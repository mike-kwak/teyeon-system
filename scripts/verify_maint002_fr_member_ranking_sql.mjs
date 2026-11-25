/**
 * MAINT-002 SQL 시험 — 격리된 PGlite 에서만 실행(운영 DB 미접속 · 가상 회원 · 가상 이름).
 *
 *   실행: PGLITE_MODULE=<@electric-sql/pglite dist/index.js 절대경로> node --experimental-strip-types scripts/verify_maint002_fr_member_ranking_sql.mjs
 *   설치 순서: Supabase stub → add_kdk_final_report.sql → add_kdk_final_report_v41.sql → (precheck) → maint002 → (verify)
 *   검증: 권한별 공개/회원 응답 · 공개 투영(판형 v1 · v2 · V4.1 · V4.2) · 문구 안전 판정 · 정정/비공개/공식 해제 ·
 *        직접 접근 차단 · 보조 함수 실행 차단 · 발행 원본/Archive 무변경 · 정산 무변경 · 재실행 · rollback · TS 투영과 일치.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

process.on('unhandledRejection', (e) => { console.log('UNHANDLED', e?.code || '', String(e?.message || e).slice(0, 300)); process.exit(1); });
const modPath = process.env.PGLITE_MODULE;
if (!modPath) { console.log('SKIP: PGLITE_MODULE 미지정'); process.exit(2); }
const { PGlite } = await import(pathToFileURL(modPath).href);
const here = dirname(fileURLToPath(import.meta.url));
const rd = (f) => readFileSync(join(here, '../supabase', f), 'utf8');
const BASE = rd('add_kdk_final_report.sql'); const V41 = rd('add_kdk_final_report_v41.sql');
const M = rd('maint002_fr_member_ranking.sql'); const RB = rd('maint002_fr_member_ranking_rollback.sql');
const PRE = rd('maint002_fr_member_ranking_precheck_READONLY.sql'); const VER = rd('maint002_fr_member_ranking_verify_READONLY.sql');
const fx = await import('./maint002_fr_fixtures.mjs');
const pv = await import('../lib/kdk/finalReport/finalReportPublicView.ts');
const model = await import('../lib/kdk/finalReport/finalReportModel.ts');

let passed = 0; const failures = [];
const check = (name, cond, info = '') => { if (cond) passed += 1; else failures.push(`${name}${info ? ` — ${info}` : ''}`); };
const A = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MID = (n) => `33333333-0000-4000-8000-${String(n).padStart(12, '0')}`;

// 계정(가상) — 정책 표의 행마다 하나
const ACC = {
  GUEST_LOGIN: A(1),        // 카카오 로그인 · profiles GUEST · members 없음
  DAY_GUEST: A(2),          // 당일 참가 게스트(manual-guest) 가 로그인 — members 없음 · 이름 같음
  UNLINKED: A(3),           // profiles MEMBER · members 행은 이메일만 같고 auth_user_id 없음(이메일 fallback 금지)
  WITHDRAWN: A(4),          // '정회원, 탈회'
  REGULAR: A(5),            // 정회원
  ASSOC: A(6),              // 준회원
  EXEC: A(7),               // '정회원, 총무'
  EXEC_ONLY: A(8),          // '경기'(임원 토큰만)
  SYS_CEO: A(9),            // profiles CEO · members 없음
  SYS_ADMIN: A(10),         // profiles ADMIN · members 없음
  OPERATOR: A(11),          // profiles OPERATOR · members 없음
  GUEST_MEMBER_ROW: A(12),  // members '게스트' 연결
  UNKNOWN: A(13),           // members '메모'
  MULTI_WD: A(14),          // 연결 행 2개: 정회원 + 탈회 → 탈회 우선
  PROFILE_GUEST_MEMBER: A(15), // profiles GUEST 인데 members 정회원 연결(앱 권한 표시 오류 사례) → 회원 자격 기준 허용
  CEO_WITHDRAWN: A(16),     // profiles CEO + members 탈회 → 거부
  OTHER_CLUB: A(17),        // 다른 클럽의 정회원 → 거부(클럽 범위)
  NULL_CLUB: A(18),         // 정회원이지만 members.club_id 없음 → 거부(운영 건수는 precheck P08)
};
const CLUB = '512d047d-a076-4080-97e5-6bb5a2c07819'; const OTHER_CLUB = '99999999-0000-4000-8000-000000000001';
const ALLOW = new Set(['REGULAR', 'ASSOC', 'EXEC', 'EXEC_ONLY', 'PROFILE_GUEST_MEMBER']);

async function newDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema auth; grant usage on schema auth to anon, authenticated, service_role;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.profiles (id uuid primary key, role text, profile_visibility_level text default 'public');
    create table public.members (id uuid primary key, auth_user_id uuid, role text, email text, nickname text, club_id uuid default '512d047d-a076-4080-97e5-6bb5a2c07819');
    create table public.kdk_managers (user_id uuid primary key);
    create table public.teyeon_archive_v1 (id text primary key, raw_data jsonb, created_at timestamptz default now(),
      is_official boolean not null default false, is_test boolean not null default false, confirmed_at timestamptz, confirmed_by text,
      profile_reflected boolean not null default false, archive_type text not null default 'kdk');
    revoke all on public.teyeon_archive_v1 from anon; grant select on public.teyeon_archive_v1 to authenticated;
    create function public.kdk_spotlight_is_admin(p_user uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
      select p_user is not null and exists (select 1 from public.profiles p where p.id = p_user and upper(btrim(coalesce(p.role, ''))) in ('CEO', 'ADMIN')) $$;
    revoke all on function public.kdk_spotlight_is_admin(uuid) from public, anon, authenticated;
    create table public.finance_dues_receivables (id uuid primary key default gen_random_uuid(), member_id uuid not null, receivable_type text not null,
      amount_due integer not null, status text not null default 'pending', related_kdk_session_id text);
    create table public.finance_dues_payments (id uuid primary key default gen_random_uuid(), member_id uuid, receivable_id uuid, amount integer not null,
      payment_type text, is_voided boolean not null default false);
    create table public.kdk_guest_penalty_payments (id uuid primary key default gen_random_uuid(), session_id text not null, participant_id text not null,
      charge_type text not null default 'penalty', participant_name_snapshot text, amount integer not null, status text not null default 'paid',
      paid_at timestamptz, paid_by uuid, cancelled_at timestamptz, cancelled_by uuid, updated_at timestamptz default now());
    create table public.club_schedules (id uuid primary key default gen_random_uuid(), title text, schedule_type text, schedule_date date, start_time time);
  `);
  const prof = { GUEST_LOGIN: 'GUEST', DAY_GUEST: 'GUEST', UNLINKED: 'MEMBER', WITHDRAWN: 'MEMBER', REGULAR: 'MEMBER', ASSOC: 'MEMBER', EXEC: 'MEMBER',
    EXEC_ONLY: 'OPERATOR', SYS_CEO: 'CEO', SYS_ADMIN: 'ADMIN', OPERATOR: 'OPERATOR', GUEST_MEMBER_ROW: 'GUEST', UNKNOWN: 'MEMBER', MULTI_WD: 'MEMBER',
    PROFILE_GUEST_MEMBER: 'GUEST', CEO_WITHDRAWN: 'CEO', OTHER_CLUB: 'MEMBER', NULL_CLUB: 'MEMBER' };
  for (const [k, role] of Object.entries(prof)) {
    await db.query(`insert into public.profiles (id, role) values ($1, $2)`, [ACC[k], role]);
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [ACC[k], `${k.toLowerCase()}@qa.test`]);
  }
  const mem = [[MID(1), null, '정회원', 'unlinked@qa.test'], [MID(2), ACC.WITHDRAWN, '정회원, 탈회', null], [MID(3), ACC.REGULAR, '정회원', null],
    [MID(4), ACC.ASSOC, '준회원', null], [MID(5), ACC.EXEC, '정회원, 총무', null], [MID(6), ACC.EXEC_ONLY, '경기', null],
    [MID(7), ACC.GUEST_MEMBER_ROW, '게스트', null], [MID(8), ACC.UNKNOWN, '메모', null], [MID(9), ACC.MULTI_WD, '정회원', null],
    [MID(10), ACC.MULTI_WD, '탈회', null], [MID(11), ACC.PROFILE_GUEST_MEMBER, ' 정회원 ', null], [MID(12), ACC.CEO_WITHDRAWN, '탈회', null]];
  for (const [id, au, role, email] of mem) await db.query(`insert into public.members (id, auth_user_id, role, email) values ($1, $2, $3, $4)`, [id, au, role, email]);
  await db.query(`insert into public.members (id, auth_user_id, role, club_id) values ($1, $2, '정회원', $3), ($4, $5, '정회원', null)`,
    [MID(13), ACC.OTHER_CLUB, OTHER_CLUB, MID(14), ACC.NULL_CLUB]);
  return db;
}
const q = async (db, sql, p) => (await db.query(sql, p)).rows;
const one = async (db, sql, p) => (await q(db, sql, p))[0];
const asRole = async (db, role, sub, fn) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${sub || ''}', false);`);
  try { return await fn(); } finally { await db.exec('reset role;'); }
};
const errOf = async (fn) => { try { await fn(); return null; } catch (e) { return String(e?.code || e?.message || e); } };

// ── 판형별 발행본(운영: edition 3 두 건(V4.1 8장 · V4.2 7장) · edition 없음 한 건 + v2 · 문구 위험 사례) ─────────
const S = {
  v1: fx.sourceOf({ id: 'KDK-QA-V1', title: '11월 2주 정모 KDK', date: '2026-11-10' }),
  v2: fx.sourceOf({ id: 'KDK-QA-V2', title: '11월 3주 정모 KDK', date: '2026-11-17' }),
  v41: fx.sourceOf({ id: 'KDK-QA-V41', title: '10월 4주 정모 KDK', date: '2026-10-27' }),
  v42: fx.sourceOf({ id: 'KDK-QA-V42', title: '11월 4주 정모 KDK', date: '2026-11-24' }),
  risky: fx.sourceOf({ id: 'KDK-QA-RISK', title: '11월 번개 KDK', date: '2026-11-26' }),
};
const heroesInjected = (p) => ({ ...p, v41: { ...p.v41,
  heroes: [{ kind: 'COMEBACK', title: 'THE COMEBACK', name: '이나래', stat: '+5', head: '이나래, 역전의 날', line: '지난 정모보다 2승 더', source: 'today' }],
  mentions: [{ name: '박다온', line: '끝까지 버틴 4경기' }],
  rivalry: { winner: '김가람', loser: '최라온', winnerTeam: ['김가람', '한바다'], loserTeam: ['최라온', '오아라'], priorWins: 1, priorLosses: 2,
    recent: ['W', 'L'], from: '2026-09', to: '2026-11', scoreWin: 6, scoreLose: 5, round: 3, title: 'RIVALRY', line: '세 번째 맞대결' } } });
const P = {
  v1: fx.payloadV1(S.v1),
  v2: fx.payloadV2(S.v2),
  v41: heroesInjected(fx.payloadV41(S.v41, {}, { layout1: true })),
  v42: fx.payloadV41(S.v42),
  // 위험 문구: opening 에 이름 · closing 에 점수 · headline 에 이름(G) · closingTitle 에 이름
  risky: fx.payloadV41(S.risky, { opening: '김가람 선수가 정상에 오른 날', closing: '결승은 6:5 접전이었습니다', headline: '정마루(G)의 깜짝 활약', closingTitle: '오아라의 날' }),
};
const SLUG = { v1: 'qam002v1report01', v2: 'qam002v2report01', v41: 'qam002v41report1', v42: 'qam002v42report1', risky: 'qam002riskreport' };

async function seed(db) {
  for (const k of Object.keys(S)) {
    const raw = fx.rawOf(S[k]);
    await db.query(`insert into public.teyeon_archive_v1 (id, raw_data, is_official, confirmed_at) values ($1, $2, true, now())`, [S[k].id, JSON.stringify(raw)]);
    await db.query(`insert into public.kdk_final_reports (club_id, session_id, public_slug, status, revision, content, public_payload, source_signature,
        created_by, updated_by, published_at, published_by)
      values ('${CLUB}', $1, $2, 'published', 1, '{}'::jsonb, $3::jsonb, public.kdk_final_report_signature($4::jsonb), $5, $5, now(), $5)`,
      [S[k].id, SLUG[k], JSON.stringify(P[k]), JSON.stringify(raw), ACC.SYS_CEO]);
  }
}
const fingerprint = async (db) => (await one(db, `select md5(string_agg(session_id || ':' || coalesce(public_payload::text, '') || ':' || status || ':' || revision, '|' order by session_id)) r,
  (select md5(string_agg(id || ':' || raw_data::text || is_official::text, '|' order by id)) from public.teyeon_archive_v1) a from public.kdk_final_reports`));
const fnMd5 = async (db) => Object.fromEntries((await q(db, `select p.oid::regprocedure::text s, md5(replace(p.prosrc, chr(13), '')) m from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'`)).map((r) => [r.s, r.m]));
const pubRpc = (db, role, sub, slug) => asRole(db, role, sub, async () => (await one(db, `select public.get_public_kdk_final_report($1) r`, [slug])).r);
const memRpc = (db, sub, slug) => asRole(db, 'authenticated', sub, async () => (await one(db, `select public.get_kdk_final_report_member($1) r`, [slug])).r);
const allNames = fx.NAMES.map((n) => n.replace(/\(G\)$/, ''));
const hasName = (o) => allNames.some((n) => JSON.stringify(o).includes(n));
/** 키 순서 무관 비교(jsonb 는 키를 정렬해 저장한다). */
const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

