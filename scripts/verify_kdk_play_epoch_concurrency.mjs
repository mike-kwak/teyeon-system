/**
 * [CLOSING SPRINT K1] matches.play_epoch — 실제 PostgreSQL 다중 연결 시험(설치 영향 · 증가 규칙 · 위조 차단 · 동시성 · 롤백).
 *
 *   ⚠️ 테스트 전용 "빈" DB 에서만. 운영 Supabase 접속 금지(아래 안전 장치가 차단).
 *   실행:
 *     KDK_EPOCH_TESTDB=yes-test-only \
 *     PG_MODULE=<pg 패키지 디렉터리 절대경로(저장소 밖 설치)> \
 *     DATABASE_URL=postgres://...빈 테스트 DB... \
 *     [KDK_LOCAL_STUB=1  ← 로컬 순수 PostgreSQL 일 때만: Supabase stub(auth 스키마 · role) 생성] \
 *     node scripts/verify_kdk_play_epoch_concurrency.mjs
 *
 *   안전 장치: ① KDK_EPOCH_TESTDB 확인값 ② .env.local 의 운영 Supabase project ref 가 DATABASE_URL 에 있으면 중단
 *             ③ public.matches 가 이미 있으면 중단(빈 테스트 DB 만 — 운영 · 기존 DB 오실행 방지).
 *   구조: 저장소 SQL 원본을 운영 적용 순서(docs/SECURITY_SQL_REGISTRY.md §3)대로 설치 → K1 적용 · 시험 → 롤백 · 재적용.
 *   데이터: 전부 가상(QA- 접두사). 각 요청 = 독립 연결 · PostgREST 와 같은 트랜잭션(role authenticated + JWT sub).
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const sqlFile = (p) => readFileSync(join(root, 'supabase', p), 'utf8');

// ── 안전 장치 ────────────────────────────────────────────────────────────────
if (process.env.KDK_EPOCH_TESTDB !== 'yes-test-only') { console.log('SKIP: KDK_EPOCH_TESTDB=yes-test-only 미지정 — 실DB 시험 미실시'); process.exit(2); }
const url = process.env.DATABASE_URL || '';
if (!url || !process.env.PG_MODULE) { console.log('SKIP: DATABASE_URL 또는 PG_MODULE 미지정'); process.exit(2); }
{
  const envPath = join(root, '.env.local');
  const prodUrl = existsSync(envPath) ? (readFileSync(envPath, 'utf8').match(/^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m)?.[1] || '').trim() : '';
  const prodRef = prodUrl.match(/^https?:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1];
  if (prodRef && url.toLowerCase().includes(prodRef.toLowerCase())) { console.error('ABORT: DATABASE_URL 이 운영 Supabase 프로젝트를 가리킵니다.'); process.exit(3); }
}
const pg = createRequire(join(process.env.PG_MODULE, 'package.json'))(process.env.PG_MODULE);

// ── 공통 ────────────────────────────────────────────────────────────────────
const results = [];
const check = (name, cond, info = '') => { results.push({ name, pass: !!cond, info }); console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };
const connect = async () => { const c = new pg.Client({ connectionString: url }); await c.connect(); c.pid = (await c.query('select pg_backend_pid() p')).rows[0].p; return c; };
const one = async (c, q, p) => (await c.query(q, p)).rows[0];
const CLUB = '512d047d-a076-4080-97e5-6bb5a2c07819';
const U = (s) => `00000000-0000-4000-8000-${s.padStart(12, '0')}`;
const USERS = { adminA: U('a1'), adminB: U('a2'), mgr: U('b1'), mem1: U('e1'), mem2: U('e2') };
const ROLE = { adminA: 'ADMIN', adminB: 'ADMIN', mgr: 'MEMBER', mem1: 'MEMBER', mem2: 'MEMBER' };

const admin = await connect();
if ((await one(admin, `select to_regclass('public.matches') is not null as e`)).e) { console.error('ABORT: public.matches 가 이미 있음 — 빈 테스트 DB 에서만 실행'); process.exit(3); }

// ── 0) 운영 모양 구조 · 기존 SQL 원본 설치 ──────────────────────────────────
console.log('== 0) 테스트 DB 구조(저장소 SQL 원본 · 운영 적용 순서)');
if (process.env.KDK_LOCAL_STUB === '1') {
  for (const r of ['anon', 'authenticated', 'service_role']) {
    if (!(await one(admin, `select exists (select 1 from pg_roles where rolname = $1) e`, [r])).e) await admin.query(`create role ${r} nologin${r === 'service_role' ? ' bypassrls' : ''}`);
  }
  await admin.query(sqlFile('spotlight_testenv/00_local_supabase_stub.sql').replace(/create role [a-z_]+ nologin( bypassrls)?;/g, ''));
}
await admin.query(`create table if not exists auth.users (id uuid primary key); grant select on auth.users to authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
await admin.query(sqlFile('spotlight_testenv/01_testenv_base_schema.sql'));
await admin.query(`
  create table public.members (id uuid primary key default gen_random_uuid(), nickname text, auth_user_id uuid, role text, club_id uuid, "나이" text);
  alter table public.members enable row level security; create policy qa_members_read on public.members for select using (true);
  create table public.app_config (id text primary key, permissions jsonb); insert into public.app_config values ('primary', '{}'::jsonb);
  alter table public.teyeon_archive_v1 add column if not exists is_official boolean, add column if not exists is_test boolean, add column if not exists created_at timestamptz default now();`);
for (const f of ['kdk_session_meta.sql', 'add_kdk_group_courts.sql', 'add_kdk_session_guest_fee.sql', 'add_matches_playing_court_unique_index.sql',
  'add_start_kdk_match_rpc.sql', 'add_kdk_match_timer.sql', 'add_delete_kdk_live_session_rpc.sql', 'sync_rpc_v1.sql']) await admin.query(sqlFile(f));
{
  const src = sqlFile('secure_member_column_privileges.sql');
  const fn = src.slice(src.indexOf('create or replace function public.is_full_admin()'));
  await admin.query(fn.slice(0, fn.indexOf('$$;', fn.indexOf('as $$') + 5) + 3));
}
await admin.query(`revoke insert, update, delete, truncate on public.matches from anon;`); // P0-A 효과(matches)
for (const f of ['security_p0/11_p0b_rpc_revoke_anon.sql', 'security_p1/20_p1_kdk_score_guard.sql', 'security_p1/25_p1b_archive_guard.sql',
  'security_p1/34_matches_court_index_apply.sql', 'security_p1/30_kdk_managers_court_ops.sql', 'security_p1/31_kdk_official_save.sql', 'add_kdk_match_spotlight.sql']) await admin.query(sqlFile(f));
check('기존 구조 · 보안 SQL(P0-B · P1 · P1-b · 34 · 30 · 31) · SPOTLIGHT 원본 설치', true);
for (const [k, id] of Object.entries(USERS)) {
  await admin.query('insert into auth.users(id) values ($1)', [id]);
  await admin.query('insert into public.profiles(id, role) values ($1,$2)', [id, ROLE[k]]);
  await admin.query('insert into public.members(nickname, auth_user_id, role, club_id) values ($1,$2,$3,$4)', [`QA-${k}`, id, '회원', CLUB]);
}
await admin.query('insert into public.kdk_managers(user_id) values ($1)', [USERS.mgr]);

// PostgREST 와 같은 요청
async function begin(c, uid) {
  await c.query('begin'); await c.query('set local role authenticated');
  await c.query(`select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)`, [uid, JSON.stringify({ sub: uid, role: 'authenticated' })]);
}
async function req(c, uid, text, params) {
  try { await begin(c, uid); const r = await c.query(text, params); await c.query('commit'); return { rows: r.rows }; }
  catch (e) { try { await c.query('rollback'); } catch {} return { error: e.code, msg: e.message }; }
}
const ok = (r) => r.rows?.length === 1;
async function overlap(c1, u1, q1, c2, u2, q2) {
  await begin(c1, u1); const r1 = await c1.query(q1[0], q1[1]).then((r) => ({ rows: r.rows }), (e) => ({ error: e.code }));
  await begin(c2, u2); const p2 = c2.query(q2[0], q2[1]).then((r) => ({ rows: r.rows }), (e) => ({ error: e.code }));
  let wait = '';
  for (let i = 0; i < 60; i++) { const w = await one(admin, `select wait_event_type t, wait_event e, state from pg_stat_activity where pid=$1`, [c2.pid]); if (w?.t === 'Lock') { wait = w.e; break; } if (w?.state === 'idle in transaction') break; await new Promise((r) => setTimeout(r, 15)); }
  await c1.query(r1.error ? 'rollback' : 'commit'); const r2 = await p2; await c2.query(r2.error ? 'rollback' : 'commit');
  return { r1, r2, wait };
}
// 앱 쿼리(app/kdk/page.tsx)
const Q = {
  start: (id) => [`select public.start_kdk_match($1,$2) r`, [id, CLUB]],
  timer: (id) => [`select public.start_kdk_match_timer($1,$2) r`, [id, CLUB]],
  ret: (id) => [`update public.matches set status='waiting', court=null, score1=1, score2=1, started_at=null where id=$1 and status='playing' returning id`, [id]],
  reopen: (id) => [`update public.matches set status='waiting', court=null, score1=1, score2=1, started_at=null where id=$1 and status='complete' returning id`, [id]],
  /** 새 화면(K1): 연 시점 status · (완료면) 점수 · play_epoch 조건 */
  save: (id, s1, s2, b) => {
    const p = [id, s1, s2]; let w = `id=$1 and status='${b.status === 'complete' ? 'complete' : 'playing'}'`;
    if (b.status === 'complete') { p.push(b.score1, b.score2); w += ` and score1=$4 and score2=$5`; }
    if (typeof b.play_epoch === 'number') { p.push(b.play_epoch); w += ` and play_epoch=$${p.length}`; }
    return [`update public.matches set status='complete', score1=$2, score2=$3 where ${w} returning id`, p];
  },
  /** afa598e 화면(P1, epoch 모름) */
  saveP1: (id, s1, s2, b) => b.status === 'complete'
    ? [`update public.matches set status='complete', score1=$2, score2=$3 where id=$1 and status='complete' and score1=$4 and score2=$5 returning id`, [id, s1, s2, b.score1, b.score2]]
    : [`update public.matches set status='complete', score1=$2, score2=$3 where id=$1 and status='playing' returning id`, [id, s1, s2]],
};
let seq = 0;
async function newMatch(status = 'waiting') {
  const sid = `QA-K1-${Date.now().toString(36)}-${++seq}`;
  await admin.query(`insert into public.matches(id, club_id, session_id, session_title, round, court, player_ids, player_names, score1, score2, status, mode, group_name)
    values ($1,$2,$3,'QA',1,null,$4,$4,1,1,$5,'KDK','A')`, [`${sid}-m1`, CLUB, sid, [`${sid}:a`, `${sid}:b`, `${sid}:c`, `${sid}:d`], status]);
  return `${sid}-m1`;
}
const row = (id) => one(admin, `select status, court, score1, score2, started_at, play_epoch from public.matches where id=$1`, [id]);
const snap = async (id) => { const r = await row(id); return { status: r.status, score1: r.score1, score2: r.score2, play_epoch: r.play_epoch }; };
const A = await connect(), B = await connect();
const pool = await Promise.all(Array.from({ length: 10 }, () => connect()));

