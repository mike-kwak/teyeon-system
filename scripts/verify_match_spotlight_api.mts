/**
 * MATCH SPOTLIGHT 운영 API 보안 fixture — 핸들러를 가짜 의존성으로 실행(네트워크·DB·env 미사용).
 *
 *   실행: node scripts/verify_match_spotlight_api.mts
 *   검증: 미로그인·위조 토큰·일반 회원·OPERATOR 차단 · 미설정 503 · 입력 검증 · 클라이언트 확률 무시 ·
 *         stale 재시도 1회 · 공개 범위 조회 실패 시 거부(fail-closed) · 공개 시 선수 교체 무효화 · 클럽 범위.
 */
import { register } from 'node:module';

register('./ts-resolve-hook.mjs', import.meta.url);
const load = (path: string): Promise<any> => import(path);
const { handleSpotlightAction, bearerOf } = await load('../lib/kdk/server/spotlightHandler.ts');
const se = await load('../lib/kdk/analytics/spotlightEngine.ts');

let passed = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, info = '') => { if (cond) passed += 1; else failures.push(`${name}${info ? ` — ${info}` : ''}`); };

const MEMBERS = Array.from({ length: 8 }, (_, i) => ({ id: `mem-${i + 1}`, name: `회원${i + 1}` }));
const archive = (id: string, date: string) => ({
  id, created_at: `${date}T00:00:00Z`, archive_type: 'kdk', is_official: true, is_test: false,
  raw_data: { date, snapshot_data: Array.from({ length: 8 }, (_, i) => ({
    id: `${id}-${i}`, round: i + 1, status: 'complete',
    player_ids: i % 2 ? ['mem-1', 'mem-2', 'mem-3', 'mem-4'] : ['mem-1', 'mem-3', 'mem-2', 'mem-4'],
    player_names: ['회원1', '회원2', '회원3', '회원4'], score1: i % 3 ? 6 : 2, score2: i % 3 ? 2 : 6,
  })) },
});
const ARCHIVES = [archive('A1', '2026-10-01'), archive('A2', '2026-10-08'), archive('A3', '2026-10-15')];
const MATCHES = [
  { id: 'L1', round: 1, court: 1, status: 'waiting', group_name: 'A', player_ids: ['mem-1', 'mem-2', 'mem-3', 'mem-4'], player_names: ['회원1', '회원2', '회원3', '회원4'], session_title: '11월 정모' },
  { id: 'L2', round: 1, court: 2, status: 'waiting', group_name: 'A', player_ids: ['mem-5', 'mem-6', 'mem-7', 'mem-8'], player_names: ['회원5', '회원6', '회원7', '회원8'], session_title: '11월 정모' },
  { id: 'L3', round: 2, court: 1, status: 'playing', group_name: 'A', player_ids: ['mem-1', 'mem-3', 'mem-2', 'mem-4'], player_names: ['회원1', '회원3', '회원2', '회원4'], session_title: '11월 정모' },
];
const TOKENS: Record<string, { id: string; role: string }> = {
  'tok-ceo': { id: '00000000-0000-0000-0000-0000000000c1', role: 'CEO' },
  'tok-admin': { id: '00000000-0000-0000-0000-0000000000a1', role: 'admin' },
  'tok-member': { id: '00000000-0000-0000-0000-0000000000b1', role: 'MEMBER' },
  'tok-operator': { id: '00000000-0000-0000-0000-0000000000d1', role: 'OPERATOR' },
  'tok-norole': { id: '00000000-0000-0000-0000-0000000000e1', role: '' },
  // KDK 전용 관리자(앱 권한 MEMBER 유지 · kdk_managers 등재) — 운영 DB 의 can_manage_kdk() = true
  'tok-kdkmgr': { id: '00000000-0000-0000-0000-0000000000f1', role: 'MEMBER' },
  'tok-guest': { id: '00000000-0000-0000-0000-0000000000f2', role: 'GUEST' },
};
// can_manage_kdk() 를 사용자 토큰으로 호출한 결과(운영 SQL 30 적용 상태). CEO · ADMIN · 등재 관리자만 true.
const CAN_MANAGE: Record<string, boolean> = { 'tok-ceo': true, 'tok-admin': true, 'tok-kdkmgr': true, 'tok-member': false, 'tok-operator': false, 'tok-norole': false, 'tok-guest': false };
const RUN_ID = '11111111-2222-3333-4444-555555555555';

