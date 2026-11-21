/**
 * TEYEON KDK 누적 벌금 공유 텍스트 fixture 검증.
 *
 *   실행: node scripts/verify_kdk_penalty_history_share.mts
 *   (Node 24 type-stripping + scripts/ts-resolve-hook.mjs — DB 미접속.)
 *
 *   검증: 탭별 섹션 구성 · 요약 = 화면 요약(summarizeRecords) · 전체 = 회원 + 게스트 · 목록 합 = 요약 ·
 *         미납→부과 내림차순 정렬 · 동명 회원 비병합(구분 표시) · 게스트 동일 이름 묶음(기존 기준) · 이름 확인 불가 맨 아래 ·
 *         비대상 제외 · 확인 필요 별도 표기 · 게스트 줄 '청구 대상' 라벨(회원 줄 '부과') · 기간 필터 · 빈 기간 · 기준일(로컬) · 내부 ID 미포함 · 천 단위 쉼표.
 */
import { register } from 'node:module';

register('./ts-resolve-hook.mjs', import.meta.url);

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://127.0.0.1:1';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'fixture-anon-key';

type Any = Record<string, any>; // fixture 용 느슨한 타입(검증 스크립트 관례).
const load = (path: string): Promise<Any> => import(path);
const M = await load('../lib/finance/kdkPenaltyHistoryModel.ts');
const SH = await load('../lib/finance/kdkPenaltyHistoryShare.ts');

let passed = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, info = '') => { if (cond) passed += 1; else failures.push(`${name}${info ? ` — ${info}` : ''}`); };
const eq = (name: string, actual: unknown, expected: unknown) => check(name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);

// ── fixture ──────────────────────────────────────────────────────────────────
let seq = 0;
const uid = (p: string) => `${p}-${String(++seq).padStart(6, '0')}`;
const entry = (player_id: string | null, player_name: string, penalty: number, is_guest = false) =>
    ({ player_id, player_name, is_guest, penalty_amount: -penalty, penalty_level: 'L1' });
const recv = (member_id: string, session: string, amount: number, status = 'pending') => ({
    id: uid('recv'), member_id, receivable_type: 'penalty', title: 'KDK 벌금', target_year: 2026, target_month: null,
    amount_due: amount, due_date: null, status, exemption_reason: null, memo: '운영진메모-비공개', related_kdk_session_id: session,
    created_by: null, created_at: '2026-01-01', updated_at: '2026-01-01',
});
const pay = (r: { id: string; member_id: string }, amount: number, paid_at: string) => ({
    id: uid('pay'), member_id: r.member_id, receivable_id: r.id, payment_type: 'penalty', amount, paid_at,
    memo: null, is_voided: false, created_by: null, updated_by: null, created_at: paid_at, updated_at: paid_at,
});
const gpay = (session_id: string, participant_id: string, amount: number) =>
    ({ session_id, participant_id, amount, status: 'paid', paid_at: '2026-11-19T10:00:00+09:00' });

