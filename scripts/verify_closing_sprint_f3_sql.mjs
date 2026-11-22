/**
 * [CLOSING SPRINT F3] 과거 벌금 정합성 READ-ONLY SQL 시험 — 격리된 PGlite 메모리 DB · 가상 데이터. 운영 DB 미접속.
 *   실행: PGLITE_MODULE=<@electric-sql/pglite dist/index.js 절대경로> node scripts/verify_closing_sprint_f3_sql.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modPath = process.env.PGLITE_MODULE;
if (!modPath) { console.error('PGLITE_MODULE 환경변수가 필요합니다.'); process.exit(2); }
const { PGlite } = await import(pathToFileURL(modPath).href);
const SQL = fs.readFileSync(path.join(ROOT, 'supabase/closing_sprint/F3_penalty_status_consistency_READONLY.sql'), 'utf8');

let passed = 0; const failures = [];
const check = (name, cond, info = '') => { if (cond) passed += 1; else failures.push(`${name}${info ? ` — ${info}` : ''}`); };
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const db = new PGlite();
await db.exec(`
  create table public.teyeon_archive_v1 (id text primary key, raw_data jsonb, is_official boolean, is_test boolean, created_at timestamptz default now());
  create table public.finance_dues_receivables (id uuid primary key, member_id uuid, receivable_type text, amount_due numeric, status text, related_kdk_session_id text);
  create table public.finance_dues_payments (id uuid primary key, receivable_id uuid, amount numeric, is_voided boolean);
  create table public.kdk_guest_penalty_payments (session_id text, participant_id text, amount numeric, status text, charge_type text);
`);
const settle = (guests) => JSON.stringify({ date: '2026-10-20', settlement_data: guests.map(([pid, amt]) => ({ player_id: pid, is_guest: true, penalty_amount: -amt })) });
await db.query('insert into public.teyeon_archive_v1 values ($1, $2, true, false)', ['S1', settle([['manual-guest-aaa', 4000], ['manual-guest-bbb', 3000]])]);
await db.query('insert into public.teyeon_archive_v1 values ($1, $2, true, true)', ['S_TEST', settle([['manual-guest-ttt', 5000]])]); // 테스트 세션 제외
const R = async (id, mem, amt, status, sid = 'S1') => db.query('insert into public.finance_dues_receivables values ($1,$2,\'penalty\',$3,$4,$5)', [U(id), U(mem), amt, status, sid]);
const P = async (id, rid, amt, voided = false) => db.query('insert into public.finance_dues_payments values ($1,$2,$3,$4)', [U(id), U(rid), amt, voided]);
await R(1, 101, 3000, 'pending'); await P(201, 1, 3000);                    // STATUS_UNPAID_BUT_PAID
await R(2, 102, 4000, 'paid');                                              // STATUS_PAID_BUT_NO_PAYMENT
await R(3, 103, 3000, 'paid'); await P(202, 3, 3000); await P(203, 3, 3000); // OVERPAID
await R(4, 104, 3000, 'pending'); await R(5, 104, 3000, 'pending');          // DUPLICATE ×2
await R(6, 105, 5000, 'paid'); await P(204, 6, 5000);                        // 정상
await R(7, 106, 3000, 'pending'); await P(205, 7, 3000, true);              // 취소 납부만 → 정상 미납(이슈 아님)
await R(8, 107, 3000, 'partial'); await P(206, 8, 1000);                     // 정상 일부
await db.query("insert into public.kdk_guest_penalty_payments values ('S1','manual-guest-aaa',4000,'paid','penalty')"); // 정상
await db.query("insert into public.kdk_guest_penalty_payments values ('S1','manual-guest-zzz',3000,'paid','penalty')"); // ORPHAN
await db.query("insert into public.kdk_guest_penalty_payments values ('S1','manual-guest-bbb',3000,'cancelled','penalty')"); // 취소 → bbb 미납

let rows = [];
const err = await (async () => { try { rows = (await db.query(SQL)).rows; return null; } catch (e) { return e?.message; } })();
check('SQL 실행(문법)', err === null, err);
const byIssue = (i) => rows.filter((r) => r.issue === i);
check('STATUS_UNPAID_BUT_PAID 1건', byIssue('STATUS_UNPAID_BUT_PAID').length === 1 && byIssue('STATUS_UNPAID_BUT_PAID')[0].who === U(101).slice(0, 8));
check('STATUS_PAID_BUT_NO_PAYMENT 1건', byIssue('STATUS_PAID_BUT_NO_PAYMENT').length === 1);
check('OVERPAID 1건', byIssue('OVERPAID').length === 1 && Number(byIssue('OVERPAID')[0].paid) === 6000);
check('DUPLICATE_RECEIVABLE 2행(같은 회원)', byIssue('DUPLICATE_RECEIVABLE').length === 2);
check('GUEST_UNPAID: bbb(취소만) 1건 · 테스트 세션 제외', byIssue('GUEST_UNPAID').length === 1 && byIssue('GUEST_UNPAID')[0].who === 'manual-g' && Number(byIssue('GUEST_UNPAID')[0].charged) === 3000);
check('GUEST_PAYMENT_ORPHAN 1건', byIssue('GUEST_PAYMENT_ORPHAN').length === 1);
check('정상 건은 결과에 없음(총 7행)', rows.length === 7, String(rows.length));
check('이름 컬럼 없음', rows.every((r) => !('name' in r)));
check('READ-ONLY: 쓰기 문장 없음', !/\b(insert|update|delete|alter|drop|create|truncate|grant|revoke)\b/i.test(SQL.replace(/--.*$/gm, '')));
const before = (await db.query('select count(*)::int as n from public.finance_dues_receivables')).rows[0].n;
check('실행 후 데이터 변화 없음', before === 8);

console.log(`\nCLOSING SPRINT F3 SQL (PGlite): ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  FAIL ${f}`); process.exit(1); }
