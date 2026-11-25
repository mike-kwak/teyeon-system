/**
 * MAINT-002 회원 전용 리포트 API 시험 — 핸들러(handleMemberReportRequest) 단위 + 공개 조회 서비스 투영.
 *   실행: node --experimental-strip-types scripts/verify_maint002_fr_member_api.mjs   (DB 불필요 · 가짜 의존성)
 *   검증: 토큰 없음 · slug 형식 · DB 판정 전달(forbidden/not_available/login_required) · 함수 없음(SQL 미적용) · 응답 allow-list ·
 *        정정 상태 공식 요약(회원만) · 응답 헤더 no-store · 공개 조회가 전체 발행본을 받아도 공개 뷰만 돌려줌.
 */
import { register } from 'node:module';
register('./ts-resolve-hook.mjs', import.meta.url);
const fx = await import('./maint002_fr_fixtures.mjs');
const { handleMemberReportRequest } = await import('../lib/kdk/server/finalReportMemberHandler.ts');
const { SETTLEMENT_HEADERS } = await import('../lib/kdk/server/finalReportSettlementHandler.ts');
const pub = await import('../lib/kdk/finalReportPublicService.ts');
const pvm = await import('../lib/kdk/finalReport/finalReportPublicView.ts');

let passed = 0; const failures = [];
const check = (name, cond, info = '') => { if (cond) passed += 1; else failures.push(`${name}${info ? ` — ${info}` : ''}`); };
const src = fx.sourceOf({ id: 'KDK-QA-API', title: '11월 정모 KDK', date: '2026-11-24' });
const FULL = fx.payloadV41(src);
const names = fx.NAMES.map((n) => n.replace(/\(G\)$/, ''));
const hasName = (o) => names.some((n) => JSON.stringify(o).includes(n));

const calls = [];
const deps = (reply, { configured = true, official = null } = {}) => ({
  configured,
  rpcAsUser: async (token, fn, args) => { calls.push({ token, fn, args }); return typeof reply === 'function' ? reply(token) : reply; },
  officialSummary: async (sid) => { calls.push({ official: sid }); return official; },
});
const SLUG = 'qam002apireport';

let r = await handleMemberReportRequest(deps({ ok: true, data: {} }, { configured: false }), 'Bearer x', SLUG);
check('설정 없음 → 503 not_configured', r.status === 503 && r.body.reason === 'not_configured');
calls.length = 0;
r = await handleMemberReportRequest(deps({ ok: true, data: { ok: true, state: 'ok', payload: FULL } }), null, SLUG);
check('토큰 없음 → 401 · DB 호출 없음', r.status === 401 && r.body.reason === 'login_required' && calls.length === 0);
r = await handleMemberReportRequest(deps({ ok: true, data: {} }), 'Basic abc', SLUG);
check('Bearer 아님 → 401', r.status === 401);
r = await handleMemberReportRequest(deps({ ok: true, data: {} }), 'Bearer tok', '../etc');
check('slug 형식 오류 → 400 · DB 호출 없음', r.status === 400 && r.body.reason === 'invalid_slug' && calls.length === 0);
calls.length = 0;
r = await handleMemberReportRequest(deps({ ok: true, data: { ok: false, reason: 'forbidden' } }), 'Bearer user-token', SLUG);
check('DB forbidden → 403 · 데이터 없음', r.status === 403 && JSON.stringify(r.body) === '{"ok":false,"reason":"forbidden"}');
check('사용자 토큰 그대로 · 회원 RPC 이름 · slug 인자', calls[0].token === 'user-token' && calls[0].fn === 'get_kdk_final_report_member' && calls[0].args.p_slug === SLUG);
r = await handleMemberReportRequest(deps({ ok: true, data: { ok: false, reason: 'login_required' } }), 'Bearer t', SLUG);
check('DB login_required → 401', r.status === 401);
r = await handleMemberReportRequest(deps({ ok: true, data: { ok: false, reason: 'not_available' } }), 'Bearer t', SLUG);
check('DB not_available → 404', r.status === 404 && r.body.reason === 'not_available');
r = await handleMemberReportRequest(deps({ ok: false, status: 404, code: 'PGRST202' }), 'Bearer t', SLUG);
check('함수 없음(SQL 미적용 · rollback) → 404 not_available', r.status === 404 && r.body.reason === 'not_available');
r = await handleMemberReportRequest(deps({ ok: false, status: 403, code: '42501' }), 'Bearer t', SLUG);
check('실행 권한 없음 42501 → 403', r.status === 403);
r = await handleMemberReportRequest(deps({ ok: false, status: 401, code: 'PGRST301' }), 'Bearer t', SLUG);
check('만료 토큰 PGRST301 → 401', r.status === 401);
r = await handleMemberReportRequest(deps({ ok: false, status: 0, code: 'network' }), 'Bearer t', SLUG);
check('네트워크 오류 → 502 unavailable', r.status === 502 && r.body.reason === 'unavailable');
r = await handleMemberReportRequest(deps({ ok: true, data: { ok: true, state: 'ok', payload: { schema: 1, junk: true } } }), 'Bearer t', SLUG);
check('형식 깨진 payload → 502(부분 데이터 반환 없음)', r.status === 502 && !('payload' in r.body));
const evil = { ...FULL, standings: FULL.standings.map((s, i) => (i ? s : { ...s, memberId: '11111111-2222-4333-8444-555555555555', email: 'x@y.z' })) };
r = await handleMemberReportRequest(deps({ ok: true, data: { ok: true, state: 'ok', payload: evil, revision: 3, officialSessionId: 'KDK-QA-API' } }), 'Bearer t', SLUG);
check('회원 ok → 200 · 순위 포함 · revision', r.status === 200 && r.body.state === 'ok' && r.body.payload.standings.length === 8 && r.body.revision === 3);
check('회원 응답도 allow-list(모르는 키 · 이메일 · UUID · 세션 id 제거)', !/memberId|x@y\.z|11111111-2222|KDK-QA-API/.test(JSON.stringify(r.body)));
calls.length = 0;
const OFFICIAL = { standings: [{ rank: 1, name: '김가람', guest: false, wins: 4, losses: 0, diff: 8 }], matches: [] };
r = await handleMemberReportRequest(deps({ ok: true, data: { ok: true, state: 'corrected', title: '11월 정모', date: '2026-11-24', officialSessionId: 'KDK-QA-API' } }, { official: OFFICIAL }), 'Bearer t', SLUG);
check('회원 정정 → 공식 요약 첨부(세션 id 는 응답에 없음)', r.status === 200 && r.body.state === 'corrected' && r.body.official?.standings.length === 1 && !JSON.stringify(r.body).includes('KDK-QA-API'));
check('정정 공식 요약은 DB 가 회원으로 판정한 뒤에만 조회', calls.findIndex((c) => c.fn) < calls.findIndex((c) => c.official));
calls.length = 0;
await handleMemberReportRequest(deps({ ok: true, data: { ok: false, reason: 'forbidden' } }, { official: OFFICIAL }), 'Bearer t', SLUG);
check('비회원 → 공식 요약 조회 안 함', !calls.some((c) => c.official));
check('응답 헤더 no-store · private · CDN 금지', /no-store/.test(SETTLEMENT_HEADERS['cache-control']) && /private/.test(SETTLEMENT_HEADERS['cache-control'])
  && SETTLEMENT_HEADERS['cdn-cache-control'] === 'no-store' && SETTLEMENT_HEADERS['vercel-cdn-cache-control'] === 'no-store');

