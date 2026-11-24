/**
 * [CLOSING SPRINT F3] 벌금 정합성 요약 READ-ONLY SQL ↔ 앱 누적 벌금 판정(buildPenaltyHistory) 일치 시험.
 *   격리된 PGlite 메모리 DB · 무작위 가상 데이터(시드 고정). 운영 DB 미접속.
 *   실행: PGLITE_MODULE=<@electric-sql/pglite dist/index.js 절대경로> node scripts/verify_closing_sprint_f3_summary.mts
 */
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

register('./ts-resolve-hook.mjs', import.meta.url);
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://127.0.0.1:1';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'fixture-anon-key';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modPath = process.env.PGLITE_MODULE;
if (!modPath) { console.error('PGLITE_MODULE 환경변수가 필요합니다.'); process.exit(2); }
const { PGlite } = await import(pathToFileURL(modPath).href);
const load = (p: string): Promise<any> => import(p);
const M = await load('../lib/finance/kdkPenaltyHistoryModel.ts');
const SQL = fs.readFileSync(path.join(ROOT, 'supabase/closing_sprint/F3_penalty_reconciliation_summary_READONLY.sql'), 'utf8');

let passed = 0; const failures: string[] = [];
const check = (name: string, cond: boolean, info = '') => { if (cond) passed += 1; else failures.push(`${name}${info ? ` — ${info}` : ''}`); };

const DDL = `
  create table public.teyeon_archive_v1 (id text primary key, raw_data jsonb, is_official boolean, is_test boolean, archive_type text not null default 'kdk', created_at timestamptz);
  create table public.members (id uuid primary key, nickname text);
  create table public.finance_dues_receivables (id uuid primary key, member_id uuid, receivable_type text, amount_due numeric, status text, related_kdk_session_id text, title text, created_at timestamptz default now());
  create table public.finance_dues_payments (id uuid primary key, member_id uuid, receivable_id uuid, payment_type text, amount numeric, is_voided boolean, paid_at timestamptz, created_at timestamptz default now());
  create table public.kdk_guest_penalty_payments (id uuid primary key, session_id text, participant_id text, charge_type text default 'penalty', amount integer, status text, paid_at timestamptz);
`;

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
let uidN = 0; const uid = () => `00000000-0000-4000-8000-${(++uidN).toString(16).padStart(12, '0')}`;

