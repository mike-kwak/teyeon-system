// MATCH SPOTLIGHT 운영 API 핸들러 — 의존성 주입형(네트워크·env 미사용 → 보안 테스트 가능).
//
//   흐름: Bearer 토큰 → 사용자 확인 → 관리 권한 확인 → action 실행.
//     관리 권한 = 기존 KDK 관리자 체계 그대로: 사용자 토큰으로 can_manage_kdk() 호출(CEO · ADMIN · kdk_managers 등재 회원).
//     can_manage_kdk 가 없는 DB(SQL 30 미적용)에서만 예전 규칙(profiles.role CEO/ADMIN)으로 판정한다(권한 확대 없음).
//     generate  : DB 원본(matches · 공식 Archive · members · 공개 범위)으로 서버가 직접 계산 → save RPC.
//                 ⚠ 요청 body 의 확률·선정·payload 는 읽지 않는다(sessionId 만 사용).
//                 RPC 가 stale_matches 로 거부한 경기는 제외하고 1회만 재계산·재시도.
//     publish   : 저장 snapshot + 현재 선수 구성 + 현재 공개 범위로 DTO 재구성(preparePublish) → publish RPC.
//                 operator(선택): 운영진 승인 관전 포인트 · 운영진 PICK — 형식 · 경기 · 선수 · PICK 자격 검증 후 반영.
//                 republish=true: 공개 중이면 검증 통과 후에만 비공개 → 같은 회차 재공개(링크 유지).
//     preview   : publish 와 같은 계산 · 검증 결과만 반환(저장 없음).
//     unpublish : unpublish RPC.
//     ai_matches: AI 관전 포인트 v2 — 회차의 공개 대상 경기 목록(라운드 · 코트 · 선수 · 안정 id) + AI 사용 가능 여부. 저장 없음.
//     ai_draft  : 확정된 경기별 지시 → AI 초안 생성 · 검증 결과만 반환(저장 · 공개 데이터 변경 없음).
//                 경기는 matchNo + ref(matchId) 가 이 회차의 공개 대상 snapshot 과 일치할 때만(선수 변경 · 제외 경기 거부).
//   공개 범위 조회 실패 시 생성/공개를 거부한다(fail-closed — 비공개 회원 수치 노출 방지).

import { buildSpotlight, type SessionMatchRow } from '../analytics/spotlightEngine';
import { buildPublicSpotlightPayload } from '../analytics/publicSpotlight';
import { preparePublish, mainFactUsesRestricted, type StoredPredictionForPublish } from '../analytics/spotlightPublish';
import { applyOperatorInput, parseOperatorInput, type OperatorInput } from '../analytics/spotlightOperator';
import {
  allNamesOf, assembleDrafts, draftKey, AI_INSTRUCTION_MAX, AI_ITEMS_MAX,
  type AiMatchInfo, type DraftRequestItem,
} from '../analytics/spotlightAiDraft';
import { sanitizeOperatorText } from '../analytics/spotlightOperator';
import { withTimeout, type SpotlightAiDeps } from './spotlightAi';
import { buildDraftPrompt } from './spotlightAiPrompt';
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
  /** 세션의 최신 회차 번호(superseded 제외 · 사용자 토큰으로 운영진 RPC 조회). 조회 실패 null. 재공개 전 확인용. */
  latestRunRevision(token: string, sessionId: string): Promise<number | null>;
  rpc(fn: string, args: Record<string, unknown>): Promise<RpcResult>;
  randomSlug(): string;
  /** KST 오늘(YYYY-MM-DD). */
  today(): string;
  /** AI 관전 포인트 v2(선택). 없으면 AI 사용 불가(수동 작성). */
  ai?: SpotlightAiDeps;
}

export interface HandlerResponse {
  status: number;
  body: Record<string, unknown>;
}

const fail = (status: number, reason: string, extra: Record<string, unknown> = {}): HandlerResponse =>
  ({ status, body: { ok: false, reason, ...extra } });