// ── 1) 설치 영향: 기존 데이터 · xmin(SPOTLIGHT 인증) · 잠금 시간 제한 ─────────
console.log('== 1) K1 설치 영향');
const legacy = { waiting: await newMatch('waiting'), playing: await newMatch('waiting'), complete: await newMatch('waiting') };
await req(A, USERS.adminA, ...Q.start(legacy.playing));
await req(A, USERS.adminA, ...Q.start(legacy.complete)); await req(A, USERS.adminA, ...Q.saveP1(legacy.complete, 6, 3, { status: 'playing' }));
const dataHash = `select md5(string_agg(to_jsonb(m)::text, '|' order by id)) h, count(*)::int n from (select id, club_id, session_id, round, court, player_ids, score1, score2, status, started_at from public.matches) m`;
const xminQ = `select string_agg(xmin::text, ',' order by id) x from public.matches`;
const before = await one(admin, dataHash); const xBefore = (await one(admin, xminQ)).x;
const certBefore = (await one(admin, `select count(*)::int n from public.kdk_match_lifecycle l join public.matches m on m.id = l.match_id where l.certified and l.certified_xmin = m.xmin`)).n;
// 1a) 진행 중 트랜잭션이 matches 행을 잡고 있으면 lock_timeout 으로 실패 · 무변경
{
  const holder = await connect();
  await holder.query('begin'); await holder.query(`select 1 from public.matches where id=$1 for update`, [legacy.playing]);
  const t0 = Date.now(); let err = null;
  try { await admin.query(sqlFile('closing_sprint/K1_kdk_play_epoch.sql')); } catch (e) { err = e; try { await admin.query('rollback'); } catch {} }
  const ms = Date.now() - t0;
  await holder.query('rollback'); await holder.end();
  const col = (await one(admin, `select count(*)::int n from information_schema.columns where table_name='matches' and column_name='play_epoch'`)).n;
  check('1a 경기 행을 잡은 트랜잭션이 있으면 K1 은 lock_timeout(3s) 후 실패 · 무변경(대기열 고착 없음)', err?.code === '55P03' && col === 0, `${err?.code} · ${ms}ms · 열 ${col}`);
}
// 1b) 정상 적용
await admin.query(sqlFile('closing_sprint/K1_kdk_play_epoch.sql'));
const after = await one(admin, dataHash); const xAfter = (await one(admin, xminQ)).x;
const certAfter = (await one(admin, `select count(*)::int n from public.kdk_match_lifecycle l join public.matches m on m.id = l.match_id where l.certified and l.certified_xmin = m.xmin`)).n;
check('1b 기존 데이터(점수 · 상태 · 코트 · 선수 · 타이머) 불변 · 행 수 불변', before.h === after.h && before.n === after.n, `${before.n}행`);
check('1c 기존 행 xmin 불변(테이블 재작성 · UPDATE 없음) → SPOTLIGHT xmin 인증 유지', xBefore === xAfter && certBefore === certAfter, `인증 ${certBefore}→${certAfter}`);
const leg = (await admin.query(`select status, play_epoch from public.matches where id = any($1) order by id`, [Object.values(legacy)])).rows;
check('1d 기존 행 play_epoch = 0(진행 중 · 완료 · 대기 모두) · NULL 0', leg.every((r) => r.play_epoch === 0) && (await one(admin, `select count(*)::int n from public.matches where play_epoch is null`)).n === 0, leg.map((r) => `${r.status}:${r.play_epoch}`).join(','));
const verify = (await admin.query(sqlFile('closing_sprint/K1_kdk_play_epoch_verify_READONLY.sql'))).rows;
check('1e verify_READONLY V01~V07 OK', verify.filter((r) => r.k !== 'V08').every((r) => r.result === 'OK'), verify.map((r) => `${r.k}=${r.result}`).join(' '));
// 1f) 적용 시점 진행 중이던 경기(epoch 0): 새 화면 저장 정상 · 복귀 후 재투입하면 1
{
  const b = await snap(legacy.playing);
  const s = await req(B, USERS.mem1, ...Q.save(legacy.playing, 6, 1, b));
  check('1f 적용 전부터 진행 중(epoch 0) 경기 — 새 화면 최초 저장 정상', ok(s) && (await row(legacy.playing)).play_epoch === 0, s.error || '');
}