function gen(seed: number) {
  const r = rng(seed); const pick = <T,>(a: T[]): T => a[Math.floor(r() * a.length)];
  const names = ['가람', '나래', '다솜', '라온', '마루', '바다', '사랑', '아라', '자람', '차오', '가람', '하늘 ', ' 노을(G)', '단비 g'];
  const members = names.map((n) => ({ id: uid(), nickname: n }));
  const dates = ['2026-11-10', '2026-11-17', '2026-11-18', '2026-11-18T21:00:00', '2026-11-19', '2026-11-24', null, 'bad-date'];
  const sessions: any[] = [];
  for (let i = 0; i < 9; i++) {
    const kind = i === 6 ? 'test' : i === 7 ? 'unofficial' : i === 8 ? 'other_type' : 'ok';
    const date = pick(dates);
    const noSnap = r() < 0.1;
    const entries: any[] = [];
    const n = 4 + Math.floor(r() * 8);
    for (let k = 0; k < n; k++) {
      const t = r(); const m = pick(members);
      const pen = pick([-3000, -5000, -2000, 0, -4000, '-6000', -1500.7]);
      if (t < 0.35) entries.push({ player_id: m.id, player_name: m.nickname, is_guest: false, penalty_amount: pen });
      else if (t < 0.55) entries.push({ player_id: `p-${k}`, player_name: ` ${m.nickname.trim()} `, is_guest: false, penalty_amount: pen }); // 이름 매칭(동명이면 실패)
      else if (t < 0.8) entries.push({ player_id: `manual-guest-${seed}-${i}-${k}`, player_name: `게${k}(G)`, is_guest: true, penalty_amount: pen });
      else if (t < 0.87) entries.push({ player_id: '', player_name: `게스트무id${k}`, is_guest: true, penalty_amount: pen });
      else if (t < 0.93) entries.push({ player_id: null, player_name: `미상${k}`, is_guest: false, penalty_amount: pen });
      else entries.push({ player_id: m.id, player_name: m.nickname, is_guest: 'true', penalty_amount: pen }); // 문자열 is_guest(=게스트 아님)
    }
    const raw: any = { title: `S${i}` };
    if (date) raw.date = date;
    if (!noSnap) raw.settlement_data = entries; else raw.settlement_data = { broken: true };
    sessions.push({ id: `S${seed}-${i}`, raw, is_official: kind !== 'unofficial', is_test: kind === 'test', archive_type: kind === 'other_type' ? 'special' : 'kdk',
      created_at: pick(['2026-11-18T23:30:00Z', '2026-11-12T03:00:00Z', '2026-11-20T01:00:00Z']), entries });
  }
  const receivables: any[] = []; const payments: any[] = []; const guestPays: any[] = [];
  for (const s of sessions) {
    for (const e of s.entries) {
      const mm = members.find((m) => m.id === e.player_id);
      if (!mm || r() < 0.2) continue; // 일부는 청구 미등록
      const rid = uid(); const due = Math.abs(Math.trunc(Number(e.penalty_amount) || 0)) + (r() < 0.1 ? 1000 : 0);
      receivables.push({ id: rid, member_id: mm.id, receivable_type: 'penalty', amount_due: due, status: pick(['pending', 'paid', 'partial', 'exempt', 'not_target', 'pending']), related_kdk_session_id: s.id });
      const pt = r();
      if (pt < 0.4) payments.push({ id: uid(), member_id: mm.id, receivable_id: rid, payment_type: 'penalty', amount: due, is_voided: false, paid_at: '2026-11-20T00:00:00Z' });
      else if (pt < 0.5) payments.push({ id: uid(), member_id: mm.id, receivable_id: rid, payment_type: 'penalty', amount: Math.floor(due / 2), is_voided: false, paid_at: null });
      else if (pt < 0.6) payments.push({ id: uid(), member_id: mm.id, receivable_id: rid, payment_type: 'penalty', amount: due, is_voided: true, paid_at: null });
      else if (pt < 0.65) payments.push({ id: uid(), member_id: mm.id, receivable_id: rid, payment_type: 'penalty', amount: due + 500, is_voided: null, paid_at: null });
      if (r() < 0.08) receivables.push({ id: uid(), member_id: mm.id, receivable_type: 'penalty', amount_due: due, status: 'pending', related_kdk_session_id: s.id }); // 중복 청구
    }
    for (const e of s.entries) if (e.is_guest === true && e.player_id && r() < 0.6) {
      guestPays.push({ id: uid(), session_id: s.id, participant_id: e.player_id, amount: Math.abs(Math.trunc(Number(e.penalty_amount) || 0)) || 1000, status: r() < 0.85 ? 'paid' : 'cancelled', paid_at: '2026-11-21T00:00:00Z' });
    }
  }
  // 고아 청구 · 미연결 납부 · 고아 게스트 납부 · 다른 종류 청구
  receivables.push({ id: uid(), member_id: members[0].id, receivable_type: 'penalty', amount_due: 3000, status: 'pending', related_kdk_session_id: null });
  receivables.push({ id: uid(), member_id: members[1].id, receivable_type: 'penalty', amount_due: 4000, status: 'paid', related_kdk_session_id: 'NO-SUCH' });
  receivables.push({ id: uid(), member_id: members[2].id, receivable_type: 'penalty', amount_due: 2000, status: 'pending', related_kdk_session_id: sessions[0].id });
  receivables.push({ id: uid(), member_id: members[3].id, receivable_type: 'dues', amount_due: 30000, status: 'pending', related_kdk_session_id: null });
  payments.push({ id: uid(), member_id: members[4].id, receivable_id: null, payment_type: 'penalty', amount: 5000, is_voided: false, paid_at: null });
  payments.push({ id: uid(), member_id: members[4].id, receivable_id: null, payment_type: 'penalty', amount: 7000, is_voided: true, paid_at: null });
  guestPays.push({ id: uid(), session_id: sessions[0].id, participant_id: 'manual-guest-orphan', amount: 3000, status: 'paid', paid_at: null });
  return { members, sessions, receivables, payments, guestPays };
}