function makeDeps(over: Record<string, any> = {}) {
  const calls: Array<{ fn: string; args: any }> = [];
  const authCalls: string[] = [];
  let saveCount = 0;
  const deps: any = {
    configured: true,
    clubId: 'CLUB',
    verifyUser: async (t: string) => TOKENS[t]?.id ?? null,
    getRole: async (uid: string) => Object.values(TOKENS).find((x) => x.id === uid)?.role ?? null,
    // 기본 = SQL 30 적용 운영 상태(can_manage_kdk 결과). over.noKdk30 이면 함수 없음(null) → 예전 CEO/ADMIN 규칙.
    canManageKdk: async (t: string) => { authCalls.push(t); return over.noKdk30 ? null : (CAN_MANAGE[t] ?? false); },
    loadSessionMatches: async () => MATCHES,
    loadOfficialArchives: async () => ARCHIVES,
    loadMembers: async () => MEMBERS,
    loadRestrictedMemberIds: async () => [],
    randomSlug: () => 'abcdefghijklmnop',
    today: () => '2026-11-03',
    rpc: async (fn: string, args: any) => {
      calls.push({ fn, args });
      if (fn === 'save_kdk_spotlight_run') {
        saveCount += 1;
        if (over.staleOnce && saveCount === 1) return { ok: true, data: { ok: false, reason: 'stale_matches', rejected: [{ match_id: 'L2', reason: 'started_before' }] } };
        // DB 가 받은 대기 경기를 전부 거절(예: SQL 설치 이전 경기 = uncertifiable). over.rejectAll = 경기별 사유 함수.
        if (over.rejectAll) return { ok: true, data: { ok: false, reason: 'stale_matches',
          rejected: args.p_predictions.map((p: any) => ({ match_id: p.match_id, reason: over.rejectAll(p.match_id) })) } };
        return { ok: true, data: { ok: true, run_id: RUN_ID, revision: saveCount, public_slug: 'abcdefghijklmnop', saved: args.p_predictions.length } };
      }
      if (fn === 'get_kdk_spotlight_run_for_publish') {
        const res = se.buildSpotlight({ sessionId: 'S1', sessionDate: '2026-11-03', sessionMatches: MATCHES, archiveRows: ARCHIVES, members: MEMBERS });
        return { ok: true, data: { ok: true, run: { id: RUN_ID, club_id: over.otherClub ? 'OTHER' : 'CLUB', session_id: 'S1', status: 'draft', model_version: res.modelVersion, select_version: res.selectVersion, cutoff_date: '2026-11-03', session_title: 't', session_date: '2026-11-03' },
          predictions: res.predictions.map((p: any) => ({ match_id: p.matchId, status: 'active', selected: true, snapshot: p,
            current_player_ids: over.changedL1 && p.matchId === 'L1' ? ['mem-1', 'mem-2', 'mem-3', 'mem-8'] : p.playerIds })) } };
      }
      if (fn === 'publish_kdk_spotlight_run') return { ok: true, data: { ok: true, reason: 'published', public_slug: 'abcdefghijklmnop' } };
      if (fn === 'unpublish_kdk_spotlight_run') return { ok: true, data: { ok: true, reason: 'unpublished' } };
      return { ok: false, status: 404, code: 'PGRST202' };
    },
    ...over.deps,
  };
  return { deps, calls, authCalls };
}
const GEN = { action: 'generate', sessionId: 'KDK-20261103-ABCDEFGHI' };

