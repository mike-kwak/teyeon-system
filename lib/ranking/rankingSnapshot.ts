// TEYEON Ranking — 시즌 종료 snapshot 계층.
//   · 계산은 clubRankingCore(computeClubRanking)가 담당. 이 파일은 그 결과를 snapshot payload 로
//     직렬화(avatarUrl 제거)·검증하고, finalize/reopen RPC 호출과 finalized snapshot 조회를 담당한다.
//   · 순수 함수(build/validate/fingerprint)와 Supabase 호출 함수를 분리했다.
import { supabase } from '../supabase';
import type { ClubRankingResult, ClubRankingEntry, ClubRankingAwards, RankingConfigValues } from './clubRankingCore';

export const RANKING_SNAPSHOT_SCHEMA_VERSION = 1;

/** snapshot 회원 행 — ClubRankingEntry 에서 avatarUrl(런타임·만료 URL) 만 제외. */
export type SnapshotEntry = Omit<ClubRankingEntry, 'avatarUrl'>;
/** snapshot 공동 수상자 — avatarUrl 제외(이름은 종료 당시 값 보존). */
export type SnapshotAwardWinner = { memberId: string; name: string; value: number };
export type SnapshotAwards = Record<
  'mostParticipation' | 'bestWinRate' | 'mostWins' | 'mostChampionships' | 'mostTop3',
  SnapshotAwardWinner[]
>;

export interface RankingSnapshotData {
  schemaVersion: number;
  generatedAt: string;
  summary: { memberCount: number; officialSessionCount: number; latestArchiveDate: string | null };
  config: { id: string | null; version: number | null } & RankingConfigValues;
  entries: SnapshotEntry[];
  awards: SnapshotAwards;
}

/** snapshot 메타 row(관리자 이력/조회용). */
export interface RankingSnapshotRow {
  id: string;
  seasonKey: string;
  seasonName: string;
  status: 'finalized' | 'superseded';
  configId: string;
  configVersion: number;
  schemaVersion: number;
  memberCount: number;
  officialSessionCount: number;
  latestArchiveDate: string | null;
  finalizeReason: string | null;
  finalizedAt: string;
  finalizedBy: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  createdAt: string;
}

const AWARD_KEYS = ['mostParticipation', 'bestWinRate', 'mostWins', 'mostChampionships', 'mostTop3'] as const;

// ── 순수 함수 ────────────────────────────────────────────────────────────────

/**
 * ClubRankingResult + 적용 config → snapshot payload. avatarUrl 은 저장하지 않는다(만료 URL·개인정보).
 * generatedAt 은 호출부에서 주입(코어/순수 계층은 시간 부작용을 갖지 않도록).
 */
export function buildSnapshotData(
  result: ClubRankingResult,
  config: { id: string | null; version: number | null; values: RankingConfigValues },
  generatedAt: string,
): RankingSnapshotData {
  const entries: SnapshotEntry[] = result.entries.map(({ avatarUrl: _omit, ...rest }) => rest);
  const awards = {} as SnapshotAwards;
  for (const k of AWARD_KEYS) {
    awards[k] = (result.awards[k] || []).map((w) => ({ memberId: w.memberId, name: w.name, value: w.value }));
  }
  return {
    schemaVersion: RANKING_SNAPSHOT_SCHEMA_VERSION,
    generatedAt,
    summary: {
      memberCount: result.aggregatedMembers,
      officialSessionCount: result.totalOfficialSessions,
      latestArchiveDate: result.latestSessionDate,
    },
    config: { id: config.id, version: config.version, ...config.values },
    entries,
    awards,
  };
}

/** snapshot payload 검증 — 빈 배열이면 유효. 저장 전 확인용(서버 RPC 검증과 이중). */
export function validateSnapshotData(data: unknown): string[] {
  const errs: string[] = [];
  const d = data as Partial<RankingSnapshotData> | null;
  if (!d || typeof d !== 'object') return ['snapshot 이 객체가 아닙니다.'];
  if (d.schemaVersion !== RANKING_SNAPSHOT_SCHEMA_VERSION) errs.push('schemaVersion 이 일치하지 않습니다.');
  if (!Array.isArray(d.entries)) errs.push('entries 가 배열이 아닙니다.');
  if (!d.awards || typeof d.awards !== 'object') errs.push('awards 가 객체가 아닙니다.');
  else for (const k of AWARD_KEYS) if (!Array.isArray((d.awards as any)[k])) errs.push(`awards.${k} 가 배열이 아닙니다.`);
  if (Array.isArray(d.entries) && d.entries.some((e) => 'avatarUrl' in (e as any))) errs.push('entries 에 avatarUrl 이 남아 있습니다.');
  return errs;
}

