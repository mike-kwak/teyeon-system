/**
 * TEYEON KDK 누적 벌금 현황 fixture 검증.
 *
 *   실행: node scripts/verify_kdk_penalty_history.mts
 *   (Node 24 type-stripping + scripts/ts-resolve-hook.mjs — DB 미접속. Supabase 클라이언트는 더미 URL 로 생성만 되고 호출되지 않는다.)
 *
 *   검증: 세션 정산 화면 판정(buildKdkPenaltyRows + summarizePenaltyRows)과 누적 집계 일치 · 완납/일부/미납/비대상/면제 ·
 *         pending 이지만 완납 · 취소 납부 제외 · 게스트 취소/복구 · 동명 회원·게스트 · 동명 게스트 비병합 · 긴 이름/접두사 표시 ·
 *         미연결 납부 · 복수 납부 · 기간 경계 · 정정일≠세션일 · 스냅샷 누락 · 0건 · 100/1,000건+ · 페이지 조회 실패 ·
 *         URL query 왕복 · 2026-11-19 정정 회귀(A/B/C/D, 비대상 제외, 11/10 오매칭 보존, 미납 0원, 중복 없음).
 */
import { register } from 'node:module';

register('./ts-resolve-hook.mjs', import.meta.url);

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://127.0.0.1:1';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'fixture-anon-key';

const load = (path: string): Promise<any> => import(path);
const M = await load('../lib/finance/kdkPenaltyHistoryModel.ts');
const S = await load('../lib/finance/kdkSettlementService.ts');
const Q = await load('../lib/finance/kdkPenaltyHistoryQuery.ts');
const SVC = await load('../lib/finance/kdkPenaltyHistoryService.ts');

let passed = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, info = '') => { if (cond) passed += 1; else failures.push(`${name}${info ? ` — ${info}` : ''}`); };
const eq = (name: string, actual: unknown, expected: unknown) => check(name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);

// ── fixture builders ─────────────────────────────────────────────────────────
let seq = 0;
const uid = (p: string) => `${p}-${String(++seq).padStart(6, '0')}`;
const entry = (player_id: string | null, player_name: string, penalty: number, is_guest = false) =>
    ({ player_id, player_name, is_guest, penalty_amount: -penalty, penalty_level: 'L1' });
const zero = (player_id: string, player_name: string) => ({ player_id, player_name, is_guest: false, penalty_amount: 0 });
const recv = (member_id: string, session: string | null, amount: number, status = 'pending') => ({
    id: uid('recv'), member_id, receivable_type: 'penalty', title: 'KDK 벌금', target_year: 2026, target_month: null,
    amount_due: amount, due_date: null, status, exemption_reason: null, memo: null, related_kdk_session_id: session,
    created_by: null, created_at: '2026-01-01', updated_at: '2026-01-01',
});
const pay = (r: { id: string; member_id: string } | null, member_id: string, amount: number, paid_at: string, voided = false) => ({
    id: uid('pay'), member_id, receivable_id: r ? r.id : null, payment_type: 'penalty', amount, paid_at,
    memo: null, is_voided: voided, created_by: null, updated_by: null, created_at: paid_at, updated_at: paid_at,
});
const gpay = (session_id: string, participant_id: string, amount: number, status: 'paid' | 'cancelled', paid_at = '2026-11-19T10:00:00+09:00') =>
    ({ session_id, participant_id, amount, status, paid_at });

function emptyDs(): any {
    return { sessions: [], members: [], receivables: [], payments: [], unlinkedPayments: [], guestAvailable: true, guestPayments: [] };
}

/** 세션 정산 화면과 같은 경로로 세션별 summary 를 만든다(기준값). */
function sessionScreenSummary(ds: any, sessionId: string) {
    const s = ds.sessions.find((x: any) => x.id === sessionId);
    const recvs = ds.receivables.filter((r: any) => r.related_kdk_session_id === sessionId);
    const ids = new Set(recvs.map((r: any) => r.id));
    const pays = ds.payments.filter((p: any) => ids.has(p.receivable_id));
    const paidByParticipant = new Map();
    for (const g of ds.guestPayments) if (g.session_id === sessionId && g.status === 'paid') paidByParticipant.set(g.participant_id, { participantId: g.participant_id, amount: g.amount, paidAt: g.paid_at });
    const rows = S.buildKdkPenaltyRows(s.settlementData, ds.members, recvs, pays, { available: ds.guestAvailable, paidByParticipant });
    return S.summarizePenaltyRows(rows);
}