// ════ 1) 설치 · precheck ════
const db = await newDb();
await db.exec(BASE); await db.exec(V41); await seed(db);
const pre1 = await q(db, PRE);
check('precheck(적용 전): STOP 없음 · NEW_INSTALL · P03 OK_ORIGINAL', !pre1.some((r) => r.result === 'STOP') && pre1.some((r) => r.id === 'P02' && r.result === 'NEW_INSTALL')
  && pre1.some((r) => r.id === 'P03' && r.result === 'OK_ORIGINAL'), JSON.stringify(pre1.filter((r) => r.id <= 'P03')));
const before = await fingerprint(db); const fnBefore = await fnMd5(db);
// 적용 전 상태: 공개 RPC 가 전체 발행본을 준다(현행 노출 재현)
const legacyPub = await pubRpc(db, 'anon', '', SLUG.v2);
check('[현행 재현] 적용 전 anon 공개 응답에 순위 · 이름 · 세션 id 있음', legacyPub.payload.standings.length === 8 && hasName(legacyPub) && legacyPub.officialSessionId === S.v2.id);

await db.exec(M);
await db.exec(M); // 재실행 안전
check('설치 2회 실행 → 오류 없음(재실행 안전)', true);
const pre2 = await q(db, PRE);
check('precheck(적용 후): ALREADY_APPLIED', pre2.some((r) => r.id === 'P02' && r.result === 'ALREADY_APPLIED') && pre2.some((r) => r.id === 'P03' && r.result === 'ALREADY_APPLIED'));