/**
 * 공식 Archive fingerprint — 향후 stale(정정) 감지용. 이번 단계에선 저장만 하고 UI 미사용.
 * 안정 필드가 id/created_at 뿐이라(Archive 에 updated_at/confirmed_at 없음) 그 조합으로 계산한다.
 * → 한계: 세션 '내용'이 바뀌고 created_at 이 그대로면 감지 못 함(추가/삭제·재확정은 감지). 보고에 명시.
 */
export function archiveFingerprint(rows: { id: string; created_at?: string | null }[]): string {
  const joined = rows
    .map((r) => `${r.id}:${r.created_at || ''}`)
    .sort()
    .join('|');
  // djb2 (crypto 비의존 — 충돌보다 '변화 감지'가 목적).
  let h = 5381;
  for (let i = 0; i < joined.length; i++) h = ((h << 5) + h + joined.charCodeAt(i)) >>> 0;
  return `fp1-${rows.length}-${h.toString(16)}`;
}

/** snapshot_data → ClubRankingResult 복원(avatarUrl=null → 화면 이니셜 fallback). 종료 시즌 렌더용. */
export function snapshotToResult(data: RankingSnapshotData, season: ClubRankingResult['season']): ClubRankingResult {
  const awards = { mostParticipation: [], bestWinRate: [], mostWins: [], mostChampionships: [], mostTop3: [] } as ClubRankingAwards;
  for (const k of AWARD_KEYS) awards[k] = (data.awards?.[k] || []).map((w) => ({ ...w, avatarUrl: null }));
  return {
    season,
    totalOfficialSessions: data.summary.officialSessionCount,
    aggregatedMembers: data.summary.memberCount,
    latestSessionDate: data.summary.latestArchiveDate,
    entries: (data.entries || []).map((e) => ({ ...e, avatarUrl: null })),
    awards,
  };
}

// ── Supabase 호출 ────────────────────────────────────────────────────────────

const isMissingRelation = (err: unknown): boolean => {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = String(e?.code || '');
  const msg = String(e?.message || '');
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST202' ||
    ((msg.includes('ranking_snapshots') || msg.includes('finalize_ranking_season') || msg.includes('reopen_ranking_season')) &&
      (msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('Could not find')));
};

const mapRow = (r: any): RankingSnapshotRow => ({
  id: String(r.id), seasonKey: String(r.season_key), seasonName: String(r.season_name),
  status: r.status, configId: String(r.config_id), configVersion: Number(r.config_version),
  schemaVersion: Number(r.schema_version), memberCount: Number(r.member_count),
  officialSessionCount: Number(r.official_session_count), latestArchiveDate: r.latest_archive_date ?? null,
  finalizeReason: r.finalize_reason ?? null, finalizedAt: String(r.finalized_at), finalizedBy: r.finalized_by ?? null,
  reopenedAt: r.reopened_at ?? null, reopenReason: r.reopen_reason ?? null, createdAt: String(r.created_at),
});

/**
 * 시즌의 finalized snapshot 조회.
 *   · 없음 → null(라이브 계산 경로).
 *   · 테이블 미생성(마이그레이션 전) → null(기존 전 시즌 live 로 무장애 폴백).
 *   · 그 외 조회 오류 → throw(호출부가 잘못된 live 로 대체하지 않도록 — finalized 상태 미확정).
 */
export async function getFinalizedSnapshot(
  seasonKey: string,
): Promise<{ data: RankingSnapshotData; row: RankingSnapshotRow } | null> {
  try {
    const { data, error } = await supabase
      .from('ranking_snapshots')
      .select('*')
      .eq('season_key', seasonKey)
      .eq('status', 'finalized')
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { data: (data as any).snapshot_data as RankingSnapshotData, row: mapRow(data) };
  } catch (err) {
    if (isMissingRelation(err)) return null; // 마이그레이션 전 — 안전 폴백
    throw err; // 실제 오류 — finalized 상태 미확정 → 상위에서 오류 처리
  }
}

/** 공개 시즌 key 판정 — 4자리 연도 AND 현재 연도 이하(미래 시즌 = 테스트 2099 등 제외). */
export function isPublicSeasonKey(seasonKey: string, currentYear: number): boolean {
  if (!/^\d{4}$/.test(seasonKey)) return false;
  return Number(seasonKey) <= currentYear;
}

/** 일반 회원 selector 용 finalized 시즌 메타(공개 안전 필드만 — 내부 id/finalized_by/사유 미포함). */
export interface FinalizedSeasonMeta {
  seasonKey: string;
  year: number;
  seasonName: string;
  finalizedAt: string;
  configVersion: number;
  memberCount: number;
  officialSessionCount: number;
}

/** 일반 회원 시즌 selector 옵션. isFinal=true 면 finalized snapshot, false 면 진행 중(live). */
export interface SeasonOption {
  year: number;
  isFinal: boolean;
  meta: FinalizedSeasonMeta | null;
}