// ═══ 기본 케이스 1~10 ═══════════════════════════════════════════════════════
{
    const ds = emptyDs();
    const sid = 'sess-basic';
    const mem = (id: string, nickname: string) => { ds.members.push({ id, nickname }); return id; };
    const m1 = mem('m1', '완납삼천'), m2 = mem('m2', '완납오천'), m3 = mem('m3', '일부납부'), m4 = mem('m4', '미납회원'),
        m5 = mem('m5', '비대상회원'), m6 = mem('m6', '펜딩완납'), m7 = mem('m7', '면제회원');
    ds.sessions.push({ id: sid, date: '2026-06-23', title: 'KDK 6월', settlementData: [
        entry(m1, '완납삼천', 3000), entry(m2, '완납오천', 5000), entry(m3, '일부납부', 5000), entry(m4, '미납회원', 3000),
        entry(m5, '비대상회원', 4000), entry(m6, '펜딩완납', 3000), entry(m7, '면제회원', 3000),
        entry('manual-guest-게스트삼', '게스트삼', 3000, true), entry('manual-guest-게스트오', '게스트오', 5000, true),
        entry('g-1700000000001', '게스트취소', 4000, true), entry('g-1700000000002', '게스트복구', 4000, true),
        zero('m8', '무벌금'),
    ] });
    const r1 = recv(m1, sid, 3000, 'paid'), r2 = recv(m2, sid, 5000, 'paid'), r3 = recv(m3, sid, 5000, 'partial'), r4 = recv(m4, sid, 3000),
        r5 = recv(m5, sid, 4000, 'not_target'), r6 = recv(m6, sid, 3000, 'pending'), r7 = recv(m7, sid, 3000, 'exempt');
    ds.receivables.push(r1, r2, r3, r4, r5, r6, r7);
    ds.payments.push(
        pay(r1, m1, 3000, '2026-06-23'), pay(r2, m2, 5000, '2026-06-24'),
        pay(r3, m3, 2000, '2026-06-25'),
        pay(r4, m4, 3000, '2026-06-25', true), // 취소된 납부 → 미납 유지
        pay(r6, m6, 3000, '2026-11-19'),       // pending 이지만 유효 납부 = 청구 → 완납(정정일 11/19)
    );
    ds.guestPayments.push(
        gpay(sid, 'manual-guest-게스트삼', 3000, 'paid'), gpay(sid, 'manual-guest-게스트오', 5000, 'paid'),
        gpay(sid, 'g-1700000000001', 4000, 'cancelled'), gpay(sid, 'g-1700000000002', 4000, 'paid'),
    );
    const h = M.buildPenaltyHistory(ds);
    const by = (name: string) => h.records.find((r: any) => r.displayName === name);
    eq('1 회원 3,000 완납', [by('완납삼천').bucket, by('완납삼천').amountPaid], ['paid', 3000]);
    eq('2 회원 5,000 완납', [by('완납오천').bucket, by('완납오천').amountPaid], ['paid', 5000]);
    eq('3 회원 일부 납부', [by('일부납부').bucket, by('일부납부').status, by('일부납부').remaining], ['unpaid', 'partial', 3000]);
    eq('4 회원 미납(취소 납부 제외)', [by('미납회원').bucket, by('미납회원').amountPaid, by('미납회원').remaining], ['unpaid', 0, 3000]);
    eq('5 회원 비대상 — 미납 아님', [by('비대상회원').bucket, by('비대상회원').remaining], ['excluded', 0]);
    eq('5b 면제 — 미납 아님', [by('면제회원').bucket, by('면제회원').status], ['excluded', 'exempt']);
    eq('6 pending 이지만 실제 완납', [by('펜딩완납').bucket, by('펜딩완납').status], ['paid', 'paid']);
    eq('7 게스트 3,000 완납', [by('게스트삼').bucket, by('게스트삼').side, by('게스트삼').isGuest], ['paid', 'guest', true]);
    eq('8 게스트 5,000 완납', [by('게스트오').bucket, by('게스트오').amountPaid], ['paid', 5000]);
    eq('9 게스트 취소 납부 → 미납', [by('게스트취소').bucket, by('게스트취소').amountPaid], ['unpaid', 0]);
    eq('10 게스트 복구 납부 → 완납', [by('게스트복구').bucket, by('게스트복구').amountPaid], ['paid', 4000]);
    check('0원 참가자는 기록 없음', !by('무벌금'));

    const sum = M.summarizeRecords(h.records);
    const screen = sessionScreenSummary(ds, sid);
    eq('세션 정산 화면 총 벌금 = 누적 원금', sum.grossAmount, screen.totalPenalty);
    eq('세션 정산 화면 납부 완료 금액 = 누적 납부', sum.paidAmount, screen.totalPaid);
    eq('세션 정산 화면 미납 금액 = 누적 미납', sum.unpaidAmount, screen.totalUnpaid);
    eq('원금 = 청구 대상 + 비대상 + 확인 필요', sum.grossAmount, sum.billableAmount + sum.excludedAmount + sum.reviewAmount);
    eq('비대상 금액(not_target 4,000 + exempt 3,000)', sum.excludedAmount, 7000);
    eq('미납 = 일부 3,000 + 미납 3,000 + 게스트 취소 4,000', sum.unpaidAmount, 10000);
    eq('납부율', Math.round(sum.paidRate * 10000), Math.round(((sum.billableAmount - sum.unpaidAmount) / sum.billableAmount) * 10000));
    eq('취소 건수 참고', [h.exceptions.voidedMemberPaymentCount, h.exceptions.cancelledGuestPaymentCount], [1, 1]);

    const agg = M.aggregateMembers(h.records);
    eq('회원 집계에 게스트 없음', agg.every((a: any) => a.memberId.startsWith('m')), true);
    eq('회원 정렬: 청구액 내림차순 → 이름', agg.map((a: any) => a.name), ['완납오천', '일부납부', '미납회원', '완납삼천', '펜딩완납', '면제회원', '비대상회원'].sort((a, b) => {
        const amt: Record<string, number> = { 완납오천: 5000, 일부납부: 5000, 미납회원: 3000, 완납삼천: 3000, 펜딩완납: 3000, 면제회원: 0, 비대상회원: 0 };
        return (amt[b] - amt[a]) || a.localeCompare(b, 'ko');
    }));
    eq('비대상 회원 대표 상태', agg.find((a: any) => a.memberId === m5).bucket, 'excluded');
}