// ── 공개 조회 서비스: SQL 적용 전(전체 발행본)이 와도 공개 뷰만 ─────────────────────
const rpc = (body) => async () => ({ ok: true, status: 200, body });
const before = await pub.fetchPublicFinalReport('qam002apireport', rpc({ ok: true, state: 'ok', payload: FULL, revision: 2, officialSessionId: 'KDK-QA-API' }));
check('SQL 적용 전 응답(전체) → 공개 뷰만 · 이름 · 세션 id 없음', before.state === 'ok' && !hasName(before) && !JSON.stringify(before).includes('KDK-QA-API') && !('payload' in before));
check('공개 뷰 키 = allow-list', Object.keys(before.view).sort().join() === 'closing,closingTitle,edition,headline,layout,next,numbers,opening,session,vol');
check('공개 뷰 집계 · 판형 유지', before.view.numbers.length === 4 && before.view.layout === 2 && before.view.next?.date === '2026-12-01' && before.view.session.participantCount === 8);
const redacted = { schema: 1, access: 'public', edition: 3, session: FULL.session, opening: FULL.opening, closing: FULL.closing, headline: FULL.headline, podium: [], featured: [], standings: [], highlights: [],
  v41: { vol: FULL.v41.vol, heroes: [], mentions: [], rivalry: null, numbers: FULL.v41.numbers.map(({ kind, value }) => ({ kind, value })), next: FULL.v41.next, layout: 2, closingTitle: FULL.v41.closingTitle } };
const after = await pub.fetchPublicFinalReport('qam002apireport', rpc({ ok: true, state: 'ok', access: 'public', payload: redacted, revision: 2 }));
check('SQL 적용 후 응답(공개 투영) → 같은 공개 뷰', JSON.stringify(after.view) === JSON.stringify(before.view));
const v2h = fx.payloadV2(src);
check('v2 이름 든 헤드라인 → 공개 뷰 null', /김가람/.test(v2h.headline) && pvm.parsePublicReportView(v2h).headline === null);
check('메타 설명 · OG 값에 이름 없음', !hasName((await import('../lib/kdk/finalReport/finalReportView.ts')).reportMetaDescription(before.view)));

console.log(`MAINT-002 member report API: ${passed} passed / ${failures.length} failed`);
for (const f of failures) console.log('  FAIL', f);
process.exit(failures.length ? 1 : 0);
