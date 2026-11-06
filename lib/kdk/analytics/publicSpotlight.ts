// MATCH SPOTLIGHT 공개 DTO · 관전 포인트 문구 · 공유 문구 — 순수 계산.
//
//   공개(anon) 응답에 들어가는 값은 이 파일이 만드는 것뿐이다(allow-list).
//     ✔ 선수 표시명 · 경기 번호 · 라운드 · 조 · 배지 · 관전 포인트 · 설명형 예측 라벨 · 표본 수 · 신뢰도
//     ✘ members.id · auth id · 연락처 · 이메일 · 분석 키 · factors 원본 · 숫자 확률 · 비공개(private/partial) 회원 개인 수치
//   ⚠ 1차 공개 정책(2026-11-03): 숫자 승리 확률은 공개 DTO 에 넣지 않는다(prob 은 비공개 snapshot 에만 저장).
//   문구는 SpotlightFact(결정적 사실)로만 만든다. AI 미사용.

import type { SpotlightPredictionSnapshot, SpotlightBuildResult } from './spotlightEngine';
import type { SpotlightType } from './spotlight';
import { clipPlayerName } from './playerName';

export const PUBLIC_SPOTLIGHT_SCHEMA = 1;

export const SPOTLIGHT_BADGE_LABEL: Record<SpotlightType, string> = {
  RIVAL: 'RIVAL',
  CLOSE: 'CLOSE',
  HOT_STREAK: 'HOT STREAK',
  POWER: 'POWER',
};

export const SPOTLIGHT_DISCLAIMER =
  '공식 KDK 기록을 바탕으로 한 참고용 분석이며, 경기 결과를 보장하지 않습니다.';

export type PublicPrediction =
  | { kind: 'label'; text: '팀 A 우세' | '팀 B 우세' | '박빙' }
  | { kind: 'insufficient' };

export type PublicConfidence = '높음' | '보통' | '참고' | '데이터 부족';

export interface PublicMatchAnalysis {
  matchNo: number;
  round: number;
  group: string;
  teamA: [string, string];
  teamB: [string, string];
  badge: SpotlightType | null;
  prediction: PublicPrediction;
  confidence: PublicConfidence;
  /** 공개 가능한 선수의 공식 경기 수 범위. 공개 가능한 선수가 없으면 null. */
  sampleRange: { min: number; max: number } | null;
  /** 분석에서 제외된 선수 수(식별 불가 게스트·표본 부족). */
  unanalyzedPlayers: number;
  /** 운영진 관전 포인트 — 운영진이 승인한 문구 그대로(공식 분석과 별개 · 최대 120자). 없으면 생략. */
  operatorPoint?: string;
}

export interface PublicSpotlightItem extends PublicMatchAnalysis {
  badge: SpotlightType;
  headline: string;
  viewpoint: string;
  /** 운영진 PICK — 자동 TOP 대신 운영진이 고른 경기(배지 · 분석 문구는 공식 분석 그대로). */
  operatorPick?: boolean;
}

/** 운영진 관전 포인트가 있을 때 덧붙이는 안내. */
export const OPERATOR_POINT_NOTICE = '운영진 관전 포인트는 운영진이 제공한 현장 정보이며 공식 기록이 아닙니다.';
export const OPERATOR_PICK_LABEL = '운영진 PICK';

export interface PublicSpotlightPayload {
  schema: number;
  modelVersion: string;
  title: string;
  date: string;
  items: PublicSpotlightItem[];
  /** 하단 "전체 경기 분석"(기본 접힘). */
  matches: PublicMatchAnalysis[];
  disclaimer: string;
}

const CONFIDENT_GAMES = 30;

const teamText = (names: readonly string[]): string => names.filter(Boolean).join('·') || '미정';

function publicPrediction(p: SpotlightPredictionSnapshot): PublicPrediction {
  const pr = p.prediction;
  if (pr.tier === 'insufficient' || pr.probA === null) return { kind: 'insufficient' };
  return { kind: 'label', text: pr.label === 'close' ? '박빙' : pr.label === 'favoredA' ? '팀 A 우세' : '팀 B 우세' };
}

function confidenceOf(p: SpotlightPredictionSnapshot): PublicConfidence {
  const pr = p.prediction;
  if (pr.tier === 'insufficient') return '데이터 부족';
  if (pr.tier === 'reference') return '참고';
  return (pr.samples.minGames ?? 0) >= CONFIDENT_GAMES ? '높음' : '보통';
}

