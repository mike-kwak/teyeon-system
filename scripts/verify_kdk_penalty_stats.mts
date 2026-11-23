/**
 * TEYEON KDK 누적 벌금 V6 — 참가 횟수 · 벌금 발생 횟수 · 벌금 발생률 fixture 검증.
 *
 *   실행: node scripts/verify_kdk_penalty_stats.mts
 *   (Node 24 type-stripping + scripts/ts-resolve-hook.mjs — DB 미접속. 실제 운영 데이터 아님.)
 *
 *   검증: 참가 0/1/10/12/20회 · 벌금 0/1/3회 · 발생률(25% 등 · 참가 0 → '—') · 같은 세션 여러 경기 1회 ·
 *         같은 세션 여러 벌금 항목 1회 · 미납/완납 모두 발생 · 비대상/면제(취소) 제외 · 납부 취소는 발생 유지 ·
 *         확인 필요(미등록) 별도 · 동명 게스트 비병합 · 게스트 회원 오연결 금지 · 비공식/스냅샷 없는 세션 제외 ·
 *         이름 변경 회원 동일 집계 · 기간 필터 · 탭 필터 · 정렬(모드별 · 동률 V5 순서) ·
 *         V5 금액 불변(aggregateMembers · 공유 · 이미지 레이아웃) · 벌금 발생 ≤ 참가 · 이미지 문서 모드 반영.
 */
import { register } from 'node:module';

register('./ts-resolve-hook.mjs', import.meta.url);

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://127.0.0.1:1';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'fixture-anon-key';

type Any = Record<string, any>;
const load = (path: string): Promise<Any> => import(path);
const M = await load('../lib/finance/kdkPenaltyHistoryModel.ts');
const S = await load('../lib/finance/kdkPenaltyStatsModel.ts');
const SH = await load('../lib/finance/kdkPenaltyHistoryShare.ts');
const LY = await load('../lib/finance/kdkPenaltyReportLayout.ts');

let passed = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, info = '') => { if (cond) passed += 1; else failures.push(`${name}${info ? ` — ${info}` : ''}`); };
const eq = (name: string, actual: unknown, expected: unknown) => check(name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);

// ── fixture ──────────────────────────────────────────────────────────────────
let seq = 0;
const uid = (p: string) => `${p}-${String(++seq).padStart(6, '0')}`;
/** settlement 항목. penalty 0 = 벌금 없는 참가자(실제 스냅샷과 같이 전원 기록). */
const entry = (player_id: string | null, player_name: string, penalty = 0, is_guest = false) =>
    ({ player_id, player_name, is_guest, penalty_amount: penalty ? -penalty : 0, penalty_level: penalty ? 'L1' : null });
const recv = (member_id: string, session: string, amount: number, status = 'pending') => ({
    id: uid('recv'), member_id, receivable_type: 'penalty', title: 'KDK 벌금', target_year: 2026, target_month: null,
    amount_due: amount, due_date: null, status, exemption_reason: null, memo: null, related_kdk_session_id: session,
    created_by: null, created_at: '2026-01-01', updated_at: '2026-01-01',
});
const pay = (r: { id: string; member_id: string }, amount: number, paid_at: string, voided = false) => ({
    id: uid('pay'), member_id: r.member_id, receivable_id: r.id, payment_type: 'penalty', amount, paid_at,
    memo: null, is_voided: voided, created_by: null, updated_by: null, created_at: paid_at, updated_at: paid_at,
});
const emptyDs = (): Any => ({ sessions: [], members: [], receivables: [], payments: [], unlinkedPayments: [], guestAvailable: true, guestPayments: [] });
const day = (i: number) => {
    const d = new Date(Date.UTC(2026, 0, 6 + i * 7));
    return d.toISOString().slice(0, 10);
};
/** 세션 n개 생성 → 반환: 세션 id 배열. */
function addSessions(ds: Any, n: number, startIdx = 0): string[] {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
        const id = uid('sess');
        ds.sessions.push({ id, date: day(startIdx + i), title: `KDK ${startIdx + i + 1}회차`, settlementData: [] });
        ids.push(id);
    }
    return ids;
}
const sess = (ds: Any, id: string) => ds.sessions.find((s: Any) => s.id === id);
/** 회원 참가 추가(벌금 금액이 있으면 settlement 에 음수 · 청구 생성). */
function join(ds: Any, sid: string, m: { id: string; nickname: string }, penalty = 0, opts: { status?: string; paid?: boolean; voidPay?: boolean; noRecv?: boolean } = {}) {
    sess(ds, sid).settlementData.push(entry(m.id, m.nickname, penalty));
    if (penalty && !opts.noRecv) {
        const r = recv(m.id, sid, penalty, opts.status || 'pending');
        ds.receivables.push(r);
        if (opts.paid) ds.payments.push(pay(r, penalty, sess(ds, sid).date, false));
        if (opts.voidPay) ds.payments.push(pay(r, penalty, sess(ds, sid).date, true));
    }
}
const build = (ds: Any) => {
    const h = M.buildPenaltyHistory(ds);
    return { ...h, participations: S.buildParticipations(ds.sessions, ds.members) };
};
const ALL = { from: null, to: null };
const statsOf = (h: Any, range: Any = ALL) => S.aggregateMemberStats(
    h.records.filter((r: Any) => r.side === 'member' && M.inPeriod(r.sessionDate, range)),
    S.participationsInPeriod(h.participations, range),
);
const rowOf = (rows: Any[], id: string) => rows.find((r) => r.memberId === id);