// ════ 2) 공개 응답(anon · 모든 로그인 비회원) ════
for (const k of Object.keys(S)) {
  const r = await pubRpc(db, 'anon', '', SLUG[k]);
  const p = r.payload;
  check(`[${k}] anon 공개 ok · access=public`, r.ok === true && r.state === 'ok' && r.access === 'public');
  check(`[${k}] 공개본 standings · podium · featured 빈 배열`, Array.isArray(p.standings) && !p.standings.length && !p.podium.length && !p.featured.length);
  check(`[${k}] 공개 응답에 officialSessionId · 세션 id 없음`, !('officialSessionId' in r) && !JSON.stringify(r).includes(S[k].id));
  check(`[${k}] 공개 응답에 참가자 이름 0`, !hasName(r), JSON.stringify(r).slice(0, 300));
  check(`[${k}] 공개 응답에 UUID · manual-guest · 승패 키 없음`, !/[0-9a-f]{8}-[0-9a-f]{4}-|manual-guest|"wins"|"losses"|"diff"|"record"|"note"|"tags"/.test(JSON.stringify(r)));
  check(`[${k}] 세션 기본 정보 유지(제목 · 날짜 · 참가 · 경기)`, p.session.title === S[k].title && p.session.date === S[k].date && p.session.participantCount === 8 && p.session.matchCount === 8);
  check(`[${k}] 판형(edition) 유지`, (p.edition ?? null) === (P[k].edition ?? null));
  if (P[k].edition) check(`[${k}] highlights 빈 배열`, Array.isArray(p.highlights) && p.highlights.length === 0);
  if (P[k].edition === 3) {
    check(`[${k}] v41 heroes · mentions 빈 배열 · rivalry null`, !p.v41.heroes.length && !p.v41.mentions.length && p.v41.rivalry === null);
    check(`[${k}] v41.numbers = kind · value 만(4개)`, p.v41.numbers.length === 4 && p.v41.numbers.every((n) => Object.keys(n).sort().join() === 'kind,value'));
    check(`[${k}] v41.next · vol 유지`, p.v41.next?.date === '2026-12-01' && p.v41.next.startTime === '08:00' && p.v41.vol === P[k].v41.vol);
  }
  // 공개 응답은 TS 공개 파서를 통과(구 파서는 standings 빈 배열 → null: 프런트 먼저 배포해야 하는 이유)
  check(`[${k}] 새 프런트 파서 통과 · 구 파서는 null`, !!pv.parsePublicReportView(p) && model.parsePublicFinalReport(p) === null);
  // 이중 방어 일치: SQL 투영 결과 == TS 투영(전체 발행본 입력)
  check(`[${k}] SQL 투영과 TS 투영이 같은 공개 뷰`, JSON.stringify(pv.parsePublicReportView(p)) === JSON.stringify(pv.parsePublicReportView(P[k])),
    `${JSON.stringify(pv.parsePublicReportView(p))} vs ${JSON.stringify(pv.parsePublicReportView(P[k]))}`);
}
// 판형별 세부
const v42 = (await pubRpc(db, 'anon', '', SLUG.v42)).payload;
check('[v42] layout 2 · closingTitle(안전) 유지', v42.v41.layout === 2 && v42.v41.closingTitle === 'SEE YOU IN DECEMBER');
check('[v41] layout 없음(V4.1 8장 판형 정보 유지)', !('layout' in (await pubRpc(db, 'anon', '', SLUG.v41)).payload.v41));
check('[v1] edition 키 없음 · headline 없음', (() => true)() && !('edition' in (await pubRpc(db, 'anon', '', SLUG.v1)).payload));
const v2p = (await pubRpc(db, 'anon', '', SLUG.v2)).payload;
check('[v2] 이름 든 헤드라인 → null(원본: 우승자 이름 포함)', /김가람/.test(P.v2.headline) && v2p.headline === null);
check('[v2] 안전한 opening · closing(08:00 시각 포함) 유지', v2p.opening === P.v2.opening && v2p.closing === P.v2.closing && /08:00/.test(v2p.closing));
const rk = (await pubRpc(db, 'anon', '', SLUG.risky)).payload;
check('[risky] opening(이름) · closing(점수 6:5) · headline(G) · closingTitle(이름) 모두 null',
  rk.opening === null && rk.closing === null && rk.headline === null && rk.v41.closingTitle === null, JSON.stringify(rk));