// ═══ 특수 케이스 11~21 ═══════════════════════════════════════════════════════
{
    // 11 동일 이름 회원·게스트 / 12 동일 이름 서로 다른 게스트 / 13 긴 이름 / 14 미연결 납부 / 15 복수 납부
    const ds = emptyDs();
    ds.members.push({ id: 'mk', nickname: '김동명' }, { id: 'mx', nickname: '다중납부' });
    const s1 = 'sess-a', s2 = 'sess-b';
    ds.sessions.push(
        { id: s1, date: '2026-11-10', title: 'KDK 11/10', settlementData: [
            entry('manual-guest-김동명', '김동명(G)', 3000, true), // 게스트 — 동명 회원에게 이름 매칭 금지
            entry('manual-guest-아주아주긴게스트이름입니다정말로깁니다', 'manual-guest-아주아주긴게스트이름입니다정말로깁니다', 5000, true),
            entry('mx', '다중납부', 5000),
        ] },
        { id: s2, date: '2026-10-20', title: 'KDK 10/20', settlementData: [
            entry('g-1690000000000', '박같은', 3000, true), entry('g-1690000000001', '박같은', 4000, true),
        ] },
    );
    // 11/10 오매칭 정정 형태: 동명 회원 청구 = not_target, 회원 납부 void, 게스트 납부 paid
    const wrong = recv('mk', s1, 3000, 'not_target');
    const rx = recv('mx', s1, 5000);
    ds.receivables.push(wrong, rx);
    ds.payments.push(pay(wrong, 'mk', 3000, '2026-11-10', true), pay(rx, 'mx', 2000, '2026-11-10'), pay(rx, 'mx', 3000, '2026-11-12'), pay(rx, 'mx', 5000, '2026-11-13', true));
    ds.unlinkedPayments.push(pay(null, 'mk', 3000, '2026-09-02'), pay(null, 'mx', 4000, '2026-09-03', true));
    ds.guestPayments.push(gpay(s1, 'manual-guest-김동명', 3000, 'paid'), gpay(s2, 'g-1690000000000', 3000, 'paid'));
    const h = M.buildPenaltyHistory(ds);

    const guestKim = h.records.filter((r: any) => r.sessionId === s1 && r.displayName === '김동명');
    eq('11 동명 회원·게스트: 게스트 기록 1건(회원 미연결)', guestKim.map((r: any) => [r.side, r.memberId, r.bucket]), [['guest', null, 'paid']]);
    check('11 동명 회원 쪽 누적 기록 없음', !h.records.some((r: any) => r.memberId === 'mk'));
    eq('11 오매칭 청구는 예외(공식 벌금 대상 아님)로 보존', h.exceptions.orphanReceivables.map((o: any) => [o.memberId, o.reason, o.storedStatus, o.validPaid]), [['mk', 'not_in_settlement', 'not_target', 0]]);

    const parks = h.records.filter((r: any) => r.displayName === '박같은');
    eq('12 동명 게스트 2건 별도 기록', parks.length, 2);
    eq('12 각자 다른 상태', parks.map((r: any) => r.bucket).sort(), ['paid', 'unpaid']);
    check('12 회원 집계에 동명 게스트 없음', M.aggregateMembers(h.records).every((a: any) => a.name !== '박같은'));

    const long = h.records.find((r: any) => r.amount === 5000 && r.side === 'guest');
    eq('13 긴 이름 manual-guest- 접두사 제거', long.displayName, '아주아주긴게스트이름입니다정말로깁니다');
    eq('13 (G) 접미사 제거', guestKim[0].displayName, '김동명');
    eq('13 UUID 이름 대체', M.cleanPenaltyDisplayName('123e4567-e89b-12d3-a456-426614174000', true), '게스트');
    eq('13 g-타임스탬프 이름 대체', M.cleanPenaltyDisplayName('g-1700000000000', true), '게스트');
    check('13 화면 이름에 내부 id 없음', h.records.every((r: any) => !/manual-guest-|^g-\d|[0-9a-f]{8}-[0-9a-f]{4}/i.test(r.displayName)));

    eq('14 미연결 유효 납부만 예외 표시(취소 제외)', h.exceptions.unlinkedPayments.map((p: any) => [p.memberName, p.amount]), [['김동명', 3000]]);
    const sum = M.summarizeRecords(h.records);
    check('14 미연결 납부는 합계 미포함', sum.paidAmount === 3000 + 5000 + 3000, `paid=${sum.paidAmount}`);

    const multi = h.records.find((r: any) => r.memberId === 'mx');
    eq('15 복수 납부(2,000+3,000, 취소 5,000 제외) = 완납 5,000', [multi.bucket, multi.amountPaid], ['paid', 5000]);
    eq('15 초과 납부 없음', h.exceptions.overpaidRecords.length, 0);
}
{
    // 15b 이중 유효 납부(중복 의심) → 초과 납부 예외
    const ds = emptyDs();
    ds.members.push({ id: 'md', nickname: '이중납부' });
    ds.sessions.push({ id: 'sd', date: '2026-09-01', title: 'KDK', settlementData: [entry('md', '이중납부', 3000)] });
    const r = recv('md', 'sd', 3000); ds.receivables.push(r);
    ds.payments.push(pay(r, 'md', 3000, '2026-09-01'), pay(r, 'md', 3000, '2026-11-19'));
    const h = M.buildPenaltyHistory(ds);
    eq('15b 중복 유효 납부 → 초과 납부 예외 표시', h.exceptions.overpaidRecords.map((x: any) => x.amountPaid), [6000]);
    eq('15b 세션 정산 화면과 같은 납부 합계', M.summarizeRecords(h.records).paidAmount, sessionScreenSummary(ds, 'sd').totalPaid);
}
{
    // 16 기간 경계 / 17 정정일과 세션 날짜가 다른 기록 / 18 스냅샷 누락 / 19 0건
    const today = '2026-11-19';
    const yr = M.resolvePeriod('year', {}, today);
    eq('16 올해 범위', yr.range, { from: '2026-01-01', to: '2026-12-31' });
    check('16 1/1 포함', M.inPeriod('2026-01-01', yr.range));
    check('16 12/31 포함', M.inPeriod('2026-12-31', yr.range));
    check('16 작년 12/31 제외', !M.inPeriod('2025-12-31', yr.range));
    const m3 = M.resolvePeriod('3m', {}, today);
    eq('16 지난 3개월', m3.range, { from: '2026-08-19', to: '2026-11-19' });
    check('16 3개월 시작일 포함', M.inPeriod('2026-08-19', m3.range) && !M.inPeriod('2026-08-18', m3.range));
    eq('16 월말 보정(5/31 - 3개월 = 2/28)', M.resolvePeriod('3m', {}, '2026-05-31').range.from, '2026-02-28');
    eq('16 6개월', M.resolvePeriod('6m', {}, today).range.from, '2026-05-19');
    check('16 전체 기간은 날짜 미상 포함', M.inPeriod(null, M.resolvePeriod('all', {}, today).range));
    check('16 기간 지정 시 날짜 미상 제외', !M.inPeriod(null, yr.range));
    eq('16 직접 선택 역전 거부', M.resolvePeriod('custom', { from: '2026-10-01', to: '2026-09-01' }, today).ok, false);
    eq('16 직접 선택 잘못된 날짜 거부', M.resolvePeriod('custom', { from: '2026-02-30', to: '2026-03-01' }, today).ok, false);
    eq('16 직접 선택 누락 거부', M.resolvePeriod('custom', { from: '2026-02-01' }, today).ok, false);
    eq('16 직접 선택 하루', M.resolvePeriod('custom', { from: '2026-06-23', to: '2026-06-23' }, today).range, { from: '2026-06-23', to: '2026-06-23' });
    eq('16 KST 오늘(UTC 15시 = 다음날 0시)', M.todayKst(new Date('2026-12-31T15:00:00Z')), '2027-01-01');

    const ds = emptyDs();
    ds.members.push({ id: 'mm', nickname: '정정회원' });
    ds.sessions.push(
        { id: 'sj', date: '2026-06-23', title: 'KDK', settlementData: [entry('mm', '정정회원', 3000)] },
        { id: 'sn', date: '2026-07-07', title: '스냅샷 없음', settlementData: null },
        { id: 'se', date: '2026-07-14', title: '빈 스냅샷', settlementData: [] },
        { id: 'su', date: null, title: '날짜 없음', settlementData: [entry('mm', '정정회원', 3000)] },
    );
    const r = recv('mm', 'sj', 3000); ds.receivables.push(r);
    ds.payments.push(pay(r, 'mm', 3000, '2026-11-19'));
    const rn = recv('mm', 'sn', 3000); ds.receivables.push(rn);
    const h = M.buildPenaltyHistory(ds);
    const nov = M.resolvePeriod('custom', { from: '2026-11-01', to: '2026-11-30' }, today);
    const jun = M.resolvePeriod('custom', { from: '2026-06-01', to: '2026-06-30' }, today);
    check('17 11/19 정정 납부는 6/23 세션에 귀속(11월 조회 0건)', h.records.filter((x: any) => M.inPeriod(x.sessionDate, nov.range)).length === 0);
    check('17 6월 조회에 포함', h.records.filter((x: any) => M.inPeriod(x.sessionDate, jun.range)).length === 1);
    eq('17 납부일은 상세 정보로만', h.records.find((x: any) => x.sessionId === 'sj').paidAt, '2026-11-19');
    eq('18 스냅샷 누락 세션은 예외', h.exceptions.noSnapshotSessions.map((s: any) => s.id), ['sn']);
    eq('18 스냅샷 누락 세션 청구 → 예외(no_snapshot), 0원 단정 안 함', h.exceptions.orphanReceivables.map((o: any) => o.reason), ['no_snapshot']);
    eq('18 스냅샷 누락 세션 summary hasSnapshot=false', h.sessions.find((s: any) => s.sessionId === 'sn').hasSnapshot, false);
    eq('18 빈 스냅샷은 정상(벌금 없음)', [h.sessions.find((s: any) => s.sessionId === 'se').hasSnapshot, h.sessions.find((s: any) => s.sessionId === 'se').recordCount], [true, 0]);
    eq('18 날짜 미상 세션 수', h.exceptions.undatedSessionCount, 1);

    const z = M.buildPenaltyHistory(emptyDs());
    const zs = M.summarizeRecords(z.records);
    eq('19 0건 요약', [zs.recordCount, zs.grossAmount, zs.paidAmount, zs.paidRate], [0, 0, 0, null]);
    eq('19 0건 회원 집계', M.aggregateMembers(z.records), []);
}
{
    // 20 100건+ / 21 1,000건+ (정확성 + 처리 시간)
    for (const n of [120, 1500]) {
        const ds = emptyDs();
        let expectPaid = 0, expectUnpaid = 0;
        for (let i = 0; i < 40; i++) ds.members.push({ id: `bm${i}`, nickname: `회원${i}` });
        const perSession = 15;
        const sessions = Math.ceil(n / perSession);
        for (let s = 0; s < sessions; s++) {
            const sid = `bs${s}`;
            const date = `2026-${String(1 + (s % 12)).padStart(2, '0')}-${String(1 + (s % 28)).padStart(2, '0')}`;
            const data: any[] = [];
            for (let k = 0; k < perSession && s * perSession + k < n; k++) {
                const idx = (s * 7 + k) % 40;
                if (k < 12) {
                    const mid = `bm${(idx + k) % 40}`;
                    if (data.some((d) => d.player_id === mid)) continue;
                    data.push(entry(mid, `회원${(idx + k) % 40}`, 3000));
                    const r = recv(mid, sid, 3000); ds.receivables.push(r);
                    if ((s + k) % 5 !== 0) { ds.payments.push(pay(r, mid, 3000, date)); expectPaid += 3000; } else expectUnpaid += 3000;
                } else {
                    const gid = `g-${s}-${k}`;
                    data.push(entry(gid, '게스트', 4000, true));
                    if (k % 2 === 0) { ds.guestPayments.push(gpay(sid, gid, 4000, 'paid')); expectPaid += 4000; } else expectUnpaid += 4000;
                }
            }
            ds.sessions.push({ id: sid, date, title: `KDK ${s}`, settlementData: data });
        }
        const t0 = Date.now();
        const h = M.buildPenaltyHistory(ds);
        const ms = Date.now() - t0;
        const sum = M.summarizeRecords(h.records);
        eq(`${n >= 1000 ? 21 : 20} ${h.records.length}건 납부 합계`, sum.paidAmount, expectPaid);
        eq(`${n >= 1000 ? 21 : 20} ${h.records.length}건 미납 합계`, sum.unpaidAmount, expectUnpaid);
        let viaScreen = 0;
        for (const s of ds.sessions) viaScreen += sessionScreenSummary(ds, s.id).totalPaid;
        eq(`${n >= 1000 ? 21 : 20} 세션 화면 합 = 누적`, sum.paidAmount, viaScreen);
        check(`${n >= 1000 ? 21 : 20} 처리 시간 < 1.5s`, ms < 1500, `${ms}ms`);
        check(`${n >= 1000 ? 21 : 20} 레코드 수 ≥ ${Math.floor(n * 0.8)}`, h.records.length >= Math.floor(n * 0.8), String(h.records.length));
    }
}
{
    // 22 Supabase 일부 페이지 조회 실패 → 예외(부분 결과 반환 금지) / 페이지네이션 이어 받기
    const rows = Array.from({ length: 2345 }, (_, i) => ({ id: i }));
    const pages: number[] = [];
    const ok = await SVC.fetchAllPages('테스트', async (from: number, to: number) => { pages.push(from); return { data: rows.slice(from, to + 1), error: null }; }, 1000);
    eq('22 페이지네이션 전부 수신(2,345건)', ok.length, 2345);
    eq('22 페이지 요청 범위', pages, [0, 1000, 2000]);
    const exact = await SVC.fetchAllPages('테스트', async (from: number, to: number) => ({ data: rows.slice(0, 2000).slice(from, to + 1), error: null }), 1000);
    eq('22 정확히 페이지 배수(2,000건)', exact.length, 2000);
    let threw = false;
    try {
        await SVC.fetchAllPages('테스트', async (from: number) => from === 1000 ? { data: null, error: { message: 'timeout' } } : { data: rows.slice(from, from + 1000), error: null }, 1000);
    } catch (e: any) { threw = /테스트 조회에 실패/.test(e.message); }
    check('22 2페이지 실패 → 예외(일부 결과 미반환)', threw);
}
{
    // 23~25 URL 상태(필터 변경 · 뒤로 가기 · 직접 접근) — 화면은 URL 을 단일 상태로 사용.
    const parse = (s: string) => Q.readHistoryQuery(new URLSearchParams(s));
    // V6: 표시 방식(view, 기본 종합 'summary') 필드가 추가됐다 — 기존 필드 기대값은 그대로.
    eq('25 기본(직접 접근, 파라미터 없음)', parse(''), { tab: 'all', period: 'year', from: '', to: '', q: '', gview: 'name', view: 'summary' });
    eq('25 직접 접근 type=member&period=year', parse('type=member&period=year'), { tab: 'member', period: 'year', from: '', to: '', q: '', gview: 'name', view: 'summary' });
    eq('25 알 수 없는 값은 기본값', parse('type=hack&period=forever&gv=zzz&view=zzz'), { tab: 'all', period: 'year', from: '', to: '', q: '', gview: 'name', view: 'summary' });
    const q = { tab: 'guest', period: 'custom', from: '2026-06-01', to: '2026-09-30', q: '홍길동', gview: 'records', view: 'summary' };
    eq('24 왕복(새로고침·뒤로 가기 복원)', parse(Q.historyQueryString(q).slice(1)), q);
    eq('23 기본값은 URL 생략', Q.historyQueryString({ tab: 'all', period: 'year', from: 'x', to: 'y', q: '' }), '');
    eq('23 게스트 이름별(기본)은 gv 생략', Q.historyQueryString({ tab: 'guest', period: 'year', q: '', gview: 'name' }), '?type=guest');
    eq('23 게스트 외 탭에서는 gv 미포함', Q.historyQueryString({ tab: 'member', period: 'year', q: '', gview: 'records' }), '?type=member');
    eq('23 프리셋 기간은 from/to 미포함', Q.historyQueryString({ tab: 'member', period: '3m', from: '2026-01-01', to: '2026-02-01', q: '' }), '?type=member&period=3m');
    // V6 표시 방식 URL
    eq('V6 기본(종합)은 view 생략', Q.historyQueryString({ tab: 'member', period: 'year', q: '', view: 'summary' }), '?type=member');
    eq('V6 금액 모드 URL', Q.historyQueryString({ tab: 'member', period: 'year', q: '', view: 'amount' }), '?type=member&view=amount');
    for (const v of ['amount', 'participation', 'penalty']) {
        const qq = { tab: 'member', period: 'year', from: '', to: '', q: '', gview: 'name', view: v };
        eq(`V6 왕복 view=${v}`, parse(Q.historyQueryString(qq).slice(1)), qq);
    }
}