const MID = {
    a: '11111111-aaaa-4aaa-8aaa-000000000001', // 미납 많음
    b: '11111111-aaaa-4aaa-8aaa-000000000002', // 완납
    c: '11111111-aaaa-4aaa-8aaa-000000000003', // 동명 1
    d: '11111111-aaaa-4aaa-8aaa-000000000004', // 동명 2
    e: '11111111-aaaa-4aaa-8aaa-000000000005', // 비대상만
    f: '11111111-aaaa-4aaa-8aaa-000000000006', // 일부 납부
};
const S1 = 'arch-2026-06-23-sessionid', S2 = 'arch-2026-09-01-sessionid', S3 = 'arch-2025-12-20-sessionid';
const ds: Any = {
    sessions: [
        { id: S1, date: '2026-06-23', title: 'KDK 6월', settlementData: [
            entry(MID.a, '알파', 5000), entry(MID.b, '브라보', 3000), entry(MID.c, '같은이름', 3000), entry(MID.d, '같은이름', 4000),
            entry(MID.e, '비대상만', 4000), entry(MID.f, '폭스트롯', 6000),
            entry('manual-guest-게스트민', '게스트민', 3000, true), entry('g-1700000000001', '', 2000, true),
            entry('pid-unlinked-xyz', '미연결참가자', 3000, false),
        ] },
        { id: S2, date: '2026-09-01', title: 'KDK 9월', settlementData: [
            entry(MID.a, '알파', 4000), entry(MID.b, '브라보', 2000),
            entry('manual-guest-게스트민', '게스트 민', 5000, true), entry('manual-guest-게스트하나', '게스트하나', 1000, true),
        ] },
        { id: S3, date: '2025-12-20', title: 'KDK 작년', settlementData: [entry(MID.a, '알파', 9000), entry('manual-guest-작년게스트', '작년게스트', 7000, true)] },
    ],
    members: [
        { id: MID.a, nickname: '알파' }, { id: MID.b, nickname: '브라보' }, { id: MID.c, nickname: '같은이름' },
        { id: MID.d, nickname: '같은이름' }, { id: MID.e, nickname: '비대상만' }, { id: MID.f, nickname: '폭스트롯' },
    ],
    receivables: [], payments: [], unlinkedPayments: [], guestAvailable: true, guestPayments: [],
};
const R = (m: string, s: string, amt: number, st = 'pending') => { const r = recv(m, s, amt, st); ds.receivables.push(r); return r; };
R(MID.a, S1, 5000);
const rb1 = R(MID.b, S1, 3000, 'paid'); ds.payments.push(pay(rb1, 3000, '2026-06-30'));
const rc = R(MID.c, S1, 3000, 'paid'); ds.payments.push(pay(rc, 3000, '2026-06-30'));
R(MID.d, S1, 4000);
R(MID.e, S1, 4000, 'not_target');
const rf = R(MID.f, S1, 6000, 'partial'); ds.payments.push(pay(rf, 2000, '2026-07-01'));
R(MID.a, S2, 4000);
const rb2 = R(MID.b, S2, 2000, 'paid'); ds.payments.push(pay(rb2, 2000, '2026-09-05'));
const ra3 = R(MID.a, S3, 9000, 'paid'); ds.payments.push(pay(ra3, 9000, '2025-12-25'));
ds.guestPayments.push(gpay(S1, 'manual-guest-게스트민', 3000), gpay(S2, 'manual-guest-게스트하나', 1000), gpay(S3, 'manual-guest-작년게스트', 7000));

const history = M.buildPenaltyHistory(ds);
const YEAR = { from: '2026-01-01', to: '2026-12-31' };
const ALL = { from: null, to: null };
const NOW = new Date(2026, 10, 22, 23, 30); // 로컬 2026-11-22 23:30

const screenSummary = (range: Any, tab: string) => {
    const period = history.records.filter((r: Any) => M.inPeriod(r.sessionDate, range));
    return M.summarizeRecords(tab === 'all' ? period : period.filter((r: Any) => r.side === tab));
};
const pick = (s: Any) => ({ b: s.billableAmount, p: s.paidAmount, u: s.unpaidAmount });
const sumLines = (ls: Any[]) => ls.reduce((a, l) => ({ b: a.b + l.billable, p: a.p + l.paid, u: a.u + l.unpaid }), { b: 0, p: 0, u: 0 });

// ═══ 1. 탭별 구성 · 요약 = 화면 ═══════════════════════════════════════════════
for (const tab of ['all', 'member', 'guest']) {
    const c = SH.buildPenaltyShareContent(history.records, YEAR, tab, NOW);
    const text = SH.formatPenaltyShareText(c);
    eq(`[${tab}] 요약 = 화면 요약 카드`, pick(c.summary), pick(screenSummary(YEAR, tab)));
    check(`[${tab}] 제목`, text.startsWith('🎾 TEYEON KDK 누적 벌금 현황\n'));
    check(`[${tab}] 조회 기간`, text.includes('조회 기간: 2026.01.01 ~ 2026.12.31'));
    check(`[${tab}] 기준일(로컬)`, text.includes('기준일: 2026.11.22'));
    check(`[${tab}] 회원 섹션 ${tab === 'guest' ? '없음' : '있음'}`, text.includes('[회원별 누적 벌금]') === (tab !== 'guest'));
    check(`[${tab}] 게스트 섹션 ${tab === 'member' ? '없음' : '있음'}`, text.includes('[게스트별 누적 벌금]') === (tab !== 'member'));
    check(`[${tab}] 요약 라벨`, text.includes(tab === 'all' ? '[전체 요약]' : tab === 'member' ? '[회원 요약]' : '[게스트 요약]'));
    check(`[${tab}] 비대상 안내`, text.includes('※ 비대상 벌금은 부과·납부 집계에서 제외'));
    check(`[${tab}] 요약 금액 문자열`, text.includes(`총 부과: ${c.summary.billableAmount.toLocaleString('ko-KR')}원`) && text.includes(`미납: ${c.summary.unpaidAmount.toLocaleString('ko-KR')}원`));
    // 내부 식별값·메모 미포함
    const leaks = [...Object.values(MID), S1, S2, S3, 'manual-guest-', 'g-1700000000001', 'pid-unlinked-xyz', '운영진메모', 'recv-', 'pay-'].filter((s) => text.includes(s));
    eq(`[${tab}] 내부 ID·메모 미포함`, leaks, []);
    check(`[${tab}] UUID 형식 미포함`, !/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(text));
}