// ═══ 1. 기본 횟수 케이스 ═══════════════════════════════════════════════════════
const ds = emptyDs();
const mk = (nickname: string) => { const m = { id: uid('mem'), nickname }; ds.members.push(m); return m; };
const zero = mk('영회원');        // 참가 0 · 벌금 0
const one0 = mk('하나무벌');      // 참가 1 · 벌금 0
const one1 = mk('하나한벌');      // 참가 1 · 벌금 1
const ten3 = mk('열셋');          // 참가 10 · 벌금 3
const tw3 = mk('열둘셋');         // 참가 12 · 벌금 3 · 18,000원
const tw0 = mk('스물무벌');       // 참가 20 · 벌금 0
const sids = addSessions(ds, 20);
join(ds, sids[0], one0);
join(ds, sids[0], one1, 3000, { paid: true });
sids.slice(0, 10).forEach((sid, i) => join(ds, sid, ten3, i < 3 ? 5000 : 0, { paid: i === 0 }));
sids.slice(0, 12).forEach((sid, i) => join(ds, sid, tw3, i % 4 === 0 ? 6000 : 0, { paid: i === 4 }));
sids.forEach((sid) => join(ds, sid, tw0));

{
    const h = build(ds);
    const rows = statsOf(h);
    check('1 참가 0 · 벌금 0 회원은 목록에 없음', !rowOf(rows, zero.id));
    eq('1 참가 1 · 벌금 0', [rowOf(rows, one0.id)?.participationCount, rowOf(rows, one0.id)?.penaltyCount, rowOf(rows, one0.id)?.penaltyRate], [1, 0, 0]);
    eq('1 참가 1 · 벌금 1', [rowOf(rows, one1.id)?.participationCount, rowOf(rows, one1.id)?.penaltyCount, rowOf(rows, one1.id)?.penaltyRate], [1, 1, 1]);
    eq('1 참가 10 · 벌금 3', [rowOf(rows, ten3.id)?.participationCount, rowOf(rows, ten3.id)?.penaltyCount], [10, 3]);
    eq('1 참가 10 · 벌금 3 → 30%', S.formatPenaltyRate(rowOf(rows, ten3.id)?.penaltyRate), '30%');
    const r12 = rowOf(rows, tw3.id);
    eq('1 예시: 참가 12 · 벌금 3 · 18,000원 · 25%', [r12?.participationCount, r12?.penaltyCount, r12?.billableAmount, S.formatPenaltyRate(r12?.penaltyRate)], [12, 3, 18000, '25%']);
    eq('1 참가 20 · 벌금 0 → 0%', [rowOf(rows, tw0.id)?.participationCount, rowOf(rows, tw0.id)?.penaltyCount, S.formatPenaltyRate(rowOf(rows, tw0.id)?.penaltyRate)], [20, 0, '0%']);
    eq('1 참가 0 → 발생률 —', S.formatPenaltyRate(null), '—');
    eq('1 33.33% 내림 표기', S.formatPenaltyRate(1 / 3), '33.3%');
    eq('1 2/3 내림 표기', S.formatPenaltyRate(2 / 3), '66.6%');
    check('1 모든 회원 벌금 발생 ≤ 참가', rows.every((r: Any) => r.penaltyCount <= r.participationCount && !r.inconsistent));
    // V5 금액 불변: 금액 필드 = aggregateMembers 값 그대로.
    const v5 = M.aggregateMembers(h.records.filter((r: Any) => r.side === 'member'));
    const pick = (m: Any) => ({ memberId: m.memberId, name: m.name, sessionCount: m.sessionCount, billableAmount: m.billableAmount, paidAmount: m.paidAmount, unpaidAmount: m.unpaidAmount, excludedAmount: m.excludedAmount, reviewAmount: m.reviewAmount, bucket: m.bucket });
    eq('1 금액 필드 = V5 aggregateMembers', S.memberRowsForView(rows, 'amount').map(pick), v5.map(pick));
    check('1 미납 · 완납 모두 벌금 발생(납부 여부 무관)', rowOf(rows, ten3.id)?.penaltyCount === 3 && rowOf(rows, ten3.id)?.unpaidAmount === 10000 && rowOf(rows, ten3.id)?.paidAmount === 5000);
}

