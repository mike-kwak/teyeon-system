// TEYEON KDK FINAL REPORT 운영 API 핸들러(P3) — 의존성 주입형(네트워크 · env 미사용 → 보안 시험 가능).
//
//   흐름: Bearer 토큰 → Supabase Auth 로 사용자 확인 → 관리 권한(can_manage_kdk: CEO · ADMIN · 등재 KDK 관리자) →
//         action 실행. SQL 함수 안에서도 kdk_spotlight_is_admin(p_actor) 로 다시 확인한다(이중 확인).
//   ⚠ p_actor 는 서버가 토큰으로 확인한 사용자 id 다. 요청 body 의 사용자 · 순위 · 점수 · 공개본은 쓰지 않는다.
//   ⚠ 공개본(payload)은 서버가 공식 Archive(get_kdk_final_report_source)와 검증된 문구로 매번 새로 만든다.
//
//   actions
//     access    : 편집 권한 확인(Archive 진입 버튼 표시용 · 읽기 없음)
//     load      : 공식 기록 + 저장된 문구 + 발행 상태(편집기 STEP 1)
//     reanchor  : 운영진이 재확인한 문구를 현재 공식 기록에 다시 연결(저장 없음)
//     preview   : 서버가 만든 공개본(실제 공개 화면과 같은 데이터 · 저장 없음)
//     save      : 초안 저장(공개본 무변경 · 동시 편집 충돌 검사)
//     publish   : 확인 체크 + 기록 지문 · revision · 연결 · 문구 검증 후 초안 저장 → 발행(slug 유지 · revision+1)
//     unpublish : 비공개

import {
  EMPTY_CONTENT, buildFinalReportModel, buildFinalReportPayload, parseFinalReportContent, reanchorContent, reconcileContent,
  type FinalReportContent, type FinalReportModel, type FinalReportSource,
} from '../finalReport/finalReportModel';
import { EMPTY_EPOCH, toEditorData, type EditorReport } from '../finalReport/finalReportEditor';

export type RpcResult = { ok: true; data: any } | { ok: false; status: number; code: string };

export interface FinalReportDeps {
  configured: boolean;
  clubId: string;
  verifyUser(token: string): Promise<string | null>;
  getRole(userId: string): Promise<string | null>;
  canManageKdk(token: string): Promise<boolean | null>;
  rpc(fn: string, args: Record<string, unknown>): Promise<RpcResult>;
  randomSlug(): string;
}
export interface HandlerResponse { status: number; body: Record<string, unknown> }

const fail = (status: number, reason: string, extra: Record<string, unknown> = {}): HandlerResponse => ({ status, body: { ok: false, reason, ...extra } });
const ADMIN_ROLES = new Set(['CEO', 'ADMIN']);
const SESSION_RE = /^[A-Za-z0-9_\-:.]{1,80}$/;
const TS_RE = /^\d{4}-\d{2}-\d{2}[T ][0-9:.]+(Z|[+-]\d{2}(:?\d{2})?)$/;

export function bearerOf(header: string | null | undefined): string | null {
  const h = String(header || '');
  if (!h.startsWith('Bearer ')) return null;
  const t = h.slice(7).trim();
  return t && t.length <= 4096 ? t : null;
}