// ── 인증·권한 ────────────────────────────────────────────────────────────────
for (const [label, header, status, reason] of [
  ['헤더 없음', null, 401, 'login_required'],
  ['Bearer 아님', 'Basic abc', 401, 'login_required'],
  ['빈 토큰', 'Bearer ', 401, 'login_required'],
  ['위조 토큰', 'Bearer forged', 401, 'login_required'],
  ['일반 회원', 'Bearer tok-member', 403, 'forbidden'],
  ['OPERATOR', 'Bearer tok-operator', 403, 'forbidden'],
  ['role 없음', 'Bearer tok-norole', 403, 'forbidden'],
  ['GUEST', 'Bearer tok-guest', 403, 'forbidden'],
] as const) {
  for (const body of [GEN, { action: 'publish', runId: RUN_ID }, { action: 'unpublish', sessionId: 'S1' }]) {
    const { deps, calls } = makeDeps();
    const r = await handleSpotlightAction(deps, header, body);
    check(`${label} ${body.action} 차단`, r.status === status && r.body.reason === reason, `${r.status} ${r.body.reason}`);
    check(`${label} ${body.action} RPC 미호출`, calls.length === 0);
  }
}
check('긴 토큰 거부', bearerOf(`Bearer ${'x'.repeat(5000)}`) === null);
{
  const { deps } = makeDeps({ deps: { configured: false } });
  const r = await handleSpotlightAction(deps, 'Bearer tok-ceo', GEN);
  check('service role 미설정 → 503', r.status === 503 && r.body.reason === 'not_configured');
}
{
  const { deps } = makeDeps();
  check('소문자 admin 허용', (await handleSpotlightAction(deps, 'Bearer tok-admin', GEN)).status === 200);
}
// ── KDK 전용 관리자(기존 KDK 관리자 체계 재사용) ──────────────────────────────────
for (const body of [GEN, { action: 'publish', runId: RUN_ID }, { action: 'unpublish', sessionId: 'S1' }]) {
  const { deps, calls, authCalls } = makeDeps();
  const r = await handleSpotlightAction(deps, 'Bearer tok-kdkmgr', body);
  check(`KDK 관리자(앱 권한 MEMBER) ${body.action} 허용`, r.status === 200 && r.body.ok === true, `${r.status} ${r.body.reason}`);
  check(`KDK 관리자 ${body.action}: 사용자 본인 토큰으로 can_manage_kdk 판정`, authCalls.length === 1 && authCalls[0] === 'tok-kdkmgr');
  const actorCall = calls.find((c) => c.args && typeof c.args === 'object' && 'p_actor' in c.args);
  check(`KDK 관리자 ${body.action}: DB RPC 에 본인 id 를 actor 로 전달(DB 재검증)`, !actorCall || actorCall.args.p_actor === TOKENS['tok-kdkmgr'].id);
}
{
  // SQL 30 미적용 DB(can_manage_kdk 없음) — 예전 규칙 그대로: CEO · ADMIN 만, 등재 회원도 MEMBER 라 거부
  const a = makeDeps({ noKdk30: true });
  check('SQL 30 미적용: CEO 허용(예전 규칙)', (await handleSpotlightAction(a.deps, 'Bearer tok-ceo', GEN)).status === 200);
  const b = makeDeps({ noKdk30: true });
  const r = await handleSpotlightAction(b.deps, 'Bearer tok-kdkmgr', GEN);
  check('SQL 30 미적용: 앱 권한 MEMBER 는 거부(권한 확대 없음)', r.status === 403 && r.body.reason === 'forbidden');
  const c = makeDeps({ deps: { canManageKdk: async () => false, getRole: async () => 'CEO' } });
  check('can_manage_kdk=false 이면 role 값과 무관하게 거부(DB 판정 우선)', (await handleSpotlightAction(c.deps, 'Bearer tok-ceo', GEN)).status === 403);
}

// ── 입력 검증 ────────────────────────────────────────────────────────────────
for (const [label, body, reason] of [
  ['action 없음', {}, 'invalid_action'],
  ['알 수 없는 action', { action: 'delete' }, 'invalid_action'],
  ['sessionId 형식', { action: 'generate', sessionId: "x'; drop table" }, 'invalid_session'],
  ['runId 형식', { action: 'publish', runId: 'not-uuid' }, 'invalid_run'],
  ['body null', null, 'invalid_action'],
] as const) {
  const { deps, calls } = makeDeps();
  const r = await handleSpotlightAction(deps, 'Bearer tok-ceo', body);
  check(`입력 검증: ${label}`, r.status === 400 && r.body.reason === reason && calls.length === 0, `${r.status} ${r.body.reason}`);
}