// ═══ 2. 전체 = 회원 + 게스트, 목록 합 = 요약 ═════════════════════════════════
{
    const c = SH.buildPenaltyShareContent(history.records, YEAR, 'all', NOW);
    const m = pick(c.memberSummary), g = pick(c.guestSummary), t = pick(c.summary);
    eq('전체 = 회원 + 게스트', t, { b: m.b + g.b, p: m.p + g.p, u: m.u + g.u });
    eq('회원 목록 합 = 회원 요약', sumLines(c.members), m);
    eq('게스트 목록 합 = 게스트 요약', sumLines(c.guests), g);
    eq('회원 요약 기대값(2026)', m, { b: 5000 + 3000 + 3000 + 4000 + 6000 + 4000 + 2000, p: 3000 + 3000 + 2000 + 2000, u: 5000 + 4000 + 4000 + 4000 });
    const text = SH.formatPenaltyShareText(c);
    check('전체 탭 회원·게스트 내역 줄', text.includes(`(회원 ${m.b.toLocaleString('ko-KR')}원 · 게스트 ${g.b.toLocaleString('ko-KR')}원)`));
    check('미연결 참가자 → 확인 필요 표기', c.summary.reviewAmount === 3000 && text.includes('확인 필요: 3,000원 (부과·미납 미포함)'));
}

// ═══ 3. 정렬 · 동명 · 비대상 · 게스트 묶음 ════════════════════════════════════
{
    const c = SH.buildPenaltyShareContent(history.records, YEAR, 'member', NOW);
    eq('회원 정렬(미납↓ → 부과↓)', c.members.map((l: Any) => l.name), ['알파', '폭스트롯', '같은이름 (동명 1)', '브라보', '같은이름 (동명 2)']);
    // 폭스트롯 미납 4000 / 부과 6000, 같은이름(d) 미납 4000 / 부과 4000 → 부과 큰 쪽 먼저. 브라보(부과 5000, 미납 0) > 같은이름(c)(3000)
    eq('알파 줄', c.members[0], { name: '알파', billable: 9000, paid: 0, unpaid: 9000, review: 0 });
    check('동명 회원 두 줄(비병합)', c.members.filter((l: Any) => l.name.startsWith('같은이름')).length === 2);
    check('비대상만 회원 제외', !c.members.some((l: Any) => l.name.includes('비대상만')));
    const text = SH.formatPenaltyShareText(c);
    check('줄 포맷', text.includes('1. 알파 — 부과 9,000원 / 납부 0원 / 미납 9,000원'));
    check('일부 납부 줄', text.includes('2. 폭스트롯 — 부과 6,000원 / 납부 2,000원 / 미납 4,000원'));
    check('회원 탭엔 게스트 안내 없음', !text.includes('동일 이름 기준'));
    check('회원 줄 라벨 = 부과(청구 대상 라벨 없음)', !text.includes('청구 대상'));
}
{
    const c = SH.buildPenaltyShareContent(history.records, YEAR, 'guest', NOW);
    const groups = M.groupGuestsByName(history.records.filter((r: Any) => r.side === 'guest' && M.inPeriod(r.sessionDate, YEAR)));
    eq('게스트 이름 수 = 화면 이름별 묶음 수', c.guests.length, groups.filter((gr: Any) => gr.summary.billableAmount > 0 || gr.summary.paidAmount > 0 || gr.summary.reviewAmount > 0).length);
    const min = c.guests.find((l: Any) => l.name === '게스트 민' || l.name === '게스트민');
    eq('게스트민 공백 차이 묶음(기존 기준)', min && { b: min.billable, p: min.paid, u: min.unpaid }, { b: 8000, p: 3000, u: 5000 });
    eq('이름 확인 불가 맨 아래', c.guests[c.guests.length - 1].name, '이름 확인 불가');
    const text = SH.formatPenaltyShareText(c);
    check('게스트 동일 이름 안내', text.includes('※ 게스트는 동일 이름 기준 합계(공식 개인별 누적 아님)'));
    check('게스트 줄 라벨 = 청구 대상', text.includes('1. 게스트 민 — 청구 대상 8,000원 / 납부 3,000원 / 미납 5,000원'));
    const guestLines = text.split('\n').filter((l: string) => /^\d+\. /.test(l));
    check('게스트 줄에 "부과" 라벨 없음', guestLines.length === c.guests.length && guestLines.every((l: string) => l.includes(' — 청구 대상 ') && !l.includes(' — 부과 ')));
    check('게스트 요약은 화면과 같은 "총 부과" 유지', text.includes(`총 부과: ${c.summary.billableAmount.toLocaleString('ko-KR')}원`));
    check('작년 게스트 제외(기간)', !text.includes('작년게스트'));
}

