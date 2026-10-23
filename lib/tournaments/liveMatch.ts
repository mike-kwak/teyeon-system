// LIVE 중계 경기 정보 — 공개 RPC(get_public_live_match) 응답을 화면용 값으로 옮긴다.
//
//   ⚠ 응답을 spread 하지 않고 필요한 필드만 '직접 골라' 담는다(화이트리스트).
//     RPC 가 나중에 필드를 추가해도 내부 ID · 점수 · 연락처가 화면이나 API 응답으로 새지 않게 하기 위함이다.
//   ⚠ 이상한 값은 버린다. 경기 정보를 지어내지 않는다(선수 이름이 비면 경기 자체를 null 로).
//   서버(API route)와 테스트가 함께 쓰는 순수 함수다 — 네트워크 · 비밀값 없음.

import type { LiveMatchInfo, LiveMatchReplay, LiveMatchState, LiveMatchTeam } from './liveTypes';

/** 이름 · 라벨 길이 상한(화면이 무너지지 않게). DB 제약(선수 이름 40자)보다 넉넉하다. */
const MAX_TEXT = 60;

export const LIVE_MATCH_UNAVAILABLE: LiveMatchState = { available: false, mode: null, match: null };

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1)}…` : t;
}

function int(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 100_000 ? v : null;
}

function team(v: unknown): LiveMatchTeam | null {
  const o = obj(v);
  if (!o) return null;
  const player1Name = text(o.player1Name);
  const player2Name = text(o.player2Name);
  if (!player1Name || !player2Name) return null;
  return { player1Name, player2Name };
}

const STAGES = new Set<LiveMatchInfo['stage']>(['preliminary', 'placement', 'knockout']);
const MODES = new Set<NonNullable<LiveMatchState['mode']>>(['auto', 'manual', 'none']);

/** 경기 한 건. 필수 값(단계 · 단계 이름 · 두 팀 선수 이름)이 하나라도 없으면 null. */
export function parseLiveMatchInfo(raw: unknown): LiveMatchInfo | null {
  const o = obj(raw);
  if (!o) return null;
  const stage = typeof o.stage === 'string' && STAGES.has(o.stage as LiveMatchInfo['stage'])
    ? (o.stage as LiveMatchInfo['stage']) : null;
  const stageLabel = text(o.stageLabel);
  const team1 = team(o.team1);
  const team2 = team(o.team2);
  if (!stage || !stageLabel || !team1 || !team2) return null;
  return {
    stage,
    stageLabel,
    matchNo: int(o.matchNo),
    courtNo: int(o.courtNo),
    courtName: text(o.courtName),
    team1,
    team2,
  };
}

/** RPC 응답 전체. 형식이 어긋나면 '조회 실패'(available=false)로 접는다. */
export function parseLiveMatchState(raw: unknown): LiveMatchState {
  const o = obj(raw);
  if (!o || o.available !== true) return LIVE_MATCH_UNAVAILABLE;
  const mode = typeof o.mode === 'string' && MODES.has(o.mode as NonNullable<LiveMatchState['mode']>)
    ? (o.mode as NonNullable<LiveMatchState['mode']>) : null;
  // 관리자가 '중계 경기 없음'을 지정했으면 경기가 와도 보여 주지 않는다.
  const match = mode === 'none' ? null : parseLiveMatchInfo(o.match);
  return { available: true, mode, match };
}

/** 화면에 쓰는 코트 이름 — 이름이 있으면 이름, 없으면 'N번 코트'. */
export function liveCourtLabel(m: LiveMatchInfo): string | null {
  if (m.courtName) return m.courtName;
  return m.courtNo !== null ? `${m.courtNo}번 코트` : null;
}

// ── 경기별 다시보기 ────────────────────────────────────────────────────────────

const HEX32 = /^[a-f0-9]{32}$/;
/** 다시보기 목록 상한 — 화면이 무너지지 않게. */
const MAX_REPLAYS = 50;

function sec(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 && n < 86_400 ? Math.round(n * 1000) / 1000 : null;
}

/**
 * 공개 RPC(get_public_live_replays) 응답 → 화면용 목록(화이트리스트).
 *   playbackBase(uid) 는 서버가 Cloudflare customer 주소로 만든 iframe URL(없으면 null).
 */
export function parseLiveMatchReplays(raw: unknown, playbackBase: (uid: string) => string | null): LiveMatchReplay[] {
  const o = obj(raw);
  if (!o || o.available !== true || !Array.isArray(o.replays)) return [];
  const out: LiveMatchReplay[] = [];
  for (const r of o.replays.slice(0, MAX_REPLAYS)) {
    const x = obj(r);
    if (!x) continue;
    const videoUid = typeof x.videoUid === 'string' && HEX32.test(x.videoUid) ? x.videoUid : null;
    const startSec = sec(x.startSec);
    const endSec = sec(x.endSec);
    const match = parseLiveMatchInfo(x.match);
    if (!videoUid || startSec === null || endSec === null || endSec <= startSec || !match) continue;
    const at = typeof x.recordedAt === 'string' && Number.isFinite(Date.parse(x.recordedAt)) ? x.recordedAt : null;
    out.push({ videoUid, startSec, endSec, recordedAt: at, title: text(x.title), match, playbackUrl: playbackBase(videoUid) });
  }
  return out;
}

/** 초 → 'm:ss' / 'h:mm:ss'(소수점 버림). */
export function formatClock(totalSec: number): string {
  const t = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s2 = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s2}` : `${m}:${s2}`;
}

/** 'm:ss' · 'h:mm:ss' · 초(소수 가능) → 초. 형식이 틀리면 null. */
export function parseClock(input: string): number | null {
  const t = input.trim();
  if (/^\d+(\.\d{1,3})?$/.test(t)) return Number(t);
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})(\.\d{1,3})?$/.exec(t);
  if (!m) return null;
  const [, h, mm, ss, frac] = m;
  if (Number(ss) > 59 || (h !== undefined && Number(mm) > 59)) return null;
  return (h ? Number(h) * 3600 : 0) + Number(mm) * 60 + Number(ss) + (frac ? Number(frac) : 0);
}