// ── A) 기본 투입 ───────────────────────────────────────────────────────────
console.log('== A) 기본 투입');
{
  const id = await newMatch();
  const e0 = (await row(id)).play_epoch;
  const st = (await req(A, USERS.mem1, ...Q.start(id))).rows[0].r;
  const e1 = (await row(id)).play_epoch;
  const tm = (await req(A, USERS.mem1, ...Q.timer(id))).rows[0].r;
  const e2 = (await row(id)).play_epoch;
  const b = await snap(id);
  const sv = await req(B, USERS.mem2, ...Q.save(id, 6, 2, b));
  const e3 = (await row(id)).play_epoch;
  const cb = await snap(id);
  const cr = await req(B, USERS.adminB, ...Q.save(id, 6, 4, cb));
  const e4 = (await row(id)).play_epoch;
  check('A1 대기 경기 epoch 0 → 최초 투입(start_kdk_match RPC · 회원) 1', e0 === 0 && st.ok && e1 === 1, `${e0}→${e1}`);
  check('A2 타이머 시작 epoch 유지', tm.ok && e2 === 1);
  check('A3 최초 점수 저장(회원 · 경기 완료) epoch 유지', ok(sv) && e3 === 1);
  check('A4 운영진 정정 epoch 유지', ok(cr) && e4 === 1);
}
// ── B) 복귀 · 재투입 ──────────────────────────────────────────────────────
console.log('== B) 복귀 · 재투입');
{
  const id = await newMatch(); await req(A, USERS.adminA, ...Q.start(id));
  const oldModal = await snap(id);                                        // A 가 점수 창을 연 시점(epoch 1)
  await req(B, USERS.mgr, ...Q.ret(id)); const eRet = (await row(id)).play_epoch;
  await req(B, USERS.adminB, ...Q.start(id)); const eRe = (await row(id)).play_epoch;
  const s1 = await req(A, USERS.adminA, ...Q.save(id, 6, 1, oldModal));
  const after1 = await row(id);
  const fresh = await snap(id);
  const s2 = await req(A, USERS.adminA, ...Q.save(id, 6, 2, fresh));
  const f = await row(id);
  check('B1 복귀 epoch 유지(1) · 재투입 증가(2)', eRet === 1 && eRe === 2, `${eRet}→${eRe}`);
  check('B2 이전 점수 창(epoch 1) 저장 → 0행 차단 · 경기 진행 유지', !ok(s1) && !s1.error && after1.status === 'playing' && after1.score1 === 1, `${after1.status} ${after1.score1}:${after1.score2}`);
  check('B3 새 점수 창(epoch 2) 저장 → 성공', ok(s2) && f.status === 'complete' && f.score1 === 6 && f.score2 === 2 && f.play_epoch === 2);
  // 완료 → 되돌리기 → 재투입 → 재완료: 완료 시점에 연 정정 창(옛 epoch)도 차단
  const corrOld = await snap(id);
  await req(B, USERS.adminB, ...Q.reopen(id)); await req(B, USERS.adminB, ...Q.start(id));
  const nb = await snap(id); await req(B, USERS.adminB, ...Q.save(id, 6, 2, nb));     // 같은 6:2 로 다시 완료
  const s3 = await req(A, USERS.adminA, ...Q.save(id, 6, 0, corrOld));              // 점수는 같지만 epoch 가 다름
  const s3p1 = await snap(id);
  check('B4 되돌리기 → 재투입 → 같은 점수 재완료 뒤, 이전 주기에 연 정정 창 → 차단(P1 점수 조건만으로는 통과하던 경우)', !ok(s3) && s3p1.score2 === 2 && s3p1.play_epoch === 3, `epoch ${corrOld.play_epoch}→${s3p1.play_epoch}`);
  const p1only = await req(A, USERS.adminA, ...Q.saveP1(id, 6, 0, corrOld));
  check('B5 [대조] 같은 상황에서 epoch 모르는 afa598e 화면 쿼리는 통과(혼합 버전 위험 확인)', ok(p1only));
}
// ── C) 다중 운영자 ────────────────────────────────────────────────────────
console.log('== C) 다중 운영자');
{ // C1 A 점수 창(epoch n) · B 복귀(겹침) · B 재투입 · A 저장 — 겹침 구간에서도 차단
  const id = await newMatch(); await req(A, USERS.adminA, ...Q.start(id));
  const modal = await snap(id);
  const o = await overlap(B, USERS.mgr, Q.ret(id), A, USERS.adminA, Q.save(id, 6, 3, modal)); // 복귀 커밋 전 A 저장 → 대기 후 0행
  await req(B, USERS.adminB, ...Q.start(id));
  const s = await req(A, USERS.adminA, ...Q.save(id, 6, 3, modal));
  const f = await row(id);
  check('C1 복귀와 저장 겹침 → 복귀 1건 · 저장 0행(행 잠금 대기 후 재평가)', ok(o.r1) && o.r2.rows?.length === 0 && o.wait === 'transactionid', `wait ${o.wait}`);
  check('C2 재투입 뒤 A 의 이전 창 저장 → 0행 · 진행 중 유지', !ok(s) && f.status === 'playing' && f.play_epoch === 2);
}
{ // C3 재투입과 이전 창 저장 겹침(재투입 RPC 가 행을 잡은 사이 저장)
  const id = await newMatch(); await req(A, USERS.adminA, ...Q.start(id));
  const modal = await snap(id); await req(B, USERS.mgr, ...Q.ret(id));
  const o = await overlap(B, USERS.adminB, Q.start(id), A, USERS.adminA, Q.save(id, 6, 3, modal));
  const f = await row(id);
  check('C3 재투입 RPC 와 이전 창 저장 겹침 → 저장 0행 · epoch 2 · 진행 중', o.r1.rows?.[0]?.r?.ok && o.r2.rows?.length === 0 && f.play_epoch === 2 && f.status === 'playing', `wait ${o.wait || '없음'}`);
}
{ // C4 같은 epoch 에서 동시 정정(P1 유지) — 강제 겹침 + 20회 × 3명
  const id = await newMatch(); await req(A, USERS.adminA, ...Q.start(id)); const b0 = await snap(id); await req(A, USERS.adminA, ...Q.save(id, 6, 3, b0));
  const b = await snap(id);
  const o = await overlap(A, USERS.adminA, Q.save(id, 6, 4, b), B, USERS.adminB, Q.save(id, 6, 2, b));
  let bad = 0;
  for (let i = 0; i < 20; i++) {
    const id2 = await newMatch(); await req(A, USERS.adminA, ...Q.start(id2)); const z = await snap(id2); await req(A, USERS.adminA, ...Q.save(id2, 6, 3, z));
    const bb = await snap(id2);
    const rs = await Promise.all([[6, 4], [6, 2], [6, 1]].map(([x, y], k) => req(pool[k], [USERS.adminA, USERS.adminB, USERS.mgr][k], ...Q.save(id2, x, y, bb))));
    if (rs.filter(ok).length !== 1) bad++;
  }
  const f = await row(id);
  check('C4 같은 주기 동시 정정 → 1건만 반영(P1 조건 유지) · 반복 20회 위반 0', ok(o.r1) && o.r2.rows?.length === 0 && f.score2 === 4 && bad === 0, `wait ${o.wait} · 위반 ${bad}`);
}
{ // C5 같은 경기 동시 투입 10회 → 성공 1 · epoch +1 만
  const id = await newMatch();
  const rs = await Promise.all(pool.map((c, k) => req(c, [USERS.adminA, USERS.adminB, USERS.mgr, USERS.mem1, USERS.mem2][k % 5], ...Q.start(id))));
  const f = await row(id);
  check('C5 같은 경기 10회 동시 투입 → 성공 1 · epoch 정확히 1', rs.filter((r) => r.rows?.[0]?.r?.ok).length === 1 && f.play_epoch === 1, `epoch ${f.play_epoch}`);
}
{ // C6 복귀 · 재투입 반복 경합 — 10라운드(복귀 2명 + 재투입 2명 동시) 후 epoch = 실제 playing 진입 횟수
  const id = await newMatch(); await req(A, USERS.adminA, ...Q.start(id));
  let entries = 1;
  for (let i = 0; i < 10; i++) {
    const rr = await Promise.all([req(pool[0], USERS.mgr, ...Q.ret(id)), req(pool[1], USERS.adminA, ...Q.ret(id))]);
    const ss = await Promise.all([req(pool[2], USERS.adminB, ...Q.start(id)), req(pool[3], USERS.mem1, ...Q.start(id))]);
    entries += ss.filter((r) => r.rows?.[0]?.r?.ok).length;
    if (rr.filter(ok).length !== 1) entries = -999;
  }
  const f = await row(id);
  check('C6 복귀·재투입 동시 경합 10라운드 → epoch = 성공한 투입 횟수(누락 · 중복 증가 없음)', f.play_epoch === entries, `epoch ${f.play_epoch} · 투입 ${entries}`);
}
// ── D) 권한 · 위조 ────────────────────────────────────────────────────────
console.log('== D) 권한 · 위조');
{
  const id = await newMatch(); await req(A, USERS.adminA, ...Q.start(id));
  const b = await snap(id);
  const forgeMem = await req(B, USERS.mem1, `update public.matches set status='complete', score1=6, score2=1, play_epoch=7 where id=$1 and status='playing' returning id`, [id]);
  const memOk = await req(B, USERS.mem1, ...Q.save(id, 6, 1, b));
  const cb = await snap(id);
  const memCorr = await req(B, USERS.mem2, ...Q.save(id, 6, 3, cb));
  const admCorr = await req(A, USERS.adminA, ...Q.save(id, 6, 3, cb));
  const forgeAdm = await req(A, USERS.adminA, `update public.matches set play_epoch=99 where id=$1 returning id`, [id]);
  const forgeIns = await req(A, USERS.adminA, `insert into public.matches(id, club_id, session_id, player_ids, status, play_epoch) values ($1,$2,'QA-K1-INS',$3,'waiting',5) returning id`, [`QA-K1-INS-${Date.now()}`, CLUB, ['x', 'y', 'z', 'w']]);
  const insOk = await req(A, USERS.adminA, `insert into public.matches(id, club_id, session_id, player_ids, status) values ($1,$2,'QA-K1-INS',$3,'playing') returning play_epoch`, [`QA-K1-INS2-${Date.now()}`, CLUB, ['x2', 'y2', 'z2', 'w2']]);
  await admin.query(`update public.matches set play_epoch=42 where id=$1`, [id]);     // SQL Editor(테이블 소유자) — 규칙값으로 덮어씀
  const f = await row(id);
  check('D1 회원 최초 입력(새 화면 쿼리) 정상', ok(memOk));
  check('D2 회원이 최초 입력에 play_epoch 위조 → 42501(P1 guard/K1)', forgeMem.error === '42501');
  check('D3 회원 정정 → 42501 · 운영진 정정 정상', memCorr.error === '42501' && ok(admCorr));
  check('D4 운영진 직접 API 로 play_epoch 변경 → 42501', forgeAdm.error === '42501');
  check('D5 직접 INSERT 에 play_epoch 지정 → 42501 · 미지정 INSERT(playing) 는 1', forgeIns.error === '42501' && insOk.rows?.[0]?.play_epoch === 1);
  check('D6 소유자(SQL Editor/DEFINER) 경로의 임의 값도 규칙값으로 덮어씀(1 유지)', f.play_epoch === 1, `epoch ${f.play_epoch}`);
  const anon = await (async () => { try { await admin.query('begin'); await admin.query('set local role anon'); await admin.query(`update public.matches set play_epoch=3 where id=$1`, [id]); await admin.query('commit'); return 'ok'; } catch (e) { await admin.query('rollback'); return e.code; } })();
  check('D7 비로그인(anon) 쓰기 → 거절', anon === '42501', anon);
}
{ // D8 upsert(대진 저장 경로) — 같은 id 재저장해도 epoch 유지
  const id = await newMatch(); await req(A, USERS.adminA, ...Q.start(id));
  const up = await req(A, USERS.adminA, `insert into public.matches(id, club_id, session_id, round, court, player_ids, status) select id, club_id, session_id, round, court, player_ids, status from public.matches where id=$1
    on conflict (id) do update set round = excluded.round, court = excluded.court, status = excluded.status returning play_epoch`, [id]);
  check('D8 운영진 upsert(같은 id · play_epoch 미포함) → 오류 없음 · epoch 유지', up.rows?.[0]?.play_epoch === 1, up.error || '');
}