export async function handleFinalReportAction(deps: FinalReportDeps, authHeader: string | null | undefined, body: unknown): Promise<HandlerResponse> {
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
  if (action === 'access') return { status: 200, body: { ok: true } };

  const sessionId = String(b.sessionId || '');
  if (!SESSION_RE.test(sessionId)) return fail(400, 'invalid_session');
  if (action === 'unpublish') {
    const r = await deps.rpc('unpublish_kdk_final_report', { p_session_id: sessionId, p_actor: userId });
    if (!r.ok) return rpcFail(r);
    if (r.data?.ok !== true) return dbReason(r.data);
    return { status: 200, body: { ok: true, reason: String(r.data.reason || '') } };
  }
  if (!['load', 'reanchor', 'preview', 'save', 'publish'].includes(action)) return fail(400, 'invalid_action');

  // 공식 원본(서버 조회) → 모델. 이후 모든 판단은 이 값으로만 한다.
  const src = await loadSource(deps, sessionId, userId);
  if ('error' in src) return src.error;
  const { model, signature, report } = src;

  if (action === 'load') {
    const parsed = report?.content ? parseFinalReportContent(report.content) : { ok: true as const, content: EMPTY_CONTENT };
    const content = parsed.ok ? parsed.content : EMPTY_CONTENT;
    return { status: 200, body: { ok: true, data: toEditorData(model, { id: sessionId, signature, report: editorReport(report, signature), content, contentReset: !parsed.ok }) } };
  }

  // 이하: 요청 문구 형식 검증 + 이 세션의 선수 · 경기에만 연결 가능
  const pc = parseFinalReportContent(b.content);
  if (!pc.ok) return fail(400, `content_${pc.reason}`, { field: pc.field });
  const link = foreignLink(pc.content, model);
  if (link) return fail(400, link);
  let content = pc.content;

  if (action === 'reanchor') {
    const keep = (b.keep && typeof b.keep === 'object' ? b.keep : {}) as Record<string, unknown>;
    const ks = Array.isArray(keep.stories) ? keep.stories.filter((x): x is string => typeof x === 'string').slice(0, 10) : [];
    const kf = Array.isArray(keep.featured) ? keep.featured.filter((x): x is string => typeof x === 'string').slice(0, 10) : [];
    content = reanchorContent(content, model, { stories: ks, featured: kf });
    return { status: 200, body: { ok: true, content, reconcile: reconcileContent(content, model) } };
  }

  if (action === 'preview') {
    const p = buildFinalReportPayload(model, content);
    if (!p.ok) return { status: 200, body: { ok: false, reason: p.reason, issues: p.issues ?? [], reconcile: p.reconciled ?? null } };
    return { status: 200, body: { ok: true, payload: p.payload, signature, officialSessionId: sessionId } };
  }

  const expectedUpdatedAt = b.expectedUpdatedAt == null || b.expectedUpdatedAt === '' ? EMPTY_EPOCH : String(b.expectedUpdatedAt);
  if (!TS_RE.test(expectedUpdatedAt)) return fail(400, 'invalid_expected');

  if (action === 'save') return save(deps, sessionId, userId, content, report, expectedUpdatedAt);

  // publish
  if (b.confirm !== true) return fail(400, 'confirm_required');
  if (typeof b.baseSignature !== 'string' || b.baseSignature !== signature) return fail(409, 'stale_source');
  const expectedRevision = Number.isInteger(b.expectedRevision) ? (b.expectedRevision as number) : -1;
  if ((report?.revision ?? 0) !== expectedRevision) return fail(409, 'revision_conflict');
  const p = buildFinalReportPayload(model, content);
  if (!p.ok) return fail(409, p.reason, { issues: p.issues ?? [], reconcile: p.reconciled ?? null });
  const saved = await save(deps, sessionId, userId, content, report, expectedUpdatedAt);
  if (saved.status !== 200) return saved;
  const r = await deps.rpc('publish_kdk_final_report', {
    p_session_id: sessionId, p_actor: userId, p_payload: p.payload, p_signature: signature, p_expected_revision: expectedRevision,
  });
  if (!r.ok) return rpcFail(r);
  if (r.data?.ok !== true) return dbReason(r.data);
  return { status: 200, body: { ok: true, reason: 'published', publicSlug: String(r.data.publicSlug), revision: Number(r.data.revision), updatedAt: r.data.updatedAt ?? null } };
}

// ── 내부 ───────────────────────────────────────────────────────────────────────
interface ReportRow { status: EditorReport['status']; publicSlug: string; revision: number; content: unknown; sourceSignature: string | null; updatedAt: string | null; publishedAt: string | null }