// ═══ 4. 기간 필터 · 전체 기간 · 빈 기간 ══════════════════════════════════════
{
    const all = SH.buildPenaltyShareContent(history.records, ALL, 'all', NOW);
    eq('전체 기간 요약 = 화면', pick(all.summary), pick(screenSummary(ALL, 'all')));
    check('전체 기간 표기', SH.formatPenaltyShareText(all).includes('조회 기간: 전체 기간'));
    check('전체 기간엔 작년 포함', SH.formatPenaltyShareText(all).includes('작년게스트'));
    eq('전체 기간 알파 누적', all.members.find((l: Any) => l.name === '알파'), { name: '알파', billable: 18000, paid: 9000, unpaid: 9000, review: 0 });

    const sep = SH.buildPenaltyShareContent(history.records, { from: '2026-09-01', to: '2026-09-01' }, 'all', NOW);
    eq('경계일(9/1 하루) 요약', pick(sep.summary), { b: 4000 + 2000 + 5000 + 1000, p: 2000 + 1000, u: 4000 + 5000 });
    check('경계 밖 6월 미포함', !sep.members.some((l: Any) => l.name === '폭스트롯'));

    const empty = SH.buildPenaltyShareContent(history.records, { from: '2024-01-01', to: '2024-12-31' }, 'all', NOW);
    const et = SH.formatPenaltyShareText(empty);
    check('빈 기간 0원', et.includes('총 부과: 0원') && et.includes('납부 완료: 0원') && et.includes('미납: 0원'));
    check('빈 기간 안내', et.includes('해당 기간 회원 벌금 기록 없음') && et.includes('해당 기간 게스트 벌금 기록 없음'));
    check('빈 기간 게스트 안내 생략', !et.includes('동일 이름 기준'));
    const none = SH.buildPenaltyShareText([], YEAR, 'member', NOW);
    check('데이터 0건', none.includes('해당 기간 회원 벌금 기록 없음') && !none.includes('[게스트별'));
}

// ═══ 5. 결정성 · 기준일 ══════════════════════════════════════════════════════
{
    const a = SH.buildPenaltyShareText(history.records, YEAR, 'all', NOW);
    const b = SH.buildPenaltyShareText([...history.records].reverse(), YEAR, 'all', NOW);
    eq('입력 순서와 무관(결정적)', a, b);
    eq('기준일 자정 직후', SH.localBaseDate(new Date(2026, 0, 1, 0, 5)), '2026.01.01');
    eq('기간 표기(한쪽 열림)', SH.sharePeriodText({ from: '2026-03-01', to: null }), '2026.03.01 ~ 현재');
}

console.log(`\nKDK 누적 벌금 공유 텍스트 fixture: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  FAIL ${f}`); process.exit(1); }
