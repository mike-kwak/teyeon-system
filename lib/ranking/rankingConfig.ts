// TEYEON Ranking 산식 config — 조회/검증/저장/publish 계층.
//   · 유효 산식 = ranking_config 의 season_key 별 최신 published. 없거나 조회 실패면
//     DEFAULT_RANKING_CONFIG(현재 고정 산식)로 폴백 → 앱은 config 미존재에도 정상 동작한다.
//   · 쓰기(draft/publish)는 Ranking Manager(CEO OR ranking_managers) 만. RLS + RPC 로 서버 강제.
//   · core(clubRankingCore)는 이 파일에 의존하지 않는다(순수 유지) — 값 주입은 service 계층이 담당.
import { supabase } from '../supabase';
import { DEFAULT_RANKING_CONFIG, type RankingConfigValues } from './clubRankingCore';

export type { RankingConfigValues } from './clubRankingCore';
export { DEFAULT_RANKING_CONFIG } from './clubRankingCore';

export type RankingConfigStatus = 'draft' | 'published' | 'archived';

/** ranking_config row(표시/이력용). values 는 RankingConfigValues 와 동일 필드. */
export interface RankingConfigRow extends RankingConfigValues {
  id: string;
  seasonKey: string;
  version: number;
  status: RankingConfigStatus;
  reason: string | null;
  changedBy: string | null;
  createdAt: string;
}

/** 값 범위(코드 clamp + DB CHECK 이중 방어). */
export const RANKING_CONFIG_LIMITS = {
  weight: { min: 0, max: 1000 },        // participation/win/bonus*
  minSessions: { min: 1, max: 100 },
  bestWinrateMinGames: { min: 1, max: 1000 },
} as const;

const clampInt = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? '').trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
};

/** 입력값을 안전 범위로 정규화(음수/과대/비정수 차단). 검증 실패 필드는 기본값으로 대체하지 않고 clamp. */
export function normalizeRankingConfig(input: Partial<RankingConfigValues>): RankingConfigValues {
  const w = RANKING_CONFIG_LIMITS.weight;
  return {
    participation: clampInt(input.participation, w.min, w.max, DEFAULT_RANKING_CONFIG.participation),
    win: clampInt(input.win, w.min, w.max, DEFAULT_RANKING_CONFIG.win),
    bonusFirst: clampInt(input.bonusFirst, w.min, w.max, DEFAULT_RANKING_CONFIG.bonusFirst),
    bonusSecond: clampInt(input.bonusSecond, w.min, w.max, DEFAULT_RANKING_CONFIG.bonusSecond),
    bonusThird: clampInt(input.bonusThird, w.min, w.max, DEFAULT_RANKING_CONFIG.bonusThird),
    minSessions: clampInt(input.minSessions, RANKING_CONFIG_LIMITS.minSessions.min, RANKING_CONFIG_LIMITS.minSessions.max, DEFAULT_RANKING_CONFIG.minSessions),
    bestWinrateMinGames: clampInt(input.bestWinrateMinGames, RANKING_CONFIG_LIMITS.bestWinrateMinGames.min, RANKING_CONFIG_LIMITS.bestWinrateMinGames.max, DEFAULT_RANKING_CONFIG.bestWinrateMinGames),
    formulaVersion: input.formulaVersion === 2 ? 2 : 1,
  };
}

/** 엄격 검증 — 범위 밖이면 사유 목록 반환(빈 배열 = 유효). UI 저장 전 확인용. */
export function validateRankingConfig(input: RankingConfigValues): string[] {
  const errs: string[] = [];
  const w = RANKING_CONFIG_LIMITS.weight;
  const chk = (label: string, v: number, lo: number, hi: number) => {
    if (!Number.isInteger(v) || v < lo || v > hi) errs.push(`${label}은(는) ${lo}~${hi} 정수여야 합니다.`);
  };
  chk('참가 점수', input.participation, w.min, w.max);
  chk('승리 점수', input.win, w.min, w.max);
  chk('1위 점수', input.bonusFirst, w.min, w.max);
  chk('2위 점수', input.bonusSecond, w.min, w.max);
  chk('3위 점수', input.bonusThird, w.min, w.max);
  chk('최소 참가 횟수', input.minSessions, RANKING_CONFIG_LIMITS.minSessions.min, RANKING_CONFIG_LIMITS.minSessions.max);
  chk('최고 승률상 최소 경기 수', input.bestWinrateMinGames, RANKING_CONFIG_LIMITS.bestWinrateMinGames.min, RANKING_CONFIG_LIMITS.bestWinrateMinGames.max);
  if (input.formulaVersion !== 1 && input.formulaVersion !== 2) errs.push('산식 버전은 1 또는 2 여야 합니다.');
  return errs;
}

const isMissingRelation = (err: unknown): boolean => {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = String(e?.code || '');
  const msg = String(e?.message || '');
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST202' ||
    ((msg.includes('ranking_config') || msg.includes('publish_ranking_config') || msg.includes('can_manage_ranking')) &&
      (msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('Could not find')));
};

