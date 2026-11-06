// MATCH SPOTLIGHT 운영 API 핸들러 — 의존성 주입형(네트워크·env 미사용 → 보안 테스트 가능).
//
//   흐름: Bearer 토큰 → 사용자 확인 → 관리 권한 확인 → action 실행.
//     관리 권한 = 기존 KDK 관리자 체계 그대로: 사용자 토큰으로 can_manage_kdk() 호출(CEO · ADMIN · kdk_managers 등재 회원).
//     can_manage_kdk 가 없는 DB(SQL 30 미적용)에서만 예전 규칙(profiles.role CEO/ADMIN)으로 판정한다(권한 확대 없음).
//     generate  : DB 원본(matches · 공식 Archive · members · 공개 범위)으로 서버가 직접 계산 → save RPC.
//                 ⚠ 요청 body 의 확률·선정·payload 는 읽지 않는다(sessionId 만 사용).
//                 RPC 가 stale_matches 로 거부한 경기는 제외하고 1회만 재계산·재시도.
//     publish   : 저장 snapshot + 현재 선수 구성 + 현재 공개 범위로 DTO 재구성(preparePublish) → publish RPC.
//     unpublish : unpublish RPC.
//   공개 범위 조회 실패 시 생성/공개를 거부한다(fail-closed — 비공개 회원 수치 노출 방지).

import { buildSpotlight, type SessionMatchRow } from '../analytics/spotlightEngine';
import { buildPublicSpotlightPayload } from '../analytics/publicSpotlight';
import { preparePublish, type StoredPredictionForPublish } from '../analytics/spotlightPublish';
import type { HeadToHeadMemberRef } from '../../ranking/headToHead';
import type { KdkArchiveRow } from '../../kdkArchiveStats';

export type RpcResult = { ok: true; data: any } | { ok: false; status: number; code: string };

export interface SpotlightDeps {
  configured: boolean;
  clubId: string;
  /** 토큰 → 사용자 id. 무효면 null. */
  verifyUser(token: string): Promise<string | null>;
  /** profiles.role. 조회 실패 시 null. */
  getRole(userId: string): Promise<string | null>;
  /** 사용자 토큰으로 can_manage_kdk() — true/false, 함수 없음 · 오류는 null(→ 예전 CEO/ADMIN 규칙). */
  canManageKdk(token: string): Promise<boolean | null>;
  loadSessionMatches(sessionId: string): Promise<(SessionMatchRow & { session_title?: string | null })[] | null>;
  loadOfficialArchives(): Promise<KdkArchiveRow[] | null>;
  loadMembers(): Promise<HeadToHeadMemberRef[] | null>;
  /** private/partial 회원 id. 조회 실패 시 null(→ 거부). */
  loadRestrictedMemberIds(): Promise<string[] | null>;
  rpc(fn: string, args: Record<string, unknown>): Promise<RpcResult>;
  randomSlug(): string;
  /** KST 오늘(YYYY-MM-DD). */
  today(): string;
}

export interface HandlerResponse {
  status: number;
  body: Record<string, unknown>;
}

const fail = (status: number, reason: string, extra: Record<string, unknown> = {}): HandlerResponse =>
  ({ status, body: { ok: false, reason, ...extra } });

const ADMIN_ROLES = new Set(['CEO', 'ADMIN']);
const SESSION_RE = /^[A-Za-z0-9_\-:.]{1,120}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function bearerOf(header: string | null | undefined): string | null {
  const h = String(header || '');
  if (!h.startsWith('Bearer ')) return null;
  const t = h.slice(7).trim();
  return t && t.length <= 4096 ? t : null;
}

export async function handleSpotlightAction(
  deps: SpotlightDeps,
  authHeader: string | null | undefined,
  body: unknown,
): Promise<HandlerResponse> {
  if (!deps.configured) return fail(503, 'not_configured');
  const token = bearerOf(authHeader);
  if (!token) return fail(401, 'login_required');
  const userId = await deps.verifyUser(token);
  if (!userId) return fail(401, 'login_required');
  const manager = await deps.canManageKdk(token);
  if (manager === false) return fail(403, 'forbidden');
  if (manager !== true) {
    const role = await deps.getRole(userId);
    if (!role || !ADMIN_ROLES.has(role.trim().toUpperCase())) return fail(403, 'forbidden');
  }

  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const action = String(b.action || '');
  if (action === 'generate') {
    const sessionId = String(b.sessionId || '');
    if (!SESSION_RE.test(sessionId)) return fail(400, 'invalid_session');
    return generate(deps, userId, sessionId);
  }
  if (action === 'publish') {
    const runId = String(b.runId || '');
    if (!UUID_RE.test(runId)) return fail(400, 'invalid_run');
    return publish(deps, userId, runId);
  }
  if (action === 'unpublish') {
    const sessionId = String(b.sessionId || '');
    if (!SESSION_RE.test(sessionId)) return fail(400, 'invalid_session');
    const r = await deps.rpc('unpublish_kdk_spotlight_run', { p_club_id: deps.clubId, p_session_id: sessionId, p_actor: userId });
    if (!r.ok) return rpcFail(r);
    return { status: 200, body: { ok: r.data?.ok === true, reason: String(r.data?.reason || '') } };
  }
  return fail(400, 'invalid_action');
}

function rpcFail(r: { status: number; code: string }): HandlerResponse {
  if (r.code === 'PGRST202' || r.code === '42883' || r.status === 404) return fail(503, 'sql_not_applied');
  if (r.code === '42501' || r.status === 401 || r.status === 403) return fail(403, 'forbidden');
  return fail(502, 'db_unavailable');
}