const ADMIN_ROLES = new Set(['CEO', 'ADMIN']);
// DB 판정 사유 중 "시작 전임을 증명할 수 없음"(SQL 설치 이전 경기 · 증명서 없음) — 경기 시작과 무관한 이력 부재.
const UNCERTIFIED_REASONS = new Set(['uncertifiable', 'no_certificate']);
const countBy = (xs: string[]): Record<string, number> =>
  xs.reduce<Record<string, number>>((acc, k) => { acc[k] = (acc[k] || 0) + 1; return acc; }, {});
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
  if (action === 'publish' || action === 'preview') {
    const runId = String(b.runId || '');
    if (!UUID_RE.test(runId)) return fail(400, 'invalid_run');
    // 운영진 입력(승인 문구 · PICK) — 형식 검증 실패는 아무것도 바꾸지 않고 거부.
    const op = parseOperatorInput(b.operator);
    if (!op.ok) return fail(400, op.reason, op.matchNo ? { matchNo: op.matchNo } : {});
    return publish(deps, userId, token, runId, op.input, { previewOnly: action === 'preview', republish: b.republish === true });
  }
  if (action === 'ai_matches' || action === 'ai_draft') {
    const runId = String(b.runId || '');
    if (!UUID_RE.test(runId)) return fail(400, 'invalid_run');
    return action === 'ai_matches' ? aiMatches(deps, userId, runId) : aiDraft(deps, userId, runId, b);
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
      // 같은 reason 을 유지하되 원인을 detail 로 구분한다(판정은 그대로 — 화면 안내만 정확하게).
      //   uncertified: 대기 경기가 있으나 DB 가 "시작 전 증명 불가"(설치 이전 생성 · 증명서 없음)로 거절
      //   blocked:     대기 경기가 있으나 시작 이력 · 행 변경 · 기록 오류로 거절
      //   invalid_players: 대기 경기의 선수 4명 정보가 온전하지 않음
      //   no_waiting:  대기 경기 자체가 없음
      const blocked = countBy(lastRejected.map((x: any) => String(x?.reason || 'unknown')));
      const invalidPlayers = result.skipped.filter((s) => s.reason === 'invalid_players').length;
      const blockedTotal = Object.values(blocked).reduce((a, b) => a + b, 0);
      const detail = blockedTotal > 0
        ? (Object.keys(blocked).every((k) => UNCERTIFIED_REASONS.has(k)) ? 'uncertified' : 'blocked')
        : invalidPlayers > 0 ? 'invalid_players' : 'no_waiting';
      return fail(409, 'no_predictable_matches', {
        detail, skipped: result.skipped.length, blocked, invalidPlayers, rejected: lastRejected,
      });
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
          // DB 가 예측을 거절해 제외한 대기 경기 수(사유별) — 일부만 제외된 경우 화면 안내용.
          blocked: countBy(lastRejected.map((x: any) => String(x?.reason || 'unknown'))),
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

async function publish(
  deps: SpotlightDeps, userId: string, token: string, runId: string, operator: OperatorInput,
  opts: { previewOnly: boolean; republish: boolean },
): Promise<HandlerResponse> {
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

  // 운영진 입력 반영(없으면 자동 결과 그대로). PICK 은 지금도 대기 중인 경기만 — 현재 상태를 DB 원본으로 확인.
  let currentStatus: Map<number, string> | null = null;
  if (operator.pick) {
    const rows = await deps.loadSessionMatches(String(run.session_id || ''));
    if (!rows) return fail(502, 'db_unavailable');
    const statusById = new Map(rows.map((m) => [String(m.id), String(m.status || '')]));
    currentStatus = new Map(prepared.eligible.map((s) => [s.matchNo, statusById.get(String(s.matchId)) || '']));
  }
  const applied = applyOperatorInput(prepared.payload, operator, {
    eligible: prepared.eligible,
    usesRestricted: mainFactUsesRestricted,
    currentStatus,
  });
  if (!applied.ok) return fail(409, applied.reason, applied.matchNo ? { matchNo: applied.matchNo } : {});
  const payload = applied.payload;
  const summary = {
    payload,
    invalidated: prepared.invalidateMatchIds.length,
    droppedForPrivacy: prepared.droppedForPrivacy.length,
    runStatus: String(run.status || ''),
  };
  // 미리보기: 같은 계산 · 같은 검증 결과만 돌려준다(저장 없음).
  if (opts.previewOnly) return { status: 200, body: { ok: true, preview: true, ...summary } };

  // 공개 중 수정(재공개): 검증을 모두 통과한 뒤에만 비공개 → 같은 회차 재공개(같은 링크 유지).
  if (opts.republish && run.status === 'published') {
    // 더 새 회차(재생성 draft)가 있으면 재공개가 not_latest 로 실패해 아무것도 공개되지 않는다 → 비공개 전에 막는다.
    const latest = await deps.latestRunRevision(token, String(run.session_id || ''));
    if (latest == null) return fail(502, 'db_unavailable');
    if (latest !== Number(run.revision)) return fail(409, 'not_latest');
    const u = await deps.rpc('unpublish_kdk_spotlight_run', { p_club_id: deps.clubId, p_session_id: String(run.session_id || ''), p_actor: userId });
    if (!u.ok) return rpcFail(u);
    if (u.data?.ok !== true) return fail(409, String(u.data?.reason || 'rejected'));
  }
  const r = await deps.rpc('publish_kdk_spotlight_run', {
    p_run_id: runId,
    p_actor: userId,
    p_public_payload: payload,
    p_invalidate_match_ids: prepared.invalidateMatchIds,
  });
  if (!r.ok) return rpcFail(r);
  const res = r.data || {};
  if (res.ok !== true) return fail(409, String(res.reason || 'rejected'));
  return { status: 200, body: { ok: true, reason: res.reason, slug: res.public_slug, ...summary } };
}

// ── AI 관전 포인트 v2(저장 없음 · 공개 데이터 변경 없음) ─────────────────────────────
//   경기 목록은 publish 와 같은 재검증(preparePublish) 결과 = 지금 공개하면 보일 경기만.
async function loadAiMatches(
  deps: SpotlightDeps, userId: string, runId: string,
): Promise<{ ok: true; matches: AiMatchInfo[] } | { ok: false; res: HandlerResponse }> {
  const [ctx, restricted] = await Promise.all([
    deps.rpc('get_kdk_spotlight_run_for_publish', { p_run_id: runId, p_actor: userId }),
    deps.loadRestrictedMemberIds(),
  ]);
  if (!ctx.ok) return { ok: false, res: rpcFail(ctx) };
  if (!restricted) return { ok: false, res: fail(502, 'visibility_unavailable') };
  const d = ctx.data || {};
  if (d.ok !== true) return { ok: false, res: fail(d.reason === 'forbidden' ? 403 : 404, String(d.reason || 'not_found')) };
  const run = d.run || {};
  if (String(run.club_id) !== deps.clubId) return { ok: false, res: fail(404, 'not_found') };
  const prepared = preparePublish({
    modelVersion: String(run.model_version || ''), selectVersion: String(run.select_version || ''),
    sessionId: String(run.session_id || ''), cutoffDate: String(run.cutoff_date || ''),
    title: String(run.session_title || ''), date: String(run.session_date || ''),
    predictions: (Array.isArray(d.predictions) ? d.predictions : []).map((p: any) => ({
      matchId: String(p.match_id), status: String(p.status), selected: p.selected === true, snapshot: p.snapshot,
      currentPlayerIds: Array.isArray(p.current_player_ids) ? p.current_player_ids.map(String) : null,
    })),
    restrictedMemberIds: restricted,
  });
  // 현재 코트 · 상태(표시용) — 조회 실패해도 snapshot 값으로 진행.
  const rows = await deps.loadSessionMatches(String(run.session_id || '')).catch(() => null);
  const rowById = new Map((rows || []).map((r) => [String(r.id), r]));
  const snapByNo = new Map(prepared.eligible.map((s) => [s.matchNo, s]));
  const itemByNo = new Map(prepared.payload.items.map((i) => [i.matchNo, i]));
  const matches: AiMatchInfo[] = [];
  for (const m of prepared.payload.matches) {
    const s = snapByNo.get(m.matchNo);
    if (!s) continue;
    const row = rowById.get(String(s.matchId));
    const it = itemByNo.get(m.matchNo);
    const court = row && row.court != null && Number(row.court) > 0 ? Number(row.court) : (s.court ?? null);
    matches.push({
      matchNo: m.matchNo, ref: String(s.matchId), round: m.round, court, group: m.group,
      teamA: m.teamA, teamB: m.teamB, badge: m.badge, inTop: !!it,
      official: it ? `${it.headline} — ${it.viewpoint}` : '', status: row ? String(row.status || '') : '',
    });
  }
  return { ok: true, matches };
}

async function aiMatches(deps: SpotlightDeps, userId: string, runId: string): Promise<HandlerResponse> {
  const r = await loadAiMatches(deps, userId, runId);
  if (!r.ok) return r.res;
  const ai = deps.ai;
  return { status: 200, body: { ok: true, matches: r.matches, ai: { available: !!ai?.available, reason: ai?.available ? null : (ai?.reason || 'disabled') } } };
}

async function aiDraft(deps: SpotlightDeps, userId: string, runId: string, b: Record<string, unknown>): Promise<HandlerResponse> {
  const ai = deps.ai;
  if (!ai || !ai.available || !ai.generate) return fail(503, 'ai_disabled', { detail: ai?.reason || 'disabled' });
  // 입력 형식: items 1~8 · matchNo 정수 · ref 문자열 · 지시 200자(꺾쇠 · 제어문자 정리)
  const raw = Array.isArray(b.items) ? b.items : null;
  if (!raw || raw.length === 0) return fail(400, 'ai_invalid');
  if (raw.length > AI_ITEMS_MAX) return fail(400, 'ai_too_many');
  const req: Array<{ matchNo: number; ref: string; instruction: string }> = [];
  for (const x of raw) {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const no = o.matchNo;
    if (typeof no !== 'number' || !Number.isInteger(no) || no <= 0 || no >= 10000) return fail(400, 'ai_invalid');
    if (typeof o.ref !== 'string' || !o.ref || o.ref.length > 64) return fail(400, 'ai_invalid');
    if (req.some((y) => y.matchNo === no)) return fail(400, 'ai_invalid');
    // 지시(운영진 메모 조각)가 있는 경기만 생성한다 — 편집기 규칙과 같다(빈 지시 = 거부).
    if (typeof o.instruction !== 'string' || !o.instruction.trim()) return fail(400, 'ai_invalid', { matchNo: no });
    const ins = sanitizeOperatorText(o.instruction.replace(/[<>]/g, ' '), AI_INSTRUCTION_MAX);
    if (!ins.ok) return fail(400, ins.reason === 'operator_text_too_long' ? 'ai_instruction_too_long' : 'ai_invalid', { matchNo: no });
    req.push({ matchNo: no, ref: o.ref, instruction: ins.text });
  }
  const regenerate = b.regenerate === true;
  const lim = ai.limiter.acquire(userId, runId, req.map((x) => x.matchNo), regenerate);
  if (!lim.ok) return fail(429, lim.reason, lim.matchNo ? { matchNo: lim.matchNo } : {});
  try {
    const loaded = await loadAiMatches(deps, userId, runId);
    if (!loaded.ok) return loaded.res;
    const byNo = new Map(loaded.matches.map((m) => [m.matchNo, m]));
    // 경기 확인: 이 회차 공개 대상 + 같은 matchId(선수 변경 · 제외 · 다른 회차 번호 거부)
    const unavailable: Array<{ matchNo: number; reason: 'match_unavailable' | 'match_changed' }> = [];
    const items: DraftRequestItem[] = [];
    for (const x of req) {
      const m = byNo.get(x.matchNo);
      if (!m) { unavailable.push({ matchNo: x.matchNo, reason: 'match_unavailable' }); continue; }
      if (m.ref !== x.ref) { unavailable.push({ matchNo: x.matchNo, reason: 'match_changed' }); continue; }
      items.push({ key: draftKey(items.length), match: m, instruction: x.instruction });
    }
    if (items.length === 0) return { status: 200, body: { ok: true, cards: [], unavailable } };
    const prompt = buildDraftPrompt(items);
    let out: unknown;
    try {
      out = await withTimeout((signal) => (ai.generate as NonNullable<SpotlightAiDeps['generate']>)(
        { system: prompt.system, user: prompt.user, maxOutputTokens: 300 + items.length * 250 }, signal), ai.timeoutMs);
    } catch (e) {
      return fail(e instanceof Error && e.message === 'ai_timeout' ? 504 : 502, e instanceof Error && e.message === 'ai_timeout' ? 'ai_timeout' : 'ai_failed');
    }
    const assembled = assembleDrafts(out, items, allNamesOf(loaded.matches));
    if (!assembled.ok) return fail(502, assembled.reason);
    return { status: 200, body: { ok: true, cards: assembled.cards, unavailable, ignoredKeys: assembled.ignoredKeys.length } };
  } finally {
    lim.release();
  }
}
