// 공식 KDK 경기 추출 — MATCH SPOTLIGHT / MY RIVAL / MATCHDAY REPORT 공통 입력(순수 계산, Supabase 미의존).
//
//   · 세션 포함 기준: 상대전적과 동일한 isEligibleOfficialKdkArchive(kdk · is_official · is_test!==true).
//   · 경기 포함 기준: 상대전적과 동일한 parseCompleteMatch(완료 · 4인 · 무승부 아님).
//   · 회원 식별: 상대전적과 동일한 buildMemberResolver(id exact → legacy 이름 exact → 그 외 식별 불가).
//   · 게스트: 기본은 "식별 불가"(분석 제외). 현재 게스트 키는 이름에서 파생(`manual-guest-<이름>`)되거나
//     세션마다 새로 생성(`g-<시각>`)되므로 세션 간 동일 인물을 보장하지 못한다.
//     운영진이 확인한 식별자가 생길 때만 GuestIdentityPolicy 로 주입한다(이름만으로 병합 금지).
//   · 기준일 컷오프: beforeDate(YYYY-MM-DD) "미만" 날짜만 포함 + 현재 세션 id 명시 제외.
//     → 현재 세션 결과·기준일 이후 기록은 구조적으로 예측에 들어갈 수 없다.

import {
  buildMemberResolver,
  isEligibleOfficialKdkArchive,
  parseCompleteMatch,
  type HeadToHeadMemberRef,
} from '../../ranking/headToHead';
import { getArchiveDate, type KdkArchiveRow } from '../../kdkArchiveStats';

/** 선수 분석 키. 회원 `m:<members.id>` · 운영진 확인 게스트 `g:<식별자>` · 식별 불가 null. */
export type PlayerKey = string;

export const memberKey = (id: string): PlayerKey => `m:${id}`;
export const guestKey = (id: string): PlayerKey => `g:${id}`;
export const isMemberKey = (k: PlayerKey | null): k is PlayerKey => !!k && k.startsWith('m:');
export const memberIdOfKey = (k: PlayerKey): string | null => (k.startsWith('m:') ? k.slice(2) : null);

/**
 * 게스트 동일 인물 식별 정책. null 이면 식별 불가(분석 제외).
 *   ⚠ 이름만으로 식별자를 만들지 말 것 — 서로 다른 게스트가 합쳐진다.
 */
export interface GuestIdentityPolicy {
  resolve(archiveId: string, pid: string, name: string): string | null;
}

/** 기본 정책: 게스트는 모두 식별 불가. */
export const NO_GUEST_IDENTITY: GuestIdentityPolicy = { resolve: () => null };

/**
 * 운영진이 확인한 (원본 게스트 pid → 안정 식별자) 표 기반 정책.
 *   archiveId 별로 다르게 확인할 수 있도록 `${archiveId}::${pid}` 키를 우선, 없으면 `*::${pid}` 를 본다.
 */
export function confirmedGuestIdentity(confirmed: Record<string, string>): GuestIdentityPolicy {
  return {
    resolve(archiveId, pid) {
      return confirmed[`${archiveId}::${pid}`] ?? confirmed[`*::${pid}`] ?? null;
    },
  };
}

export interface AnalysisCutoff {
  /** 이 날짜(YYYY-MM-DD) "미만" 세션만 포함. 날짜 미상 세션은 제외(기준일 이전임을 증명 불가). */
  beforeDate: string;
  /** 추가로 제외할 Archive id(현재 세션 id 등). */
  excludeArchiveIds?: readonly string[];
}

export interface OfficialGame {
  archiveId: string;
  date: string;
  /** Archive snapshot 의 경기 id(= LIVE matches.id). 없으면 `${archiveId}#${seq}`. */
  matchId: string;
  round: number;
  /** snapshot 배열 내 순서(동일 round 안 보조 정렬). */
  seq: number;
  teamA: [PlayerKey | null, PlayerKey | null];
  teamB: [PlayerKey | null, PlayerKey | null];
  /** snapshot 당시 표시명(4명, 원본 순서). */
  names: [string, string, string, string];
  scoreA: number;
  scoreB: number;
  winner: 'A' | 'B';
}