async function generate(deps: SpotlightDeps, userId: string, sessionId: string): Promise<HandlerResponse> {
  const [matches, archives, members, restricted] = await Promise.all([
    deps.loadSessionMatches(sessionId),
    deps.loadOfficialArchives(),
    deps.loadMembers(),
    deps.loadRestrictedMemberIds(),
  ]);
  if (!matches || !archives || !members) return fail(502, 'db_unavailable');
  if (!restricted) return fail(502, 'visibility_unavailable');
  if (matches.length === 0) return fail(404, 'session_not_found');

  const title = String(matches.find((m) => m.session_title)?.session_title || 'KDK').slice(0, 60);
  const sessionDate = deps.today();
  const slug = deps.randomSlug();
  let excluded = new Set<string>();
  let lastRejected: unknown[] = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const rows = matches.map((m) => (excluded.has(String(m.id)) ? { ...m, status: '__rejected__' } : m));
    const result = buildSpotlight({
      sessionId,
      sessionDate,
      sessionMatches: rows,
      archiveRows: archives,
      members,
      restrictedMemberIds: restricted,
    });
    if (result.predictions.length === 0) {
      return fail(409, 'no_predictable_matches', { skipped: result.skipped.length, rejected: lastRejected });
    }
    const payload = buildPublicSpotlightPayload(result, { title, date: sessionDate });
    const selected = new Set(result.selection.matchIds);
    const r = await deps.rpc('save_kdk_spotlight_run', {
      p_club_id: deps.clubId,
      p_session_id: sessionId,
      p_actor: userId,
      p_run: {
        public_slug: slug,
        model_version: result.modelVersion,
        select_version: result.selectVersion,
        cutoff_date: result.cutoffDate,
        source_signature: result.source.signature,
        source_archive_count: result.source.archiveCount,
        source_game_count: result.source.gameCount,
        session_title: title,
        session_date: sessionDate,
        public_payload: payload,
      },
      p_predictions: result.predictions.map((p) => ({
        match_id: p.matchId,
        match_no: p.matchNo,
        round: p.round,
        player_ids: p.playerIds,
        players_hash: p.playersHash,
        model_version: result.modelVersion,
        tier: p.prediction.tier,
        prob_a: p.prediction.probA,
        snapshot: p,
        main_type: p.mainType,
        score: p.score,
        selected: selected.has(p.matchId),
      })),
    });
    if (!r.ok) return rpcFail(r);
    const d = r.data || {};
    if (d.ok === true) {
      return {
        status: 200,
        body: {
          ok: true,
          runId: d.run_id,
          revision: d.revision,
          slug: d.public_slug,
          preview: payload,
          predicted: result.predictions.length,
          skipped: result.skipped.length + excluded.size,
          selected: result.selection.matchIds.length,
          shortfall: result.selection.shortfall,
        },
      };
    }
    if (d.reason === 'stale_matches' && Array.isArray(d.rejected) && attempt === 0) {
      lastRejected = d.rejected;
      excluded = new Set(d.rejected.map((x: any) => String(x?.match_id || '')));
      continue;
    }
    return fail(409, String(d.reason || 'rejected'), { rejected: d.rejected ?? lastRejected });
  }
  return fail(409, 'stale_matches', { rejected: lastRejected });
}

async function publish(deps: SpotlightDeps, userId: string, runId: string): Promise<HandlerResponse> {
  const [ctx, restricted] = await Promise.all([
    deps.rpc('get_kdk_spotlight_run_for_publish', { p_run_id: runId, p_actor: userId }),
    deps.loadRestrictedMemberIds(),
  ]);
  if (!ctx.ok) return rpcFail(ctx);
  if (!restricted) return fail(502, 'visibility_unavailable');
  const d = ctx.data || {};
  if (d.ok !== true) return fail(d.reason === 'forbidden' ? 403 : 404, String(d.reason || 'not_found'));
  const run = d.run || {};
  if (String(run.club_id) !== deps.clubId) return fail(404, 'not_found');

  const predictions: StoredPredictionForPublish[] = (Array.isArray(d.predictions) ? d.predictions : []).map((p: any) => ({
    matchId: String(p.match_id),
    status: String(p.status),
    selected: p.selected === true,
    snapshot: p.snapshot,
    currentPlayerIds: Array.isArray(p.current_player_ids) ? p.current_player_ids.map(String) : null,
  }));
  const prepared = preparePublish({
    modelVersion: String(run.model_version || ''),
    selectVersion: String(run.select_version || ''),
    sessionId: String(run.session_id || ''),
    cutoffDate: String(run.cutoff_date || ''),
    title: String(run.session_title || ''),
    date: String(run.session_date || ''),
    predictions,
    restrictedMemberIds: restricted,
  });
  const r = await deps.rpc('publish_kdk_spotlight_run', {
    p_run_id: runId,
    p_actor: userId,
    p_public_payload: prepared.payload,
    p_invalidate_match_ids: prepared.invalidateMatchIds,
  });
  if (!r.ok) return rpcFail(r);
  const res = r.data || {};
  if (res.ok !== true) return fail(409, String(res.reason || 'rejected'));
  return {
    status: 200,
    body: {
      ok: true,
      reason: res.reason,
      slug: res.public_slug,
      payload: prepared.payload,
      invalidated: prepared.invalidateMatchIds.length,
      droppedForPrivacy: prepared.droppedForPrivacy.length,
    },
  };
}
