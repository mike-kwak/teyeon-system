/**
 * KDK FINAL REPORT V4.1 SQL 시험 — 격리된 PGlite 에서만 실행(운영 DB 미접속 · 가상 회원).
 *
 *   실행: PGLITE_MODULE=<@electric-sql/pglite dist/index.js 절대경로> node scripts/verify_final_report_v41_sql.mjs
 *   검증: 설치 · 재실행 · 기존 rev1 보존(복사만) · 재발행 이력 · insert-only · 직접 접근 차단 ·
 *        정산 열람 자격(profiles 단독 판정 금지 · 탈회 · 게스트 · 미연결 · 이메일 fallback) ·
 *        회원 정산 조회 · V4.1 발행(공개본 분리 · 스냅샷 검사 · 원자성) · 편집 맥락 · Archive 무변경 · rollback.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

process.on('uncaughtException', (e) => { console.log('UNCAUGHT', e?.code || '', String(e?.message || e).slice(0, 300)); process.exit(1); });
process.on('unhandledRejection', (e) => { console.log('UNHANDLED', e?.code || '', String(e?.message || e).slice(0, 300)); process.exit(1); });
const modPath = process.env.PGLITE_MODULE;
if (!modPath) { console.log('SKIP: PGLITE_MODULE 미지정'); process.exit(2); }
const { PGlite } = await import(pathToFileURL(modPath).href);
const here = dirname(fileURLToPath(import.meta.url));
const BASE = readFileSync(join(here, '../supabase/add_kdk_final_report.sql'), 'utf8');
const V41 = readFileSync(join(here, '../supabase/add_kdk_final_report_v41.sql'), 'utf8');
const V41_RB = readFileSync(join(here, '../supabase/add_kdk_final_report_v41_rollback.sql'), 'utf8');
const V41_VERIFY = readFileSync(join(here, '../supabase/add_kdk_final_report_v41_verify_READONLY.sql'), 'utf8');

let passed = 0; const failures = [];
const check = (name, cond, info = '') => { if (cond) passed += 1; else failures.push(`${name}${info ? ` — ${info}` : ''}`); };
const U = (n) => `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`; // auth uid

// 계정(가상): 역할 조합
const ACC = {
  CEO: A(1), ADMIN: A(2), FIN: A(3), OPERATOR: A(4), KDKM: A(5), MEMBER: A(6), ASSOC: A(7), EXEC: A(8),
  GUEST_PROFILE_MEMBER: A(9), WITHDRAWN: A(10), GUESTCLUB: A(11), UNLINKED: A(12), EMAIL_MEMBER: A(13),
  EMAIL_BUT_LINKED_GUEST: A(14), ADMIN_WITHDRAWN: A(15), KDKM_NOMEMBER: A(16), UNKNOWN_ROLE: A(17),
};

async function newDb({ withFinanceLink = true, withGuestTable = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema auth; grant usage on schema auth to anon, authenticated, service_role;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.profiles (id uuid primary key, role text, profile_visibility_level text default 'public');
    create table public.members (id uuid primary key, auth_user_id uuid, role text, email text, nickname text);
    create table public.kdk_managers (user_id uuid primary key);
    create table public.teyeon_archive_v1 (id text primary key, raw_data jsonb, created_at timestamptz default now(),
      is_official boolean not null default false, is_test boolean not null default false, confirmed_at timestamptz, confirmed_by text,
      profile_reflected boolean not null default false, archive_type text not null default 'kdk');
    revoke all on public.teyeon_archive_v1 from anon; grant select on public.teyeon_archive_v1 to authenticated;
    create function public.kdk_spotlight_is_admin(p_user uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
      select p_user is not null and (exists (select 1 from public.profiles p where p.id = p_user and upper(btrim(coalesce(p.role, ''))) in ('CEO', 'ADMIN'))
        or (exists (select 1 from public.kdk_managers k where k.user_id = p_user)
            and exists (select 1 from public.profiles p where p.id = p_user and upper(btrim(coalesce(p.role, ''))) in ('MEMBER', 'OPERATOR', 'FINANCE_MANAGER')))) $$;
    revoke all on function public.kdk_spotlight_is_admin(uuid) from public, anon, authenticated;
    create table public.finance_dues_receivables (id uuid primary key default gen_random_uuid(), member_id uuid not null, receivable_type text not null,
      amount_due integer not null, status text not null default 'pending' ${withFinanceLink ? ', related_kdk_session_id text' : ''});
    create table public.finance_dues_payments (id uuid primary key default gen_random_uuid(), member_id uuid, receivable_id uuid, amount integer not null,
      payment_type text, is_voided boolean not null default false);
    ${withGuestTable ? `create table public.kdk_guest_penalty_payments (id uuid primary key default gen_random_uuid(), session_id text not null, participant_id text not null,
      charge_type text not null default 'penalty', participant_name_snapshot text, amount integer not null, status text not null default 'paid',
      paid_at timestamptz, paid_by uuid, cancelled_at timestamptz, cancelled_by uuid, updated_at timestamptz default now());` : ''}
    create table public.club_schedules (id uuid primary key default gen_random_uuid(), title text, schedule_type text, schedule_date date, start_time time);
  `);
  const prof = [['CEO', 'CEO'], ['ADMIN', 'ADMIN'], ['FIN', 'FINANCE_MANAGER'], ['OPERATOR', 'OPERATOR'], ['KDKM', 'MEMBER'], ['MEMBER', 'MEMBER'],
    ['ASSOC', 'MEMBER'], ['EXEC', 'MEMBER'], ['GUEST_PROFILE_MEMBER', 'GUEST'], ['WITHDRAWN', 'MEMBER'], ['GUESTCLUB', 'GUEST'], ['UNLINKED', 'MEMBER'],
    ['EMAIL_MEMBER', 'MEMBER'], ['EMAIL_BUT_LINKED_GUEST', 'GUEST'], ['ADMIN_WITHDRAWN', 'ADMIN'], ['KDKM_NOMEMBER', 'OPERATOR'], ['UNKNOWN_ROLE', 'MEMBER']];
  for (const [k, role] of prof) await db.query(`insert into public.profiles (id, role) values ($1, $2)`, [ACC[k], role]);
  for (const k of Object.keys(ACC)) await db.query(`insert into auth.users (id, email) values ($1, $2)`, [ACC[k], `${k.toLowerCase()}@qa.test`]);
  await db.query(`insert into public.kdk_managers values ($1), ($2)`, [ACC.KDKM, ACC.KDKM_NOMEMBER]);
  // 클럽 회원 행(members.role 은 한글 · 쉼표 다중값)
  const mem = [[U(1), ACC.KDKM, '정회원, 경기'], [U(2), ACC.MEMBER, '정회원'], [U(3), ACC.ASSOC, '준회원'], [U(4), ACC.EXEC, '총무'],
    [U(5), ACC.GUEST_PROFILE_MEMBER, '정회원'], [U(7), ACC.WITHDRAWN, '정회원, 탈회'], [U(8), ACC.GUESTCLUB, '게스트'],
    [U(9), null, '정회원'], [U(10), ACC.EMAIL_BUT_LINKED_GUEST, '게스트'], [U(11), null, '정회원'], [U(12), ACC.ADMIN_WITHDRAWN, '탈회'],
    [U(13), ACC.UNKNOWN_ROLE, '메모'], [U(14), null, '정회원']];
  for (const [id, au, role] of mem) await db.query(`insert into public.members (id, auth_user_id, role, email) values ($1, $2, $3, null)`, [id, au, role]);
  await db.query(`update public.members set email = 'email_member@qa.test' where id = $1`, [U(9)]);           // 미연결 · 이메일 일치 → 허용
  await db.query(`update public.members set email = 'email_but_linked_guest@qa.test' where id = $1`, [U(11)]); // 연결 행(게스트)이 있으면 fallback 금지
  return db;
}

const q = async (db, sql, p) => (await db.query(sql, p)).rows;
const one = async (db, sql, p) => (await q(db, sql, p))[0];
const asRole = async (db, role, sub, fn) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${sub || ''}', false);`);
  try { return await fn(); } finally { await db.exec('reset role;'); }
};
const errOf = async (fn) => { try { await fn(); return null; } catch (e) { return String(e?.code || e?.message || e); } };

// ── 가상 공식 Archive(이번 세션 + 과거 세션 3개) ─────────────────────────────
const SID = 'KDK-20261124-QAV41';
const RAW = {
  title: '11월 4주 정모 KDK', date: '2026-11-24',
  ranking_data: [{ id: U(1), name: '가회원', wins: 3, losses: 0, diff: 9 }, { id: U(2), name: '나회원', wins: 2, losses: 1, diff: 3 },
    { id: 'manual-guest-x', name: '다게스트', wins: 1, losses: 2, diff: -4 }, { id: U(3), name: '라회원', wins: 0, losses: 3, diff: -8 }],
  snapshot_data: [{ id: 'm1', round: 1, court: 1, status: 'complete', player_ids: [U(1), U(2), 'manual-guest-x', U(3)], player_names: ['가회원', '나회원', '다게스트(G)', '라회원'], score1: 6, score2: 3 }],
  settlement_data: [
    { player_id: U(2), player_name: '나회원', is_guest: false, penalty_amount: -10000, final_amount: -10000 },
    { player_id: U(3), player_name: '라회원', is_guest: false, penalty_amount: -10000, final_amount: -10000 },
    { player_id: 'manual-guest-x', player_name: '다게스트', is_guest: true, penalty_amount: -5000, final_amount: -15000 },
    { player_id: U(4), player_name: '총무님', is_guest: false, penalty_amount: 0, final_amount: 0 },
  ],
};
const rawOld = (date, w1) => ({ title: `과거 ${date}`, date, ranking_data: [{ id: U(1), name: '가회원', wins: w1, losses: 1, diff: 1 }],
  snapshot_data: [{ id: `o-${date}`, round: 1, court: 1, status: 'complete', player_ids: [U(1), U(9), U(2), U(3)], player_names: ['가회원', 'x', '나회원', '라회원'], score1: 4, score2: 6 }], settlement_data: [] });
const LEGACY_SID = 'KDK-20261110-QALEG';

async function seed(db) {
  await db.query(`insert into public.teyeon_archive_v1 (id, raw_data, is_official, confirmed_at) values ($1, $2, true, now())`, [SID, JSON.stringify(RAW)]);
  await db.query(`insert into public.teyeon_archive_v1 (id, raw_data, is_official, confirmed_at) values ($1, $2, true, now())`, [LEGACY_SID, JSON.stringify({ ...RAW, title: '레거시', date: '2026-11-10' })]);
  for (const [i, d] of ['2026-10-01', '2026-10-15', '2026-11-01'].entries()) {
    await db.query(`insert into public.teyeon_archive_v1 (id, raw_data, is_official) values ($1, $2, true)`, [`KDK-OLD-${i}`, JSON.stringify(rawOld(d, i + 1))]);
  }
  await db.query(`insert into public.teyeon_archive_v1 (id, raw_data, is_official, is_test) values ('KDK-TESTX', $1, true, true)`, [JSON.stringify(rawOld('2026-11-02', 4))]);
  await db.query(`insert into public.club_schedules (title, schedule_type, schedule_date, start_time) values
    ('번개', '번개', '2026-11-26', '19:00'), ('12월 정모', '정모', '2026-12-01', '08:00'), ('이전 정모', '정모', '2026-11-20', '08:00')`);
}

const payloadV1 = (title = '11월 4주 정모 KDK') => ({ schema: '1', session: { title, date: '2026-11-24', participantCount: 4, matchCount: 1, officialConfirmed: true },
  opening: null, closing: null, podium: [{ rank: 1, name: '가회원', wins: 3, losses: 0, diff: 9, group: '', guest: false, story: null }], featured: [], standings: [] });
const payloadV3 = () => ({ ...payloadV1(), edition: 3, v41: { vol: 7, heroes: [], numbers: [] } });
const settlementLive = () => ({ schema: '1', mode: 'live', rows: [
  { name: '나회원', guest: false, status: 'PAID', charged: 10000, paid: 10000, note: null },
  { name: '라회원', guest: false, status: 'UNPAID', charged: 10000, paid: 6000, note: 'partial' },
  { name: '다게스트(G)', guest: true, status: 'PENDING', charged: 5000, paid: 0, note: 'awaiting_review' }],
  totals: { charged: 25000, paid: 16000, unpaid: 4000, pending: 5000 }, counts: { targets: 3, paid: 1, unpaid: 1, pending: 1, review: 0 }, reviewCount: 0 });

async function publishV1(db, sid, actor = ACC.CEO) {
  const sig = (await one(db, `select public.kdk_final_report_signature(raw_data) as s from public.teyeon_archive_v1 where id = $1`, [sid])).s;
  const cur = await one(db, `select revision from public.kdk_final_reports where session_id = $1`, [sid]);
  return asRole(db, 'service_role', null, async () => {
    if (!cur) await one(db, `select public.save_kdk_final_report_draft('club', $1, $2, '{}'::jsonb, $3, null) as r`, [sid, actor, `slug${sid.toLowerCase().replace(/[^a-z0-9]/g, '')}`.slice(0, 30)]);
    const rev = cur ? cur.revision : 0;
    return (await one(db, `select public.publish_kdk_final_report($1, $2, $3::jsonb, $4, $5) as r`, [sid, actor, JSON.stringify(payloadV1()), sig, rev])).r;
  });
}
async function publishV41(db, sid, { payload = payloadV3(), settlement = settlementLive(), actor = ACC.CEO, sig = null, rev = null } = {}) {
  const s = sig ?? (await one(db, `select public.kdk_final_report_signature(raw_data) as s from public.teyeon_archive_v1 where id = $1`, [sid])).s;
  const cur = await one(db, `select revision from public.kdk_final_reports where session_id = $1`, [sid]);
  return asRole(db, 'service_role', null, async () => {
    if (!cur) await one(db, `select public.save_kdk_final_report_draft('club', $1, $2, '{}'::jsonb, $3, null) as r`, [sid, actor, `slug${sid.toLowerCase().replace(/[^a-z0-9]/g, '')}`.slice(0, 30)]);
    return (await one(db, `select public.publish_kdk_final_report_v41($1, $2, $3::jsonb, $4, $5, $6::jsonb) as r`,
      [sid, actor, JSON.stringify(payload), s, rev ?? (cur ? cur.revision : 0), JSON.stringify(settlement)])).r;
  });
}
const slugOf = async (db, sid) => (await one(db, `select public_slug from public.kdk_final_reports where session_id = $1`, [sid]))?.public_slug;
const readSettlement = (db, uid, slug) => asRole(db, uid === null ? 'anon' : 'authenticated', uid, async () => (await one(db, `select public.get_kdk_final_report_settlement($1) as r`, [slug])).r);

// ════════════════════════════════════════════════════════════════════════════
// 1) 기존 발행본(rev1)이 있는 상태에서 설치 → 복사만, 원본 무변경
{
  const db = await newDb(); await db.exec(BASE); await seed(db);
  const r1 = await publishV1(db, LEGACY_SID);
  check('사전: 기존 방식 rev1 발행', r1?.ok === true && r1.revision === 1, JSON.stringify(r1));
  const before = await one(db, `select id, revision, public_payload::text p, published_at::text pa, updated_at::text ua, status from public.kdk_final_reports where session_id = $1`, [LEGACY_SID]);
  const archBefore = await q(db, `select id, raw_data::text r from public.teyeon_archive_v1 order by id`);
  check('설치', (await errOf(() => db.exec(V41))) === null);
  check('재실행 안전', (await errOf(() => db.exec(V41))) === null);
  const after = await one(db, `select id, revision, public_payload::text p, published_at::text pa, updated_at::text ua, status from public.kdk_final_reports where session_id = $1`, [LEGACY_SID]);
  check('기존 rev1 행 무변경(내용 · 시각 · 상태)', JSON.stringify(before) === JSON.stringify(after));
  const rv = await q(db, `select revision, edition, public_payload::text p from public.kdk_final_report_revisions where report_id = $1`, [before.id]);
  check('기존 rev1 → 이력에 1건 복사(edition 1)', rv.length === 1 && rv[0].revision === 1 && rv[0].edition === 1 && rv[0].p === before.p);
  // 재발행(기존 함수) → rev2 이력, rev1 그대로
  const r2 = await publishV1(db, LEGACY_SID);
  const rv2 = await q(db, `select revision, public_payload::text p from public.kdk_final_report_revisions where report_id = $1 order by revision`, [before.id]);
  check('기존 발행 함수 재발행 → rev2 이력 · rev1 보존', r2?.ok === true && rv2.length === 2 && rv2[0].p === before.p && rv2[1].revision === 2);
  // 비공개 → 이력 변화 없음
  await asRole(db, 'service_role', null, () => one(db, `select public.unpublish_kdk_final_report($1, $2) as r`, [LEGACY_SID, ACC.CEO]));
  check('비공개 전환은 이력을 늘리지 않음', (await one(db, `select count(*)::int n from public.kdk_final_report_revisions`)).n === 2);
  // insert-only
  for (const [label, sql] of [['update', `update public.kdk_final_report_revisions set edition = 9`], ['delete', `delete from public.kdk_final_report_revisions`], ['truncate', `truncate public.kdk_final_report_revisions`]]) {
    check(`이력 ${label} 차단(service_role)`, (await asRole(db, 'service_role', null, () => errOf(() => db.exec(sql)))) === '42501');
    check(`이력 ${label} 차단(소유자)`, (await errOf(() => db.exec(sql))) === '42501');
  }
  // 직접 접근 차단
  for (const t of ['kdk_final_report_revisions', 'kdk_final_report_settlements', 'kdk_settlement_reviews']) {
    for (const [role, sub] of [['anon', null], ['authenticated', ACC.MEMBER], ['authenticated', ACC.CEO]]) {
      check(`${t} 직접 SELECT 차단(${role}${sub === ACC.CEO ? ' CEO' : ''})`, (await asRole(db, role, sub, () => errOf(() => q(db, `select * from public.${t}`)))) === '42501');
    }
    check(`${t} 직접 INSERT 차단(authenticated)`, (await asRole(db, 'authenticated', ACC.FIN, () => errOf(() => db.exec(`insert into public.${t} default values`)))) === '42501');
  }
  const archAfter = await q(db, `select id, raw_data::text r from public.teyeon_archive_v1 order by id`);
  check('Archive 무변경', JSON.stringify(archBefore) === JSON.stringify(archAfter));
  // 적용 후 확인 SQL
  const vr = await q(db, V41_VERIFY);
  const bad = vr.filter((r) => /^V0[1-9]$|^V13$/.test(r.check_id) && r.result !== 'OK');
  check('verify_READONLY 전 항목 OK', bad.length === 0, JSON.stringify(bad));
}

// 2) 열람 자격 — profiles 단독 판정 금지 · 탈회 · 게스트 · 미연결 · 이메일 fallback
{
  const db = await newDb(); await db.exec(BASE); await db.exec(V41);
  const can = async (uid) => (await one(db, `select public.kdk_can_view_settlement($1::uuid) as v`, [uid])).v;
  const expect = { CEO: true, ADMIN: true, FIN: true, OPERATOR: false, KDKM: true, MEMBER: true, ASSOC: true, EXEC: true,
    GUEST_PROFILE_MEMBER: true, WITHDRAWN: false, GUESTCLUB: false, UNLINKED: false, EMAIL_MEMBER: true, EMAIL_BUT_LINKED_GUEST: false,
    ADMIN_WITHDRAWN: false, KDKM_NOMEMBER: false, UNKNOWN_ROLE: false };
  for (const [k, v] of Object.entries(expect)) check(`열람 자격 ${k} = ${v}`, (await can(ACC[k])) === v);
  check('열람 자격 null = false', (await can(null)) === false);
  check('kdk_can_view_settlement: anon 실행 불가', (await asRole(db, 'anon', null, () => errOf(() => one(db, `select public.kdk_can_view_settlement($1::uuid)`, [ACC.CEO])))) === '42501');
  check('kdk_can_view_settlement: authenticated 실행 불가', (await asRole(db, 'authenticated', ACC.MEMBER, () => errOf(() => one(db, `select public.kdk_can_view_settlement($1::uuid)`, [ACC.CEO])))) === '42501');
}

// 3) V4.1 발행 · 회원 정산 조회
{
  const db = await newDb(); await db.exec(BASE); await db.exec(V41); await seed(db);
  // 발행 권한 · 형식 · 분리
  check('V4.1 발행: authenticated 실행 불가', (await asRole(db, 'authenticated', ACC.CEO, () => errOf(() => one(db, `select public.publish_kdk_final_report_v41('x', $1::uuid, '{}'::jsonb, '', 0, '{}'::jsonb)`, [ACC.CEO])))) === '42501');
  check('V4.1 발행: anon 실행 불가', (await asRole(db, 'anon', null, () => errOf(() => one(db, `select public.publish_kdk_final_report_v41('x', $1::uuid, '{}'::jsonb, '', 0, '{}'::jsonb)`, [ACC.CEO])))) === '42501');
  check('V4.1 발행: 권한 없는 actor → forbidden', (await publishV41(db, SID, { actor: ACC.MEMBER }))?.reason === 'forbidden');
  check('V4.1 발행: edition ≠ 3 → invalid_payload', (await publishV41(db, SID, { payload: payloadV1() }))?.reason === 'invalid_payload');
  for (const word of ['벌금', 'penalty', '정산', '계좌', 'amount', '미납']) {
    const p = payloadV3(); p.closing = `오늘 ${word} 안내`;
    check(`V4.1 발행: 공개본에 '${word}' → payload_leak`, (await publishV41(db, SID, { payload: p }))?.reason === 'payload_leak');
  }
  const bads = [
    ['totals 불일치', (s) => { s.totals.paid = 1; }],
    ['PAID 인데 일부만 납부', (s) => { s.rows[0].paid = 5000; s.totals.paid = 11000; s.totals.unpaid = 9000; }],
    ['PENDING 에 납부액', (s) => { s.rows[2].paid = 100; }],
    ['상태 값 오류', (s) => { s.rows[0].status = 'DONE'; }],
    ['legacy 모드에 개인 행', (s) => { s.mode = 'legacy_closed'; }],
    ['금액 음수', (s) => { s.rows[0].charged = -1; }],
    ['이름 누락', (s) => { delete s.rows[0].name; }],
    ['guest 누락', (s) => { delete s.rows[0].guest; }],
  ];
  for (const [label, mut] of bads) { const s = settlementLive(); mut(s); check(`V4.1 발행: 스냅샷 ${label} → invalid_settlement`, (await publishV41(db, SID, { settlement: s }))?.reason === 'invalid_settlement'); }
  for (const [label, mut] of [['회원 uuid', (s) => { s.rows[0].name = U(2).slice(0, 36); }], ['manual-guest', (s) => { s.rows[2].name = 'manual-guest-x'; }],
    ['이메일', (s) => { s.rows[0].name = 'a@b.co'; }], ['세션 id', (s) => { s.rows[0].name = SID; }]]) {
    const s = settlementLive(); mut(s);
    check(`V4.1 발행: 스냅샷에 ${label} → settlement_leak`, (await publishV41(db, SID, { settlement: s }))?.reason === 'settlement_leak');
  }
  check('실패한 발행은 흔적 없음(보고서 행 draft · 스냅샷 0 · 이력 0)', (await one(db, `select (select status from public.kdk_final_reports where session_id = $1) s,
    (select count(*)::int from public.kdk_final_report_settlements) n, (select count(*)::int from public.kdk_final_report_revisions) v`, [SID])).s === 'draft'
    && (await one(db, `select count(*)::int n from public.kdk_final_report_settlements`)).n === 0);
  // 원자성: 기존 발행 검사(stale 지문) 실패 → 스냅샷 없음
  check('V4.1 발행: 지문 불일치 → stale · 스냅샷 없음', (await publishV41(db, SID, { sig: 'v1:00000000000000000000000000000000' }))?.reason === 'stale'
    && (await one(db, `select count(*)::int n from public.kdk_final_report_settlements`)).n === 0);
  check('V4.1 발행: revision 충돌 → 스냅샷 없음', (await publishV41(db, SID, { rev: 5 }))?.reason === 'revision_conflict'
    && (await one(db, `select count(*)::int n from public.kdk_final_report_settlements`)).n === 0);
  const ok1 = await publishV41(db, SID);
  check('V4.1 발행 성공 · rev1', ok1?.ok === true && ok1.revision === 1 && ok1.settlementMode === 'live', JSON.stringify(ok1));
  const slug = await slugOf(db, SID);
  const rep = await one(db, `select id, revision, public_payload from public.kdk_final_reports where session_id = $1`, [SID]);
  check('공개본에 정산 없음(공개 RPC 응답)', !/penalt|settle|벌금|정산|charged|unpaid|paid|계좌/i.test(JSON.stringify((await asRole(db, 'anon', null, () => one(db, `select public.get_public_kdk_final_report($1) as r`, [slug]))).r)));
  check('스냅샷 = 판 번호 1', (await one(db, `select revision from public.kdk_final_report_settlements where report_id = $1`, [rep.id])).revision === 1);
  check('이력 edition 3', (await one(db, `select edition from public.kdk_final_report_revisions where report_id = $1 and revision = 1`, [rep.id])).edition === 3);
  // 조회 자격별
  check('조회: anon 실행 불가', (await asRole(db, 'anon', null, () => errOf(() => one(db, `select public.get_kdk_final_report_settlement($1)`, [slug])))) === '42501');
  check('조회: 로그인 없음(authenticated, sub 없음) → login_required', (await readSettlement(db, '', slug))?.reason === 'login_required');
  for (const k of ['OPERATOR', 'WITHDRAWN', 'GUESTCLUB', 'UNLINKED', 'KDKM_NOMEMBER', 'ADMIN_WITHDRAWN', 'UNKNOWN_ROLE', 'EMAIL_BUT_LINKED_GUEST']) {
    const r = await readSettlement(db, ACC[k], slug);
    check(`조회: ${k} → forbidden · 데이터 없음`, r?.ok === false && r.reason === 'forbidden' && !('snapshot' in r));
  }
  check('조회: 비허용자는 없는 slug 에도 같은 forbidden(존재 노출 없음)', (await readSettlement(db, ACC.GUESTCLUB, 'zzzzzzzzzzzzzzzz'))?.reason === 'forbidden');
  for (const k of ['MEMBER', 'ASSOC', 'EXEC', 'GUEST_PROFILE_MEMBER', 'EMAIL_MEMBER', 'CEO', 'FIN', 'ADMIN']) {
    const r = await readSettlement(db, ACC[k], slug);
    check(`조회: ${k} → 전체 스냅샷(읽기 전용)`, r?.ok === true && r.snapshot?.rows?.length === 3 && r.revision === 1);
  }
  // 회원이 스냅샷을 고칠 수 없음
  check('회원: 스냅샷 쓰기 불가', (await asRole(db, 'authenticated', ACC.MEMBER, () => errOf(() => db.exec(`update public.kdk_final_report_settlements set mode = 'none'`)))) === '42501');
  check('소유자도 스냅샷 수정 불가(insert-only)', (await errOf(() => db.exec(`update public.kdk_final_report_settlements set mode = 'none'`))) === '42501');
  // 발행 후 Finance 가 바뀌어도 스냅샷 그대로
  await db.query(`insert into public.finance_dues_receivables (member_id, receivable_type, amount_due, related_kdk_session_id) values ($1, 'penalty', 10000, $2)`, [U(3), SID]);
  const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
  check('Finance 변경 후에도 발행 스냅샷 그대로', JSON.stringify(canon((await readSettlement(db, ACC.MEMBER, slug)).snapshot)) === JSON.stringify(canon(settlementLive())));
  // 재발행(V4.1) → rev2 스냅샷, rev1 스냅샷 · 이력 보존, 조회는 최신 판
  const s2 = settlementLive(); s2.rows[2] = { ...s2.rows[2], status: 'PAID', paid: 5000, note: null }; s2.totals = { charged: 25000, paid: 21000, unpaid: 4000, pending: 0 };
  const ok2 = await publishV41(db, SID, { settlement: s2 });
  check('V4.1 재발행 rev2', ok2?.ok === true && ok2.revision === 2);
  check('rev1 스냅샷 · 이력 보존', (await one(db, `select count(*)::int n from public.kdk_final_report_settlements where report_id = $1`, [rep.id])).n === 2
    && (await one(db, `select count(*)::int n from public.kdk_final_report_revisions where report_id = $1`, [rep.id])).n === 2);
  check('조회는 현재 판(rev2)', (await readSettlement(db, ACC.MEMBER, slug))?.revision === 2);
  // 기록 정정(지문 불일치) → not_available
  const raw2 = JSON.parse(JSON.stringify(RAW)); raw2.snapshot_data[0].score2 = 4;
  await db.query(`update public.teyeon_archive_v1 set raw_data = $2 where id = $1`, [SID, JSON.stringify(raw2)]);
  check('정정된 기록 → 회원 조회 not_available', (await readSettlement(db, ACC.MEMBER, slug))?.reason === 'not_available');
  await db.query(`update public.teyeon_archive_v1 set raw_data = $2 where id = $1`, [SID, JSON.stringify(RAW)]);
  // 기존 방식(v1) 발행본 → 스냅샷 없음 → not_available
  await publishV1(db, LEGACY_SID);
  check('v1 발행본 → 회원 조회 not_available', (await readSettlement(db, ACC.MEMBER, await slugOf(db, LEGACY_SID)))?.reason === 'not_available');
  // 비공개 → not_available
  await asRole(db, 'service_role', null, () => one(db, `select public.unpublish_kdk_final_report($1, $2) as r`, [SID, ACC.CEO]));
  check('비공개 리포트 → not_available', (await readSettlement(db, ACC.MEMBER, slug))?.reason === 'not_available');
}

// 4) 편집 맥락(서버 전용)
{
  const db = await newDb(); await db.exec(BASE); await db.exec(V41); await seed(db);
  const ctx = (actor, sid = SID) => asRole(db, 'service_role', null, async () => (await one(db, `select public.get_kdk_final_report_v41_context($1, $2) as r`, [sid, actor])).r);
  check('맥락: 권한 없는 actor → forbidden', (await ctx(ACC.MEMBER))?.reason === 'forbidden');
  check('맥락: authenticated 실행 불가', (await asRole(db, 'authenticated', ACC.CEO, () => errOf(() => one(db, `select public.get_kdk_final_report_v41_context($1, $2::uuid)`, [SID, ACC.CEO])))) === '42501');
  check('맥락: 시험 세션 → not_official', (await ctx(ACC.CEO, 'KDK-TESTX'))?.reason === 'not_official');
  // Finance · 게스트 기록
  const recv = (await one(db, `insert into public.finance_dues_receivables (member_id, receivable_type, amount_due, related_kdk_session_id) values ($1, 'penalty', 10000, $2) returning id`, [U(2), SID])).id;
  await db.query(`insert into public.finance_dues_payments (receivable_id, amount, is_voided) values ($1, 6000, false), ($1, 4000, true)`, [recv]);
  await db.query(`insert into public.finance_dues_receivables (member_id, receivable_type, amount_due, related_kdk_session_id) values ($1, 'monthly_fee', 30000, $2)`, [U(2), SID]);
  await db.query(`insert into public.kdk_guest_penalty_payments (session_id, participant_id, amount, status, paid_at) values ($1, 'manual-guest-x', 5000, 'paid', now())`, [SID]);
  await db.query(`insert into public.kdk_settlement_reviews (session_id, participant_id, decision, basis, official_amount, reviewed_by) values ($1, 'manual-guest-x', 'unpaid_confirmed', 'bank_check', 5000, $2)`, [SID, ACC.FIN]);
  const c = await ctx(ACC.CEO);
  check('맥락 ok', c?.ok === true, JSON.stringify(c)?.slice(0, 200));
  check('맥락: 공식 세션 이력(시험 제외 · self 표시)', c.history.length === 5 && c.history.filter((h) => h.self).length === 1);
  check('맥락: 다음 정모 = 리포트 날짜 이후 가장 가까운 정모', c.next?.date === '2026-12-01' && c.next?.startTime === '08:00');
  check('맥락: 정산 항목 원형 4개', c.settlement.items.length === 4 && c.settlement.hasData === true);
  check('맥락: 존재하는 회원 id 만', c.settlement.memberIds.length === 3);
  check('맥락: 벌금 청구만 · 무효 납부 제외', c.settlement.receivables.length === 1 && Number(c.settlement.receivables[0].paid) === 6000);
  check('맥락: 게스트 납부 · 확인 기록', c.settlement.guestTableAvailable && c.settlement.guestPayments.length === 1 && c.settlement.reviews.length === 1);
  check('확인 기록: insert-only', (await errOf(() => db.exec(`update public.kdk_settlement_reviews set decision = 'withdrawn'`))) === '42501');
  // 정모 일정이 없으면 null
  await db.exec(`delete from public.club_schedules where schedule_type = '정모'`);
  check('맥락: 다음 정모 없음 → null', (await ctx(ACC.CEO)).next === null);
  // 현재 발행본 판형: 발행 전 null · V4.1 발행 후 3 · 기존 방식 발행본 1
  check('맥락: 발행 전 currentEdition = null', (await ctx(ACC.CEO)).currentEdition === null);
  await publishV41(db, SID);
  check('맥락: V4.1 발행 후 currentEdition = 3', (await ctx(ACC.CEO)).currentEdition === 3);
  await publishV1(db, LEGACY_SID);
  check('맥락: 기존 방식 발행본 currentEdition = 1', (await ctx(ACC.CEO, LEGACY_SID)).currentEdition === 1);
}

// 4b) 정산 공개 기준일(운영 설정) · 미설정 모드 · 다음 정모 신뢰도
{
  const db = await newDb(); await db.exec(BASE); await db.exec(V41); await seed(db);
  const ctx = (actor, sid = SID) => asRole(db, 'service_role', null, async () => (await one(db, `select public.get_kdk_final_report_v41_context($1, $2) as r`, [sid, actor])).r);
  const c0 = await ctx(ACC.CEO);
  check('기준일 미설정 → settlementLiveFrom null', c0.settlementLiveFrom === null);
  check('다음 정모 신뢰도: 확정 · 취소 상태 없음 → nextReliable false', c0.nextReliable === false && !!c0.next);
  for (const [role, sub] of [['anon', null], ['authenticated', ACC.CEO]]) {
    check(`설정 표 직접 조회 차단(${role})`, (await asRole(db, role, sub, () => errOf(() => q(db, `select * from public.kdk_final_report_settings`)))) === '42501');
    check(`설정 표 직접 쓰기 차단(${role})`, (await asRole(db, role, sub, () => errOf(() => db.exec(`insert into public.kdk_final_report_settings (key, value_date) values ('settlement_live_from', '2000-01-01')`)))) === '42501');
  }
  check('설정 키는 정해진 값만', (await errOf(() => db.exec(`insert into public.kdk_final_report_settings (key, value_date) values ('other', '2000-01-01')`))) === '23514');
  await db.exec(`insert into public.kdk_final_report_settings (key, value_date, note, updated_by) values ('settlement_live_from', '2026-11-11', 'QA', 'test')`);
  check('기준일 설정 후 맥락에 반영', (await ctx(ACC.CEO)).settlementLiveFrom === '2026-11-11');
  const un = { schema: '1', mode: 'unconfigured', rows: [], totals: { charged: 0, paid: 0, unpaid: 0, pending: 0 }, counts: { targets: 0, paid: 0, unpaid: 0, pending: 0, review: 0 }, excluded: 0 };
  const unRows = { ...un, rows: [{ name: '나회원', guest: false, status: 'PAID', charged: 1, paid: 1, note: null }], totals: { charged: 1, paid: 1, unpaid: 0, pending: 0 } };
  check('미설정 모드 스냅샷에 개인 행 → invalid_settlement', (await publishV41(db, SID, { settlement: unRows }))?.reason === 'invalid_settlement');
  const okU = await publishV41(db, SID, { settlement: un });
  check('미설정 모드 스냅샷 발행 · 회원 조회', okU?.ok === true && (await readSettlement(db, ACC.MEMBER, await slugOf(db, SID)))?.snapshot?.mode === 'unconfigured');
  check('rollback: 설정 값이 있으면 설정 표 보존', (await errOf(() => db.exec(V41_RB))) === null && !!(await one(db, `select to_regclass('public.kdk_final_report_settings') t`)).t);
  check('재설치 후에도 기준일 유지', (await errOf(() => db.exec(V41))) === null && (await ctx(ACC.CEO)).settlementLiveFrom === '2026-11-11');
}
{
  const db = await newDb(); await db.exec(BASE); await db.exec(V41);
  check('rollback: 설정이 비어 있으면 설정 표 제거', (await errOf(() => db.exec(V41_RB))) === null && !(await one(db, `select to_regclass('public.kdk_final_report_settings') t`)).t);
}

// 5) Finance 연결 컬럼 · 게스트 표가 없는 환경에서도 동작
{
  const db = await newDb({ withFinanceLink: false, withGuestTable: false }); await db.exec(BASE); await db.exec(V41); await seed(db);
  const c = await asRole(db, 'service_role', null, async () => (await one(db, `select public.get_kdk_final_report_v41_context($1, $2) as r`, [SID, ACC.CEO])).r);
  check('컬럼 · 표 없음: 맥락 ok · 연결 불가 표시', c?.ok === true && c.settlement.financeLinkAvailable === false && c.settlement.guestTableAvailable === false && c.settlement.receivables.length === 0);
}

// 6) rollback — (a) V4.1 발행 전: 표까지 제거 (b) 발행 후: 데이터 표 보존
{
  const db = await newDb(); await db.exec(BASE); await seed(db); await publishV1(db, LEGACY_SID); await db.exec(V41);
  check('rollback(발행 전) 실행', (await errOf(() => db.exec(V41_RB))) === null);
  check('rollback(발행 전): 새 표 · 함수 · 트리거 제거',
    !(await one(db, `select to_regclass('public.kdk_final_report_revisions') t`)).t && !(await one(db, `select to_regclass('public.kdk_final_report_settlements') t`)).t
    && !(await one(db, `select to_regprocedure('public.get_kdk_final_report_settlement(text)') f`)).f);
  const legacySlug = await slugOf(db, LEGACY_SID);
  check('rollback 후 기존 발행 · 공개 조회 정상', (await publishV1(db, LEGACY_SID))?.ok === true
    && (await asRole(db, 'anon', null, async () => (await one(db, `select public.get_public_kdk_final_report($1) as r`, [legacySlug])).r))?.state === 'ok');
  check('rollback 후 재설치', (await errOf(() => db.exec(V41))) === null);
}
{
  const db = await newDb(); await db.exec(BASE); await db.exec(V41); await seed(db);
  await publishV41(db, SID);
  check('rollback(발행 후) 실행', (await errOf(() => db.exec(V41_RB))) === null);
  check('rollback(발행 후): 스냅샷 · 이력 표 보존 · 조회 함수 제거',
    !!(await one(db, `select to_regclass('public.kdk_final_report_settlements') t`)).t && !!(await one(db, `select to_regclass('public.kdk_final_report_revisions') t`)).t
    && (await one(db, `select count(*)::int n from public.kdk_final_report_settlements`)).n === 1
    && !(await one(db, `select to_regprocedure('public.get_kdk_final_report_settlement(text)') f`)).f);
  check('rollback(발행 후): 보존 표는 여전히 insert-only', (await errOf(() => db.exec(`delete from public.kdk_final_report_settlements`))) === '42501');
  check('rollback 후 재설치(데이터 유지)', (await errOf(() => db.exec(V41))) === null && (await one(db, `select count(*)::int n from public.kdk_final_report_settlements`)).n === 1);
}

console.log(`KDK FINAL REPORT V4.1 SQL fixture: ${passed} passed / ${failures.length} failed`);
for (const f of failures) console.log('  FAIL', f);
process.exit(failures.length ? 1 : 0);
