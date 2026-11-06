/**
 * MATCH SPOTLIGHT — 실제 PostgreSQL 다중 연결 시험(동시성 · trigger 영향 · 설치/재적용/rollback 잠금).
 *
 *   ⚠️ 테스트 전용 DB 에서만. 운영 Supabase 접속 금지(아래 안전 장치가 차단).
 *   실행:
 *     SPOTLIGHT_TESTDB=yes-test-only \
 *     PG_MODULE=<pg 패키지 디렉터리 절대경로(저장소 밖 설치)> \
 *     DATABASE_URL=postgres://...테스트 DB... \
 *     [SPOTLIGHT_LOCAL_STUB=1  ← 로컬 순수 PostgreSQL 일 때만: Supabase stub 생성] \
 *     node scripts/verify_match_spotlight_concurrency.mjs
 *
 *   안전 장치: ① SPOTLIGHT_TESTDB 확인값 ② .env.local 의 운영 Supabase project ref 가 DATABASE_URL 에 있으면 중단
 *             ③ matches 에 QA- / SP-QA- 가 아닌 행이 하나라도 있으면 중단(실데이터 DB 로 판단).
 *   데이터: 전부 가상(QA- 접두사). 운영 데이터 복제 없음.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const sqlFile = (p) => readFileSync(join(root, 'supabase', p), 'utf8');

// ── 안전 장치 ────────────────────────────────────────────────────────────────
if (process.env.SPOTLIGHT_TESTDB !== 'yes-test-only') { console.log('SKIP: SPOTLIGHT_TESTDB=yes-test-only 미지정 — 실DB 시험 미실시'); process.exit(2); }
const url = process.env.DATABASE_URL || '';
if (!url || !process.env.PG_MODULE) { console.log('SKIP: DATABASE_URL 또는 PG_MODULE 미지정'); process.exit(2); }
{
  const envPath = join(root, '.env.local');
  const prodUrl = existsSync(envPath) ? (readFileSync(envPath, 'utf8').match(/^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m)?.[1] || '').trim() : '';
  const prodRef = prodUrl.match(/^https?:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1];
  if (prodRef && url.toLowerCase().includes(prodRef.toLowerCase())) {
    console.error('ABORT: DATABASE_URL 이 운영 Supabase 프로젝트를 가리킵니다. 테스트 전용 프로젝트만 허용.');
    process.exit(3);
  }
}
const pg = createRequire(join(process.env.PG_MODULE, 'package.json'))(process.env.PG_MODULE);

// ── 공통 ────────────────────────────────────────────────────────────────────
let passed = 0; const failures = []; const notes = [];
const check = (name, cond, info = '') => { if (cond) { passed += 1; console.log(`  PASS ${name}${info ? ` (${info})` : ''}`); } else { failures.push(`${name}${info ? ` — ${info}` : ''}`); console.log(`  FAIL ${name}${info ? ` — ${info}` : ''}`); } };
const note = (s) => { notes.push(s); console.log(`  NOTE ${s}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clients = [];
const connect = async (name) => {
  const c = new pg.Client({ connectionString: url, application_name: `spotlight-qa-${name}` });
  await c.connect(); clients.push(c); return c;
};
const timed = async (p) => { const t = Date.now(); try { const res = await p; return { ms: Date.now() - t, res }; } catch (err) { return { ms: Date.now() - t, err }; } };
const CLUB = 'QA-CLUB';
const CEO = '00000000-0000-4000-8000-0000000000c1';
const ADMIN = '00000000-0000-4000-8000-0000000000a1';
const asOperator = (c, uid) => c.query(`set role authenticated;
  select set_config('request.jwt.claim.sub', '${uid}', false), set_config('request.jwt.claim.role', 'authenticated', false),
         set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', false)`);
const asService = (c) => c.query(`set role service_role; select set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
const asOwner = (c) => c.query('reset role');
const one = async (c, sql, params) => (await c.query(sql, params)).rows[0];

const runOf = (session, slug) => ({
  public_slug: slug, model_version: 'spotlight-v1', select_version: 'spotlight-select-v1', cutoff_date: '2026-11-03',
  source_signature: 'qa-sig', source_archive_count: 3, source_game_count: 40, session_title: 'QA', session_date: '2026-11-03',
  public_payload: { schema: 1, items: [], matches: [] },
});
const predOf = (id, no, ids) => ({
  match_id: id, match_no: no, round: 1, player_ids: ids, players_hash: 'h', model_version: 'spotlight-v1',
  tier: 'reference', prob_a: 0.55, snapshot: { matchId: id }, main_type: 'CLOSE', score: 61, selected: true,
});
const save = async (c, session, preds, slug = 'qaslugconc0001') =>
  (await one(c, `select public.save_kdk_spotlight_run($1, $2, $3, $4::jsonb, $5::jsonb) as r`,
    [CLUB, session, CEO, JSON.stringify(runOf(session, slug)), JSON.stringify(preds)])).r;
const players = (id) => [`${id}-p1`, `${id}-p2`, `${id}-p3`, `${id}-p4`];
const insertMatches = async (c, session, ids) => {
  for (const [i, id] of ids.entries()) {
    await c.query(`insert into public.matches (id, club_id, session_id, session_title, round, court, player_ids, player_names, score1, score2, status, mode, group_name)
                   values ($1, $2, $3, 'QA', $4, $5, $6, $6, 1, 1, 'waiting', 'KDK', 'A')`, [id, CLUB, session, Math.floor(i / 4) + 1, (i % 4) + 1, players(id)]);
  }
};
const startRpc = (c, id) => c.query(`select public.start_kdk_match($1, $2) as r`, [id, CLUB]).then((x) => x.rows[0].r);
const revertApp = (c, id) => c.query(`update public.matches set status='waiting', court=null, score1=1, score2=1, started_at=null where id=$1`, [id]);

// ── 0) 대상 DB 점검 · 기본 구조 ───────────────────────────────────────────────
const admin = await connect('admin');
const hasMatches = (await one(admin, `select to_regclass('public.matches') is not null as e`)).e;
if (hasMatches) {
  const foreign = (await one(admin, `select count(*)::int as n from public.matches where session_id not like 'QA-%' and session_id not like 'SP-QA-%'`)).n;
  if (foreign > 0) { console.error(`ABORT: matches 에 QA 가 아닌 행 ${foreign}건 — 실데이터 DB 로 판단, 중단.`); process.exit(3); }
}
console.log('== 0) 테스트 DB 구조 준비');
if (!hasMatches) {
  if (process.env.SPOTLIGHT_LOCAL_STUB === '1') await admin.query(sqlFile('spotlight_testenv/00_local_supabase_stub.sql'));
  await admin.query(sqlFile('spotlight_testenv/01_testenv_base_schema.sql'));
  for (const f of ['kdk_session_meta.sql', 'add_kdk_group_courts.sql', 'add_matches_playing_court_unique_index.sql', 'add_start_kdk_match_rpc.sql',
    'add_kdk_match_timer.sql', 'add_delete_kdk_live_session_rpc.sql', 'sync_rpc_v1.sql']) {
    await admin.query(sqlFile(f));
  }
  await admin.query(sqlFile('spotlight_testenv/02_testenv_seed.sql'));
  check('기본 구조 + 기존 KDK RPC(원본 파일) + 가상 데이터 설치', true);
} else {
  // 재실행: 이전 SPOTLIGHT 설치 제거 후 QA 데이터 초기화
  await admin.query(sqlFile('add_kdk_match_spotlight_rollback.sql'));
  await admin.query(`delete from public.matches where session_id like 'QA-%' or session_id like 'SP-QA-%'`);
  await admin.query(sqlFile('spotlight_testenv/02_testenv_seed.sql'));
  check('재실행: 이전 설치 rollback + QA 데이터 초기화', true);
}
const pgVersion = (await one(admin, 'show server_version')).server_version;
note(`PostgreSQL ${pgVersion}`);

// ── 1) 설치 전 trigger 없는 기준 성능 ───────────────────────────────────────
const bulk = async (session, n) => {
  const rows = Array.from({ length: n }, (_, i) => ({ id: `${session}-${i}`, club_id: CLUB, session_id: session, round: 1, court: 1,
    player_ids: players(`${session}-${i}`), player_names: players(`${session}-${i}`), status: 'waiting', mode: 'KDK', group_name: 'A' }));
  const t = Date.now();
  await admin.query(`insert into public.matches (id, club_id, session_id, round, court, player_ids, player_names, status, mode, group_name)
    select r->>'id', r->>'club_id', r->>'session_id', (r->>'round')::int, (r->>'court')::int,
           array(select jsonb_array_elements_text(r->'player_ids')), array(select jsonb_array_elements_text(r->'player_names')),
           r->>'status', r->>'mode', r->>'group_name' from jsonb_array_elements($1::jsonb) r
    on conflict (id) do update set status = excluded.status, player_ids = excluded.player_ids`, [JSON.stringify(rows)]);
  const ins = Date.now() - t;
  const t2 = Date.now();
  await admin.query(`update public.matches set score1 = score1 where session_id = $1`, [session]);
  return { ins, upd: Date.now() - t2 };
};
const base = await bulk('QA-PERF-A', 300);

// ── 2) 설치 잠금 영향: 진행 중 KDK 쓰기 트랜잭션이 있으면 3s 안에 포기, 그동안 다른 KDK 쓰기 대기 ≤ ~3s ─
console.log('== 2) 설치 시 잠금 영향(lock_timeout 3s)');
const SPOT = sqlFile('add_kdk_match_spotlight.sql');
const ROLLBACK = sqlFile('add_kdk_match_spotlight_rollback.sql');
const VERIFY = sqlFile('add_kdk_match_spotlight_verify.sql');
{
  const holder = await connect('holder'); const installer = await connect('installer'); const kdk = await connect('kdk');
  await asOperator(kdk, CEO);
  await holder.query('begin');
  await holder.query(`update public.matches set score1 = score1 where id = 'qa-kdk-8'`);       // 진행 중 KDK 쓰기(미커밋)
  const inst = timed(installer.query(SPOT));
  await sleep(500);
  const kdkWrite = await timed(kdk.query(`update public.matches set score2 = score2 where id = 'qa-kdk-7'`)); // 다른 경기 쓰기
  const r = await inst;
  await installer.query('rollback').catch(() => {});
  check('진행 중 쓰기 있으면 설치가 lock_timeout(55P03)으로 포기', r.err?.code === '55P03', `${r.err?.code} ${r.ms}ms`);
  check('포기한 설치는 흔적 없음(trigger·table 0)', (await one(admin, `select (select count(*) from pg_trigger where tgname like 'kdk_match_lifecycle%')::int + (select count(*) from pg_tables where tablename like 'kdk_match_lifecycle%')::int as n`)).n === 0);
  check('설치 대기 중 다른 KDK 쓰기는 성공(지연 ≤ 4s)', !kdkWrite.err && kdkWrite.ms < 4000, `${kdkWrite.ms}ms`);
  note(`설치 대기 중 KDK 쓰기 지연 실측 ${kdkWrite.ms}ms (설치가 잠금 대기열에 있는 동안 뒤에 줄 섬 — 최대 lock_timeout 3s)`);
  await holder.query('commit');
}

// ── 3) 설치 · 재적용 · verify ────────────────────────────────────────────────
console.log('== 3) 설치 · 중복 설치 방지 · 재적용');
{
  const t = Date.now(); await admin.query(SPOT); const ms = Date.now() - t;
  check('설치 성공', true, `${ms}ms`);
  const before = await one(admin, `select count(*)::int as n from public.kdk_match_lifecycle`);
  await admin.query(SPOT);
  const trg = await one(admin, `select count(*)::int as n from pg_trigger where tgname like 'kdk_match_lifecycle%' and tgrelid = 'public.matches'::regclass`);
  const after = await one(admin, `select count(*)::int as n from public.kdk_match_lifecycle`);
  check('재적용 후에도 trigger 정확히 3개(중복 없음)', trg.n === 3, `trigger ${trg.n}`);
  check('재적용이 기존 증명서를 바꾸지 않음', before.n === after.n, `${before.n} → ${after.n}`);
  const rows = (await admin.query(VERIFY)).flatMap((x) => x.rows || []);
  const by = Object.fromEntries(rows.map((x) => [x.check, x]));
  for (const k of ['A1 tables', 'A2 triggers enabled', 'A3 RLS on', 'A4 no table privileges for anon/authenticated',
    'A5 write RPC only service_role', 'A6 read RPC grants', 'A7 non-waiting matches without left_waiting record',
    'A8 ledger faults', 'A9 matches without certificate row']) check(`verify ${k}`, by[k]?.ok === true, JSON.stringify(by[k]?.n ?? ''));
  note(`verify A11 matches 의 다른 사용자 trigger: ${by['A11 other user triggers on matches (info)']?.n}`);
}
const withTrg = await bulk('QA-PERF-B', 300);
note(`trigger 오버헤드 실측(300행): upsert ${base.ins}→${withTrg.ins}ms · 전체 update ${base.upd}→${withTrg.upd}ms`);

// ── 4) 기존 KDK · Special 경로 무회귀(trigger 존재) ──────────────────────────
console.log('== 4) KDK · Special 경로(trigger 존재)');
{
  const op = await connect('op'); await asOperator(op, CEO);
  const s1 = await startRpc(op, 'qa-kdk-1');
  check('KDK start_kdk_match 정상', s1.ok === true, JSON.stringify(s1));
  const tm = (await one(op, `select public.start_kdk_match_timer('qa-kdk-1', $1) as r`, [CLUB])).r;
  check('KDK start_kdk_match_timer 정상', tm.ok === true, JSON.stringify(tm));
  const done = await op.query(`update public.matches set status='complete', score1=6, score2=4 where id='qa-kdk-1' and status='playing' returning id`);
  check('KDK 완료(앱 경로) 정상', done.rowCount === 1);
  await revertApp(op, 'qa-kdk-1');
  check('KDK 완료→waiting 복원(앱 경로) 정상', (await one(op, `select status from public.matches where id='qa-kdk-1'`)).status === 'waiting');
  const conflict = await (async () => { await startRpc(op, 'qa-kdk-2'); return startRpc(op, 'qa-kdk-6'); })();
  check('KDK 코트 배정 RPC 연속 투입 정상', conflict.ok === true, JSON.stringify(conflict));
  // Special: sync_tournament_matches (anon 도 실행 가능한 기존 RPC) — 생성·시작·완료
  const sp = await connect('special'); await sp.query('set role anon');
  const spm = (status, s1v = 0, s2v = 0) => JSON.stringify([{ id: 'qa-sp-1', club_id: CLUB, session_id: 'SP-QA-20261103', session_title: 'QA 스페셜',
    round: 1, court: null, playerIds: ['qa-s1', 'qa-s11', 'qa-s21', 'qa-s31'], player_names: ['스페셜1', '스페셜11', '스페셜21', '스페셜31'],
    score1: s1v, score2: s2v, status, mode: 'SPECIAL' }]);
  for (const [st, a, b] of [['waiting'], ['playing'], ['complete', 6, 2]]) {
    const e = await timed(sp.query(`select public.sync_tournament_matches($1::jsonb)`, [spm(st, a, b)]));
    check(`Special sync_tournament_matches ${st} 정상`, !e.err, e.err?.message || '');
  }
  const spNew = JSON.stringify([{ id: 'qa-sp-new', club_id: CLUB, session_id: 'SP-QA-20261103', round: 9, court: null,
    playerIds: ['x1', 'x2', 'x3', 'x4'], player_names: ['a', 'b', 'c', 'd'], status: 'waiting', mode: 'SPECIAL' }]);
  check('Special 신규 경기 생성 정상', !(await timed(sp.query(`select public.sync_tournament_matches($1::jsonb)`, [spNew]))).err);
  const spLife = await one(admin, `select left_waiting_at is not null as l from public.kdk_match_lifecycle where match_id='qa-sp-1'`);
  check('Special 경기도 이탈 기록(예측 대상은 아님 · 기록만)', spLife.l === true);
  const del = await timed(op.query(`select public.delete_kdk_live_session('QA-PERF-A', $1)`, [CLUB]));
  check('KDK 세션 삭제 RPC 정상', !del.err, del.err?.message || '');
  const orphan = await one(admin, `select count(*)::int as n from public.kdk_match_lifecycle l where not exists (select 1 from public.matches m where m.id = l.match_id)`);
  note(`삭제된 경기의 증명서 잔존 ${orphan.n}건(경기 삭제 시 ledger 는 남음 — 정리 정책은 후속)`);
}

// ── 5) 동시성 시나리오(서로 다른 연결) ───────────────────────────────────────
const S = 'QA-KDK-CONC';
await insertMatches(admin, S, Array.from({ length: 12 }, (_, i) => `qa-c-${i + 1}`));
const opA = await connect('opA'); await asOperator(opA, CEO);
const opA2 = await connect('opA2'); await asOperator(opA2, ADMIN);
const svcB = await connect('svcB'); await asService(svcB);
const svcB2 = await connect('svcB2'); await asService(svcB2);
const activePred = async (id) => (await one(admin, `select count(*)::int as n from public.kdk_match_predictions where match_id=$1 and status='active'`, [id])).n;

console.log('== 5-1) 운영자 A 경기 시작(커밋 전) ↔ 운영자 B 예측 생성');
{
  await opA.query('begin');
  const st = await startRpc(opA, 'qa-c-1');
  const r = await timed(save(svcB, S, [predOf('qa-c-1', 1, players('qa-c-1')), predOf('qa-c-2', 2, players('qa-c-2'))]));
  check('A 시작 미커밋 중 B 생성 → B 가 양보(55P03, ≈0.8s)', r.err?.code === '55P03' && r.ms < 2500, `${r.err?.code} ${r.ms}ms`);
  await opA.query('commit');
  check('A 경기 시작은 정상 커밋', st.ok === true);
  const r2 = await save(svcB, S, [predOf('qa-c-1', 1, players('qa-c-1'))]);
  check('A 커밋 후 B 재시도 → not_waiting 거부', r2.ok === false && r2.rejected?.[0]?.reason === 'not_waiting', JSON.stringify(r2));
  check('시작된 경기 active 예측 0', (await activePred('qa-c-1')) === 0);
}

console.log('== 5-2) B 예측 저장(커밋 전) ↔ A 경기 시작');
{
  await svcB.query('begin');
  const r = await save(svcB, S, [predOf('qa-c-2', 2, players('qa-c-2'))]);
  const hold = 400;
  const st = timed(startRpc(opA, 'qa-c-3'));          // 같은 세션 다른 경기
  const st2 = timed(startRpc(opA2, 'qa-c-2'));        // 예측 저장 중인 바로 그 경기
  await sleep(hold);
  await svcB.query('commit');
  const [a, b] = await Promise.all([st, st2]);
  check('B 저장 성공', r.ok === true, JSON.stringify(r));
  check('A 같은 세션 경기 시작: B 커밋까지 대기 후 성공(실패 없음)', a.res?.ok === true && a.ms >= hold - 50, `${a.ms}ms ${JSON.stringify(a.res || a.err?.message)}`);
  check('A 저장 대상 경기 시작: 대기 후 성공', b.res?.ok === true, `${b.ms}ms`);
  check('시작 전에 저장된 qa-c-2 예측은 유효(시작 전 snapshot)', (await activePred('qa-c-2')) === 1);
  note(`예측 저장 트랜잭션이 열려 있는 동안 같은 세션 KDK 시작은 대기(실측 ${a.ms}ms, 보유 ${hold}ms) — 실제 route 는 단일 RPC 자동 커밋`);
  const t = Date.now();
  await save(svcB2, S, Array.from({ length: 8 }, (_, i) => predOf(`qa-c-${i + 4}`, i + 4, players(`qa-c-${i + 4}`))));
  note(`8경기 예측 저장 RPC 실측 ${Date.now() - t}ms(= 같은 세션 KDK 쓰기가 최대로 기다릴 수 있는 시간)`);
}

console.log('== 5-3) 예측 생성 중 선수 교체');
{
  await svcB.query('begin');
  const r = await save(svcB, S, [predOf('qa-c-4', 4, players('qa-c-4'))]);
  const swap = timed(opA.query(`update public.matches set player_ids = $1 where id = 'qa-c-4'`, [['qa-c-4-p1', 'qa-c-4-p2', 'qa-c-4-p3', 'SUB']]));
  await sleep(300);
  await svcB.query('commit');
  const sw = await swap;
  check('저장 중 선수 교체: 대기 후 교체 성공', r.ok === true && !sw.err, `${sw.ms}ms`);
  const old = await save(svcB, S, [predOf('qa-c-4', 4, players('qa-c-4'))]);
  check('교체 후 이전 선수로 재생성 → player_mismatch', old.ok === false && old.rejected?.[0]?.reason === 'player_mismatch', JSON.stringify(old));
  const neu = await save(svcB, S, [predOf('qa-c-4', 4, ['qa-c-4-p1', 'qa-c-4-p2', 'qa-c-4-p3', 'SUB'])]);
  check('교체 후 새 선수로 재생성 → 허용(시작 전 수정 체인 유지)', neu.ok === true, JSON.stringify(neu));

  await opA.query('begin');
  await opA.query(`update public.matches set player_ids = $1 where id = 'qa-c-5'`, [['SUB2', 'qa-c-5-p2', 'qa-c-5-p3', 'qa-c-5-p4']]);
  const r2 = await timed(save(svcB, S, [predOf('qa-c-5', 5, players('qa-c-5'))]));
  await opA.query('commit');
  check('교체 미커밋 중 생성 → 55P03 양보', r2.err?.code === '55P03', `${r2.err?.code} ${r2.ms}ms`);
  const r3 = await save(svcB, S, [predOf('qa-c-5', 5, players('qa-c-5'))]);
  check('교체 커밋 후 이전 선수 → player_mismatch', r3.ok === false && r3.rejected?.[0]?.reason === 'player_mismatch');
}

console.log('== 5-4) 두 운영자 동시 공개');
{
  const latest = await save(svcB, S, [predOf('qa-c-6', 6, players('qa-c-6'))]);
  const payload = JSON.stringify({ schema: 1, items: [], matches: [] });
  const pub = (c) => one(c, `select public.publish_kdk_spotlight_run($1, $2, $3::jsonb, '{}') as r`, [latest.run_id, CEO, payload]).then((x) => x.r);
  const [p1, p2] = await Promise.all([pub(svcB), pub(svcB2)]);
  const reasons = [p1.reason, p2.reason].sort();
  check('동시 공개 → 하나만 published, 다른 하나 already_published', JSON.stringify(reasons) === JSON.stringify(['already_published', 'published']), JSON.stringify(reasons));
  const cnt = await one(admin, `select count(*) filter (where status='published')::int as p, count(*) filter (where status='draft')::int as d from public.kdk_spotlight_runs where session_id=$1`, [S]);
  check('세션 published 1 · draft 0', cnt.p === 1 && cnt.d === 0, JSON.stringify(cnt));
  // 공개 중(커밋 전) ↔ 재생성
  const next = await save(svcB, S, [predOf('qa-c-7', 7, players('qa-c-7'))]);
  await svcB.query('begin');
  const pr = await pub(svcB).catch((e) => ({ reason: e.code }));
  const regen = timed(save(svcB2, S, [predOf('qa-c-8', 8, players('qa-c-8'))]));
  await sleep(300);
  await svcB.query('commit');
  const rg = await regen;
  const cnt2 = await one(admin, `select count(*) filter (where status='published')::int as p, count(*) filter (where status='draft')::int as d from public.kdk_spotlight_runs where session_id=$1`, [S]);
  check('공개 중 재생성: 대기 후 처리(or 55P03 양보), published ≤1 · draft ≤1', cnt2.p <= 1 && cnt2.d <= 1 && (rg.res?.ok === true || rg.err?.code === '55P03'), `${JSON.stringify(cnt2)} ${pr.reason} regen=${rg.res?.reason || rg.err?.code} ${rg.ms}ms next=${next.reason}`);
}

console.log('== 5-5) 동시 재생성 3건');
{
  const rs = await Promise.all([svcB, svcB2, admin].map(async (c, i) => {
    if (c === admin) { await asService(c); }
    const x = await timed(save(c, S, [predOf('qa-c-9', 9, players('qa-c-9')), predOf('qa-c-10', 10, players('qa-c-10'))]));
    if (c === admin) await asOwner(c);
    return x;
  }));
  const okN = rs.filter((x) => x.res?.ok).length;
  const yieldN = rs.filter((x) => x.err?.code === '55P03').length;
  check('동시 재생성: 성공 또는 55P03 양보만(다른 오류 없음)', okN + yieldN === 3 && okN >= 1, `ok ${okN} · 양보 ${yieldN}`);
  const inv = await one(admin, `select
    (select count(*) from public.kdk_spotlight_runs where session_id=$1 and status='draft')::int as drafts,
    (select count(*) from (select revision from public.kdk_spotlight_runs where session_id=$1 group by revision having count(*) > 1) d)::int as dup_rev,
    (select count(*) from (select match_id from public.kdk_match_predictions where session_id=$1 and status='active' group by match_id having count(*) > 1) a)::int as dup_active`, [S]);
  check('draft ≤1 · revision 중복 0 · 경기당 active ≤1', inv.drafts <= 1 && inv.dup_rev === 0 && inv.dup_active === 0, JSON.stringify(inv));
}

console.log('== 5-6) 시작 → waiting 복원 → 재생성 / 시작 취소(rollback) 경합');
{
  check('시작', (await startRpc(opA, 'qa-c-11')).ok === true);
  await revertApp(opA, 'qa-c-11');
  const r = await save(svcB, S, [predOf('qa-c-11', 11, players('qa-c-11'))]);
  check('시작 후 waiting 복원 경기 재생성 거부', r.ok === false && ['started_before', 'row_changed'].includes(r.rejected?.[0]?.reason), JSON.stringify(r));
  await opA.query('begin');
  const st = await startRpc(opA, 'qa-c-12');
  const w = await timed(save(svcB, S, [predOf('qa-c-12', 12, players('qa-c-12'))]));
  await opA.query('rollback');
  check('시작 미커밋 중 생성 → 55P03', w.err?.code === '55P03' && st.ok === true);
  const after = await save(svcB, S, [predOf('qa-c-12', 12, players('qa-c-12'))]);
  check('시작이 롤백되면(실제로 시작 안 됨) 생성 허용', after.ok === true, JSON.stringify(after));
}

console.log('== 5-7) 혼합 부하: KDK 시작·완료 × Special 동기화 × 반복 생성');
{
  const L = 'QA-KDK-LOAD';
  const ids = Array.from({ length: 16 }, (_, i) => `qa-l-${i + 1}`);
  await insertMatches(admin, L, ids);
  const kdkErrors = []; const startedAt = new Map(); const savedViolations = [];
  const opL = await connect('opL'); await asOperator(opL, CEO);
  const spL = await connect('spL'); await spL.query('set role anon');
  const svL = await connect('svL'); await asService(svL);
  const kdkWorker = (async () => {
    for (const id of ids) {
      try {
        const r = await startRpc(opL, id);
        if (!r.ok) kdkErrors.push(`${id} ${r.reason}`);
        startedAt.set(id, Date.now());
        await opL.query(`update public.matches set status='complete', score1=6, score2=3 where id=$1 and status='playing'`, [id]);
      } catch (e) { kdkErrors.push(`${id} ${e.code || e.message}`); }
      await sleep(15);
    }
  })();
  const spWorker = (async () => {
    for (let k = 0; k < 30; k++) {
      const st = ['waiting', 'playing', 'complete'][k % 3];
      try {
        await spL.query(`select public.sync_tournament_matches($1::jsonb)`, [JSON.stringify([{ id: 'qa-sp-2', club_id: CLUB, session_id: 'SP-QA-20261103', round: 2, court: null,
          playerIds: ['qa-s2', 'qa-s12', 'qa-s22', 'qa-s32'], player_names: ['a', 'b', 'c', 'd'], score1: 0, score2: 0, status: st, mode: 'SPECIAL' }])]);
      } catch (e) { kdkErrors.push(`special ${e.code || e.message}`); }
    }
  })();
  let saves = 0, yields = 0, rejects = 0;
  const genWorker = (async () => {
    for (let k = 0; k < 25; k++) {
      const began = Date.now();
      const cand = ids.filter((id) => !startedAt.has(id));
      if (!cand.length) break;
      const x = await timed(save(svL, L, cand.slice(0, 6).map((id, i) => predOf(id, i + 1, players(id))), 'qaslugload0001'));
      if (x.res?.ok) {
        saves += 1;
        for (const id of cand.slice(0, 6)) if (startedAt.has(id) && startedAt.get(id) < began) savedViolations.push(id);
      } else if (x.err?.code === '55P03') yields += 1; else rejects += 1;
    }
  })();
  await Promise.all([kdkWorker, spWorker, genWorker]);
  check('부하 중 KDK·Special 쓰기 오류 0', kdkErrors.length === 0, kdkErrors.slice(0, 3).join(' | '));
  check('시작이 커밋된 뒤 시작된 저장이 그 경기 예측을 성공시킨 사례 0', savedViolations.length === 0, savedViolations.join(','));
  note(`부하 중 생성 시도: 성공 ${saves} · 양보(55P03) ${yields} · 거부(stale) ${rejects}`);
  const inv = await one(admin, `select
    (select count(*) from public.matches m where m.status is distinct from 'waiting' and not exists
       (select 1 from public.kdk_match_lifecycle l where l.match_id = m.id and l.left_waiting_at is not null))::int as a7,
    (select count(*) from public.kdk_match_lifecycle_faults)::int as faults`);
  check('부하 후 A7(이탈 미기록) 0 · fault 0', inv.a7 === 0 && inv.faults === 0, JSON.stringify(inv));
}

console.log('== 5-8) P0: 이탈 기록 + fault 기록 동시 실패 → 실제 KDK RPC 로 시작 → waiting 복원 → 사후 예측');
{
  const P = 'QA-KDK-P0';
  await insertMatches(admin, P, ['qa-p0-1', 'qa-p0-2']);
  await admin.query(`alter table public.kdk_match_lifecycle add constraint qa_fail check (left_waiting_at is null or match_id <> 'qa-p0-1') not valid;
    alter table public.kdk_match_lifecycle_faults add constraint qa_fail_f check (match_id <> 'qa-p0-1') not valid`);
  const op = await connect('opP0'); await asOperator(op, CEO);
  const st = await startRpc(op, 'qa-p0-1');
  check('기록 이중 실패에도 KDK 시작 RPC 성공', st.ok === true, JSON.stringify(st));
  const miss = await one(admin, `select left_waiting_at is null as m from public.kdk_match_lifecycle where match_id='qa-p0-1'`);
  check('이탈 기록 누락 재현(조건 확인)', miss.m === true);
  await revertApp(op, 'qa-p0-1');
  await admin.query(`alter table public.kdk_match_lifecycle drop constraint qa_fail; alter table public.kdk_match_lifecycle_faults drop constraint qa_fail_f`);
  const r = await save(svcB, P, [predOf('qa-p0-1', 1, players('qa-p0-1'))], 'qaslugp0000001');
  check('waiting 복원 후 사후 예측 → row_changed 거부(실DB)', r.ok === false && r.rejected?.[0]?.reason === 'row_changed', JSON.stringify(r));
  await op.query(`update public.matches set player_ids = player_ids where id='qa-p0-1'`);
  const r2 = await save(svcB, P, [predOf('qa-p0-1', 1, players('qa-p0-1'))], 'qaslugp0000001');
  check('이후 waiting 수정으로도 체인 복구 안 됨', r2.ok === false && r2.rejected?.[0]?.reason === 'row_changed');
  const ok = await save(svcB, P, [predOf('qa-p0-2', 2, players('qa-p0-2'))], 'qaslugp0000001');
  check('같은 세션 정상 경기는 영향 없음', ok.ok === true, JSON.stringify(ok));
}

// ── 6) rollback(잠금 대기 3s 포기 → 재실행 성공) · rollback 후 KDK 정상 ─────
console.log('== 6) rollback');
{
  const holder = await connect('holder2'); const rb = await connect('rb');
  await holder.query('begin');
  await holder.query(`update public.matches set score1 = score1 where id = 'qa-kdk-8'`);
  const r = await timed(rb.query(ROLLBACK));
  await rb.query('rollback').catch(() => {});
  await holder.query('commit');
  check('진행 중 쓰기 있으면 rollback 도 3s 안에 포기(55P03)', r.err?.code === '55P03', `${r.err?.code} ${r.ms}ms`);
  check('포기한 rollback 은 아무것도 지우지 않음', (await one(admin, `select public.kdk_spotlight_ledger_healthy() as h`)).h === true);
  await admin.query(ROLLBACK);
  const left = await one(admin, `select
    (select count(*) from pg_trigger where tgname like 'kdk_match_lifecycle%')::int as trg,
    (select count(*) from pg_tables where tablename in ('kdk_match_lifecycle','kdk_match_lifecycle_faults','kdk_spotlight_runs','kdk_match_predictions'))::int as tbl,
    (select count(*) from pg_proc where proname like '%spotlight%' or proname like 'kdk_match_lifecycle%')::int as fn,
    (select count(*) from public.matches)::int as matches`);
  check('rollback: trigger·table·function 0, matches 보존', left.trg === 0 && left.tbl === 0 && left.fn === 0 && left.matches > 0, JSON.stringify(left));
  const op = await connect('op2'); await asOperator(op, CEO);
  check('rollback 후 KDK 시작 RPC 정상', (await startRpc(op, 'qa-kdk-5')).ok === true);
  await admin.query(SPOT);
  check('rollback 후 재설치 정상', (await one(admin, `select public.kdk_spotlight_ledger_healthy() as h`)).h === true);
}

for (const c of clients) await c.end().catch(() => {});
console.log(`\nMATCH SPOTLIGHT 실DB 동시성 시험: ${passed} passed / ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