// ═══ 게스트 동일 이름 묶음(화면 표시용) ═══════════════════════════════════════
{
    // 49건 · 205,000원 형태(실제 운영 데이터 아님): 4,000×40 + 5,000×9
    const ds = emptyDs();
    ds.members.push({ id: 'gm-kim', nickname: '김민수' }); // 게스트와 같은 이름의 회원 — 절대 병합 금지
    const names = ['김민수', '김민수', '김민수', '김 민수', '김민', '이영희', '이영희', 'Kim', 'kim', '박철수 ', ' 박철수', '이영희'.normalize('NFD')];
    const plan: [string, number][] = [];
    for (let i = 0; plan.length < 49; i++) {
        const n = i < names.length ? names[i] : `게스트${i % 17}`;
        plan.push([n, plan.length < 40 ? 4000 : 5000]);
    }
    // 이름 확인 불가 2건(빈 이름 · 타임스탬프 id 이름)
    plan[47] = ['', 5000]; plan[48] = ['g-1700000000999', 5000];
    plan.forEach(([name, amount], k) => {
        const sid = `gs${k % 7}`;
        let sess = ds.sessions.find((x: any) => x.id === sid);
        if (!sess) { sess = { id: sid, date: `2026-0${1 + (k % 7)}-1${k % 7}`, title: `KDK ${sid}`, settlementData: [] }; ds.sessions.push(sess); }
        const pid = `gp-${k}`;
        sess.settlementData.push(entry(pid, name ? `${name}(G)` : name, amount, true));
        ds.guestPayments.push(gpay(sid, pid, amount, 'paid'));
    });
    // 같은 이름 회원의 회원 벌금(별도 세션)
    ds.sessions.push({ id: 'gs-m', date: '2026-08-01', title: 'KDK 회원', settlementData: [entry('gm-kim', '김민수', 3000)] });
    const rk = recv('gm-kim', 'gs-m', 3000); ds.receivables.push(rk); ds.payments.push(pay(rk, 'gm-kim', 3000, '2026-08-01'));

    const h = M.buildPenaltyHistory(ds);
    const guests = h.records.filter((r: any) => r.side === 'guest');
    const gs = M.summarizeRecords(guests);
    eq('G0 게스트 기록 49건 · 205,000원(묶음 전후 불변)', [guests.length, gs.paidAmount, gs.grossAmount], [49, 205000, 205000]);
    const groups = M.groupGuestsByName(h.records);
    const sumOf = (k: string) => groups.reduce((a: number, g: any) => a + g.summary[k], 0);
    eq('G1 그룹 납부 합 = 게스트 전체 납부', sumOf('paidAmount'), gs.paidAmount);
    eq('G1 그룹 원금 합 = 게스트 전체 원금', sumOf('grossAmount'), gs.grossAmount);
    eq('G1 그룹 미납 합 = 게스트 전체 미납', sumOf('unpaidAmount'), gs.unpaidAmount);
    eq('G1 그룹 기록 수 합 = 49', groups.reduce((a: number, g: any) => a + g.count, 0), 49);
    const allKeys = groups.flatMap((g: any) => g.records.map((r: any) => r.key));
    eq('G1 기록 중복·누락 없음', [allKeys.length, new Set(allKeys).size], [49, 49]);
    const by = (name: string) => groups.find((g: any) => !g.unknown && M.guestNameKey(g.name) === M.guestNameKey(name));
    check('G2 공백 차이("김 민수")는 같은 이름 묶음', !!by('김민수') && by('김민수').records.some((r: any) => r.displayName === '김 민수'));
    check('G2 앞뒤 공백("박철수 "/" 박철수")은 같은 묶음', !!by('박철수') && by('박철수').count === 2);
    check('G2 NFD 한글은 NFC 와 같은 묶음', !!by('이영희') && by('이영희').records.some((r: any) => r.displayName !== r.displayName.normalize('NFC')));
    check('G3 부분 일치("김민")는 별도 묶음', !!by('김민') && by('김민').records.every((r: any) => M.guestNameKey(r.displayName) === '김민'));
    check('G3 대소문자 다른 "Kim"/"kim" 별도 묶음', groups.filter((g: any) => /^kim$/i.test(g.name)).length === 2);
    check('G4 회원 김민수는 게스트 묶음에 없음', groups.every((g: any) => g.records.every((r: any) => r.side === 'guest' && r.memberId === null)));
    eq('G4 회원 김민수 누적은 회원 집계에만', M.aggregateMembers(h.records).map((a: any) => [a.name, a.paidAmount]), [['김민수', 3000]]);
    const unk = groups.find((g: any) => g.unknown);
    eq('G5 이름 확인 불가 기록 별도 그룹(2건) · 맨 아래', [unk?.count, groups[groups.length - 1] === unk], [2, true]);
    check('G5 확인 불가 기록은 이름 그룹에 섞이지 않음', !groups.some((g: any) => !g.unknown && g.records.some((r: any) => !r.nameKnown)));
    check('G6 (G) 표기 제거(G 배지로만 표시)', guests.every((r: any) => !/\(G\)/i.test(r.displayName)));
    check('G7 그룹 내 기록은 최신 세션 순', groups.every((g: any) => g.records.every((r: any, k: number, a: any[]) => k === 0 || String(a[k - 1].sessionDate) >= String(r.sessionDate))));
    check('G8 정렬: 원금 내림차순', groups.filter((g: any) => !g.unknown).every((g: any, k: number, a: any[]) => k === 0 || a[k - 1].summary.grossAmount >= g.summary.grossAmount));
    const searched = M.groupGuestsByName(guests.filter((r: any) => M.matchesSearch(r.displayName, '김민')));
    eq('G9 검색 "김민" → 김민수·김민 각각(검색은 부분 일치, 병합은 안 함)', searched.map((g: any) => M.guestNameKey(g.name)).sort(), ['김민', '김민수']);
    const ds2 = emptyDs();
    ds2.sessions.push({ id: 'u1', date: '2026-03-01', title: 'K', settlementData: [entry('ga', '홍길동', 4000, true), entry('gb', '홍길동', 3000, true)] });
    ds2.guestPayments.push(gpay('u1', 'ga', 4000, 'paid'), gpay('u1', 'gb', 3000, 'cancelled'));
    const g2 = M.groupGuestsByName(M.buildPenaltyHistory(ds2).records);
    eq('G10 같은 이름 묶음: 납부 4,000 · 미납 3,000 · 대표 상태 미납', [g2.length, g2[0].summary.paidAmount, g2[0].summary.unpaidAmount, g2[0].bucket], [1, 4000, 3000, 'unpaid']);
}