// ═══ 2. 정렬 ═════════════════════════════════════════════════════════════════
{
    const h = build(ds);
    const rows = statsOf(h);
    const names = (v: string) => S.memberRowsForView(rows, v).map((r: Any) => r.name);
    eq('2 종합 = 누적 벌금 내림차순(V5 순서) → 이름', names('summary'), ['열둘셋', '열셋', '하나한벌', '스물무벌', '하나무벌']);
    eq('2 금액 = V5 목록(벌금 기록 회원만)', names('amount'), ['열둘셋', '열셋', '하나한벌']);
    eq('2 참가 = 참가 내림차순', names('participation'), ['스물무벌', '열둘셋', '열셋', '하나한벌', '하나무벌']);
    eq('2 벌금 횟수 = 벌금 발생 내림차순(동률 → 누적 벌금)', names('penalty'), ['열둘셋', '열셋', '하나한벌', '스물무벌', '하나무벌']);
    // 발생률만으로 순위를 바꾸지 않는다: 하나한벌(100%)이 열셋(30%)보다 아래.
    check('2 발생률 단독 정렬 없음', names('penalty').indexOf('하나한벌') > names('penalty').indexOf('열셋'));
}

// ═══ 3. 같은 세션 여러 경기 · 여러 벌금 항목 · 취소 · 확인 필요 ═══════════════════
{
    const d = emptyDs();
    const a = { id: 'm-a', nickname: '중복참가' }; const b = { id: 'm-b', nickname: '중복청구' };
    const c = { id: 'm-c', nickname: '면제회원' }; const e = { id: 'm-e', nickname: '비대상회원' };
    const v = { id: 'm-v', nickname: '납부취소' }; const u = { id: 'm-u', nickname: '미등록' };
    d.members.push(a, b, c, e, v, u);
    const [s1, s2] = addSessions(d, 2);
    // 같은 세션 여러 경기: 스냅샷에 같은 회원이 두 번 기록돼도(방어) 참가 1회.
    join(d, s1, a, 3000); sess(d, s1).settlementData.push(entry(a.id, a.nickname, 0));
    // 같은 세션 여러 벌금 항목(중복 청구 2건).
    join(d, s1, b, 3000); d.receivables.push(recv(b.id, s1, 3000));
    join(d, s1, c, 5000, { status: 'exempt' });
    join(d, s2, e, 5000, { status: 'not_target' });
    join(d, s1, v, 3000, { voidPay: true }); // 납부 취소 → 미납 상태로 벌금 발생 유지
    join(d, s1, u, 3000, { noRecv: true }); // 공식 벌금 있으나 Finance 미등록 → 확인 필요
    const h = build(d);
    const rows = statsOf(h);
    eq('3 같은 세션 여러 경기 → 참가 1 · 벌금 1', [rowOf(rows, a.id)?.participationCount, rowOf(rows, a.id)?.penaltyCount], [1, 1]);
    eq('3 같은 세션 여러 벌금 항목 → 벌금 1', [rowOf(rows, b.id)?.participationCount, rowOf(rows, b.id)?.penaltyCount], [1, 1]);
    check('3 중복 청구는 V5 예외(합계 미포함)로 그대로', h.exceptions.orphanReceivables.some((o: Any) => o.memberId === b.id && o.reason === 'duplicate'));
    eq('3 면제(취소) → 벌금 0 · 참가 1', [rowOf(rows, c.id)?.participationCount, rowOf(rows, c.id)?.penaltyCount], [1, 0]);
    eq('3 비대상(무효) → 벌금 0 · 참가 1', [rowOf(rows, e.id)?.participationCount, rowOf(rows, e.id)?.penaltyCount], [1, 0]);
    eq('3 납부 취소 → 미납으로 벌금 발생 유지', [rowOf(rows, v.id)?.penaltyCount, rowOf(rows, v.id)?.unpaidAmount], [1, 3000]);
    eq('3 미등록(확인 필요) → 벌금 0 · 확인 필요 1', [rowOf(rows, u.id)?.penaltyCount, rowOf(rows, u.id)?.reviewPenaltyCount, rowOf(rows, u.id)?.reviewAmount], [0, 1, 3000]);
}

