/**
 * [CLOSING SPRINT B1] KDK 코트 복귀 임원진 권한 SQL 시험 — 격리된 PGlite(WASM Postgres) 메모리 DB 에서만 실행. 운영 DB 미접속 · 가상 계정.
 *   실행: PGLITE_MODULE=<@electric-sql/pglite dist/index.js 절대경로> node scripts/verify_closing_sprint_b1_sql.mjs
 *
 *   기존 함수(can_manage_kdk · kdk_actor_withdrawn · kdk_p1_result_recorded · kdk_p1_score_guard)는
 *   supabase/security_p1/* 의 정의를 그대로 옮겨 설치한 뒤 B1 을 적용한다(B1 이 기존 직접 UPDATE 차단을 바꾸지 않는지 함께 확인).
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modPath = process.env.PGLITE_MODULE;
if (!modPath) { console.error('PGLITE_MODULE 환경변수가 필요합니다.'); process.exit(2); }
const { PGlite } = await import(pathToFileURL(modPath).href);
const B1 = fs.readFileSync(path.join(ROOT, 'supabase/closing_sprint/B1_kdk_court_return_officers.sql'), 'utf8');
const B1_RB = fs.readFileSync(path.join(ROOT, 'supabase/closing_sprint/B1_kdk_court_return_officers_rollback.sql'), 'utf8');

let passed = 0; const failures = [];
const check = (name, cond, info = '') => { if (cond) passed += 1; else failures.push(`${name}${info ? ` — ${info}` : ''}`); };
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ACC = {
  CEO: U(1), ADMIN: U(2), KDKM: U(3),
  P_PRES: U(11), P_VICE: U(12), P_SEC: U(13), P_FIN: U(14), P_GAME: U(15), P_PR: U(16), P_CEOFIN: U(17), P_SPACED: U(18),
  APP_OPER: U(21), APP_FIN: U(22), MEMBER: U(23), ASSOC: U(24), MEM_CEO_ONLY: U(25), MEM_SUBSTR: U(26),
  GUEST_POS: U(31), WD_POS: U(32), OTHER_CLUB: U(33), UNLINKED: U(34),
};
const CLUB = U(9001), CLUB2 = U(9002), SID = 'KDK-B1';

const BASE = (withStartedAt) => `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; grant usage on schema auth to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated, service_role;
  create table public.profiles (id uuid primary key, role text);
  create table public.members (id uuid primary key, auth_user_id uuid, role text, club_id uuid);
  create table public.kdk_managers (user_id uuid primary key);
  create table public.matches (
    id uuid primary key, club_id text, session_id text, status text, court int, score1 int, score2 int,
    player_ids text[], player_names text[], group_name text, round int ${withStartedAt ? ', started_at timestamptz' : ''}
  );
  create table public.kdk_match_results (match_id text, closed_at timestamptz);
  grant select, update on public.matches to authenticated;

  -- ── supabase/security_p1/30_kdk_managers_court_ops.sql 정의 그대로 ──
  create or replace function public.kdk_actor_withdrawn()
  returns boolean language sql stable security definer set search_path = public, pg_temp as $b$
    select exists (select 1 from public.members m, unnest(string_to_array(coalesce(m.role::text, ''), ',')) r(v)
                    where m.auth_user_id::text = auth.uid()::text and btrim(r.v) = '탈회');
  $b$;
  create or replace function public.can_manage_kdk()
  returns boolean language sql stable security definer set search_path = public, pg_temp as $b$
    select auth.uid() is not null and (
             x.r in ('CEO', 'ADMIN')
          or (exists (select 1 from public.kdk_managers k where k.user_id = auth.uid())
              and x.r in ('MEMBER', 'OPERATOR', 'FINANCE_MANAGER')
              and not public.kdk_actor_withdrawn()))
      from (select upper(btrim(coalesce((select p.role::text from public.profiles p where p.id::text = auth.uid()::text), ''))) as r) x;
  $b$;
  revoke all on function public.kdk_actor_withdrawn(), public.can_manage_kdk() from public, anon;
  grant execute on function public.kdk_actor_withdrawn(), public.can_manage_kdk() to authenticated, service_role;

  -- ── supabase/security_p1/20_p1_kdk_score_guard.sql 정의 그대로 ──
  create or replace function public.kdk_p1_result_recorded(p_match_id text)
  returns boolean language sql stable security definer set search_path = public, pg_temp as $$
    select exists (select 1 from public.kdk_match_results r where r.match_id = p_match_id and r.closed_at is null);
  $$;
  revoke all on function public.kdk_p1_result_recorded(text) from public, anon;
  grant execute on function public.kdk_p1_result_recorded(text) to authenticated, service_role;
  -- 시험용 단순화: 결과 관리 = CEO·ADMIN, 생성 = can_manage_kdk(이 시험의 대상 아님).
  create or replace function public.kdk_p1_can_manage_results() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
    select exists (select 1 from public.profiles p where p.id::text = auth.uid()::text and upper(btrim(coalesce(p.role, ''))) in ('CEO', 'ADMIN'));
  $$;
  create or replace function public.kdk_p1_can_generate() returns boolean language sql stable security definer set search_path = public, pg_temp as $$ select public.can_manage_kdk(); $$;
  grant execute on function public.kdk_p1_can_manage_results(), public.kdk_p1_can_generate() to authenticated;
  create or replace function public.kdk_p1_score_guard()
  returns trigger language plpgsql security invoker set search_path = public, pg_temp as $b$
  declare
    v_recorded boolean;
    v_ignore constant text[] := array['status','score1','score2','updated_at'];
  begin
    if current_user not in ('anon', 'authenticated') then
      return coalesce(new, old);
    end if;
    if auth.uid() is null or current_user = 'anon' then
      raise exception 'kdk: 로그인이 필요합니다' using errcode = '42501';
    end if;
    if public.kdk_p1_can_manage_results() then
      return coalesce(new, old);
    end if;
    if public.can_manage_kdk() then
      if tg_op = 'DELETE' then raise exception 'kdk: delete' using errcode = '42501'; end if;
      return new;
    end if;
    if tg_op in ('INSERT', 'DELETE') then
      raise exception 'kdk: 경기 생성·삭제는 운영진만 가능합니다' using errcode = '42501';
    end if;
    v_recorded := public.kdk_p1_result_recorded(old.id::text);
    if old.status::text = 'playing' and new.status::text = 'complete'
       and new.score1 is not null and new.score2 is not null
       and not v_recorded
       and (to_jsonb(new) - v_ignore) = (to_jsonb(old) - v_ignore) then
      return new;
    end if;
    raise exception 'kdk: 저장된 결과의 수정·초기화 및 경기 정보 변경은 운영진만 가능합니다' using errcode = '42501';
  end;
  $b$;
  create trigger kdk_p1_score_guard_trg before insert or update or delete on public.matches
    for each row execute function public.kdk_p1_score_guard();
`;

const errOf = async (fn) => { try { await fn(); return null; } catch (e) { return e?.code || e?.message || 'error'; } };
const q = async (db, sql, p) => (await db.query(sql, p)).rows;
const asRole = async (db, role, sub, fn) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${sub || ''}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};

async function newDb(withStartedAt = true) {
  const db = new PGlite();
  await db.exec(BASE(withStartedAt));
  // [키, profiles.role, members.role(null = 연결 행 없음), members.club_id]
  const seed = [
    ['CEO', 'CEO', null], ['ADMIN', 'ADMIN', null], ['KDKM', 'MEMBER', '정회원'],
    ['P_PRES', 'MEMBER', '회장'], ['P_VICE', 'MEMBER', '부회장'], ['P_SEC', 'MEMBER', '총무'], ['P_FIN', 'MEMBER', '재무'],
    ['P_GAME', 'MEMBER', '경기'], ['P_PR', 'MEMBER', '섭외'], ['P_CEOFIN', 'MEMBER', 'CEO, 재무'], ['P_SPACED', 'MEMBER', ' 정회원 ,  경기 '],
    ['APP_OPER', 'OPERATOR', '정회원'], ['APP_FIN', 'FINANCE_MANAGER', '정회원'], ['MEMBER', 'MEMBER', '정회원'], ['ASSOC', 'MEMBER', '준회원'],
    ['MEM_CEO_ONLY', 'MEMBER', 'CEO'], ['MEM_SUBSTR', 'MEMBER', '경기위원,총무보'],
    ['GUEST_POS', 'GUEST', '총무'], ['WD_POS', 'MEMBER', '총무,탈회'], ['OTHER_CLUB', 'MEMBER', '총무', CLUB2],
  ];
  let mid = 100;
  for (const [k, prole, mrole, club] of seed) {
    await db.query('insert into public.profiles (id, role) values ($1, $2)', [ACC[k], prole]);
    if (mrole !== null) await db.query('insert into public.members (id, auth_user_id, role, club_id) values ($1, $2, $3, $4)', [U(++mid), ACC[k], mrole, club || CLUB]);
  }
  await db.query('insert into public.profiles (id, role) values ($1, $2)', [ACC.UNLINKED, 'MEMBER']);
  await db.query('insert into public.members (id, auth_user_id, role, club_id) values ($1, null, $2, $3)', [U(++mid), '총무', CLUB]); // 계정 미연결 직책 행
  await db.query('insert into public.kdk_managers values ($1)', [ACC.KDKM]);
  return db;
}
let mseq = 0;
async function addMatch(db, status, { started = false, club = CLUB } = {}, withStartedAt = true) {
  const id = U(1000 + (++mseq));
  const cols = withStartedAt ? '(id, club_id, session_id, status, court, score1, score2, player_ids, player_names, round, started_at)' : '(id, club_id, session_id, status, court, score1, score2, player_ids, player_names, round)';
  const vals = withStartedAt ? '($1,$2,$3,$4,$5,1,1,$6,$7,1,$8)' : '($1,$2,$3,$4,$5,1,1,$6,$7,1)';
  const params = [id, club, SID, status, status === 'playing' ? 2 : null, ['p1', 'p2', 'p3', 'p4'], ['가', '나', '다', '라']];
  if (withStartedAt) params.push(started ? new Date().toISOString() : null);
  await db.query(`insert into public.matches ${cols} values ${vals}`, params);
  return id;
}
const ret = (db, who, id, club = CLUB) => asRole(db, 'authenticated', ACC[who], async () => (await q(db, 'select public.return_kdk_match_to_waiting($1, $2) as r', [id, club]))[0].r);
const row = async (db, id) => (await q(db, 'select status, court, score1, score2, to_jsonb(m) ->> \'started_at\' as started_at from public.matches m where id = $1', [id]))[0];

// ═══ 1. 설치 · 재실행 · 권한 ═══
{
  const db = await newDb();
  check('B1 설치', (await errOf(() => db.exec(B1))) === null);
  check('B1 재실행 안전', (await errOf(() => db.exec(B1))) === null);
  check('anon: kdk_can_return_court 실행 불가', (await asRole(db, 'anon', null, () => errOf(() => db.query('select public.kdk_can_return_court($1)', [CLUB])))) === '42501');
  check('초안 시그니처 kdk_can_return_court() 없음', (await q(db, "select count(*)::int as n from pg_proc where proname = 'kdk_can_return_court' and pronargs = 0"))[0].n === 0);
  check('anon: return_kdk_match_to_waiting 실행 불가', (await asRole(db, 'anon', null, () => errOf(() => db.query("select public.return_kdk_match_to_waiting('x','y')")))) === '42501');
  const can = async (k, club = CLUB) => asRole(db, 'authenticated', ACC[k], async () => (await q(db, 'select public.kdk_can_return_court($1) as v', [club]))[0].v);
  const expect = {
    CEO: true, ADMIN: true, KDKM: true,                                         // 기존 유지
    P_PRES: true, P_VICE: true, P_SEC: true, P_FIN: true, P_GAME: true, P_PR: true, // 6개 직책
    P_CEOFIN: true, P_SPACED: true,                                             // 'CEO, 재무' · 공백 포함 다중값
    APP_OPER: false, APP_FIN: false,                                            // profiles OPERATOR/FINANCE_MANAGER 는 근거 아님
    MEMBER: false, ASSOC: false, MEM_CEO_ONLY: false, MEM_SUBSTR: false,        // 일반 회원 · CEO 토큰 단독 · 부분 일치
    GUEST_POS: false, WD_POS: false, OTHER_CLUB: false, UNLINKED: false,        // GUEST · 탈회 · 다른 클럽 · 계정 미연결
  };
  for (const [k, v] of Object.entries(expect)) {
    const r = await can(k);
    check(`kdk_can_return_court ${k} = ${v}`, r === v, String(r));
  }
  check('다른 클럽 직책: 자기 클럽 기준으로는 true(클럽 범위 판정)', (await can('OTHER_CLUB', CLUB2)) === true);
  check('직책 회원: 다른 클럽 id 로는 false', (await can('P_SEC', CLUB2)) === false);
  check('직책 회원: 빈 club id → false', (await can('P_SEC', '')) === false && (await can('P_SEC', null)) === false);
  check('KDK 관리자: club id 무관하게 기존대로 true', (await can('KDKM', CLUB2)) === true);
  // 임원진에게 KDK 관리자 권한이 생기지 않는다
  for (const k of ['P_SEC', 'P_CEOFIN']) {
    const r = await asRole(db, 'authenticated', ACC[k], async () => (await q(db, 'select public.can_manage_kdk() as v'))[0].v);
    check(`${k}: can_manage_kdk 여전히 false(권한 확대 없음)`, r === false);
  }

  // ═══ 2. 임원진 복귀 · 안전 조건 ═══
  const m1 = await addMatch(db, 'playing');
  const r1 = await ret(db, 'P_SEC', m1);
  const a1 = await row(db, m1);
  check('총무: 타이머 전 playing → 복귀 ok', r1.ok === true && r1.by === 'officer', JSON.stringify(r1));
  check('복귀 후 waiting · court null · 1:1 · started_at null', a1.status === 'waiting' && a1.court === null && a1.score1 === 1 && a1.score2 === 1 && a1.started_at === null, JSON.stringify(a1));
  const r1b = await ret(db, 'P_SEC', m1);
  check('중복 요청(이미 waiting) → not_playing · 변경 없음', r1b.ok === false && r1b.reason === 'not_playing');

  const m2 = await addMatch(db, 'playing', { started: true });
  const r2 = await ret(db, 'P_CEOFIN', m2);
  const a2 = await row(db, m2);
  check('CEO,재무 겸직: 타이머 시작된 경기 → timer_started · 변경 없음', r2.ok === false && r2.reason === 'timer_started' && a2.status === 'playing' && a2.court === 2 && a2.started_at !== null, JSON.stringify([r2, a2]));
  const r2m = await ret(db, 'KDKM', m2);
  const a2m = await row(db, m2);
  check('KDK 관리자: 타이머 시작된 경기 → 복귀 ok(기존 정책 A) · started_at 초기화', r2m.ok === true && r2m.by === 'manager' && a2m.status === 'waiting' && a2m.started_at === null, JSON.stringify([r2m, a2m]));

  const m3 = await addMatch(db, 'playing');
  await db.query('insert into public.kdk_match_results (match_id, closed_at) values ($1, null)', [m3]);
  const r3 = await ret(db, 'CEO', m3);
  check('결과 저장된 경기 → result_recorded(누구도 이 경로로 초기화 불가)', r3.ok === false && r3.reason === 'result_recorded' && (await row(db, m3)).status === 'playing');

  const m4 = await addMatch(db, 'complete');
  check('완료 경기 복귀 요청 → not_playing(되돌리기는 기존 관리자 경로)', (await ret(db, 'P_GAME', m4)).reason === 'not_playing' && (await row(db, m4)).status === 'complete');
  const m5 = await addMatch(db, 'waiting');
  check('대기 경기 → not_playing', (await ret(db, 'P_GAME', m5)).reason === 'not_playing');
  check('KDK 관리자: 다른 클럽 id → not_found', (await ret(db, 'KDKM', m1, CLUB2)).reason === 'not_found');
  check('빈 입력(관리자) → invalid_session', (await ret(db, 'KDKM', '', CLUB)).reason === 'invalid_session');
  {
    const mc = await addMatch(db, 'playing');
    const eX = await asRole(db, 'authenticated', ACC.P_SEC, () => errOf(() => db.query('select public.return_kdk_match_to_waiting($1, $2)', [mc, CLUB2])));
    check('직책 회원: 다른 클럽 id 로 요청 → 42501 · 경기 그대로', eX === '42501' && (await row(db, mc)).status === 'playing', String(eX));
    const mo = await addMatch(db, 'playing', { club: CLUB2 });
    const rO = await ret(db, 'OTHER_CLUB', mo, CLUB2);
    check('다른 클럽 직책: 자기 클럽 경기 복귀 ok(클럽 범위)', rO.ok === true, JSON.stringify(rO));
    const mo2 = await addMatch(db, 'playing', { club: CLUB2 });
    const eO = await asRole(db, 'authenticated', ACC.P_SEC, () => errOf(() => db.query('select public.return_kdk_match_to_waiting($1, $2)', [mo2, CLUB2])));
    check('우리 클럽 직책: 다른 클럽 경기 → 42501', eO === '42501' && (await row(db, mo2)).status === 'playing', String(eO));
  }

  for (const k of ['MEMBER', 'ASSOC', 'APP_OPER', 'APP_FIN', 'MEM_CEO_ONLY', 'MEM_SUBSTR', 'GUEST_POS', 'WD_POS', 'OTHER_CLUB', 'UNLINKED']) {
    const mx = await addMatch(db, 'playing');
    const e = await asRole(db, 'authenticated', ACC[k], () => errOf(() => db.query('select public.return_kdk_match_to_waiting($1, $2)', [mx, CLUB])));
    check(`${k}: 복귀 RPC 거부(42501) · 경기 그대로`, e === '42501' && (await row(db, mx)).status === 'playing', String(e));
  }
  const e0 = await asRole(db, 'authenticated', null, () => errOf(() => db.query('select public.return_kdk_match_to_waiting($1, $2)', [m1, CLUB])));
  check('로그인 없음(authenticated + uid 없음) → 42501', e0 === '42501');

  // ═══ 3. 기존 직접 UPDATE 경로는 그대로(임원진도 직접 복귀 불가 — RPC 로만) ═══
  const m6 = await addMatch(db, 'playing');
  const eDirect = await asRole(db, 'authenticated', ACC.P_SEC, () => errOf(() => db.query("update public.matches set status='waiting', court=null where id=$1", [m6])));
  check('직책 회원 직접 UPDATE(playing→waiting) 여전히 차단(트리거 — RPC 로만)', eDirect === '42501' && (await row(db, m6)).status === 'playing', String(eDirect));
  const eDirectM = await asRole(db, 'authenticated', ACC.KDKM, () => errOf(() => db.query("update public.matches set status='waiting', court=null where id=$1", [m6])));
  check('KDK 관리자 직접 UPDATE 기존대로 허용', eDirectM === null && (await row(db, m6)).status === 'waiting');
  const m7 = await addMatch(db, 'playing');
  const eScore = await asRole(db, 'authenticated', ACC.MEMBER, () => errOf(() => db.query("update public.matches set status='complete', score1=6, score2=3 where id=$1", [m7])));
  check('일반 회원 최초 결과 저장(playing→complete) 기존대로 허용', eScore === null && (await row(db, m7)).status === 'complete');

  // ═══ 4. 롤백 ═══
  check('롤백 실행', (await errOf(() => db.exec(B1_RB))) === null);
  const left = await q(db, "select count(*)::int as n from pg_proc where proname in ('kdk_can_return_court','return_kdk_match_to_waiting')");
  check('롤백 후 함수 0개', left[0].n === 0);
  check('롤백 후 기존 can_manage_kdk 유지', (await q(db, "select count(*)::int as n from pg_proc where proname = 'can_manage_kdk'"))[0].n === 1);
  await db.close();
}

// ═══ 5. started_at 컬럼이 없는 환경(분기) ═══
{
  const db = await newDb(false);
  check('started_at 없는 DB: B1 설치', (await errOf(() => db.exec(B1))) === null);
  const m = await addMatch(db, 'playing', {}, false);
  const r = await ret(db, 'P_FIN', m);
  check('started_at 없는 DB: 재무 복귀 ok', r.ok === true && (await row(db, m)).status === 'waiting', JSON.stringify(r));
  await db.close();
}

console.log(`\nCLOSING SPRINT B1 SQL (PGlite): ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  FAIL ${f}`); process.exit(1); }
