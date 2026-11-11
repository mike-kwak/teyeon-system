/**
 * KDK FINAL REPORT 운영 API 시험(P3) — 실제 핸들러(lib/kdk/server/finalReportHandler) + 격리된 PGlite 에 설치한 실제 SQL.
 *   핸들러의 rpc 호출을 service_role 로 "이름 붙인 인자"(p_x => ...)로 실행하므로 함수명 · 인자명 · 반환 구조가 SQL 과 다르면 실패한다.
 *   운영 DB 미접속 · 가상 회원.
 *
 *   실행: PGLITE_MODULE=<pglite dist/index.js> node --experimental-strip-types scripts/verify_final_report_api.mjs
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

const modPath = process.env.PGLITE_MODULE;
if (!modPath) { console.log('SKIP: PGLITE_MODULE 미지정'); process.exit(2); }
const { PGlite } = await import(pathToFileURL(modPath).href);
register('./ts-resolve-hook.mjs', import.meta.url);
const { handleFinalReportAction } = await import('../lib/kdk/server/finalReportHandler.ts');
const fr = await import('../lib/kdk/finalReport/finalReportModel.ts');
const ed = await import('../lib/kdk/finalReport/finalReportEditor.ts');
const { fetchPublicFinalReport } = await import('../lib/kdk/finalReportPublicService.ts');

const here = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(join(here, '../supabase/add_kdk_final_report.sql'), 'utf8');

let passed = 0;
const failures = [];
const check = (name, cond, info = '') => { if (cond) passed += 1; else failures.push(`${name}${info ? ` — ${info}` : ''}`); };
const clone = (v) => JSON.parse(JSON.stringify(v));

const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];
const asRole = async (role, fn) => { await db.exec(`set role ${role};`); try { return await fn(); } finally { await db.exec('reset role;'); } };

const CEO = '00000000-0000-0000-0000-00000000000a';
const MEMBER = '00000000-0000-0000-0000-00000000000b';
const KDKM = '00000000-0000-0000-0000-00000000000c';
const U = (n) => `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`;

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  create table public.profiles (id uuid primary key, role text, profile_visibility_level text default 'public');
  create table public.members (id uuid primary key, auth_user_id uuid);
  create table public.kdk_managers (user_id uuid primary key);
  create table public.teyeon_archive_v1 (
    id text primary key, raw_data jsonb, created_at timestamptz default now(),
    is_official boolean not null default false, is_test boolean not null default false,
    confirmed_at timestamptz, confirmed_by text, archive_type text not null default 'kdk');
  revoke all on public.teyeon_archive_v1 from anon;
  create function public.kdk_spotlight_is_admin(p_user uuid) returns boolean language sql stable security definer
    set search_path = public, pg_temp as $$
    select p_user is not null and (
      exists (select 1 from public.profiles p where p.id = p_user and upper(btrim(coalesce(p.role, ''))) in ('CEO', 'ADMIN'))
      or (exists (select 1 from public.kdk_managers k where k.user_id = p_user)
          and exists (select 1 from public.profiles p where p.id = p_user and upper(btrim(coalesce(p.role, ''))) in ('MEMBER', 'OPERATOR', 'FINANCE_MANAGER'))))
  $$;
  revoke all on function public.kdk_spotlight_is_admin(uuid) from public, anon, authenticated;
  insert into public.profiles (id, role) values ('${CEO}', 'CEO'), ('${MEMBER}', 'MEMBER'), ('${KDKM}', 'MEMBER');
  insert into public.kdk_managers values ('${KDKM}');
`);
await db.exec(SQL);

const NAMES = ['구봉준', '박광현', '정다은', '김영호', '홍길동(G)', '이상윤'];
const pid = (i) => (NAMES[i].endsWith('(G)') ? 'manual-guest-hong' : U(i + 1));
const REC = [[4, 1, 12], [4, 1, 9], [3, 2, 5], [2, 3, -2], [1, 4, -9], [1, 4, -15]];
const RAW = {
  title: '11월 정모', date: '2026-11-11',
  ranking_data: NAMES.map((n, i) => ({ id: pid(i), name: n, wins: REC[i][0], losses: REC[i][1], diff: REC[i][2], avatar: 'x.png' })),
  snapshot_data: [
    { id: 'm-1', round: 1, court: 1, group_name: 'A', status: 'complete', player_ids: [0, 1, 2, 3].map(pid), player_names: [0, 1, 2, 3].map((i) => NAMES[i]), score1: 6, score2: 5 },
    { id: 'm-2', round: 1, court: 2, group_name: 'B', status: 'complete', player_ids: [4, 5, 0, 2].map(pid), player_names: ['홍길동', '이상윤', '구봉준', '정다은'], score1: 0, score2: 6 },
    { id: 'm-3', round: 2, court: 1, group_name: 'A', status: 'complete', player_ids: [1, 3, 4, 5].map(pid), player_names: [1, 3, 4, 5].map((i) => NAMES[i]), score1: 6, score2: 2 },
  ],
  settlement_data: [{ player_id: U(1), final_amount: -10000, account: '111-222-333333' }],
  player_metadata: { [U(1)]: { group: 'A', birthYear: 1980 }, [U(6)]: { group: 'B', birthYear: 1990 } },
};
const SID = 'KDK-20261111-QAP3';
const SID_OTHER = 'KDK-20261104-QAP3';
const OTHER = clone(RAW); OTHER.ranking_data[0].id = U(9); OTHER.ranking_data[0].name = '최지훈'; OTHER.snapshot_data[0].id = 'x-1';
const ins = (id, raw, official = true, test = false) => db.query(`insert into public.teyeon_archive_v1 (id, raw_data, is_official, is_test, confirmed_by) values ($1, $2, $3, $4, 'admin@club.test')`, [id, JSON.stringify(raw), official, test]);
await ins(SID, RAW); await ins(SID_OTHER, OTHER); await ins('KDK-UNOFF', RAW, false); await ins('KDK-TEST', RAW, true, true);
const archiveBefore = await q(`select id, raw_data::text r from public.teyeon_archive_v1 order by id`);

// ── 의존성: 토큰 → 사용자 · 관리 권한(가짜 Auth) + 실제 SQL(PGlite) ───────────────────────────
const TOKENS = { 'tok-ceo': CEO, 'tok-member': MEMBER, 'tok-kdkm': KDKM, 'tok-spoof': MEMBER };
const MANAGE = { [CEO]: null /* can_manage_kdk 없음 → 예전 규칙(CEO) */, [MEMBER]: false, [KDKM]: true };
const rpcLog = [];
let sqlMissing = false;
let slugN = 0;
const deps = {
  configured: true, clubId: 'C1',
  verifyUser: async (t) => TOKENS[t] ?? null,
  canManageKdk: async (t) => (t === 'tok-spoof' ? true : MANAGE[TOKENS[t]] ?? null),
  getRole: async (id) => (await one(`select role from public.profiles where id = $1`, [id]))?.role ?? null,
  rpc: async (fn, args) => {
    rpcLog.push({ fn, args });
    if (sqlMissing) return { ok: false, status: 404, code: 'PGRST202' };
    const keys = Object.keys(args);
    const vals = keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
    try {
      const r = await asRole('service_role', () => one(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, vals));
      return { ok: true, data: r.r };
    } catch (e) { return { ok: false, status: 400, code: String(e?.code || 'sql_error'), message: String(e?.message || '') }; }
  },
  randomSlug: () => `qap3slug${String(++slugN).padStart(6, '0')}`,
};
const call = (tok, body) => handleFinalReportAction(deps, tok ? `Bearer ${tok}` : null, body);
const anonRpc = async (fn, args) => {
  const r = await asRole('anon', () => one(`select public.${fn}(${Object.keys(args).map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, Object.values(args)));
  return { ok: true, status: 200, body: r.r };
};
const pub = (slug) => fetchPublicFinalReport(slug, anonRpc);
const setRaw = (raw) => db.query(`update public.teyeon_archive_v1 set raw_data = $2 where id = $1`, [SID, JSON.stringify(raw)]);

// ── 인증 · 권한 ────────────────────────────────────────────────────────────────
check('토큰 없음 → 401', (await call(null, { action: 'access' })).status === 401);
check('위조 토큰 → 401', (await call('forged', { action: 'access' })).status === 401);
check('일반 MEMBER → 403(편집 · 발행 불가)', (await call('tok-member', { action: 'load', sessionId: SID })).status === 403
  && (await call('tok-member', { action: 'publish', sessionId: SID, confirm: true })).status === 403
  && (await call('tok-member', { action: 'unpublish', sessionId: SID })).status === 403);
check('KDK 관리자(등재) → access ok', (await call('tok-kdkm', { action: 'access' })).body.ok === true);
check('CEO(can_manage_kdk 없음 → 역할 규칙) → access ok', (await call('tok-ceo', { action: 'access' })).body.ok === true);
const spoof = await call('tok-spoof', { action: 'load', sessionId: SID });
check('서버 권한 판정을 통과해도 SQL(kdk_spotlight_is_admin)이 다시 거부 → 403', spoof.status === 403 && spoof.body.reason === 'forbidden');
check('잘못된 sessionId · action → 400', (await call('tok-ceo', { action: 'load', sessionId: "x'; drop" })).status === 400 && (await call('tok-ceo', { action: 'hack', sessionId: SID })).status === 400);

// ── load: 공식 · 비테스트만 · 저장 순서 그대로 ─────────────────────────────────────────
check('미확정 Archive → 409 not_official', (await call('tok-ceo', { action: 'load', sessionId: 'KDK-UNOFF' })).body.reason === 'not_official');
check('테스트 Archive → 409 test', (await call('tok-ceo', { action: 'load', sessionId: 'KDK-TEST' })).body.reason === 'test');
check('없는 Archive → 404', (await call('tok-ceo', { action: 'load', sessionId: 'KDK-NONE' })).status === 404);
let L = await call('tok-kdkm', { action: 'load', sessionId: SID });
let D = L.body.data;
check('load ok · 순위 = ranking_data 저장 순서(재계산 없음)', L.status === 200 && D.standings.map((s) => s.name).join() === '구봉준,박광현,정다은,김영호,홍길동(G),이상윤'
  && D.standings[0].wins === 4 && D.standings[1].diff === 9);
check('load: 동률(4승 1패) 저장 순서 유지(득실로 재정렬하지 않음 — 1위 +12, 2위 +9 그대로)', D.standings[0].rank === 1 && D.standings[1].rank === 2);
check('load: 완료 경기 · 지문 · 기록 태그 · 기본 추천', D.matches.length === 3 && D.matches.every((m) => m.fingerprint) && D.recommended.length > 0
  && D.matches.find((m) => m.matchId === 'm-1').tags.includes('CLOSEST_BATTLE'));
check('load: 정산 · 출생연도 · 계좌 · 확정자 이메일 없음', !/final_amount|birthYear|111-222|admin@club|avatar/.test(JSON.stringify(L.body)));
check('load: 처음엔 리포트 없음 · 빈 문구', D.report === null && D.content.opening === '' && D.content.featured === null);

// ── 문구 형식 · 다른 세션 연결 차단 ───────────────────────────────────────────────────
const base = (content, extra = {}) => ({ sessionId: SID, content, ...extra });
const otherKey = U(9);
check('다른 세션 선수 키로 스토리 → 400 foreign_player', (await call('tok-ceo', { action: 'save', ...base({ schema: 1, stories: [{ playerKey: otherKey, rank: 1, text: 'x' }] }) })).body.reason === 'foreign_player');
check('다른 세션 경기 id 로 리뷰 → 400 foreign_match', (await call('tok-ceo', { action: 'save', ...base({ schema: 1, featured: [{ matchId: 'x-1', fingerprint: 'f', review: '', tag: null }] }) })).body.reason === 'foreign_match');
check('꺾쇠(HTML) → 400 content_html', (await call('tok-ceo', { action: 'save', ...base({ schema: 1, opening: '<b>우승</b>' }) })).body.reason === 'content_html');
check('오프닝 61자 → 400 content_too_long', (await call('tok-ceo', { action: 'save', ...base({ schema: 1, opening: '가'.repeat(61) }) })).body.reason === 'content_too_long');
check('리뷰 5개 → 400 content_too_many', (await call('tok-ceo', { action: 'save', ...base({ schema: 1, featured: ['m-1', 'm-2', 'm-3', 'm-4', 'm-5'].map((id) => ({ matchId: id, fingerprint: 'f', review: '', tag: null })) }) })).body.reason === 'content_too_many');

// ── 초안 저장 → 공개본 없음 · actor 는 서버 확정 ─────────────────────────────────────────
const fp = (id) => D.matches.find((m) => m.matchId === id).fingerprint;
let content = { schema: 1, opening: '여섯 명이 함께한 11월 정모입니다.', closing: '다음 정모에서 만나요.',
  stories: [{ playerKey: U(1), rank: 1, text: '4승 1패, 득실 +12로 1위입니다.' }],
  featured: [{ matchId: 'm-1', fingerprint: fp('m-1'), review: '6:5 한 점 차 경기였습니다.', tag: 'MATCH_OF_THE_DAY' }] };
let s1 = await call('tok-kdkm', { action: 'save', ...base(content, { expectedUpdatedAt: null, p_actor: CEO, userId: CEO }) });
check('첫 초안 저장(KDK 관리자) → draft · revision 0 · slug 발급', s1.status === 200 && s1.body.status === 'draft' && s1.body.revision === 0 && /^qap3slug/.test(s1.body.publicSlug), JSON.stringify(s1.body));
const row = await one(`select created_by::text c, updated_by::text u from public.kdk_final_reports where session_id = $1`, [SID]);
check('작성자 = 토큰 사용자(body 의 p_actor · userId 무시)', row.c === KDKM && row.u === KDKM);
check('초안만으로는 공개 안 됨', (await pub(s1.body.publicSlug)).state === 'not_found');
const slug = s1.body.publicSlug;
check('동시 편집: 오래된 기준(null=처음 작성)으로 다시 저장 → 409 draft_conflict', (await call('tok-ceo', { action: 'save', ...base(content, { expectedUpdatedAt: null }) })).body.reason === 'draft_conflict');
check('동시 편집: 다른 시각 기준 → 409 draft_conflict', (await call('tok-ceo', { action: 'save', ...base(content, { expectedUpdatedAt: '2020-01-01T00:00:00Z' }) })).body.reason === 'draft_conflict');
check('잘못된 기준 시각 형식 → 400', (await call('tok-ceo', { action: 'save', ...base(content, { expectedUpdatedAt: 'yesterday' }) })).status === 400);
let upd = s1.body.updatedAt;

// ── 미리보기 = 서버가 만든 공개본(클라이언트 값 무시) ─────────────────────────────────────
const fakeBody = { action: 'preview', ...base(content), payload: { standings: [{ rank: 1, name: '가짜', wins: 99 }] }, standings: [{ key: U(6), rank: 1 }] };
const pv = await call('tok-ceo', fakeBody);
check('미리보기 ok · 순위 · 점수는 서버 기록(클라이언트 payload · 순위 무시)', pv.body.ok === true && pv.body.payload.standings[0].name === '구봉준' && pv.body.payload.standings[0].wins === 4 && !JSON.stringify(pv.body).includes('가짜'));
const L0 = await call('tok-ceo', { action: 'load', sessionId: SID });
check('미리보기 공개본 = 모델 직접 생성 공개본', JSON.stringify(pv.body.payload) === JSON.stringify(fr.buildFinalReportPayload(fr.buildFinalReportModel({
  id: SID, archiveType: 'kdk', isOfficial: true, isTest: false, title: RAW.title, date: RAW.date,
  rankingData: RAW.ranking_data, snapshotData: RAW.snapshot_data, playerGroups: { [U(1)]: 'A', [U(6)]: 'B' } }).model, content).payload));
check('문구 없이도 발행 가능한 공개본', (await call('tok-ceo', { action: 'preview', ...base({ schema: 1 }) })).body.ok === true);
const pii = await call('tok-ceo', { action: 'preview', ...base({ ...content, closing: '문의 010-1234-5678' }) });
check('문구 개인정보(전화) → 미리보기 거부 invalid_text', pii.body.ok === false && pii.body.reason === 'invalid_text');
const other = await call('tok-ceo', { action: 'preview', ...base({ ...content, stories: [{ playerKey: U(1), rank: 1, text: '박광현 선수를 이겼습니다.' }] }) });
check('스토리에 다른 선수 이름 → invalid_text', other.body.reason === 'invalid_text');

// ── 발행 ─────────────────────────────────────────────────────────────────────
const pubBody = (extra) => ({ action: 'publish', ...base(content), expectedUpdatedAt: upd, expectedRevision: 0, baseSignature: D.signature, confirm: true, ...extra });
check('확인 체크 없음 → 400 confirm_required', (await call('tok-ceo', pubBody({ confirm: false }))).body.reason === 'confirm_required');
check('불러온 뒤 기록 지문 다름 → 409 stale_source', (await call('tok-ceo', pubBody({ baseSignature: 'v1:0000' }))).body.reason === 'stale_source');
check('revision 다름 → 409 revision_conflict', (await call('tok-ceo', pubBody({ expectedRevision: 3 }))).body.reason === 'revision_conflict');
const before = (await pub(slug)).state;
let P1 = await call('tok-ceo', pubBody({ payload: { standings: [{ rank: 1, name: '가짜' }] } }));
check('첫 발행 → revision 1 · 같은 slug', P1.body.ok === true && P1.body.revision === 1 && P1.body.publicSlug === slug, JSON.stringify(P1.body));
let G = await pub(slug);
check('발행 전 not_found → 발행 후 공개 ok', before === 'not_found' && G.state === 'ok');
check('공개본 = 미리보기(실제 공개 화면 데이터와 일치)', JSON.stringify(G.payload) === JSON.stringify(pv.body.payload));
check('공개본에 클라이언트 값 · UUID · 게스트 id · 세션 id 없음', !/가짜|11111111-0000|manual-guest|KDK-20261111/.test(JSON.stringify(G.payload)));
const link = async () => (await anonRpc('get_public_kdk_final_report_link', { p_session_id: SID })).body;
check('Archive 진입점 링크: 발행 중 → slug', (await link()).publicSlug === slug);
upd = P1.body.updatedAt;

// ── 초안 수정은 공개본 유지 → 재발행 ──────────────────────────────────────────────────
content = { ...content, closing: '모두 수고 많으셨습니다.' };
const s2 = await call('tok-ceo', { action: 'save', ...base(content, { expectedUpdatedAt: upd }) });
check('발행 후 초안 저장 → 공개본은 그대로', s2.body.ok === true && (await pub(slug)).payload.closing === '다음 정모에서 만나요.');
upd = s2.body.updatedAt;
const P2 = await call('tok-ceo', pubBody({ expectedRevision: 1 }));
check('재발행 → revision 2 · slug 유지 · 새 문구 공개', P2.body.revision === 2 && P2.body.publicSlug === slug && (await pub(slug)).payload.closing === '모두 수고 많으셨습니다.');
upd = P2.body.updatedAt;
check('동시 발행: 이미 지난 revision(1)으로 다시 발행 → 409 revision_conflict', (await call('tok-kdkm', pubBody({ expectedRevision: 1 }))).body.reason === 'revision_conflict');

// ── 공식 기록 정정: 순위 변경 → 공개 corrected · 재확인 전 발행 차단 ───────────────────────────
const swapped = clone(RAW); [swapped.ranking_data[0], swapped.ranking_data[1]] = [swapped.ranking_data[1], swapped.ranking_data[0]];
const sigBefore = D.signature;
await setRaw(swapped);
check('순위 정정 → 공개 화면 corrected(오래된 수치 미공개)', (await pub(slug)).state === 'corrected');
check('Archive 진입점 링크도 숨김', (await link()).ok === false);
L = await call('tok-ceo', { action: 'load', sessionId: SID }); D = L.body.data;
check('load: 발행본 stale 표시 · 저장 문구 보존', D.report.stale === true && D.content.stories[0].text === '4승 1패, 득실 +12로 1위입니다.');
const rec = ed.reconcileEditor(D.content, D);
check('편집기 연결 확인: 스토리 rank_changed · 리뷰 ok', rec.needsReview && rec.stories[0].state === 'rank_changed' && rec.featured[0].state === 'ok');
check('예전 지문으로 발행 → 409 stale_source', (await call('tok-ceo', pubBody({ expectedRevision: 2, baseSignature: sigBefore }))).body.reason === 'stale_source');
const nr = await call('tok-ceo', pubBody({ expectedRevision: 2, baseSignature: D.signature }));
check('새 지문이어도 재확인 전 → 409 needs_review(문구는 지우지 않음)', nr.body.reason === 'needs_review' && (await one(`select content->'stories'->0->>'text' t from public.kdk_final_reports where session_id = $1`, [SID])).t === '4승 1패, 득실 +12로 1위입니다.');
const ra = await call('tok-ceo', { action: 'reanchor', ...base(D.content), keep: { stories: [U(1)], featured: ['m-1'] } });
check('재확인(다시 연결) → 스토리 현재 순위 2위로 연결 · 연결 문제 없음', ra.body.ok && ra.body.content.stories[0].rank === 2 && ra.body.reconcile.needsReview === false);
content = ra.body.content;
const P3 = await call('tok-ceo', pubBody({ expectedRevision: 2, baseSignature: D.signature, expectedUpdatedAt: D.report.updatedAt }));
check('재확인 후 재발행 → revision 3 · 같은 slug · 공개 ok · 정정 순위 반영', P3.body.revision === 3 && (await pub(slug)).state === 'ok' && (await pub(slug)).payload.standings[0].name === '박광현', JSON.stringify(P3.body));
upd = P3.body.updatedAt;

// ── 경기 점수 정정 → 리뷰 match_changed ─────────────────────────────────────────────
const scored = clone(swapped); scored.snapshot_data[0].score2 = 4;
await setRaw(scored);
L = await call('tok-ceo', { action: 'load', sessionId: SID }); D = L.body.data;
check('점수 정정 → 편집기 리뷰 match_changed', ed.reconcileEditor(D.content, D).featured[0].state === 'match_changed');
check('점수 정정 → 재확인 전 발행 차단', (await call('tok-ceo', pubBody({ expectedRevision: 3, baseSignature: D.signature, content: D.content, expectedUpdatedAt: D.report.updatedAt }))).body.reason === 'needs_review');
const ra2 = await call('tok-ceo', { action: 'reanchor', ...base(D.content), keep: { stories: [U(1)], featured: [] } });
check('재확인에서 리뷰 제외 → 연결 문제 없음 · 다른 문구 유지', ra2.body.reconcile.needsReview === false && ra2.body.content.featured.length === 0 && ra2.body.content.opening === content.opening);

// ── 공식 해제 · 테스트 전환 · 비공개 ─────────────────────────────────────────────────
await db.exec(`update public.teyeon_archive_v1 set is_official = false where id = '${SID}'`);
check('공식 해제 → 편집 불가(409 not_official) · 공개 not_found', (await call('tok-ceo', { action: 'load', sessionId: SID })).body.reason === 'not_official' && (await pub(slug)).state === 'not_found');
await db.exec(`update public.teyeon_archive_v1 set is_official = true where id = '${SID}'`);
const un = await call('tok-kdkm', { action: 'unpublish', sessionId: SID });
check('비공개 → 공개 not_found · 링크 숨김', un.body.ok === true && (await pub(slug)).state === 'not_found' && (await link()).ok === false);
L = await call('tok-ceo', { action: 'load', sessionId: SID }); D = L.body.data;
check('비공개 후 load: unpublished · revision 유지', D.report.status === 'unpublished' && D.report.revision === 3);
const P4 = await call('tok-ceo', { action: 'publish', ...base(ra2.body.content), expectedUpdatedAt: D.report.updatedAt, expectedRevision: 3, baseSignature: D.signature, confirm: true });
check('비공개 후 재발행 → 같은 slug · revision 4 · 공개', P4.body.revision === 4 && P4.body.publicSlug === slug && (await pub(slug)).state === 'ok');

// ── SQL 미적용 · Archive 무변경 · 호출 인자 ───────────────────────────────────────────
sqlMissing = true;
check('SQL 미적용 → 503 sql_not_applied', (await call('tok-ceo', { action: 'load', sessionId: SID })).body.reason === 'sql_not_applied');
sqlMissing = false;
check('모든 RPC 의 p_actor = 토큰 사용자', rpcLog.filter((x) => 'p_actor' in x.args).every((x) => [CEO, MEMBER, KDKM].includes(x.args.p_actor)) && rpcLog.some((x) => x.args.p_actor === KDKM));
check('SQL 호출 오류 없음(함수명 · 인자 일치)', rpcLog.length > 20);
await setRaw(RAW);
const archiveAfter = await q(`select id, raw_data::text r from public.teyeon_archive_v1 order by id`);
check('Archive 원본 무변경(시험이 바꾼 값 복원 후 동일)', JSON.stringify(archiveAfter) === JSON.stringify(archiveBefore));

console.log(`KDK FINAL REPORT API (handler + PGlite SQL): ${passed} passed / ${failures.length} failed`);
for (const f of failures) console.log('  FAIL', f);
process.exit(failures.length ? 1 : 0);