const mapRow = (r: any): RankingConfigRow => ({
  id: String(r.id),
  seasonKey: String(r.season_key),
  version: Number(r.version),
  status: r.status as RankingConfigStatus,
  reason: r.reason ?? null,
  changedBy: r.changed_by ?? null,
  createdAt: String(r.created_at),
  participation: Number(r.participation),
  win: Number(r.win),
  bonusFirst: Number(r.bonus_first),
  bonusSecond: Number(r.bonus_second),
  bonusThird: Number(r.bonus_third),
  minSessions: Number(r.min_sessions),
  bestWinrateMinGames: Number(r.best_winrate_min_games),
  // formula_version 컬럼 미배포(마이그레이션 전) 또는 레거시 row → 1(현행 산식) 로 안전 폴백.
  formulaVersion: Number(r.formula_version) === 2 ? 2 : 1,
});

const pickValues = (r: RankingConfigRow): RankingConfigValues => ({
  participation: r.participation, win: r.win,
  bonusFirst: r.bonusFirst, bonusSecond: r.bonusSecond, bonusThird: r.bonusThird,
  minSessions: r.minSessions, bestWinrateMinGames: r.bestWinrateMinGames,
  formulaVersion: r.formulaVersion,
});

/** season_key 를 config 조회용 문자열로. number → 'YYYY', 'all' → 'all', {year,month} → season 은 config 미분리라 'YYYY'. */
export function seasonKeyOf(season: number | 'all' | { year: number; month: number }): string {
  if (season === 'all') return 'all';
  if (typeof season === 'number') return String(season);
  return String(season.year); // 월간은 연도 시즌 config 를 공유(1차 범위: 월간 별도 config 없음).
}

/**
 * 유효(published) 산식 조회 — 없거나 조회 실패면 DEFAULT_RANKING_CONFIG 로 폴백.
 * 절대 throw 하지 않는다(랭킹 화면 무장애 원칙). fromDefault=true 면 폴백된 값이다.
 */
export async function getActiveRankingConfig(
  season: number | 'all' | { year: number; month: number },
): Promise<{ values: RankingConfigValues; fromDefault: boolean; row: RankingConfigRow | null }> {
  const seasonKey = seasonKeyOf(season);
  try {
    const { data, error } = await supabase
      .from('ranking_config')
      .select('*')
      .eq('season_key', seasonKey)
      .eq('status', 'published')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      const row = mapRow(data);
      return { values: pickValues(row), fromDefault: false, row };
    }
  } catch (err) {
    if (!isMissingRelation(err)) console.warn('[rankingConfig] published 조회 실패 — 기본 산식 폴백:', err);
  }
  return { values: DEFAULT_RANKING_CONFIG, fromDefault: true, row: null };
}

/** 매니저용 — 해당 시즌 전체 버전 이력(내림차순). 무권한/미생성이면 빈 배열. */
export async function listRankingConfigHistory(seasonKey: string): Promise<RankingConfigRow[]> {
  try {
    const { data, error } = await supabase
      .from('ranking_config')
      .select('*')
      .eq('season_key', seasonKey)
      .order('version', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapRow);
  } catch (err) {
    if (!isMissingRelation(err)) console.warn('[rankingConfig] 이력 조회 실패:', err);
    return [];
  }
}

/** 현재 사용자가 랭킹 매니저(CEO OR ranking_managers)인지 — RPC. 미생성/실패 시 false(안전). */
export async function fetchCanManageRanking(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('can_manage_ranking');
    if (error) throw error;
    return data === true;
  } catch (err) {
    if (!isMissingRelation(err)) console.warn('[rankingConfig] can_manage_ranking 실패:', err);
    return false;
  }
}

/** Draft 저장(INSERT) — 다음 version 은 서버에서 계산하지 않고 이력 최대+1 을 클라가 제안(충돌 시 재시도 권장). */
export async function saveRankingDraft(
  seasonKey: string,
  values: RankingConfigValues,
  reason: string,
): Promise<RankingConfigRow> {
  const v = normalizeRankingConfig(values);
  const history = await listRankingConfigHistory(seasonKey);
  const nextVersion = (history[0]?.version ?? 0) + 1;
  const { data, error } = await supabase
    .from('ranking_config')
    .insert({
      season_key: seasonKey, version: nextVersion,
      participation: v.participation, win: v.win,
      bonus_first: v.bonusFirst, bonus_second: v.bonusSecond, bonus_third: v.bonusThird,
      min_sessions: v.minSessions, best_winrate_min_games: v.bestWinrateMinGames,
      formula_version: v.formulaVersion,
      status: 'draft', reason: reason.trim() || null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapRow(data);
}

/** Publish — 원자 RPC(현재 published archive + 새 version published). 사유 필수(4자+). */
export async function publishRankingConfig(
  seasonKey: string,
  values: RankingConfigValues,
  reason: string,
): Promise<RankingConfigRow> {
  const v = normalizeRankingConfig(values);
  const errs = validateRankingConfig(v);
  if (errs.length) throw new Error(errs.join(' '));
  if (!reason || reason.trim().length < 4) throw new Error('변경 사유를 4자 이상 입력해주세요.');
  const { data, error } = await supabase.rpc('publish_ranking_config', {
    p_season_key: seasonKey,
    p_participation: v.participation,
    p_win: v.win,
    p_bonus_first: v.bonusFirst,
    p_bonus_second: v.bonusSecond,
    p_bonus_third: v.bonusThird,
    p_min_sessions: v.minSessions,
    p_best_winrate_min_games: v.bestWinrateMinGames,
    p_reason: reason.trim(),
    // 신규 인자(RPC 는 default 1 로 배포 순서 안전) — v1 publish 는 1, v2 publish 는 2.
    p_formula_version: v.formulaVersion,
  });
  if (error) throw error;
  return mapRow(data);
}