function sampleRangeOf(p: SpotlightPredictionSnapshot): { min: number; max: number } | null {
  const counts = p.prediction.samples.slots
    .filter((s) => !p.restrictedSlots[s.slot] && s.games !== null && s.analyzable)
    .map((s) => s.games as number);
  return counts.length ? { min: Math.min(...counts), max: Math.max(...counts) } : null;
}

export function toPublicMatch(p: SpotlightPredictionSnapshot): PublicMatchAnalysis {
  return {
    matchNo: p.matchNo,
    round: p.round,
    group: p.groupName,
    teamA: [p.playerNames[0], p.playerNames[1]],
    teamB: [p.playerNames[2], p.playerNames[3]],
    badge: p.mainType,
    prediction: publicPrediction(p),
    confidence: confidenceOf(p),
    sampleRange: sampleRangeOf(p),
    unanalyzedPlayers: p.prediction.samples.slots.filter((s) => !s.analyzable).length,
  };
}

/** 메인 배지 사실 → 헤드라인 · 관전 포인트(템플릿, 조사 없는 문장 구조로 이름 받침 문제 회피). */
export function describeSpotlight(p: SpotlightPredictionSnapshot): { headline: string; viewpoint: string } | null {
  const main = p.candidates.find((c) => c.type === p.mainType);
  if (!main) return null;
  const n = p.playerNames;
  const f = main.fact;
  switch (f.type) {
    case 'RIVAL': {
      const a = n[f.aSlot];
      const b = n[f.bSlot];
      if (f.kind === 'fated') {
        return { headline: '숙명의 라이벌', viewpoint: `${a} vs ${b} · 공식 맞대결 ${f.aWins}승 ${f.bWins}패. 팽팽한 균형이 오늘 깨질까?` };
      }
      if (f.kind === 'nemesis') {
        const aLeads = f.aWins > f.bWins;
        const leader = aLeads ? a : b;
        const chaser = aLeads ? b : a;
        const cw = aLeads ? f.bWins : f.aWins;
        const cl = aLeads ? f.aWins : f.bWins;
        return { headline: '천적 관계', viewpoint: `${chaser} → ${leader} 상대 공식 ${cw}승 ${cl}패. 오늘은 설욕전이 될까?` };
      }
      return { headline: '라이벌 매치', viewpoint: `${a} vs ${b} · 공식 맞대결 ${f.aWins}승 ${f.bWins}패.` };
    }
    case 'HOT_STREAK':
      return { headline: `${f.streak}연승 도전`, viewpoint: `${n[f.slot]} 공식 ${f.streak}연승 중(라운드 순서 기준). 연승 행진이 이어질까?` };
    case 'CLOSE':
      return { headline: '박빙 승부', viewpoint: '공식 기록상 두 팀의 전력 차가 거의 없는 경기. 한 포인트 싸움이 예상됩니다.' };
    case 'POWER':
      return { headline: '강자들의 대결', viewpoint: `네 명 모두 공식 ${f.minGames}경기 이상 · 기록이 증명한 강자들의 맞대결.` };
    default:
      return null;
  }
}

export function buildPublicSpotlightPayload(
  result: SpotlightBuildResult,
  meta: { title: string; date: string },
): PublicSpotlightPayload {
  const byId = new Map(result.predictions.map((p) => [p.matchId, p]));
  const items: PublicSpotlightItem[] = [];
  for (const id of result.selection.matchIds) {
    const p = byId.get(id);
    if (!p || !p.mainType) continue;
    const d = describeSpotlight(p);
    if (!d) continue;
    items.push({ ...toPublicMatch(p), badge: p.mainType, headline: d.headline, viewpoint: d.viewpoint });
  }
  return {
    schema: PUBLIC_SPOTLIGHT_SCHEMA,
    modelVersion: result.modelVersion,
    title: String(meta.title || '').slice(0, 60),
    date: String(meta.date || '').slice(0, 10),
    items,
    matches: result.predictions.map(toPublicMatch),
    disclaimer: SPOTLIGHT_DISCLAIMER,
  };
}