// ═══ 4. 게스트 · 미연결 · 동명 ═══════════════════════════════════════════════════
{
    const d = emptyDs();
    const kim = { id: 'm-kim', nickname: '김민수' };
    d.members.push(kim);
    const [s1, s2] = addSessions(d, 2);
    join(d, s1, kim);
    // 같은 이름 게스트 2명(같은 세션 · 다른 participant) + 다른 세션 같은 이름 게스트.
    sess(d, s1).settlementData.push(entry('manual-guest-김민수', '김민수 (G)', 3000, true));
    sess(d, s1).settlementData.push(entry('g-111', '김민수', 0, true));
    sess(d, s2).settlementData.push(entry('manual-guest-김민수', '김민수 (G)', 0, true));
    // 회원도 게스트도 아닌 미매칭 참가자(동명 회원 2명 → 이름 매칭 불가).
    d.members.push({ id: 'm-p1', nickname: '박철수' }, { id: 'm-p2', nickname: '박철수' });
    sess(d, s2).settlementData.push(entry(null, '박철수', 0, false));
    const h = build(d);
    const rows = statsOf(h);
    eq('4 회원 김민수는 본인 참가만(게스트 동명 비병합)', [rowOf(rows, kim.id)?.participationCount, rowOf(rows, kim.id)?.penaltyCount], [1, 0]);
    const g = h.participations.filter((p: Any) => p.side === 'guest');
    eq('4 게스트 참가는 세션별 개별 기록(3건, 이름으로 합치지 않음)', g.length, 3);
    check('4 게스트 참가에는 memberId 없음', g.every((p: Any) => p.memberId === null));
    check('4 동명 회원 미매칭 참가자는 어느 회원에도 미포함', !rowOf(rows, 'm-p1') && !rowOf(rows, 'm-p2'));
    const ov = S.buildStatsOverview(rows, h.participations, h.sessions);
    eq('4 개요: 게스트 3 · 연결 필요 1 · 회원 참가 1', [ov.guestParticipations, ov.unlinkedParticipations, ov.memberParticipations], [3, 1, 1]);
}

// ═══ 5. 이름 매칭 · 이름 변경 ═══════════════════════════════════════════════════
{
    const d = emptyDs();
    const m = { id: 'm-old', nickname: '새이름' }; // 현재 닉네임
    d.members.push(m);
    const [s1, s2, s3] = addSessions(d, 3);
    sess(d, s1).settlementData.push(entry('m-old', '옛이름', 3000)); d.receivables.push(recv('m-old', s1, 3000)); // id 매칭(옛 이름 박제)
    sess(d, s2).settlementData.push(entry('legacy-x', '새이름', 0)); // id 없음 → 유일 이름 매칭
    sess(d, s3).settlementData.push(entry('legacy-y', '새이름', 0, true)); // 게스트로 박제 → 이름 매칭 금지
    const h = build(d);
    const r = rowOf(statsOf(h), 'm-old');
    eq('5 이름이 바뀌어도 같은 회원(id) · 유일 이름 매칭 포함 · 게스트 박제 제외', [r?.participationCount, r?.penaltyCount, r?.name], [2, 1, '새이름']);
}