/**
 * finalized 시즌 목록 — RLS 로 authenticated 는 finalized 만 읽는다(superseded 미노출).
 *   공개 안전 필드만 select(내부 id/finalized_by/finalize_reason/reopen_reason/fingerprint 제외).
 *   미생성/조회 실패 시 빈 배열(진행 시즌만 노출되도록 안전 폴백).
 */
export async function listFinalizedRankingSeasons(): Promise<FinalizedSeasonMeta[]> {
  try {
    const { data, error } = await supabase
      .from('ranking_snapshots')
      .select('season_key, season_name, finalized_at, config_version, member_count, official_session_count')
      .eq('status', 'finalized')
      .order('season_key', { ascending: false });
    if (error) throw error;
    return (data || [])
      .map((r: any) => ({
        seasonKey: String(r.season_key),
        year: Number(r.season_key),
        seasonName: String(r.season_name || ''),
        finalizedAt: String(r.finalized_at),
        configVersion: Number(r.config_version),
        memberCount: Number(r.member_count),
        officialSessionCount: Number(r.official_session_count),
      }))
      .filter((m) => /^\d{4}$/.test(m.seasonKey));
  } catch (err) {
    if (!isMissingRelation(err)) console.warn('[rankingSnapshot] finalized 시즌 목록 조회 실패:', err);
    return [];
  }
}

/**
 * 일반 회원 시즌 selector 옵션 구성.
 *   · 현재 연도는 항상 포함(finalized 없으면 LIVE, 있으면 FINAL).
 *   · finalized 시즌은 포함하되 **미래 연도(현재 연도 초과)는 제외**(테스트 2099 등).
 *   · superseded 는 애초에 목록에 없음(RLS + finalized-only 조회).
 */
export function buildAvailableSeasons(currentYear: number, finalized: FinalizedSeasonMeta[]): SeasonOption[] {
  const map = new Map<number, SeasonOption>();
  map.set(currentYear, { year: currentYear, isFinal: false, meta: null });
  for (const f of finalized) {
    if (!Number.isFinite(f.year) || f.year > currentYear) continue; // 미래 시즌 제외
    map.set(f.year, { year: f.year, isFinal: true, meta: f });
  }
  return [...map.values()].sort((a, b) => b.year - a.year);
}

/** 시즌 snapshot 이력(finalized + superseded) — 매니저 화면용. 미생성/무권한 시 빈 배열. */
export async function listSnapshots(seasonKey: string): Promise<RankingSnapshotRow[]> {
  try {
    const { data, error } = await supabase
      .from('ranking_snapshots')
      .select('*')
      .eq('season_key', seasonKey)
      .order('finalized_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapRow);
  } catch (err) {
    if (!isMissingRelation(err)) console.warn('[rankingSnapshot] 이력 조회 실패:', err);
    return [];
  }
}

export interface FinalizeSeasonInput {
  seasonKey: string;
  seasonName: string;
  configId: string;
  configVersion: number;
  snapshotData: RankingSnapshotData;
  memberCount: number;
  officialSessionCount: number;
  latestArchiveDate: string | null;
  archiveFingerprint: string | null;
  finalizeReason: string;
}

/** 시즌 종료(finalize) — 원자 RPC. 저장 전 payload 검증 + 사유 확인. */
export async function finalizeSeason(input: FinalizeSeasonInput): Promise<RankingSnapshotRow> {
  const errs = validateSnapshotData(input.snapshotData);
  if (errs.length) throw new Error(errs.join(' '));
  if (!input.finalizeReason || input.finalizeReason.trim().length < 4) throw new Error('종료 사유를 4자 이상 입력해주세요.');
  const { data, error } = await supabase.rpc('finalize_ranking_season', {
    p_season_key: input.seasonKey,
    p_season_name: input.seasonName,
    p_config_id: input.configId,
    p_config_version: input.configVersion,
    p_snapshot_data: input.snapshotData,
    p_member_count: input.memberCount,
    p_official_session_count: input.officialSessionCount,
    p_latest_archive_date: input.latestArchiveDate,
    p_archive_fingerprint: input.archiveFingerprint,
    p_finalize_reason: input.finalizeReason.trim(),
  });
  if (error) throw error;
  return mapRow(data);
}

/** 시즌 재오픈(reopen) — CEO only(서버 재검증). finalized → superseded. */
export async function reopenSeason(seasonKey: string, reason: string): Promise<RankingSnapshotRow> {
  if (!reason || reason.trim().length < 4) throw new Error('재오픈 사유를 4자 이상 입력해주세요.');
  const { data, error } = await supabase.rpc('reopen_ranking_season', {
    p_season_key: seasonKey,
    p_reopen_reason: reason.trim(),
  });
  if (error) throw error;
  return mapRow(data);
}