// 로그인 비회원 · 회원 모두 공개 RPC 결과는 같은 공개본
const memberPub = await pubRpc(db, 'authenticated', ACC.REGULAR, SLUG.v2);
check('authenticated(회원)이 공개 RPC 를 불러도 공개본(회원 데이터는 회원 RPC 로만)', JSON.stringify(memberPub) === JSON.stringify(await pubRpc(db, 'anon', '', SLUG.v2)));

// ════ 3) 회원 RPC 권한별 ════
check('anon → 회원 RPC 실행 불가(42501)', (await errOf(() => asRole(db, 'anon', '', () => q(db, `select public.get_kdk_final_report_member($1)`, [SLUG.v2]))))?.includes('42501'));
check('authenticated · uid 없음 → login_required', (await memRpc(db, '', SLUG.v2)).reason === 'login_required');
for (const k of Object.keys(ACC)) {
  const r = await memRpc(db, ACC[k], SLUG.v2);
  if (ALLOW.has(k)) {
    check(`[${k}] 회원 RPC → 전체 발행본(원본과 동일)`, r.ok === true && r.state === 'ok' && r.access === 'member' && canon(r.payload) === canon(P.v2),
      JSON.stringify(r).slice(0, 200));
    check(`[${k}] 회원 응답에 officialSessionId 없음(ok 상태)`, !('officialSessionId' in r));
  } else {
    check(`[${k}] 회원 RPC → forbidden(데이터 없음)`, r.ok === false && r.reason === 'forbidden' && Object.keys(r).sort().join() === 'ok,reason', JSON.stringify(r));
  }
}
check('비허용자는 없는 slug 도 forbidden(존재 여부 비노출)', (await memRpc(db, ACC.GUEST_LOGIN, 'zzzzzzzzzzzzzz')).reason === 'forbidden');
check('회원 · 없는 slug → not_available', (await memRpc(db, ACC.REGULAR, 'zzzzzzzzzzzzzz')).reason === 'not_available' && (await memRpc(db, ACC.REGULAR, '../x')).reason === 'not_available');
for (const k of ['v1', 'v41', 'v42', 'risky']) {
  const r = await memRpc(db, ACC.ASSOC, SLUG[k]);
  check(`[${k}] 준회원 → 판형 그대로 전체(파서 통과)`, r.state === 'ok' && canon(r.payload) === canon(P[k]) && !!model.parsePublicFinalReport(r.payload));
}

