// 공개 Tournament Hub — 접수 현황 조회(비로그인).
//   · 원본 테이블(hosted_tournament_registrations)을 클라이언트가 직접 SELECT 하지 않는다.
//     공개 RPC get_public_tournament(slug) 만 사용하며, 응답에는 개인정보·내부 UUID 가 없다.
//   · 마이그레이션 미적용 상태(RPC 없음) → ready=false. 화면은 접수 현황을 '준비 중'으로만 표시하고
//     절대 임의의 숫자를 만들어 보여주지 않는다(가짜 접수 현황 금지).
//
//   ⚠️ 대회의 확정 정보(일시·장소·상금·참가비·정원)는 이 서비스가 아니라
//      lib/tournaments/officialInfo.ts(공식 요강 SSOT)에서 온다.

import { supabase } from '@/lib/supabase';
import type { TournamentPublicStatus } from './types';

const isMissingRelation = (err: unknown): boolean => {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = String(e?.code || '');
  const msg = String(e?.message || '');
  return (
    code === '42P01' ||
    code === 'PGRST202' ||
    code === 'PGRST205' ||
    (/hosted_tournaments|hosted_tournament_registrations|get_public_tournament/.test(msg) &&
      /does not exist|schema cache|Could not find/.test(msg))
  );
};

const toCount = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
};

export interface PublicTournamentStatusResult {
  /** false = 저장소 미적용. 접수 현황 숫자를 표시하지 않는다. */
  ready: boolean;
  status: TournamentPublicStatus | null;
}

/**
 * 공개 대회의 접수 가능 상태.
 *
 *   ⚠️ 판정의 단일 출처는 서버다. 화면에서 접수 가능 여부를 새로 계산하지 않는다.
 *      - 'open'        : 조회 성공 + 서버가 isRegistrationOpen=true       → 신청 가능
 *      - 'closed'      : 조회 성공 + 서버가 isRegistrationOpen=false      → 신청 불가(마감/미개시/진행중/종료/취소)
 *      - 'unpublished' : 조회 성공 + 대회 비공개(draft)라 서버가 null 반환 → 신청 불가
 *      - 'unknown'     : 조회 자체 실패(네트워크/RPC 미적용)              → 신청 불가(fail-closed)
 *
 *   ⚠️ 'unknown' 을 'unpublished'(접수 준비 중)로 뭉개지 않는다.
 *      "아직 열지 않음"과 "상태를 모름"은 사용자에게 다른 안내가 나가야 한다.
 */
export type PublicTournamentState =
  | { kind: 'open'; status: TournamentPublicStatus }
  | { kind: 'closed'; status: TournamentPublicStatus }
  | { kind: 'unpublished' }
  | { kind: 'unknown' };

/** CTA 표시 상태. 'full' 은 신청 가능 여부가 아니라 마감 '사유' 구분용이다. */
export type RegistrationCtaState =
  | 'loading'
  | 'open'
  | 'full'
  | 'closed'
  | 'unpublished'
  | 'unknown';

/** 상태 → CTA 표시값. 신청 허용은 'open' 하나뿐이다(그 외 전부 불가). */
export function toCtaState(state: PublicTournamentState | null): RegistrationCtaState {
  if (!state) return 'loading';
  if (state.kind === 'open') return 'open';
  if (state.kind === 'closed') {
    // 마감 사유가 '정원 만석'인 경우에만 별도 문구를 쓴다.
    return state.status.appliedCount >= state.status.maxCapacity ? 'full' : 'closed';
  }
  return state.kind; // 'unpublished' | 'unknown'
}

/**
 * 상태별 사용자 문구 — Hub 의 CTA 3곳과 /register 게이트가 같은 문구를 쓰도록 한 곳에 둔다.
 *   short 는 하단 고정 바처럼 폭이 좁은 자리에서 쓴다.
 *   ⚠️ 'unknown'(상태 확인 실패)을 'unpublished'(접수 준비 중)와 다르게 표기한다 — 뭉개지 말 것.
 */
export const CTA_COPY: Record<RegistrationCtaState, { title: string; sub?: string; short: string }> = {
  loading:     { title: '접수 상태 확인 중', short: '확인 중' },
  open:        { title: '참가 신청하기', short: '참가 신청하기' },
  full:        { title: '접수 마감', sub: '모집 정원이 모두 찼습니다', short: '접수 마감' },
  closed:      { title: '접수 마감', short: '접수 마감' },
  unpublished: { title: '접수 준비 중', sub: '접수가 시작되면 이 화면에서 신청할 수 있습니다', short: '접수 준비 중' },
  unknown:     { title: '접수 상태를 확인할 수 없습니다', sub: '잠시 후 다시 시도해 주세요', short: '확인 불가' },
};