// ═══ 2026-11-19 운영 정정 회귀(fixture — 실제 운영 데이터 아님) ══════════════
{
    // 확인된 5개 세션 형태: 6/23 10명 40,000 · 6/30 3명 13,000(+비대상 2명 8,000) · 9/1 9명 37,000(+비대상 1명 3,000)
    //                       10/20 14명 56,000 · 11/10 14명 56,000(동명 오매칭 정정분 보존). 전체 미납 0원.
    const ds = emptyDs();
    let n = 0;
    const tags = { A: 0, B: 0, C: 0, D: 0 };
    const addMember = () => { const id = `rm${++n}`; ds.members.push({ id, nickname: `회원${n}` }); return id; };
    function session(id: string, date: string, plan: { kind: 'A' | 'B' | 'M' | 'C' | 'D' | 'G' | 'NT'; amount: number }[]) {
        const data: any[] = [];
        for (const p of plan) {
            if (p.kind === 'C' || p.kind === 'D' || p.kind === 'G') {
                const gid = `manual-guest-게스트${++n}`;
                data.push(entry(gid, `게스트${n}(G)`, p.amount, true));
                if (p.kind === 'D') { ds.guestPayments.push(gpay(id, gid, p.amount, 'paid')); tags.D += p.amount; } // cancelled → paid 복구(현재 상태 = paid)
                else { ds.guestPayments.push(gpay(id, gid, p.amount, 'paid')); if (p.kind === 'C') tags.C += p.amount; }
                continue;
            }
            const mid = addMember();
            data.push(entry(mid, `회원${n}`, p.amount));
            if (p.kind === 'NT') { ds.receivables.push(recv(mid, id, p.amount, 'not_target')); continue; }
            if (p.kind === 'A') { // 기존 미납 청구(status pending 유지) + 정정 납부(11/19)
                const r = recv(mid, id, p.amount, 'pending'); ds.receivables.push(r);
                ds.payments.push(pay(r, mid, p.amount, '2026-11-19')); tags.A += p.amount; continue;
            }
            if (p.kind === 'B') { // 청구 신규 등록 + 납부 등록
                const r = recv(mid, id, p.amount, 'paid'); ds.receivables.push(r);
                ds.payments.push(pay(r, mid, p.amount, '2026-11-19')); tags.B += p.amount; continue;
            }
            const r = recv(mid, id, p.amount, 'paid'); ds.receivables.push(r); // 기존 정상 납부
            ds.payments.push(pay(r, mid, p.amount, date));
        }
        ds.sessions.push({ id, date, title: `KDK ${date}`, settlementData: data });
    }
    const rep = (k: any, amount: number, c: number) => Array.from({ length: c }, () => ({ kind: k, amount }));
    session('s0623', '2026-06-23', [...rep('A', 4000, 4), ...rep('M', 4000, 2), ...rep('C', 4000, 4)]);                                   // 10명 40,000
    session('s0630', '2026-06-30', [...rep('A', 4000, 1), { kind: 'B', amount: 5000 }, { kind: 'D', amount: 4000 }, ...rep('NT', 4000, 2)]); // 3명 13,000 + NT 8,000
    session('s0901', '2026-09-01', [...rep('A', 4000, 3), { kind: 'A', amount: 5000 }, ...rep('B', 4000, 3), { kind: 'C', amount: 4000 }, { kind: 'D', amount: 4000 }, { kind: 'NT', amount: 3000 }]); // 9명 37,000 + NT 3,000
    session('s1020', '2026-10-20', [...rep('A', 4000, 3), ...rep('B', 4000, 2), ...rep('M', 4000, 6), ...rep('C', 4000, 3)]);              // 14명 56,000
    session('s1110', '2026-11-10', [...rep('A', 4000, 1), { kind: 'B', amount: 4000 }, ...rep('M', 4000, 10), ...rep('G', 4000, 2)]);        // 14명 56,000
    // 11/10 동명 오매칭 정정분: 세션 비참가 회원 청구 not_target + 회원 납부 void (게스트 납부는 위 G 로 paid)
    ds.members.push({ id: 'rm-same', nickname: '게스트동명' });
    const wrong = recv('rm-same', 's1110', 3000, 'not_target'); ds.receivables.push(wrong);
    ds.payments.push(pay(wrong, 'rm-same', 3000, '2026-11-10', true));

    const h = M.buildPenaltyHistory(ds);
    const expect: Record<string, [number, number, number, number]> = { // paidCount, paid, unpaid, excluded
        s0623: [10, 40000, 0, 0], s0630: [3, 13000, 0, 8000], s0901: [9, 37000, 0, 3000], s1020: [14, 56000, 0, 0], s1110: [14, 56000, 0, 0],
    };
    for (const [sid, [cnt, paid, unpaid, excl]] of Object.entries(expect)) {
        const s = h.sessions.find((x: any) => x.sessionId === sid);
        eq(`회귀 ${sid} 납부 ${cnt}명/${paid}/미납 ${unpaid}/비대상 ${excl}`, [s.paidCount, s.paidAmount, s.unpaidAmount, s.excludedAmount], [cnt, paid, unpaid, excl]);
        const screen = sessionScreenSummary(ds, sid);
        eq(`회귀 ${sid} 세션 정산 화면과 일치`, [screen.paidCount, screen.totalPaid, screen.totalUnpaid], [s.paidCount, s.paidAmount, s.unpaidAmount]);
    }
    const all = M.summarizeRecords(h.records);
    eq('회귀 전체 미납 0원', all.unpaidAmount, 0);
    eq('회귀 전체 납부 = 5개 세션 합(202,000)', all.paidAmount, 40000 + 13000 + 37000 + 56000 + 56000);
    eq('회귀 비대상 제외(11,000, 미납 아님)', [all.excludedAmount, all.excludedCount], [11000, 3]);
    eq('회귀 납부율 100%', all.paidRate, 1);
    check('회귀 A(pending+정정 납부) 전부 완납', h.records.filter((r: any) => r.status === 'paid').length === all.paidCount);
    eq('회귀 정정 구분 합(A/B/C/D) 포함', [tags.A > 0, tags.B > 0, tags.C > 0, tags.D > 0], [true, true, true, true]);
    eq('회귀 11/10 오매칭 청구 보존(예외, 합계 미포함)', h.exceptions.orphanReceivables.map((o: any) => [o.memberId, o.storedStatus, o.validPaid]), [['rm-same', 'not_target', 0]]);
    check('회귀 11/10 오매칭 회원 누적 기록 없음', !h.records.some((r: any) => r.memberId === 'rm-same'));
    eq('회귀 중복 납부 없음', h.exceptions.overpaidRecords.length, 0);
    const keys = h.records.map((r: any) => r.key);
    eq('회귀 레코드 키 중복 없음', new Set(keys).size, keys.length);
    const memberPaid = M.aggregateMembers(h.records).reduce((a: number, m: any) => a + m.paidAmount, 0);
    const guestPaid = M.summarizeRecords(h.records.filter((r: any) => r.side === 'guest')).paidAmount;
    eq('회귀 회원 납부 + 게스트 납부 = 전체(중복 합산 없음)', memberPaid + guestPaid, all.paidAmount);
    const sessionSum = h.sessions.reduce((a: number, s: any) => a + s.paidAmount, 0);
    eq('회귀 세션별 합 = 전체', sessionSum, all.paidAmount);
}

console.log(`\nKDK 누적 벌금 현황 fixture: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
    for (const f of failures) console.log('  ✗', f);
    process.exit(1);
}
