/**
 * [CLOSING SPRINT F3] X05 · X06 추적 READ-ONLY SQL 시험 — 격리된 PGlite 메모리 DB · 가상 데이터. 운영 DB 미접속.
 *   실행: PGLITE_MODULE=<@electric-sql/pglite dist/index.js 절대경로> node scripts/verify_closing_sprint_f3_trace.mjs
 *   시나리오: 2026-11-10 게스트 오매칭 정정 결과(비대상 청구 + 취소 납부 + 게스트 납부 + 감사 기록) = X05,
 *             같은 금액 청구가 이미 완납인 회원의 청구 미연결 납부 = X06. 요약 SQL 의 X05 · X06 건수와 대조.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modPath = process.env.PGLITE_MODULE;
if (!modPath) { console.error('PGLITE_MODULE 환경변수가 필요합니다.'); process.exit(2); }
const { PGlite } = await import(pathToFileURL(modPath).href);
const rd = (f) => fs.readFileSync(path.join(ROOT, 'supabase/closing_sprint', f), 'utf8');
const TRACE = rd('F3_x05_x06_trace_READONLY.sql'), AUDIT = rd('F3_x05_x06_audit_READONLY.sql'), SUMMARY = rd('F3_penalty_reconciliation_summary_READONLY.sql');

let passed = 0; const failures = [];
const check = (name, cond, info = '') => { if (cond) passed += 1; else failures.push(`${name}${info ? ` — ${info}` : ''}`); };
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const BASE = `
  create table public.teyeon_archive_v1 (id text primary key, raw_data jsonb, is_official boolean, is_test boolean, archive_type text not null default 'kdk', created_at timestamptz);
  create table public.members (id uuid primary key, nickname text);
  create table public.finance_dues_receivables (id uuid primary key, member_id uuid, receivable_type text, title text, amount_due numeric, status text, related_kdk_session_id text,
    exemption_reason text, memo text, created_at timestamptz default '2026-11-10T12:00:00Z', updated_at timestamptz default '2026-11-12T01:00:00Z');
  create table public.finance_dues_payments (id uuid primary key, member_id uuid, receivable_id uuid, payment_type text, amount numeric, paid_at date, is_voided boolean,
    memo text, created_by uuid, created_at timestamptz default '2026-11-20T03:00:00Z', updated_at timestamptz default '2026-11-20T03:00:00Z');
  create table public.kdk_guest_penalty_payments (id uuid primary key, session_id text, participant_id text, charge_type text default 'penalty', amount integer, status text, paid_at timestamptz);
`;
const OPT = `
  create table public.finance_payment_audit (id uuid primary key, payment_id uuid, action text, old_receivable_id uuid, new_receivable_id uuid, reason text, changed_at timestamptz);
  create table public.kdk_archive_corrections (id uuid primary key, archive_id text, corrected_at timestamptz);
`;
async function seed(db, withOpt) {
  await db.exec(BASE + (withOpt ? OPT : ''));
  const S1 = { date: '2026-11-10', settlement_data: [
    { player_id: U(1), player_name: '가람', is_guest: false, penalty_amount: -3000 },
    { player_id: 'manual-guest-x1', player_name: '홍길(G)', is_guest: true, penalty_amount: -3000 } ] };
  const S2 = { date: '2026-11-17', settlement_data: [{ player_id: U(3), player_name: '다솜', is_guest: false, penalty_amount: -5000 }] };
  await db.query('insert into public.teyeon_archive_v1 values ($1,$2,true,false,$3,$4)', ['S1110', JSON.stringify(S1), 'kdk', '2026-11-10T12:00:00Z']);
  await db.query('insert into public.teyeon_archive_v1 values ($1,$2,true,false,$3,$4)', ['S1117', JSON.stringify(S2), 'kdk', '2026-11-17T12:00:00Z']);
  for (const [i, n] of [[1, '가람'], [2, '홍길'], [3, '다솜']]) await db.query('insert into public.members values ($1,$2)', [U(i), n]);
  const R = (id, mem, amt, st, sid, reason = null) => db.query('insert into public.finance_dues_receivables(id,member_id,receivable_type,title,amount_due,status,related_kdk_session_id,exemption_reason) values ($1,$2,\'penalty\',$3,$4,$5,$6,$7)', [U(id), U(mem), 'KDK 벌금', amt, st, sid, reason]);
  const P = (id, mem, rid, amt, voided, paid = '2026-11-10', by = U(99)) => db.query('insert into public.finance_dues_payments(id,member_id,receivable_id,payment_type,amount,paid_at,is_voided,created_by) values ($1,$2,$3,\'penalty\',$4,$5,$6,$7)', [U(id), U(mem), rid ? U(rid) : null, amt, paid, voided, by]);
  await R(101, 1, 3000, 'pending', 'S1110'); await P(201, 1, 101, 3000, false);                 // 정상 회원 벌금(완납)
  await R(102, 2, 3000, 'not_target', 'S1110', '게스트 오매칭 정정 2026-11-10'); await P(202, 2, 102, 3000, true); // X05 후보(정정 결과)
  await db.query("insert into public.kdk_guest_penalty_payments values ($1,'S1110','manual-guest-x1','penalty',3000,'paid','2026-11-10T12:00:00Z')", [U(301)]);
  await R(103, 3, 5000, 'pending', 'S1117'); await P(203, 3, 103, 5000, false, '2026-11-17');    // 정상(완납)
  await P(204, 3, null, 5000, false, '2026-11-17', null);                                          // X06 후보(같은 금액 이미 완납)
  if (withOpt) {
    await db.query("insert into public.finance_payment_audit values ($1,$2,'KDK_GUEST_MISMATCH_TRANSFER_V1',$3,null,'{}','2026-11-12T01:00:00Z')", [U(401), U(202), U(102)]);
    await db.query("insert into public.kdk_archive_corrections values ($1,'S1110','2026-11-11T00:00:00Z')", [U(501)]);
  }
}
const val = (rows, k, t) => rows.find((r) => r.k === k && r.target === t)?.value;

for (const withOpt of [true, false]) {
  const db = new PGlite(); await seed(db, withOpt);
  await db.exec('begin transaction read only');
  const tr = (await db.query(TRACE)).rows; await db.exec('rollback');
  const sum = (await db.query(SUMMARY)).rows;
  const sumX05 = sum.find((r) => r.k === 'X05' && r.item.includes(': not_in_settlement('));
  const sumX06 = sum.find((r) => r.k === 'X06');
  const tag = withOpt ? '[선택 테이블 있음]' : '[선택 테이블 없음]';
  check(`${tag} trace 읽기 전용 실행 · 표 1개(k · target · item · value)`, tr.length > 0 && Object.keys(tr[0]).join(',') === 'k,target,item,value');
  check(`${tag} Z01 = 요약 SQL X05(not_in_settlement) · X06 건수`, val(tr, 'Z01', '요약') === `${sumX05.cnt} · ${sumX06.cnt}`, `${val(tr, 'Z01', '요약')} vs ${sumX05.cnt} · ${sumX06.cnt}`);
  check(`${tag} X05#1 = 11-10 비대상 청구(id 앞 8자 · 세션 · 날짜)`, val(tr, 'Q01', 'X05#1') === `${U(102).slice(0, 8)} · ${U(2).slice(0, 8)} · S1110 · 2026-11-10`, val(tr, 'Q01', 'X05#1'));
  check(`${tag} X05 Q02: 3000 · not_target · not_target · 유효 0 · 취소 3000 · 기록 1`, val(tr, 'Q02', 'X05#1') === '3000 · not_target · not_target · 0 · 3000 · 1', val(tr, 'Q02', 'X05#1'));
  check(`${tag} X05 Q04: 회원 id 항목 0 / 같은 이름 회원 0 · 게스트 1 / 동명 회원 1`, val(tr, 'Q04', 'X05#1') === '0 · - / 0 · 1 / 1', val(tr, 'Q04', 'X05#1'));
  check(`${tag} X05 Q05: 같은 이름 게스트 납부 1 · 3000`, val(tr, 'Q05', 'X05#1') === '1 · 3000', val(tr, 'Q05', 'X05#1'));
  check(`${tag} X05 Q06: 선택 테이블 존재 표시`, val(tr, 'Q06', 'X05#1') === (withOpt ? '있음 · 있음' : '없음 · 없음'), val(tr, 'Q06', 'X05#1'));
  check(`${tag} X05 Q08: 미납 영향 없음`, /영향 없음/.test(val(tr, 'Q08', 'X05#1')));
  check(`${tag} X05 Q09: 11-10 정정 결과 추정`, /2026-11-10 게스트 오매칭 정정/.test(val(tr, 'Q09', 'X05#1')), val(tr, 'Q09', 'X05#1'));
  check(`${tag} X06#1 P01: 납부 id · 회원 · 5000 · 2026-11-17`, (val(tr, 'P01', 'X06#1') || '').startsWith(`${U(204).slice(0, 8)} · ${U(3).slice(0, 8)} · 5000 · 2026-11-17`), val(tr, 'P01', 'X06#1'));
  check(`${tag} X06 P02: 입력자 없음`, /^입력자 없음/.test(val(tr, 'P02', 'X06#1')));
  check(`${tag} X06 P03: 청구 1 · 미납 0 · 같은 금액 1 · 그중 완납 1`, val(tr, 'P03', 'X06#1') === '1 · 0 · 1 · 1', val(tr, 'P03', 'X06#1'));
  check(`${tag} X06 P04: 같은 날 세션 청구 S1117:5000/5000(paid)`, val(tr, 'P04', 'X06#1') === 'S1117:5000/5000(paid)', val(tr, 'P04', 'X06#1'));
  check(`${tag} X06 P06: X05 와 다른 회원`, val(tr, 'P06', 'X06#1') === '아니오');
  check(`${tag} X06 P07: 청구 5000 · 연결 납부 5000 · 미연결 5000`, val(tr, 'P07', 'X06#1') === '5000 · 5000 · 5000', val(tr, 'P07', 'X06#1'));
  check(`${tag} X06 P09: 중복 납부 후보 추정`, /중복 납부/.test(val(tr, 'P09', 'X06#1')), val(tr, 'P09', 'X06#1'));
  // audit 파일
  await db.exec('begin transaction read only');
  const au = await db.query(AUDIT).then((r) => r.rows, (e) => ({ err: e.code || e.message })); await db.exec('rollback');
  if (withOpt) {
    const a = au.find((r) => r.k === 'A1'); const c = au.find((r) => r.k === 'C1');
    check('[선택 테이블 있음] audit: 11-10 정정 action · 이전 청구(앞 8자) · 비대상', a && a.action === 'KDK_GUEST_MISMATCH_TRANSFER_V1' && a.old_recv8 === U(102).slice(0, 8) && a.old_recv_status === 'not_target' && a.x06 === '-', JSON.stringify(a));
    check('[선택 테이블 있음] audit: 세션 S1110 점수 정정 1건', c && c.payment8 === '1' && c.old_recv_session === 'S1110', JSON.stringify(c));
    check('[선택 테이블 있음] audit: reason 원문 미출력', !Object.keys(au[0]).includes('reason'));
  } else {
    check('[선택 테이블 없음] audit 파일 → 오류로 종료(무해) · 변경 없음', !!au.err, JSON.stringify(au).slice(0, 80));
  }
  await db.close();
}
// X05 · X06 없음
{
  const db = new PGlite(); await db.exec(BASE);
  const tr = (await db.query(TRACE)).rows;
  check('대상 없음: Z01 "0 · 0" 1행만', tr.length === 1 && tr[0].value === '0 · 0', JSON.stringify(tr));
  await db.close();
}
check('trace · audit SQL 에 쓰기 · DDL 문구 없음', ![TRACE, AUDIT].some((s) => /\b(insert|update|delete|alter|create|drop|truncate|grant|revoke)\b\s/i.test(s.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''"))));

console.log(`CLOSING SPRINT F3 X05/X06 추적 SQL: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log('  FAIL', f);
process.exit(failures.length ? 1 : 0);