async function loadSource(deps: FinalReportDeps, sessionId: string, userId: string):
  Promise<{ model: FinalReportModel; signature: string; report: ReportRow | null } | { error: HandlerResponse }> {
  const r = await deps.rpc('get_kdk_final_report_source', { p_session_id: sessionId, p_actor: userId });
  if (!r.ok) return { error: rpcFail(r) };
  const d = r.data;
  if (!d || d.ok !== true) return { error: dbReason(d) };
  const a = d.archive || {};
  const src: FinalReportSource = {
    id: String(a.id || ''), archiveType: String(a.archiveType || ''), isOfficial: a.isOfficial === true, isTest: a.isTest === true,
    title: String(a.title || ''), date: String(a.date || ''),
    rankingData: Array.isArray(a.rankingData) ? a.rankingData : [], snapshotData: Array.isArray(a.snapshotData) ? a.snapshotData : [],
    playerGroups: a.playerGroups && typeof a.playerGroups === 'object' ? a.playerGroups : {},
  };
  if (src.id !== sessionId) return { error: fail(404, 'not_found') };
  const m = buildFinalReportModel(src);
  if (!m.ok) return { error: fail(409, m.reason) };
  const rep = d.report;
  const report: ReportRow | null = rep && typeof rep === 'object' ? {
    status: rep.status === 'published' || rep.status === 'unpublished' ? rep.status : 'draft',
    publicSlug: String(rep.publicSlug || ''), revision: Number(rep.revision) || 0, content: rep.content,
    sourceSignature: typeof rep.sourceSignature === 'string' ? rep.sourceSignature : null,
    updatedAt: typeof rep.updatedAt === 'string' ? rep.updatedAt : null, publishedAt: typeof rep.publishedAt === 'string' ? rep.publishedAt : null,
  } : null;
  return { model: m.model, signature: String(d.signature || ''), report };
}

function editorReport(r: ReportRow | null, signature: string): EditorReport | null {
  if (!r) return null;
  return { status: r.status, publicSlug: r.publicSlug, revision: r.revision, updatedAt: r.updatedAt, publishedAt: r.publishedAt,
    stale: r.status === 'published' && r.sourceSignature !== signature };
}

/** 이 세션의 공식 기록에 없는 선수 · 경기에 연결된 문구는 받지 않는다(다른 세션 문구 연결 차단). */
function foreignLink(c: FinalReportContent, model: FinalReportModel): string | null {
  const keys = new Set(model.standings.map((s) => s.key));
  const ids = new Set(model.matches.map((m) => m.matchId));
  if (c.stories.some((s) => !keys.has(s.playerKey))) return 'foreign_player';
  if ((c.featured ?? []).some((f) => !ids.has(f.matchId))) return 'foreign_match';
  return null;
}

async function save(deps: FinalReportDeps, sessionId: string, userId: string, content: FinalReportContent, report: ReportRow | null, expectedUpdatedAt: string): Promise<HandlerResponse> {
  const r = await deps.rpc('save_kdk_final_report_draft', {
    p_club_id: deps.clubId, p_session_id: sessionId, p_actor: userId, p_content: content,
    p_new_slug: report ? null : deps.randomSlug(), p_expected_updated_at: expectedUpdatedAt,
  });
  if (!r.ok) return rpcFail(r);
  if (r.data?.ok !== true) return dbReason(r.data);
  return { status: 200, body: { ok: true, reason: 'saved', status: r.data.status, publicSlug: r.data.publicSlug, revision: r.data.revision, updatedAt: r.data.updatedAt ?? null } };
}

const REASON_STATUS: Record<string, number> = {
  forbidden: 403, not_found: 404, invalid_session: 400, not_official: 409, no_ranking: 409, stale: 409, revision_conflict: 409,
  draft_conflict: 409, no_draft: 409, invalid_content: 400, invalid_slug: 500, invalid_payload: 422, payload_leak: 422,
};
function dbReason(d: any): HandlerResponse {
  let reason = String(d?.reason || 'db_error');
  if (reason === 'stale') reason = 'stale_source';
  return fail(REASON_STATUS[String(d?.reason || '')] ?? 500, reason, d && typeof d.revision === 'number' ? { revision: d.revision } : {});
}
function rpcFail(r: { status: number; code: string }): HandlerResponse {
  if (r.code === 'PGRST202' || r.code === '42883' || r.status === 404) return fail(503, 'sql_not_applied');
  if (r.code === 'not_configured') return fail(503, 'not_configured');
  return fail(502, 'db_unavailable');
}