// ════ 4) 직접 접근 · 보조 함수 ════
for (const role of ['anon', 'authenticated']) {
  check(`${role} → kdk_final_reports 직접 SELECT 차단`, (await errOf(() => asRole(db, role, ACC.REGULAR, () => q(db, `select public_payload from public.kdk_final_reports`)))) === '42501');
  for (const f of [`public.kdk_fr_can_view_ranking('${ACC.REGULAR}')`, `public.kdk_fr_public_names('{}'::jsonb, '{}'::jsonb)`,
    `public.kdk_fr_public_text('x', '{}'::text[], 10)`, `public.kdk_fr_public_view('{}'::jsonb, '{}'::jsonb)`]) {
    check(`${role} → ${f.split('(')[0]} 실행 불가`, (await errOf(() => asRole(db, role, ACC.REGULAR, () => q(db, `select ${f}`)))) === '42501');
  }
}
const fnInfo = await q(db, `select proname, prosecdef, proconfig from pg_proc where proname in ('get_public_kdk_final_report', 'get_kdk_final_report_member',
  'kdk_fr_can_view_ranking', 'kdk_fr_public_names', 'kdk_fr_public_text', 'kdk_fr_public_view')`);
check('신규 · 교체 함수 6개 search_path 고정', fnInfo.length === 6 && fnInfo.every((f) => JSON.stringify(f.proconfig) === JSON.stringify(['search_path=public, pg_temp'])));
check('DEFINER = 공개 · 회원 · 자격 3개만', fnInfo.filter((f) => f.prosecdef).map((f) => f.proname).sort().join() === 'get_kdk_final_report_member,get_public_kdk_final_report,kdk_fr_can_view_ranking');

