/**
 * MATCH SPOTLIGHT SQL 시험 — 격리된 PGlite(WASM Postgres) 테스트 DB 에서만 실행. 운영 DB 미접속.
 *
 *   실행: PGLITE_MODULE=<@electric-sql/pglite 의 dist/index.js 절대경로> node scripts/verify_match_spotlight_sql.mjs
 *   (pglite 는 프로젝트 의존성이 아니다 — 저장소 밖 임시 폴더에 설치해 경로만 넘긴다.)
 *
 *   Supabase 최소 stub: roles(anon/authenticated/service_role) · auth.uid() · profiles · matches · teyeon_archive_v1.
 *   검증: 증명서(fail-closed) · waiting 복원 · 선수 교체 · 재생성 · 공개 상태 전이 · 권한 · rollback.
 *   한계: PGlite 는 단일 연결 → 진짜 동시 트랜잭션(경기 시작 vs 저장 경합)은 재현 불가(설계 근거로 보고).
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const modPath = process.env.PGLITE_MODULE;
if (!modPath) { console.log('SKIP: PGLITE_MODULE 미지정 — SQL 시험 미실시'); process.exit(2); }
const { PGlite } = await import(pathToFileURL(modPath).href);

const here = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(join(here, '../supabase/add_kdk_match_spotlight.sql'), 'utf8');
const ROLLBACK = readFileSync(join(here, '../supabase/add_kdk_match_spotlight_rollback.sql'), 'utf8');
const VERIFY = readFileSync(join(here, '../supabase/add_kdk_match_spotlight_verify.sql'), 'utf8');

let passed = 0;
const failures = [];
const check = (name, cond, info = '') => { if (cond) passed += 1; else failures.push(`${name}${info ? ` — ${info}` : ''}`); };

const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];
const rpc = async (fn, args) => (await one(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) as r`, args)).r;
const asRole = async (role, sub, fn) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${sub || ''}', false);`);
  try { return await fn(); } finally { await db.exec('reset role;'); }
};
const errOf = async (fn) => { try { await fn(); return null; } catch (e) { return String(e?.code || e?.message || e); } };

// ── Supabase stub ────────────────────────────────────────────────────────────
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  create schema auth; grant usage on schema auth to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table public.profiles (id uuid primary key, role text);
  create table public.teyeon_archive_v1 (id text primary key, raw_data jsonb);
  create table public.matches (
    id text primary key, club_id text, session_id text, round int, court int,
    player_ids text[], player_names text[], status text, score1 int default 1, score2 int default 1, started_at timestamptz);
  -- 기존 운영 정책 모사: 누구나 LIVE 코트 조회 · 운영자 쓰기(시험 단순화를 위해 authenticated 전체 허용)
  alter table public.matches enable row level security;
  create policy m_read on public.matches for select using (true);
  create policy m_write on public.matches for all to authenticated using (true) with check (true);
  grant select on public.matches to anon; grant all on public.matches to authenticated;
  insert into public.profiles values
    ('00000000-0000-0000-0000-00000000000a', 'CEO'),
    ('00000000-0000-0000-0000-00000000000b', 'MEMBER');
`);
const CEO = '00000000-0000-0000-0000-00000000000a';
const MEMBER = '00000000-0000-0000-0000-00000000000b';
const ins = (id, status = 'waiting', session = 'S1', ids = ['a', 'b', 'c', 'd']) =>
  db.query(`insert into public.matches (id, club_id, session_id, round, court, player_ids, player_names, status)
            values ($1, 'C1', $2, 1, 1, $3, $3, $4)`, [id, session, ids, status]);

// 설치 전부터 있던 경기(진행 중 세션 가정)
await ins('pre-wait');
await ins('pre-play', 'playing');

// ── 설치 ────────────────────────────────────────────────────────────────────
await db.exec(SQL);
check('설치 성공 · trigger 2개 정상', (await one(`select public.kdk_spotlight_ledger_healthy() as h`)).h === true);
const pre = await q(`select match_id, certified, left_waiting_at is not null as left from public.kdk_match_lifecycle order by match_id`);
check('설치 전 경기 = uncertifiable backfill', pre.length === 2 && pre.every((r) => r.certified === false), JSON.stringify(pre));
check('설치 전 playing 경기는 이탈 기록', pre.find((r) => r.match_id === 'pre-play')?.left === true);

// 신규 경기
await ins('m1'); await ins('m2'); await ins('m3'); await ins('m4');
const cert = await q(`select match_id, certified, left_waiting_at from public.kdk_match_lifecycle where match_id in ('m1','m2','m3','m4')`);
check('신규 waiting INSERT → 증명서', cert.length === 4 && cert.every((r) => r.certified && r.left_waiting_at === null));

const run = (slug = 'slugslugslug01') => ({
  public_slug: slug, model_version: 'spotlight-v1', select_version: 'spotlight-select-v1', cutoff_date: '2026-11-03',
  source_signature: 'sig', source_archive_count: 3, source_game_count: 40, session_title: '정모', session_date: '2026-11-03',
  public_payload: { schema: 1, items: [{ matchNo: 1 }, { matchNo: 2 }], matches: [{ matchNo: 1 }, { matchNo: 2 }] },
});
const pred = (id, no, ids = ['a', 'b', 'c', 'd']) => ({
  match_id: id, match_no: no, round: 1, player_ids: ids, players_hash: 'h', model_version: 'spotlight-v1',
  tier: 'reference', prob_a: 0.55, snapshot: { matchId: id }, main_type: 'CLOSE', score: 61, selected: true,
});
const save = (preds, actor = CEO, session = 'S1', r = run()) =>
  rpc('save_kdk_spotlight_run', ['C1', session, actor, JSON.stringify(r), JSON.stringify(preds)]);

// ── 증명서 판정 ──────────────────────────────────────────────────────────────
let r = await save([pred('pre-wait', 9)]);
check('설치 전 경기 예측 거부(uncertifiable)', r.ok === false && r.rejected?.[0]?.reason === 'uncertifiable', JSON.stringify(r));

// waiting 복원: 시작 → 되돌림 → 사후 예측 거부
await db.exec(`update public.matches set status='playing', court=1 where id='m3'`);
await db.exec(`update public.matches set status='waiting', court=null, started_at=null where id='m3'`);
check('waiting 복원 후에도 이탈 기록 유지', (await one(`select left_waiting_at is not null as l from public.kdk_match_lifecycle where match_id='m3'`)).l === true);
r = await save([pred('m3', 3)]);
check('시작 후 되돌린 경기 사후 예측 거부', r.ok === false && r.rejected?.[0]?.reason === 'started_before', JSON.stringify(r));

// 완료 후 되돌림도 동일
await db.exec(`update public.matches set status='complete' where id='m4'`);
await db.exec(`update public.matches set status='waiting' where id='m4'`);
r = await save([pred('m4', 4)]);
check('완료 후 되돌린 경기 거부', r.ok === false && r.rejected?.[0]?.reason === 'started_before');

// 처음부터 complete 로 INSERT
await ins('m5', 'complete');
r = await save([pred('m5', 5)]);
check('waiting 아닌 INSERT 경기 거부', r.ok === false && ['not_waiting', 'started_before'].includes(r.rejected?.[0]?.reason));

// 선수 교체
await db.exec(`update public.matches set player_ids=array['a','b','c','x'] where id='m2'`);
r = await save([pred('m1', 1), pred('m2', 2)]);
check('선수 교체 경기 거부 + 전체 미저장(all-or-nothing)', r.ok === false && r.rejected.length === 1 && r.rejected[0].reason === 'player_mismatch');
check('all-or-nothing: 회차 미생성', (await one(`select count(*)::int as n from public.kdk_spotlight_runs`)).n === 0);

// 정상 저장
r = await save([pred('m1', 1), pred('m2', 2, ['a', 'b', 'c', 'x'])]);
check('정상 저장', r.ok === true && r.revision === 1 && r.saved === 2, JSON.stringify(r));
const run1 = r.run_id;

// trigger 내부 실패 → fault → fail-closed (경기 운영은 성공)
await db.exec(`alter table public.kdk_match_lifecycle add constraint t_fail check (match_id <> 'faulty')`);
const kdkErr = await errOf(() => ins('faulty'));
check('ledger 실패해도 KDK 경기 INSERT 성공', kdkErr === null, kdkErr || '');
check('ledger 실패 → fault 기록', (await one(`select count(*)::int as n from public.kdk_match_lifecycle_faults where match_id='faulty'`)).n === 1);
r = await save([pred('faulty', 7)]);
check('fault 경기 예측 거부', r.ok === false && r.rejected?.[0]?.reason === 'ledger_fault', JSON.stringify(r));
// 이중 실패(증명서·fault 모두 실패) — INSERT 경로는 증명서 없음으로 닫힌다
await db.exec(`alter table public.kdk_match_lifecycle_faults add constraint f_fail check (match_id <> 'faulty2')`);
await db.exec(`alter table public.kdk_match_lifecycle drop constraint t_fail; alter table public.kdk_match_lifecycle add constraint t_fail check (match_id <> 'faulty2')`);
const kdkErr2 = await errOf(() => ins('faulty2'));
check('이중 실패에도 KDK INSERT 성공', kdkErr2 === null, kdkErr2 || '');
r = await save([pred('faulty2', 8)]);
check('이중 실패 INSERT 경로 → no_certificate 거부', r.ok === false && r.rejected?.[0]?.reason === 'no_certificate', JSON.stringify(r));
// 이중 실패 UPDATE 경로(v2 잔여 위험 → v2.1 행 버전 체인으로 차단): 증명서 갱신·fault 모두 실패해도
//   matches 행 버전(xmin)이 바뀌므로 증명 버전과 어긋나 사후 예측이 거부되어야 한다.
await ins('residual'); await ins('residual2');
await db.exec(`alter table public.kdk_match_lifecycle drop constraint t_fail;
  alter table public.kdk_match_lifecycle add constraint t_fail check (left_waiting_at is null or match_id not in ('residual','residual2'));
  alter table public.kdk_match_lifecycle_faults drop constraint f_fail;
  alter table public.kdk_match_lifecycle_faults add constraint f_fail check (match_id not in ('residual','residual2'))`);
const kdkErr3 = await errOf(() => db.exec(`update public.matches set status='playing' where id in ('residual','residual2')`));
check('UPDATE 이중 실패에도 KDK 경기 시작 성공', kdkErr3 === null, kdkErr3 || '');
const residual = await one(`select left_waiting_at is null as missing from public.kdk_match_lifecycle where match_id='residual'`);
check('UPDATE 이중 실패 시 이탈 미기록(재현 조건 확인)', residual.missing === true);
// residual 은 playing 으로 두어 verify A7 감지 확인용, residual2 는 waiting 으로 되돌린다(v2 에서 감지 불가였던 경로).
await db.exec(`update public.matches set status='waiting', court=null, started_at=null where id='residual2'`);
await db.exec(`alter table public.kdk_match_lifecycle drop constraint t_fail; alter table public.kdk_match_lifecycle_faults drop constraint f_fail`);
r = await save([pred('residual2', 11)]);
check('이중 실패 후 waiting 으로 되돌린 경기 → row_changed 거부(v2.1 P0)', r.ok === false && r.rejected?.[0]?.reason === 'row_changed', JSON.stringify(r));
// 되돌린 뒤 waiting→waiting 수정이 와도 체인은 다시 이어지지 않는다(직전 버전이 증명 버전이 아님)
await db.exec(`update public.matches set player_ids=array['a','b','c','d'] where id='residual2'`);
r = await save([pred('residual2', 11)]);
check('끊긴 체인은 이후 waiting 수정으로 복구되지 않음', r.ok === false && r.rejected?.[0]?.reason === 'row_changed', JSON.stringify(r));

// 시작 전 정상 수정(waiting→waiting)은 체인을 잇는다: 강제 동기화 upsert(값 동일) · 같은 값 UPDATE
await ins('chain');
await db.exec(`insert into public.matches (id, club_id, session_id, round, court, player_ids, player_names, status)
  values ('chain', 'C1', 'S1', 1, 1, array['a','b','c','d'], array['a','b','c','d'], 'waiting')
  on conflict (id) do update set status = excluded.status, court = excluded.court, player_ids = excluded.player_ids`);
await db.exec(`update public.matches set score1 = score1 where id='chain'`);
const chainOk = await one(`select (l.certified_xmin = m.xmin) as same from public.kdk_match_lifecycle l join public.matches m on m.id = l.match_id where l.match_id='chain'`);
check('강제 동기화 upsert·no-op UPDATE 후에도 체인 유지', chainOk.same === true);
// recert 실패 → fault → 차단(KDK 수정은 성공)
await db.exec(`alter table public.kdk_match_lifecycle add constraint t_fail2 check (match_id <> 'chain') not valid`);  // 기존 행 유지 · 갱신만 실패
const kdkErr4 = await errOf(() => db.exec(`update public.matches set court = 2 where id='chain'`));
check('recert 실패해도 KDK 수정 성공', kdkErr4 === null, kdkErr4 || '');
await db.exec(`alter table public.kdk_match_lifecycle drop constraint t_fail2`);
r = await save([pred('chain', 12)]);
check('recert 실패 경기 → 거부(ledger_fault)', r.ok === false && r.rejected?.[0]?.reason === 'ledger_fault', JSON.stringify(r));
// 같은 id 삭제 후 재삽입(waiting) → 이전 증명서 유지 · 버전 불일치로 거부
await ins('reins'); await db.exec(`delete from public.matches where id='reins'`); await ins('reins');
r = await save([pred('reins', 13)]);
check('같은 id 재삽입 경기 → row_changed 거부', r.ok === false && r.rejected?.[0]?.reason === 'row_changed', JSON.stringify(r));

// trigger 비활성 → 전체 거부 + 비활성 중 시작·되돌림은 재활성 후에도 거부
await ins('bypass');
for (const t of ['kdk_match_lifecycle_status_trg', 'kdk_match_lifecycle_recert_trg', 'kdk_match_lifecycle_insert_trg']) {
  await db.exec(`alter table public.matches disable trigger ${t}`);
  r = await save([pred('m1', 1)]);
  check(`trigger 비활성(${t}) → ledger_unhealthy`, r.ok === false && r.reason === 'ledger_unhealthy');
  await db.exec(`alter table public.matches enable trigger ${t}`);
}
await db.exec(`alter table public.matches disable trigger kdk_match_lifecycle_status_trg;
  update public.matches set status='playing' where id='bypass';
  update public.matches set status='waiting' where id='bypass';
  alter table public.matches enable trigger kdk_match_lifecycle_status_trg`);
r = await save([pred('bypass', 14)]);
check('trigger 우회 중 시작→되돌림 경기 → 재활성 후에도 row_changed 거부', r.ok === false && r.rejected?.[0]?.reason === 'row_changed', JSON.stringify(r));
const healthy3 = await one(`select public.kdk_spotlight_ledger_healthy() as h`);
check('재활성 후 ledger 정상', healthy3.h === true);

// ── 재생성 · 중복 클릭 ───────────────────────────────────────────────────────
r = await save([pred('m1', 1)], CEO, 'S1', run('differentslug9'));
check('재생성 → revision 2 · slug 고정', r.ok && r.revision === 2 && r.public_slug === 'slugslugslug01', JSON.stringify(r));
const run2 = r.run_id;
const states = await q(`select id, status, superseded_by from public.kdk_spotlight_runs order by revision`);
check('이전 draft superseded', states[0].status === 'superseded' && states[0].superseded_by === run2 && states[1].status === 'draft');
check('경기당 active 1건', (await one(`select count(*)::int as n from public.kdk_match_predictions where match_id='m1' and status='active'`)).n === 1);
check('재생성에 없는 경기의 기존 예측 유지', (await one(`select status from public.kdk_match_predictions where match_id='m2'`)).status === 'active');

// ── 공개 상태 전이 ───────────────────────────────────────────────────────────
const pubPayload = JSON.stringify({ schema: 1, items: [{ matchNo: 1 }, { matchNo: 2 }], matches: [{ matchNo: 1 }, { matchNo: 2 }] });
r = await rpc('publish_kdk_spotlight_run', [run1, CEO, pubPayload, []]);
check('이전 회차 공개 거부(not_publishable/not_latest)', r.ok === false, JSON.stringify(r));
let pub = await asRole('anon', '', () => rpc('get_public_kdk_spotlight', ['slugslugslug01']));
check('공개 전 anon 조회 not_found(draft 노출 금지)', pub.ok === false);
r = await rpc('publish_kdk_spotlight_run', [run2, CEO, pubPayload, []]);
check('공개', r.ok && r.reason === 'published');
r = await rpc('publish_kdk_spotlight_run', [run2, CEO, pubPayload, []]);
check('중복 공개 멱등', r.ok && r.reason === 'already_published');
pub = await asRole('anon', '', () => rpc('get_public_kdk_spotlight', ['slugslugslug01']));
check('anon 공개 조회', pub.ok === true && pub.payload.items.length === 2);
check('공개 응답에 내부 필드 없음', !/player_ids|snapshot|match_id|generated_by|prob_a/.test(JSON.stringify(pub)));
const link = await asRole('anon', '', () => rpc('get_public_kdk_spotlight_link', ['S1']));
check('anon 배너 링크', link.ok && link.public_slug === 'slugslugslug01');
// 공개 후 선수 교체 → 해당 경기 숨김(m1 = matchNo 1)
await db.exec(`update public.matches set player_ids=array['a','b','c','z'] where id='m1'`);
pub = await asRole('anon', '', () => rpc('get_public_kdk_spotlight', ['slugslugslug01']));
check('공개 후 선수 교체 경기 즉시 숨김', pub.ok && pub.hidden_count === 1 && pub.payload.items.every((i) => i.matchNo !== 1), JSON.stringify(pub.payload));
await db.exec(`update public.matches set player_ids=array['a','b','c','d'] where id='m1'`);
r = await rpc('unpublish_kdk_spotlight_run', ['C1', 'S1', CEO]);
check('비공개', r.ok && r.reason === 'unpublished');
pub = await asRole('anon', '', () => rpc('get_public_kdk_spotlight', ['slugslugslug01']));
check('비공개 후 anon not_found', pub.ok === false);
check('비공개 후 배너 없음', (await asRole('anon', '', () => rpc('get_public_kdk_spotlight_link', ['S1']))).ok === false);
r = await rpc('publish_kdk_spotlight_run', [run2, CEO, pubPayload, ['m1']]);
check('같은 회차 재공개 + 무효화 반영', r.ok && (await one(`select status from public.kdk_match_predictions where run_id=$1 and match_id='m1'`, [run2])).status === 'invalidated');

// ── 권한 ────────────────────────────────────────────────────────────────────
r = await save([pred('m1', 1)], MEMBER);
check('service 경로라도 actor 가 운영진 아니면 forbidden', r.ok === false && r.reason === 'forbidden');
for (const [role, sub] of [['anon', ''], ['authenticated', MEMBER], ['authenticated', CEO]]) {
  const e1 = await asRole(role, sub, () => errOf(() => save([pred('m1', 1)])));
  check(`${role}${sub === CEO ? '(CEO 토큰)' : ''} 저장 RPC 실행 불가`, e1 === '42501', String(e1));
  const e2 = await asRole(role, sub, () => errOf(() => rpc('publish_kdk_spotlight_run', [run2, CEO, pubPayload, []])));
  check(`${role}${sub === CEO ? '(CEO 토큰)' : ''} 공개 RPC 실행 불가`, e2 === '42501', String(e2));
  const e3 = await asRole(role, sub, () => errOf(() => rpc('unpublish_kdk_spotlight_run', ['C1', 'S1', CEO])));
  check(`${role}${sub === CEO ? '(CEO 토큰)' : ''} 비공개 RPC 실행 불가`, e3 === '42501', String(e3));
  for (const t of ['kdk_spotlight_runs', 'kdk_match_predictions', 'kdk_match_lifecycle', 'kdk_match_lifecycle_faults']) {
    const e = await asRole(role, sub, () => errOf(() => q(`select * from public.${t}`)));
    check(`${role} ${t} 직접 조회 불가`, e === '42501', String(e));
  }
}
const eAdminAnon = await asRole('anon', '', () => errOf(() => rpc('get_kdk_spotlight_admin', ['S1'])));
check('anon 운영진 미리보기 불가', eAdminAnon === '42501', String(eAdminAnon));
const eAdminMember = await asRole('authenticated', MEMBER, () => errOf(() => rpc('get_kdk_spotlight_admin', ['S1'])));
check('일반 회원 운영진 미리보기 불가', eAdminMember === '42501', String(eAdminMember));
const adminView = await asRole('authenticated', CEO, () => rpc('get_kdk_spotlight_admin', ['S1']));
check('CEO 미리보기 조회', adminView.ok && adminView.ledger_healthy === true && adminView.runs.length >= 1);

// Archive 종료 세션
await ins('s2m', 'waiting', 'S2');
await db.exec(`insert into public.teyeon_archive_v1 values ('S2', '{}'::jsonb)`);
r = await save([pred('s2m', 1)], CEO, 'S2', run('anotherslug22'));
check('Archive 종료 세션 생성 거부', r.ok === false && r.reason === 'session_archived');

// KDK 운영 무회귀(trigger 존재 상태)
const e = await errOf(() => db.exec(`update public.matches set status='playing' where id='m1';
  update public.matches set status='complete', score1=6, score2=3 where id='m1';
  delete from public.matches where session_id='S2';`));
check('KDK 시작·완료·삭제 정상', e === null, String(e));

// ── 운영 점검 SQL(verify.sql) 실행 ───────────────────────────────────────────
//   residual/faulty 시험 경기가 의도적으로 A7·A8·A9 를 깨뜨린다 → 그 3개는 "감지됨"을 확인.
{
  const results = await db.exec(VERIFY);
  const rows = results.flatMap((x) => x.rows || []);
  const byName = Object.fromEntries(rows.map((row) => [row.check, row]));
  for (const k of ['A1 tables', 'A2 triggers enabled', 'A3 RLS on', 'A4 no table privileges for anon/authenticated',
    'A5 write RPC only service_role', 'A6 read RPC grants', 'A10 waiting matches with broken version chain (info)',
    'A11 other user triggers on matches (info)']) {
    check(`verify.sql ${k}`, byName[k]?.ok === true, JSON.stringify(byName[k]));
  }
  check('verify.sql A7 잔여 위험(residual, playing 상태) 감지', byName['A7 non-waiting matches without left_waiting record']?.ok === false);
  check('verify.sql A8 fault 감지', byName['A8 ledger faults']?.ok === false);
  check('verify.sql A9 증명서 없는 경기 감지', byName['A9 matches without certificate row']?.ok === false);
  check('verify.sql A10 체인 단절 waiting 경기 수 집계(residual2·reins·bypass 포함)', Number(byName['A10 waiting matches with broken version chain (info)']?.n) >= 3,
    JSON.stringify(byName['A10 waiting matches with broken version chain (info)']));
}

// ── rollback ────────────────────────────────────────────────────────────────
await db.exec(ROLLBACK);
const left = await one(`select
  (select count(*)::int from pg_trigger where tgname like 'kdk_match_lifecycle%') as trg,
  (select count(*)::int from pg_tables where tablename like 'kdk_%spotlight%' or tablename like 'kdk_match_%') as tbl,
  (select count(*)::int from pg_proc where proname like '%spotlight%' or proname like 'kdk_match_lifecycle%') as fn`);
check('rollback: trigger·table·function 모두 제거', left.trg === 0 && left.tbl === 0 && left.fn === 0, JSON.stringify(left));
check('rollback: matches 데이터 보존', (await one(`select count(*)::int as n from public.matches`)).n > 0);
const e9 = await errOf(() => ins('after-rollback'));
check('rollback 후 KDK INSERT 정상', e9 === null);

console.log(`MATCH SPOTLIGHT SQL (PGlite): ${passed} passed / ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