// ═══ 6. 공식 Archive 없는 세션 · 스냅샷 없는 세션 ═══════════════════════════════
{
    const d = emptyDs();
    const m = { id: 'm-1', nickname: '회원1' };
    d.members.push(m);
    const [s1] = addSessions(d, 1);
    join(d, s1, m, 3000);
    d.receivables.push(recv(m.id, 'not-official-session', 5000)); // 공식 Archive 에 없는 세션 청구
    d.sessions.push({ id: 'nosnap', date: day(5), title: '스냅샷 없음', settlementData: null });
    const h = build(d);
    const rows = statsOf(h);
    eq('6 비공식 세션 청구는 참가 · 벌금 · 금액 모두 미포함', [rowOf(rows, m.id)?.participationCount, rowOf(rows, m.id)?.penaltyCount, rowOf(rows, m.id)?.billableAmount], [1, 1, 3000]);
    check('6 비공식 세션 청구는 V5 예외로 표시', h.exceptions.orphanReceivables.some((o: Any) => o.reason === 'session_not_official'));
    check('6 스냅샷 없는 세션은 참가 기록 없음', !h.participations.some((p: Any) => p.sessionId === 'nosnap'));
    eq('6 개요: 스냅샷 없는 세션 1 · 집계 세션 1', (() => { const o = S.buildStatsOverview(rows, h.participations, h.sessions); return [o.noSnapshotSessions, o.sessionCount]; })(), [1, 1]);
}

// ═══ 7. 기간 필터 — 금액 · 참가 · 벌금 같은 기준(KDK 개최일) ════════════════════════
{
    const h = build(ds);
    const range = { from: day(0), to: day(3) }; // 앞 4개 세션
    const rows = statsOf(h, range);
    const r12 = rowOf(rows, tw3.id); // 세션 0..3 참가 4 · 벌금(0) 1 · 6,000원
    eq('7 기간: 참가 · 벌금 · 금액 같은 범위', [r12?.participationCount, r12?.penaltyCount, r12?.billableAmount], [4, 1, 6000]);
    const v5 = M.aggregateMembers(h.records.filter((r: Any) => r.side === 'member' && M.inPeriod(r.sessionDate, range)));
    eq('7 기간: 금액 = V5 기간 집계', S.memberRowsForView(rows, 'amount').map((r: Any) => r.billableAmount), v5.map((m: Any) => m.billableAmount));
    check('7 기간: 기간 밖 참가 미포함', rowOf(rows, tw0.id)?.participationCount === 4);
    const empty = statsOf(h, { from: '2030-01-01', to: '2030-12-31' });
    eq('7 빈 기간 → 목록 없음', empty.length, 0);
}