// ── 2) 재실행 · 롤백 · 재적용 ─────────────────────────────────────────────
console.log('== 2) 재실행 · 롤백');
{
  const snapE = (await one(admin, `select string_agg(id || ':' || play_epoch, ',' order by id) s from public.matches`)).s;
  await admin.query(sqlFile('closing_sprint/K1_kdk_play_epoch.sql'));
  const snapE2 = (await one(admin, `select string_agg(id || ':' || play_epoch, ',' order by id) s from public.matches`)).s;
  check('2a K1 재실행 → 오류 없음 · epoch 값 보존', snapE === snapE2);
  const h0 = await one(admin, dataHash);
  await admin.query(sqlFile('closing_sprint/K1_kdk_play_epoch_rollback.sql'));
  const h1 = await one(admin, dataHash);
  const gone = await one(admin, `select (select count(*) from information_schema.columns where table_name='matches' and column_name='play_epoch')::int col,
    (select count(*) from pg_trigger where tgname='kdk_play_epoch_trg')::int trg, to_regprocedure('public.kdk_play_epoch_guard()') is null fn,
    (select count(*) from pg_trigger where tgrelid='public.matches'::regclass and tgname in ('kdk_p1_score_guard_trg','kdk_p1_score_ledger_trg','kdk_match_lifecycle_insert_trg','kdk_match_lifecycle_status_trg','kdk_match_lifecycle_recert_trg'))::int keep`);
  check('2b 롤백 → 열 · trigger · 함수 제거, 기존 trigger 5종 유지, 점수 · 상태 데이터 불변', gone.col === 0 && gone.trg === 0 && gone.fn && gone.keep === 5 && h0.h === h1.h, JSON.stringify(gone));
  // 롤백 후 P1 화면 동작(epoch 조건 없음) 정상
  const id = await newMatch(); await req(A, USERS.adminA, ...Q.start(id)); const b = { status: 'playing' };
  const s = await req(B, USERS.mem1, ...Q.saveP1(id, 6, 2, b));
  // 롤백 직전에 열린 창(epoch 조건 포함) → 42703 → 화면은 epoch 조건 없이 1회 재시도
  const withEpoch = await req(A, USERS.adminA, ...Q.save(id, 6, 3, { status: 'complete', score1: 6, score2: 2, play_epoch: 1 }));
  const retry = await req(A, USERS.adminA, ...Q.saveP1(id, 6, 3, { status: 'complete', score1: 6, score2: 2 }));
  check('2c 롤백 후: P1 저장 정상 · epoch 조건 쿼리는 42703(열 없음, 화면이 조건 빼고 재시도) · 재시도 성공', ok(s) && withEpoch.error === '42703' && /play_epoch/.test(withEpoch.msg || '') && ok(retry));
  await admin.query(sqlFile('closing_sprint/K1_kdk_play_epoch.sql'));
  check('2d 재적용 → 전 행 0 에서 다시 시작', (await one(admin, `select count(*) filter (where play_epoch <> 0)::int n from public.matches`)).n === 0);
}

const leftover = (await one(admin, `select count(*)::int n from public.matches where session_id not like 'QA-%'`)).n;
check('테스트 DB matches 는 전부 가상(QA-) 데이터', leftover === 0);
const pass = results.filter((r) => r.pass).length;
console.log(`\nKDK PLAY_EPOCH 실DB 동시성 시험: ${pass} passed / ${results.length - pass} failed`);
for (const c of [admin, A, B, ...pool]) await c.end();
process.exit(results.length - pass ? 1 : 0);