/** 카카오톡 단톡방에 붙여넣을 공유 문구(운영진 복사용). */
export function buildSpotlightShareText(payload: PublicSpotlightPayload, url: string): string {
  const lines: string[] = [];
  lines.push("[TEYEON] TODAY'S SPOTLIGHT · 오늘의 주목 경기");
  lines.push(`${payload.title}${payload.date ? ` · ${payload.date}` : ''}`);
  lines.push('');
  if (payload.items.length === 0) {
    lines.push('오늘은 공식 기록상 특별히 주목할 경기가 선정되지 않았습니다.');
  } else {
    payload.items.forEach((it, i) => {
      lines.push(`${i + 1}. [${SPOTLIGHT_BADGE_LABEL[it.badge]}]${it.operatorPick ? ` [${OPERATOR_PICK_LABEL}]` : ''} R${it.round} · ${it.matchNo}경기`);
      lines.push(`   ${teamText(it.teamA)} vs ${teamText(it.teamB)}`);
      lines.push(`   ${it.headline} — ${it.viewpoint}`);
      if (it.operatorPoint) lines.push(`   운영진 관전 포인트: ${it.operatorPoint}`);
    });
  }
  lines.push('');
  lines.push(`전체 경기 분석 보기 👉 ${url}`);
  lines.push(`※ ${payload.disclaimer}`);
  if (payload.matches.some((m) => m.operatorPoint) || payload.items.some((m) => m.operatorPoint)) lines.push(`※ ${OPERATOR_POINT_NOTICE}`);
  return lines.join('\n');
}

// ── 공개 응답 파서(allow-list 재구성) ─────────────────────────────────────────
//   DB(public_payload)에서 받은 값을 그대로 렌더하지 않고, 허용 필드만 타입을 확인해 다시 만든다.
//   예상 밖 필드(내부 id 등)가 섞여 있어도 화면·메타데이터로 흘러가지 않는다.
const BADGES: readonly SpotlightType[] = ['RIVAL', 'CLOSE', 'HOT_STREAK', 'POWER'];
const LABELS = ['팀 A 우세', '팀 B 우세', '박빙'] as const;
const CONFIDENCES: readonly PublicConfidence[] = ['높음', '보통', '참고', '데이터 부족'];
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0);
const nameOf = (v: unknown): string => (typeof v === 'string' ? clipPlayerName(v) : '');
const pair = (v: unknown): [string, string] => {
  const a = Array.isArray(v) ? v : [];
  return [nameOf(a[0]), nameOf(a[1])];
};

function parseMatch(v: unknown): PublicMatchAnalysis | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const p = (o.prediction && typeof o.prediction === 'object' ? o.prediction : {}) as Record<string, unknown>;
  const prediction: PublicPrediction = p.kind === 'label' && (LABELS as readonly string[]).includes(String(p.text))
    ? { kind: 'label', text: p.text as (typeof LABELS)[number] }
    : { kind: 'insufficient' };
  const sr = o.sampleRange && typeof o.sampleRange === 'object' ? (o.sampleRange as Record<string, unknown>) : null;
  return {
    matchNo: int(o.matchNo),
    round: int(o.round),
    group: str(o.group, 12),
    teamA: pair(o.teamA),
    teamB: pair(o.teamB),
    badge: BADGES.includes(o.badge as SpotlightType) ? (o.badge as SpotlightType) : null,
    prediction,
    confidence: CONFIDENCES.includes(o.confidence as PublicConfidence) ? (o.confidence as PublicConfidence) : '데이터 부족',
    sampleRange: sr ? { min: int(sr.min), max: int(sr.max) } : null,
    unanalyzedPlayers: Math.max(0, Math.min(4, int(o.unanalyzedPlayers))),
    ...(operatorPointOf(o.operatorPoint) ? { operatorPoint: operatorPointOf(o.operatorPoint) as string } : {}),
  };
}

// 운영진 관전 포인트(allow-list) — 문자열 · 꺾쇠 제거 · 제어문자 정리 · 120자. 비면 생략.
// eslint-disable-next-line no-control-regex
const operatorPointOf = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/[<>]/g, '').replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return t ? [...t].slice(0, 120).join('') : null;
};

export function parsePublicSpotlightPayload(v: unknown): PublicSpotlightPayload | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const items: PublicSpotlightItem[] = [];
  for (const raw of Array.isArray(o.items) ? o.items.slice(0, 5) : []) {
    const m = parseMatch(raw);
    const r = raw as Record<string, unknown>;
    if (!m || !m.badge) continue;
    items.push({ ...m, badge: m.badge, headline: str(r.headline, 40), viewpoint: str(r.viewpoint, 160),
      ...(r.operatorPick === true ? { operatorPick: true } : {}) });
  }
  const matches = (Array.isArray(o.matches) ? o.matches.slice(0, 80) : [])
    .map(parseMatch)
    .filter((m): m is PublicMatchAnalysis => !!m);
  return {
    schema: PUBLIC_SPOTLIGHT_SCHEMA,
    modelVersion: str(o.modelVersion, 40),
    title: str(o.title, 60),
    date: str(o.date, 10),
    items,
    matches,
    disclaimer: SPOTLIGHT_DISCLAIMER,
  };
}