// ═══ 8. 공유 내용 · 텍스트 · 이미지 문서 ═════════════════════════════════════════
{
    const h = build(ds);
    const now = new Date(2026, 10, 23);
    const stats = (view: string) => ({ view, participations: h.participations, sessions: h.sessions.map((s: Any) => ({ date: s.date, hasSnapshot: s.hasSnapshot })) });
    for (const tab of ['all', 'member', 'guest']) {
        const v5 = SH.buildPenaltyShareContent(h.records, ALL, tab, now);
        const amt = SH.buildPenaltyShareContent(h.records, ALL, tab, now, stats('amount'));
        eq(`8 [${tab}] 금액 모드 공유 = V5 공유`, amt, v5);
        eq(`8 [${tab}] 금액 모드 이미지 문서 = V5`, LY.buildReportDocument(amt).pages, LY.buildReportDocument(v5).pages);
        eq(`8 [${tab}] 금액 모드 텍스트 = V5`, SH.formatPenaltyShareText(amt), SH.formatPenaltyShareText(v5));
        for (const view of ['summary', 'participation', 'penalty']) {
            const c = SH.buildPenaltyShareContent(h.records, ALL, tab, now, stats(view));
            eq(`8 [${tab}/${view}] 요약 금액 불변`, [c.summary, c.memberSummary, c.guestSummary], [v5.summary, v5.memberSummary, v5.guestSummary]);
            eq(`8 [${tab}/${view}] 게스트 줄 불변`, c.guests, v5.guests);
            if (tab === 'guest') { eq(`8 [guest/${view}] 게스트 탭은 V5 금액 그대로`, [c.view, c.stats], ['amount', null]); continue; }
            eq(`8 [${tab}/${view}] 모드 반영`, c.view, view);
            const screen = S.memberRowsForView(statsOf(h), view).map((r: Any) => r.name);
            eq(`8 [${tab}/${view}] 이미지 회원 순서 = 화면 순서`, c.members.map((l: Any) => l.name), screen);
            check(`8 [${tab}/${view}] 줄마다 참가 · 벌금 · 발생률`, c.members.every((l: Any) => typeof l.participation === 'number' && typeof l.penaltyCount === 'number'));
            const doc = LY.buildReportDocument(c);
            eq(`8 [${tab}/${view}] 이미지 문서 모드 · 개요`, [doc.view, doc.stats?.memberParticipations], [view, c.stats.memberParticipations]);
            const rowsInDoc = doc.pages.flatMap((p: Any) => p.blocks).filter((b: Any) => b.type === 'row' && b.side === 'member').length;
            eq(`8 [${tab}/${view}] 이미지 회원 행 = 전체(잘림 없음)`, rowsInDoc, c.members.length);
            check(`8 [${tab}/${view}] 페이지 높이 상한`, doc.pages.every((p: Any) => p.height <= LY.MAX_PAGE_HEIGHT));
            const notes = doc.pages.flatMap((p: Any) => p.blocks).find((b: Any) => b.type === 'notes');
            check(`8 [${tab}/${view}] 안내 높이가 줄 수를 수용`, notes && notes.height >= 72 + notes.lines.length * 30, `${notes?.height}/${notes?.lines.length}`);
            const text = SH.formatPenaltyShareText(c);
            check(`8 [${tab}/${view}] 텍스트에 예시 회원 지표`, text.includes('열둘셋 — ') && text.includes('참가 12회') && text.includes('벌금 발생 3회') && text.includes('발생률 25%') && text.includes('부과 18,000원'));
            check(`8 [${tab}/${view}] 텍스트에 내부 ID 없음`, !/mem-\d|sess-\d|recv-\d/.test(text));
        }
    }
    const pc = SH.buildPenaltyShareContent(h.records, ALL, 'member', now, stats('participation'));
    check('8 참가 모드 텍스트는 참가가 앞', SH.formatPenaltyShareText(pc).includes('스물무벌 — 참가 20회'));
    const pn = SH.buildPenaltyShareContent(h.records, ALL, 'member', now, stats('penalty'));
    check('8 벌금 횟수 모드 텍스트는 벌금이 앞', SH.formatPenaltyShareText(pn).includes('열둘셋 — 벌금 발생 3회 · 참가 12회'));
    // 기간 변경 시 공유도 같은 기간
    const ranged = SH.buildPenaltyShareContent(h.records, { from: day(0), to: day(3) }, 'member', now, stats('summary'));
    eq('8 기간 공유: 예시 회원 참가 4 · 벌금 1 · 6,000원', (() => { const l = ranged.members.find((x: Any) => x.name === '열둘셋'); return [l?.participation, l?.penaltyCount, l?.billable]; })(), [4, 1, 6000]);
    eq('8 기간 공유: 개요 세션 수', ranged.stats.sessionCount, 4);
}

// ═══ 9. 많은 회원(다장) · 긴 이름 ═══════════════════════════════════════════════
{
    const d = emptyDs();
    const ss = addSessions(d, 30);
    for (let i = 0; i < 70; i++) {
        const m = { id: `m-big-${i}`, nickname: i === 0 ? '아주아주아주긴이름을가진회원님입니다정말로' : `회원${i}` };
        d.members.push(m);
        ss.slice(0, (i % 30) + 1).forEach((sid, k) => join(d, sid, m, k % 3 === 0 ? 3000 : 0));
    }
    const h = build(d);
    const c = SH.buildPenaltyShareContent(h.records, ALL, 'all', new Date(2026, 10, 23), { view: 'summary', participations: h.participations, sessions: h.sessions.map((s: Any) => ({ date: s.date, hasSnapshot: s.hasSnapshot })) });
    const doc = LY.buildReportDocument(c);
    check('9 70명 → 여러 장', doc.pages.length > 1, String(doc.pages.length));
    eq('9 모든 회원 행 포함', doc.pages.flatMap((p: Any) => p.blocks).filter((b: Any) => b.type === 'row' && b.side === 'member').length, 70);
    check('9 모든 장 높이 상한', doc.pages.every((p: Any) => p.height <= LY.MAX_PAGE_HEIGHT));
    check('9 벌금 발생 ≤ 참가(전원)', statsOf(h).every((r: Any) => r.penaltyCount <= r.participationCount));
}

console.log(`\nKDK 누적 벌금 V6 통계 fixture: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
}