/** CTA 상태에서 신청 진입을 허용할지. 이 함수 외의 곳에서 허용 판정을 만들지 않는다. */
export function canApply(cta: RegistrationCtaState): boolean {
  return cta === 'open';
}

const parseStatus = (d: Record<string, unknown>): TournamentPublicStatus => ({
  appliedCount: toCount(d.appliedCount),
  targetCapacity: toCount(d.targetCapacity),
  maxCapacity: toCount(d.maxCapacity),
  isRegistrationOpen: d.isRegistrationOpen === true,
});

/**
 * 공개 대회 상태 조회.
 *   조회 '실패'(throw)와 조회 성공 후의 'null'(비공개)을 구분한다 — 기존에는 둘 다 뭉개고 있었다.
 *   실패 시 1회만 자동 재시도하고, 그래도 실패하면 'unknown' 으로 닫는다(fail-closed).
 *   RPC 미적용(PGRST202 등)은 재시도해도 결과가 같으므로 즉시 'unknown'.
 */
export async function fetchPublicTournamentState(slug: string): Promise<PublicTournamentState> {
  const attempt = async (): Promise<PublicTournamentState> => {
    const { data, error } = await supabase.rpc('get_public_tournament', { p_slug: slug });
    if (error) throw error;
    // 조회는 성공했는데 본문이 없다 = 서버가 "공개할 대회 없음"이라고 답한 것(draft).
    if (!data || typeof data !== 'object') return { kind: 'unpublished' };
    const status = parseStatus(data as Record<string, unknown>);
    return status.isRegistrationOpen ? { kind: 'open', status } : { kind: 'closed', status };
  };

  try {
    return await attempt();
  } catch (err) {
    if (isMissingRelation(err)) return { kind: 'unknown' };
    console.warn('[tournaments] 접수 상태 조회 실패 — 1회 재시도:', err);
    try {
      return await attempt();              // 자동 재시도 1회
    } catch (err2) {
      console.warn('[tournaments] 접수 상태 재조회 실패 — 신청 차단(fail-closed):', err2);
      return { kind: 'unknown' };
    }
  }
}

/**
 * 접수 현황(숫자) 조회 — 기존 형태 유지.
 *   ⚠️ 이 함수는 '표시용 숫자'만 준다. 접수 가능 여부 판정에 쓰지 말 것(fetchPublicTournamentState 사용).
 */
export async function fetchPublicTournamentStatus(
  slug: string,
): Promise<PublicTournamentStatusResult> {
  const state = await fetchPublicTournamentState(slug);
  if (state.kind === 'open' || state.kind === 'closed') {
    return { ready: true, status: state.status };
  }
  return { ready: false, status: null };
}

// ── 공개 참가팀 현황 ─────────────────────────────────────────────────────────
//   get_public_tournament_teams 는 개인정보 없이 접수순번/선수명/클럽명/공개상태만 돌려준다.
//   ⚠ 입금 상태는 서버가 아예 반환하지 않는다(운영 내부 정보) — 화면에서 만들어 붙이지 말 것.

export interface PublicTournamentTeam {
  sequenceNo: number;
  player1Name: string;
  player2Name: string;
  /** 선수별 클럽. 신규 신청부터 채워진다. 미보정 기존 건은 null. */
  player1ClubName: string | null;
  player2ClubName: string | null;
  /** legacy 팀 단위 클럽(참가자가 한 칸에 입력한 원본). 선수별 값이 없을 때만 fallback 으로 쓴다. */
  clubName: string | null;
  /** 'applied' | 'waitlisted' | 'confirmed' */
  publicStatus: 'applied' | 'waitlisted' | 'confirmed';
}

export interface PublicTournamentTeamsResult {
  /** false = 저장소 미적용/조회 실패. 목록을 비워 두고 '준비 중'으로 안내한다. */
  ready: boolean;
  teams: PublicTournamentTeam[];
}

export async function fetchPublicTournamentTeams(
  slug: string,
): Promise<PublicTournamentTeamsResult> {
  try {
    const { data, error } = await supabase.rpc('get_public_tournament_teams', { p_slug: slug });
    if (error) throw error;
    const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
    return {
      ready: true,
      teams: rows.map((r) => ({
        sequenceNo: toCount(r.sequenceNo),
        player1Name: String(r.player1Name || ''),
        player2Name: String(r.player2Name || ''),
        player1ClubName: (r.player1ClubName as string) ?? null,
        player2ClubName: (r.player2ClubName as string) ?? null,
        clubName: (r.clubName as string) ?? null,
        publicStatus: (r.publicStatus as PublicTournamentTeam['publicStatus']) || 'applied',
      })),
    };
  } catch (err) {
    if (!isMissingRelation(err)) console.warn('[tournaments] 참가팀 조회 실패:', err);
    return { ready: false, teams: [] };
  }
}