// ── 생성: 서버 계산만 저장 ───────────────────────────────────────────────────
{
  const { deps, calls } = makeDeps();
  const forged = { ...GEN, predictions: [{ match_id: 'L1', prob_a: 0.99, tier: 'model' }], public_payload: { items: ['hack'] }, actor: 'x' };
  const r = await handleSpotlightAction(deps, 'Bearer tok-ceo', forged);
  const save = calls.find((c) => c.fn === 'save_kdk_spotlight_run');
  const expected = se.buildSpotlight({ sessionId: GEN.sessionId, sessionDate: '2026-11-03', sessionMatches: MATCHES, archiveRows: ARCHIVES, members: MEMBERS });
  check('생성 성공', r.status === 200 && r.body.ok === true, JSON.stringify(r.body).slice(0, 200));
  check('클라이언트 확률 무시(서버 계산값 저장)', !!save && JSON.stringify(save.args.p_predictions.map((p: any) => p.prob_a)) === JSON.stringify(expected.predictions.map((p: any) => p.prediction.probA)));
  check('클라이언트 payload 무시', !!save && !JSON.stringify(save.args.p_run.public_payload).includes('hack'));
  check('actor = 검증된 사용자 id', save?.args.p_actor === TOKENS['tok-ceo'].id);
  check('club 범위 = 서버 설정', save?.args.p_club_id === 'CLUB');
  check('waiting 경기만 저장(L3 playing 제외)', JSON.stringify(save?.args.p_predictions.map((p: any) => p.match_id)) === '["L1","L2"]');
  check('저장 payload 에 숫자 확률 없음', !/percent|probA|\d+%/.test(JSON.stringify(save?.args.p_run.public_payload)));
  check('응답에 service key·내부 id 없음', !/service|mem-\d|player_ids/.test(JSON.stringify(r.body)));
}
{
  const { deps, calls } = makeDeps({ staleOnce: true });
  const r = await handleSpotlightAction(deps, 'Bearer tok-ceo', GEN);
  const saves = calls.filter((c) => c.fn === 'save_kdk_spotlight_run');
  check('stale → 거부 경기 제외 후 1회 재시도', saves.length === 2 && r.status === 200);
  check('재시도에서 L2 제외', JSON.stringify(saves[1].args.p_predictions.map((p: any) => p.match_id)) === '["L1"]');
}
{
  const { deps, calls } = makeDeps({ deps: { loadRestrictedMemberIds: async () => null } });
  const r = await handleSpotlightAction(deps, 'Bearer tok-ceo', GEN);
  check('공개 범위 조회 실패 → 생성 거부(fail-closed)', r.status === 502 && r.body.reason === 'visibility_unavailable' && calls.length === 0);
}
{
  const { deps } = makeDeps({ deps: { loadSessionMatches: async () => [] } });
  check('세션 없음 → 404', (await handleSpotlightAction(deps, 'Bearer tok-ceo', GEN)).status === 404);
}
{
  const { deps } = makeDeps({ deps: { loadSessionMatches: async () => MATCHES.map((m) => ({ ...m, status: 'complete' })) } });
  const r = await handleSpotlightAction(deps, 'Bearer tok-ceo', GEN);
  check('대기 경기 없음 → 409 no_predictable_matches', r.status === 409 && r.body.reason === 'no_predictable_matches');
  check('대기 경기 없음 → detail no_waiting', r.body.detail === 'no_waiting');
}
// ── 생성 실패 원인 구분(판정은 DB 그대로 · 안내만 구분) ──
{
  // SQL 설치 이전에 만든 대기 경기: DB 가 전부 uncertifiable 로 거절 → 재시도 대상 0 → 저장 없이 원인 안내.
  const { deps, calls } = makeDeps({ rejectAll: () => 'uncertifiable' });
  const r = await handleSpotlightAction(deps, 'Bearer tok-ceo', GEN);
  const saves = calls.filter((c) => c.fn === 'save_kdk_spotlight_run');
  check('설치 이전 경기 전부 거절 → 409 no_predictable_matches', r.status === 409 && r.body.reason === 'no_predictable_matches');
  check('설치 이전 경기 → detail uncertified · 사유별 2경기', r.body.detail === 'uncertified' && r.body.blocked?.uncertifiable === 2);
  check('설치 이전 경기 → 저장 1회 시도 뒤 재저장 없음(우회 없음)', saves.length === 1);
}
{
  const { deps } = makeDeps({ rejectAll: () => 'no_certificate' });
  check('증명서 없음 → detail uncertified', (await handleSpotlightAction(deps, 'Bearer tok-ceo', GEN)).body.detail === 'uncertified');
}
{
  const { deps } = makeDeps({ rejectAll: (id: string) => (id === 'L1' ? 'uncertifiable' : 'started_before') });
  const r = await handleSpotlightAction(deps, 'Bearer tok-ceo', GEN);
  check('시작 이력 섞임 → detail blocked', r.status === 409 && r.body.detail === 'blocked' && r.body.blocked?.started_before === 1);
}
{
  const { deps } = makeDeps({ rejectAll: () => 'row_changed' });
  check('행 버전 불일치 → detail blocked', (await handleSpotlightAction(deps, 'Bearer tok-ceo', GEN)).body.detail === 'blocked');
}
{
  const { deps } = makeDeps({ deps: { loadSessionMatches: async () => MATCHES.map((m) => (m.status === 'waiting' ? { ...m, player_ids: ['mem-1', 'mem-1', 'mem-3'] } : m)) } });
  const r = await handleSpotlightAction(deps, 'Bearer tok-ceo', GEN);
  check('대기 경기 선수 정보 불완전 → detail invalid_players', r.status === 409 && r.body.detail === 'invalid_players' && r.body.invalidPlayers === 2);
}
{
  const { deps } = makeDeps({ staleOnce: true });
  const r = await handleSpotlightAction(deps, 'Bearer tok-ceo', GEN);
  check('일부만 거절 → 나머지로 생성 · 제외 사유 집계', r.status === 200 && r.body.blocked?.started_before === 1 && r.body.predicted === 1);
}
{
  const { deps } = makeDeps({});
  const r = await handleSpotlightAction(deps, 'Bearer tok-ceo', GEN);
  check('정상 생성(신규 세션) → 제외 0', r.status === 200 && Object.keys(r.body.blocked || {}).length === 0 && r.body.predicted === 2);
}
{
  const { deps } = makeDeps({ deps: { rpc: async () => ({ ok: false, status: 404, code: 'PGRST202' }) } });
  check('SQL 미적용 → 503 sql_not_applied', (await handleSpotlightAction(deps, 'Bearer tok-ceo', GEN)).body.reason === 'sql_not_applied');
}
{
  const { deps } = makeDeps({ deps: { rpc: async () => ({ ok: true, data: { ok: false, reason: 'forbidden' } }) } });
  const r = await handleSpotlightAction(deps, 'Bearer tok-ceo', GEN);
  check('DB 측 actor 거부 → 409 forbidden 전달', r.status === 409 && r.body.reason === 'forbidden');
}