export interface OfficialGameSet {
  games: OfficialGame[];
  /** 포함된 세션 id(오름차순). snapshot 근거 보존용. */
  archiveIds: string[];
  latestDate: string | null;
  /** 식별 불가 slot 수(게스트 미식별 + legacy orphan). */
  unidentifiedSlots: number;
  guestSlots: number;
  /** 포함 세션·경기 구성의 결정적 서명(FNV-1a). 같은 입력이면 항상 같다. */
  sourceSignature: string;
}

/** FNV-1a 32bit — 결정적 서명(암호용 아님, 변경 감지용). */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const toNum = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * 공식 KDK Archive → 기준일 이전 공식 경기 목록(시간 순).
 *   정렬: 세션 날짜 → 세션 created_at → round → snapshot 순서.
 *   ⚠ 실제 종료 시각은 저장되지 않으므로(matches.completed_at 없음) 세션 내부 순서는 round 기준이다.
 */
export function extractOfficialGames(
  archiveRows: readonly KdkArchiveRow[],
  members: readonly HeadToHeadMemberRef[],
  cutoff: AnalysisCutoff,
  guestPolicy: GuestIdentityPolicy = NO_GUEST_IDENTITY,
): OfficialGameSet {
  const resolver = buildMemberResolver([...members]);
  const excluded = new Set((cutoff.excludeArchiveIds || []).map(String));
  const before = String(cutoff.beforeDate || '');

  const rows = (archiveRows || [])
    .filter((row) => isEligibleOfficialKdkArchive(row))
    .filter((row) => !excluded.has(String(row.id)))
    .map((row) => ({ row, date: getArchiveDate(row) }))
    .filter(({ date }) => /^\d{4}-\d{2}-\d{2}/.test(date) && before !== '' && date.slice(0, 10) < before)
    .sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1
        : String(a.row.created_at || '') < String(b.row.created_at || '') ? -1
          : String(a.row.created_at || '') > String(b.row.created_at || '') ? 1
            : String(a.row.id) < String(b.row.id) ? -1 : 1);

  const games: OfficialGame[] = [];
  let unidentifiedSlots = 0;
  let guestSlots = 0;

  for (const { row, date } of rows) {
    const archiveId = String(row.id);
    const snap = Array.isArray(row.raw_data?.snapshot_data) ? row.raw_data!.snapshot_data! : [];
    const sessionGames: OfficialGame[] = [];
    snap.forEach((m: any, seq: number) => {
      const parsed = parseCompleteMatch(m);
      if (!parsed) return;
      const { pids, names, s1, s2 } = parsed;
      const keys = pids.map((pid, i): PlayerKey | null => {
        const r = resolver.resolveSlot(pid, names[i]);
        if (r === 'GUEST') {
          guestSlots += 1;
          const gid = guestPolicy.resolve(archiveId, pid, names[i]);
          if (gid) return guestKey(gid);
          unidentifiedSlots += 1;
          return null;
        }
        if (r === 'ORPHAN') { unidentifiedSlots += 1; return null; }
        return memberKey(r);
      });
      sessionGames.push({
        archiveId,
        date: date.slice(0, 10),
        matchId: String(m?.id ?? `${archiveId}#${seq}`),
        round: toNum(m?.round),
        seq,
        teamA: [keys[0], keys[1]],
        teamB: [keys[2], keys[3]],
        names: [names[0] || '', names[1] || '', names[2] || '', names[3] || ''],
        scoreA: s1,
        scoreB: s2,
        winner: s1 > s2 ? 'A' : 'B',
      });
    });
    sessionGames.sort((a, b) => a.round - b.round || a.seq - b.seq);
    games.push(...sessionGames);
  }

  const archiveIds = rows.map(({ row }) => String(row.id));
  const signatureText = `${before}|${archiveIds.join(',')}|${games.length}|`
    + games.map((g) => `${g.matchId}:${g.scoreA}-${g.scoreB}`).join(',');

  return {
    games,
    archiveIds,
    latestDate: rows.length ? rows[rows.length - 1].date.slice(0, 10) : null,
    unidentifiedSlots,
    guestSlots,
    sourceSignature: fnv1a(signatureText),
  };
}