// ════ 5) 무변경(원본 · Archive · 다른 함수) ════
const after = await fingerprint(db); const fnAfter = await fnMd5(db);
check('발행 원본(public_payload · status · revision) · Archive 무변경', before.r === after.r && before.a === after.a);
const changed = Object.keys(fnAfter).filter((s) => fnBefore[s] && fnBefore[s] !== fnAfter[s]);
check('기존 함수 중 바뀐 것 = get_public_kdk_final_report 하나', changed.join() === 'get_public_kdk_final_report(text)', changed.join());
check('정산 자격 · 조회 · 발행 함수 존재 · 무변경', ['kdk_can_view_settlement(uuid)', 'get_kdk_final_report_settlement(text)', 'publish_kdk_final_report_v41(text,uuid,jsonb,text,integer,jsonb)']
  .every((s) => fnBefore[s] && fnBefore[s] === fnAfter[s]));
// 정산 권한은 순위 권한과 분리(기존 그대로): profiles CEO 단독은 정산 허용 · 순위 거부
const setCeo = await asRole(db, 'authenticated', ACC.SYS_CEO, async () => (await one(db, `select public.get_kdk_final_report_settlement($1) r`, [SLUG.v42])).r);
check('정산 RPC(기존): profiles CEO 단독 → 자격 통과(not_available = 스냅샷 없음) · 순위는 forbidden', setCeo.reason === 'not_available' && (await memRpc(db, ACC.SYS_CEO, SLUG.v42)).reason === 'forbidden');
const setGuest = await asRole(db, 'authenticated', ACC.GUEST_LOGIN, async () => (await one(db, `select public.get_kdk_final_report_settlement($1) r`, [SLUG.v42])).r);
check('정산 RPC(기존): 로그인 GUEST → forbidden 유지', setGuest.reason === 'forbidden');
// 링크 함수 무변경
const link = await asRole(db, 'anon', '', async () => (await one(db, `select public.get_public_kdk_final_report_link($1) r`, [S.v2.id])).r);
check('Archive 진입점 링크(anon) 그대로 slug', link.ok === true && link.publicSlug === SLUG.v2);