/** 앱 서비스(fetchOfficialSessions · toDate)와 같은 세션 입력. */
function appSessions(ds: any) {
  const toDate = (raw: unknown, createdAt: unknown) => { const m = String(raw || '').trim().match(/^(\d{4}-\d{2}-\d{2})/); if (m) return m[1]; const c = String(createdAt || ''); return /^\d{4}-\d{2}-\d{2}/.test(c) ? c.slice(0, 10) : null; };
  return ds.sessions.filter((s: any) => s.is_official === true && s.is_test !== true && String(s.archive_type || 'kdk').toLowerCase() === 'kdk')
    .map((s: any) => ({ id: s.id, date: toDate(s.raw.date, s.created_at), title: s.raw.title, settlementData: Array.isArray(s.raw.settlement_data) ? s.raw.settlement_data : null }));
}
const per = (d: string | null) => (!d ? 'C 날짜 없음' : d <= '2026-11-18' ? 'A ~11-18' : 'B 11-19~');

for (let seed = 1; seed <= 40; seed++) {
  const ds = gen(seed);
  const db = new PGlite(); await db.exec(DDL);
  for (const s of ds.sessions) await db.query('insert into public.teyeon_archive_v1 values ($1,$2,$3,$4,$5,$6)', [s.id, JSON.stringify(s.raw), s.is_official, s.is_test, s.archive_type, s.created_at]);
  for (const m of ds.members) await db.query('insert into public.members values ($1,$2)', [m.id, m.nickname]);
  for (const r of ds.receivables) await db.query('insert into public.finance_dues_receivables(id,member_id,receivable_type,amount_due,status,related_kdk_session_id) values ($1,$2,$3,$4,$5,$6)', [r.id, r.member_id, r.receivable_type, r.amount_due, r.status, r.related_kdk_session_id]);
  for (const p of ds.payments) await db.query('insert into public.finance_dues_payments(id,member_id,receivable_id,payment_type,amount,is_voided,paid_at) values ($1,$2,$3,$4,$5,$6,$7)', [p.id, p.member_id, p.receivable_id, p.payment_type, p.amount, p.is_voided, p.paid_at]);
  for (const g of ds.guestPays) await db.query('insert into public.kdk_guest_penalty_payments(id,session_id,participant_id,amount,status,paid_at) values ($1,$2,$3,$4,$5,$6)', [g.id, g.session_id, g.participant_id, g.amount, g.status, g.paid_at]);

  await db.exec('begin transaction read only');
  const res = await db.query(SQL); await db.exec('rollback');
  const rows = res.rows as any[];
  if (seed === 1 && process.env.DUMP) console.table(rows.map((x) => ({ k: x.k, p: x.period, cnt: x.cnt, amt: x.amount, f: x.flag })));
  const get = (k: string, p: string) => rows.find((x) => x.k === k && x.period === p);

  // 앱 판정(같은 데이터) — 서비스와 같이 receivables 는 id 오름차순
  const penaltyRecv = ds.receivables.filter((r: any) => r.receivable_type === 'penalty').sort((a: any, b: any) => a.id.localeCompare(b.id));
  const h = M.buildPenaltyHistory({
    sessions: appSessions(ds), members: ds.members, receivables: penaltyRecv,
    payments: ds.payments.filter((p: any) => p.receivable_id && penaltyRecv.some((r: any) => r.id === p.receivable_id)),
    unlinkedPayments: ds.payments.filter((p: any) => p.payment_type === 'penalty' && !p.receivable_id),
    guestAvailable: true, guestPayments: ds.guestPays,
  });
  const recs = h.records as any[];
  const groups: [string, string, string[], 'amount' | 'remaining'][] = [
    ['R1', 'member', ['paid'], 'amount'], ['R2', 'member', ['pending', 'partial'], 'remaining'], ['R3', 'member', ['exempt', 'not_target'], 'amount'],
    ['R4', 'member', ['unregistered'], 'amount'], ['R5', 'member', ['needs_link'], 'amount'],
    ['R6', 'guest', ['paid'], 'amount'], ['R7', 'guest', ['pending'], 'amount'], ['R8', 'guest', ['needs_link'], 'amount'],
  ];
  for (const p of ['A ~11-18', 'B 11-19~', 'C 날짜 없음']) {
    for (const [k, side, sts, metric] of groups) {
      const sel = recs.filter((r) => per(r.sessionDate) === p && r.side === side && sts.includes(r.status));
      const expCnt = sel.length; const expAmt = sel.reduce((a, r) => a + (metric === 'remaining' ? r.remaining : r.amount), 0);
      const got = get(k, p);
      check(`seed ${seed} ${p} ${k}`, got && Number(got.cnt) === expCnt && Number(got.amount) === expAmt, `SQL ${got?.cnt}/${got?.amount} 앱 ${expCnt}/${expAmt}`);
    }
    const s = M.summarizeRecords(recs.filter((r) => per(r.sessionDate) === p));
    const r9 = get('R9', p);
    check(`seed ${seed} ${p} R9 청구 대상 · 미납 잔액`, Number(r9.cnt) === s.billableAmount && Number(r9.amount) === s.unpaidAmount, `SQL ${r9.cnt}/${r9.amount} 앱 ${s.billableAmount}/${s.unpaidAmount}`);
  }
  const vA = recs.filter((r) => per(r.sessionDate) === 'A ~11-18' && (r.bucket === 'unpaid' || r.bucket === 'review')).length;
  check(`seed ${seed} V01`, Number(get('V01', 'A ~11-18').cnt) === vA && (get('V01', 'A ~11-18').flag === (vA === 0 ? 'OK' : 'CHECK')));
  const orphan = h.exceptions.orphanReceivables as any[];
  for (const reason of ['no_session_link', 'session_not_official', 'no_snapshot', 'duplicate', 'not_in_settlement']) {
    const x = rows.find((y) => y.k === 'X05' && y.item.includes(`: ${reason}(`));
    const exp = orphan.filter((o) => o.reason === reason);
    check(`seed ${seed} X05 ${reason}`, x && Number(x.cnt) === exp.length && Number(x.amount) === exp.reduce((a, o) => a + o.amountDue, 0), `SQL ${x?.cnt}/${x?.amount} 앱 ${exp.length}`);
  }
  const x06 = get('X06', '전체'); const ul = h.exceptions.unlinkedPayments as any[];
  check(`seed ${seed} X06`, Number(x06.cnt) === ul.length && Number(x06.amount) === ul.reduce((a, u) => a + u.amount, 0));
  const x07 = get('X07', '전체'); const og = h.exceptions.orphanGuestPayments as any[];
  check(`seed ${seed} X07`, Number(x07.cnt) === og.length && Number(x07.amount) === og.reduce((a, u) => a + u.amount, 0), `SQL ${x07.cnt} 앱 ${og.length}`);
  check(`seed ${seed} X10`, Number(get('X10', '전체').cnt) === h.exceptions.cancelledGuestPaymentCount);
  const sA = appSessions(ds);
  for (const p of ['A ~11-18', 'B 11-19~', 'C 날짜 없음']) {
    const ss = sA.filter((s: any) => per(s.date) === p);
    check(`seed ${seed} ${p} S01`, get('S01', p).cnt === `${ss.length} · 스냅샷없음 ${ss.filter((s: any) => !s.settlementData).length}`);
  }
  await db.close();
}

// 빈 DB · 출력 형태
{
  const db = new PGlite(); await db.exec(DDL);
  const r = await db.query(SQL);
  const flags = new Set((r.rows as any[]).map((x) => x.flag));
  check('빈 DB: 오류 없이 실행 · CHECK 없음', !flags.has('CHECK'), JSON.stringify([...flags]));
  check('출력 열: k · period · item · cnt · amount · flag(이름 · id 열 없음)', JSON.stringify(r.fields.map((f: any) => f.name)) === JSON.stringify(['k', 'period', 'item', 'cnt', 'amount', 'flag']));
  await db.close();
}
check('SQL 쓰기 · DDL 문구 없음', !/\b(insert|update|delete|alter|create|drop|truncate|grant|revoke)\b\s/i.test(SQL.replace(/--.*$/gm, '')));

console.log(`CLOSING SPRINT F3 요약 SQL ↔ 앱 판정: ${passed} passed, ${failures.length} failed`);
for (const f of failures.slice(0, 30)) console.log('  FAIL', f);
process.exit(failures.length ? 1 : 0);