// ── 공개 ────────────────────────────────────────────────────────────────────
{
  const { deps, calls } = makeDeps({ changedL1: true });
  const r = await handleSpotlightAction(deps, 'Bearer tok-ceo', { action: 'publish', runId: RUN_ID, payload: { items: ['hack'] } });
  const p = calls.find((c) => c.fn === 'publish_kdk_spotlight_run');
  check('공개 성공', r.status === 200 && r.body.ok === true);
  check('공개: 선수 교체 L1 무효화 전달', JSON.stringify(p?.args.p_invalidate_match_ids) === '["L1"]');
  check('공개: 클라이언트 payload 무시', !JSON.stringify(p?.args.p_public_payload).includes('hack'));
  check('공개: L1 DTO 제외', !p?.args.p_public_payload.matches.some((m: any) => m.matchNo === 1));
}
{
  const { deps, calls } = makeDeps({ otherClub: true });
  const r = await handleSpotlightAction(deps, 'Bearer tok-ceo', { action: 'publish', runId: RUN_ID });
  check('다른 클럽 회차 공개 거부', r.status === 404 && !calls.some((c) => c.fn === 'publish_kdk_spotlight_run'));
}
{
  const { deps, calls } = makeDeps({ deps: { loadRestrictedMemberIds: async () => null } });
  const r = await handleSpotlightAction(deps, 'Bearer tok-ceo', { action: 'publish', runId: RUN_ID });
  check('공개: 공개 범위 조회 실패 → 거부', r.body.reason === 'visibility_unavailable' && !calls.some((c) => c.fn === 'publish_kdk_spotlight_run'));
}
{
  const { deps, calls } = makeDeps();
  const r = await handleSpotlightAction(deps, 'Bearer tok-ceo', { action: 'unpublish', sessionId: 'S1' });
  check('비공개 성공 · actor 전달', r.status === 200 && calls[0]?.args.p_actor === TOKENS['tok-ceo'].id && calls[0]?.args.p_club_id === 'CLUB');
}

console.log(`MATCH SPOTLIGHT API fixture: ${passed} passed / ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