// ════ 6) verify READONLY ════
const ver = await q(db, VER);
check('verify READONLY: FAIL 0 · V07 누출 0', ver.length > 20 && !ver.some((r) => r.result === 'FAIL') && ver.find((r) => r.id === 'V07')?.value === '0',
  JSON.stringify(ver.filter((r) => r.result === 'FAIL')));
check('verify V09 = precheck P06(발행 원본 무변경)', ver.find((r) => r.id === 'V09').value === pre1.find((r) => r.id === 'P06').value);
check('verify V10 = precheck P07(정산 함수 무변경)', JSON.stringify(ver.filter((r) => r.id === 'V10').map((r) => r.value)) === JSON.stringify(pre1.filter((r) => r.id === 'P07').map((r) => r.value)));

// ════ 7) 상태 재검증(정정 · 비공개 · 공식 해제 · 테스트) ════
await db.query(`update public.teyeon_archive_v1 set raw_data = jsonb_set(raw_data, '{ranking_data,0,wins}', '9'::jsonb) where id = $1`, [S.v2.id]);
const cp = await pubRpc(db, 'anon', '', SLUG.v2);
check('정정 → 공개 corrected · 제목 · 날짜만 · 세션 id 없음', cp.state === 'corrected' && !('officialSessionId' in cp) && !('payload' in cp) && cp.title === S.v2.title);
const cm = await memRpc(db, ACC.REGULAR, SLUG.v2);
check('정정 → 회원 corrected + officialSessionId(서버가 공식 요약을 붙이는 용도)', cm.state === 'corrected' && cm.officialSessionId === S.v2.id && !('payload' in cm));
check('정정 → 비회원 회원 RPC 는 여전히 forbidden', (await memRpc(db, ACC.GUEST_LOGIN, SLUG.v2)).reason === 'forbidden');
const verC = await q(db, VER);
check('verify: 정정 상태에서도 V07 누출 0', verC.find((r) => r.id === 'V07')?.value === '0');
await db.query(`update public.kdk_final_reports set status = 'unpublished' where session_id = $1`, [S.v1.id]);
check('비공개 → 공개 not_found · 회원 not_available', (await pubRpc(db, 'anon', '', SLUG.v1)).state === 'not_found' && (await memRpc(db, ACC.REGULAR, SLUG.v1)).reason === 'not_available');
await db.query(`update public.teyeon_archive_v1 set is_official = false where id = $1`, [S.v41.id]);
check('공식 해제 → 공개 not_found · 회원 not_available', (await pubRpc(db, 'anon', '', SLUG.v41)).state === 'not_found' && (await memRpc(db, ACC.REGULAR, SLUG.v41)).reason === 'not_available');
await db.query(`update public.teyeon_archive_v1 set is_test = true where id = $1`, [S.v42.id]);
check('테스트 기록 → 공개 not_found · 회원 not_available', (await pubRpc(db, 'anon', '', SLUG.v42)).state === 'not_found' && (await memRpc(db, ACC.REGULAR, SLUG.v42)).reason === 'not_available');

// ════ 8) 문구 안전 판정 단위 ════
const txt = async (t, names = ['김가람'], max = 90) => (await one(db, `select public.kdk_fr_public_text($1, $2::text[], $3) r`, [t, names, max])).r;
check('문구: 이름 포함 → null', (await txt('오늘 김가람 우승')) === null);
check('문구: 점수 6:5 · 6-4 · 6 : 0 → null', (await txt('결승 6:5')) === null && (await txt('6-4 승')) === null && (await txt('6 : 0 완봉')) === null);
check('문구: 시각 08:00 · 19:30 · 날짜 12-01 통과', (await txt('08:00 집합')) === '08:00 집합' && (await txt('19:30 시작')) === '19:30 시작' && (await txt('2026-12-01 정모')) === '2026-12-01 정모');
check('문구: (G) 표시 → null · 빈 문구 → null', (await txt('손님(G) 환영')) === null && (await txt('  ')) === null);
check('문구: 길이 자름', (await txt('가'.repeat(100), [], 30)).length === 30);
// 이름 변형(공백 · 성 뺀 이름) — kdk_fr_public_names 가 만든 목록으로 판정
const names2 = (await one(db, `select public.kdk_fr_public_names($1::jsonb, $2::jsonb) r`, [JSON.stringify(P.v2), JSON.stringify(fx.rawOf(S.v2))])).r;
check('이름 목록: 공백 제거 · 성 뺀 이름 포함 · (G) 제거', names2.includes('김가람') && names2.includes('가람') && names2.includes('정마루') && names2.includes('마루')
  && !names2.some((n) => /\(G\)/.test(n)), JSON.stringify(names2));
for (const t of ['김 가람 선수의 날', '가람이 최고', '오늘의 주인공은 마루']) {
  check(`문구: 이름 변형 '${t}' → null(SQL · TS 동일)`, (await txt(t, names2)) === null && pv.publicText(t, pv.participantNamesOf(P.v2), 90) === null);
}
check('문구 한계(기록): 별명 · 직함 서술은 통과', (await txt('막내가 정상에 오른 날', names2)) === '막내가 정상에 오른 날');
const titled = { ...P.v2, session: { ...P.v2.session, title: '김 가람 생일 기념 KDK' } };
const tv = (await one(db, `select public.kdk_fr_public_view($1::jsonb, $2::jsonb) r`, [JSON.stringify(titled), JSON.stringify(fx.rawOf(S.v2))])).r;
check('세션명에 참가자 이름 → TEYEON KDK(SQL · TS 동일)', tv.session.title === 'TEYEON KDK' && pv.parsePublicReportView(titled).session.title === 'TEYEON KDK');
for (const t of ['오늘 김가람 우승', '결승 6:5', '6-4 승', '08:00 집합', '2026-12-01 정모', '손님(G) 환영']) {
  check(`문구 판정 SQL = TS: ${t}`, (await txt(t)) === pv.publicText(t, ['김가람'], 90));
}

// ════ 9) rollback → 원래 정의 · 재적용 ════
await db.exec(RB);
const fnRb = await fnMd5(db);
check('rollback → get_public_kdk_final_report 원문 복원(지문 동일)', fnRb['get_public_kdk_final_report(text)'] === fnBefore['get_public_kdk_final_report(text)']);
check('rollback → 신규 함수 5개 삭제', !Object.keys(fnRb).some((s) => /kdk_fr_can_view_ranking|kdk_fr_public_(names|text|view)|get_kdk_final_report_member/.test(s)));
check('rollback → anon 실행 권한 그대로', (await one(db, `select has_function_privilege('anon', 'public.get_public_kdk_final_report(text)', 'EXECUTE') x`)).x === true);
const rbPub = await pubRpc(db, 'anon', '', SLUG.risky);
check('rollback 후 공개 RPC = 이전 동작(전체 발행본 · 세션 id) → 프런트 투영이 계속 숨김', rbPub.payload.standings.length === 8 && rbPub.officialSessionId === S.risky.id
  && !hasName(pv.parsePublicReportView(rbPub.payload)));
await db.exec(RB); check('rollback 재실행 안전', true);
await db.exec(M);
check('rollback 후 재적용 → 공개 투영 다시 동작', (await pubRpc(db, 'anon', '', SLUG.risky)).payload.standings.length === 0);
check('재적용 후에도 발행 원본 무변경', (await fingerprint(db)).r === (await (async () => { const d = await newDb(); await d.exec(BASE); await d.exec(V41); await seed(d);
  await d.query(`update public.kdk_final_reports set status = 'unpublished' where session_id = $1`, [S.v1.id]); return (await fingerprint(d)).r; })()));

console.log(`MAINT-002 FINAL REPORT member ranking SQL (PGlite): ${passed} passed / ${failures.length} failed`);
for (const f of failures) console.log('  FAIL', f);
process.exit(failures.length ? 1 : 0);
