/**
 * TEYEON KDK 누적 벌금 이미지 리포트 — 페이지 레이아웃 fixture 검증.
 *
 *   실행: node scripts/verify_kdk_penalty_report_layout.mts
 *   (Node 24 type-stripping + scripts/ts-resolve-hook.mjs — DB·DOM 미접속.)
 *
 *   검증: KPI = 화면 요약(summarizeRecords) · 회원+게스트=전체 · 탭별 섹션 · 명단 누락/중복 없음(행 단위 분할) ·
 *         장 높이 ≤ 최대 · 섹션 제목이 장 끝에 홀로 남지 않음 · 이어지는 장의 '(계속)' 제목 · 안내는 마지막 장 ·
 *         페이지 번호 · 빈 기간 · 크기 전수(회원 0~150 × 게스트 0~60) · 파일명.
 */
import { register } from 'node:module';

register('./ts-resolve-hook.mjs', import.meta.url);

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://127.0.0.1:1';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'fixture-anon-key';

type Any = Record<string, any>; // fixture 용 느슨한 타입(검증 스크립트 관례).
const load = (path: string): Promise<Any> => import(path);
const M = await load('../lib/finance/kdkPenaltyHistoryModel.ts');
const SH = await load('../lib/finance/kdkPenaltyHistoryShare.ts');
const L = await load('../lib/finance/kdkPenaltyReportLayout.ts');

let passed = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, info = '') => { if (cond) passed += 1; else failures.push(`${name}${info ? ` — ${info}` : ''}`); };
const eq = (name: string, actual: unknown, expected: unknown) => check(name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);

// ── fixture: 회원 nm명 · 게스트 ng명(한 세션) ──────────────────────────────────
let seq = 0;
const uid = (p: string) => `${p}-${String(++seq).padStart(6, '0')}`;
function dataset(nm: number, ng: number): Any {
    const sid = 'arch-2026-10-20';
    const members = Array.from({ length: nm }, (_, i) => ({ id: `mem-${i}`, nickname: i === 3 ? '아주아주긴이름을가진정회원님입니다' : `회원${String(i).padStart(3, '0')}` }));
    const settlementData: Any[] = members.map((m, i) => ({ player_id: m.id, player_name: m.nickname, is_guest: false, penalty_amount: -(1000 * ((i % 7) + 1)), penalty_level: 'L1' }));
    for (let g = 0; g < ng; g++) settlementData.push({ player_id: `manual-guest-게스트${g}`, player_name: `게스트${g}`, is_guest: true, penalty_amount: -(1000 * ((g % 5) + 1)), penalty_level: 'L1' });
    const receivables: Any[] = [], payments: Any[] = [];
    members.forEach((m, i) => {
        const amt = 1000 * ((i % 7) + 1);
        const r = { id: uid('recv'), member_id: m.id, receivable_type: 'penalty', title: 'KDK 벌금', target_year: 2026, target_month: null, amount_due: amt, due_date: null, status: i % 3 === 0 ? 'pending' : 'paid', exemption_reason: null, memo: null, related_kdk_session_id: sid, created_by: null, created_at: '2026-01-01', updated_at: '2026-01-01' };
        receivables.push(r);
        if (i % 3 !== 0) payments.push({ id: uid('pay'), member_id: m.id, receivable_id: r.id, payment_type: 'penalty', amount: amt, paid_at: '2026-10-21', memo: null, is_voided: false, created_by: null, updated_by: null, created_at: '2026-10-21', updated_at: '2026-10-21' });
    });
    const guestPayments = Array.from({ length: ng }, (_, g) => g % 2 === 0 ? { session_id: sid, participant_id: `manual-guest-게스트${g}`, amount: 1000 * ((g % 5) + 1), status: 'paid', paid_at: '2026-10-21T10:00:00+09:00' } : null).filter(Boolean);
    return { sessions: [{ id: sid, date: '2026-10-20', title: 'KDK 10월', settlementData }], members, receivables, payments, unlinkedPayments: [], guestAvailable: true, guestPayments };
}
const YEAR = { from: '2026-01-01', to: '2026-12-31' };
const NOW = new Date(2026, 10, 22, 12, 0);

function invariants(tag: string, doc: Any, content: Any) {
    const pages = doc.pages;
    check(`${tag} 장 1개 이상`, pages.length >= 1);
    for (const p of pages) {
        check(`${tag} p${p.pageNo} 높이 ≤ ${L.MAX_PAGE_HEIGHT}`, p.height <= L.MAX_PAGE_HEIGHT, String(p.height));
        const sum = (p.first ? L.H.headerFirst : L.H.headerCont) + p.blocks.reduce((a: number, b: Any) => a + b.height, 0) + L.H.pageFooter;
        check(`${tag} p${p.pageNo} 높이 = 블록 합`, sum === p.height, `${sum} vs ${p.height}`);
        check(`${tag} p${p.pageNo} 번호`, p.pageCount === pages.length && p.first === (p.pageNo === 1));
        const last = p.blocks[p.blocks.length - 1];
        check(`${tag} p${p.pageNo} 섹션 제목이 장 끝에 홀로 없음`, !last || last.type !== 'section');
        check(`${tag} p${p.pageNo} 장 끝 간격 없음`, !last || last.type !== 'gap');
        const firstBlock = p.blocks[0];
        if (!p.first && firstBlock && (firstBlock.type === 'row')) check(`${tag} p${p.pageNo} 이어지는 장 제목`, false, 'row 가 제목 없이 시작');
        if (!p.first && firstBlock?.type === 'section' && p.blocks[1]?.type === 'row' && p.blocks[1].index > 1) check(`${tag} p${p.pageNo} '(계속)' 표시`, firstBlock.continued === true);
    }
    const blocks = pages.flatMap((p: Any) => p.blocks);
    check(`${tag} KPI 는 1장 첫 블록`, pages[0].blocks[0]?.type === 'kpi' && blocks.filter((b: Any) => b.type === 'kpi').length === 1);
    const notes = blocks.filter((b: Any) => b.type === 'notes');
    check(`${tag} 안내 1개 · 마지막 장 마지막 블록`, notes.length === 1 && pages[pages.length - 1].blocks.at(-1)?.type === 'notes');
    for (const [side, lines] of [['member', content.members], ['guest', content.guests]] as const) {
        const shown = (content.tab === 'all') || content.tab === side;
        const rows = blocks.filter((b: Any) => b.type === 'row' && b.side === side);
        if (!shown) { check(`${tag} ${side} 섹션 없음`, !blocks.some((b: Any) => b.side === side)); continue; }
        eq(`${tag} ${side} 순번 1..N 누락·중복 없음`, rows.map((r: Any) => r.index), lines.map((_: Any, i: number) => i + 1));
        check(`${tag} ${side} 행 = 공유 명단 그대로`, rows.every((r: Any, i: number) => r.line === lines[i]));
        check(`${tag} ${side} 빈 명단 표시`, lines.length > 0 || blocks.some((b: Any) => b.type === 'empty' && b.side === side));
        const firstSection = blocks.find((b: Any) => b.type === 'section' && b.side === side && !b.continued);
        check(`${tag} ${side} 섹션 인원`, !!firstSection && firstSection.count === lines.length);
    }
}

// ═══ 1. KPI = 화면 요약 · 회원+게스트 = 전체 ═══════════════════════════════════
{
    const history = M.buildPenaltyHistory(dataset(3, 2)); // 1장에 들어가는 크기(행 88 기준)
    for (const tab of ['all', 'member', 'guest']) {
        const content = SH.buildPenaltyShareContent(history.records, YEAR, tab, NOW);
        const doc = L.buildReportDocument(content);
        const period = history.records.filter((r: Any) => M.inPeriod(r.sessionDate, YEAR));
        const screen = M.summarizeRecords(tab === 'all' ? period : period.filter((r: Any) => r.side === tab));
        eq(`[${tab}] KPI = 화면 요약`, [doc.kpi.billable, doc.kpi.paid, doc.kpi.unpaid, doc.kpi.paidRate, doc.kpi.excludedAmount, doc.kpi.reviewAmount],
            [screen.billableAmount, screen.paidAmount, screen.unpaidAmount, screen.paidRate, screen.excludedAmount, screen.reviewAmount]);
        eq(`[${tab}] 회원/게스트 부과 = 공유 요약`, [doc.kpi.memberBillable, doc.kpi.guestBillable], [content.memberSummary.billableAmount, content.guestSummary.billableAmount]);
        if (tab === 'all') eq('[all] 회원 + 게스트 = 전체', doc.kpi.memberBillable + doc.kpi.guestBillable, doc.kpi.billable);
        eq(`[${tab}] 탭 라벨`, doc.tabLabel, { all: '전체', member: '회원', guest: '게스트' }[tab]);
        check(`[${tab}] 기간·기준일`, doc.periodText === '2026.01.01 ~ 2026.12.31' && doc.baseDate === '2026.11.22');
        eq(`[${tab}] 1장`, doc.pages.length, 1);
        invariants(`[${tab}]`, doc, content);
        const notes = doc.pages[doc.pages.length - 1].blocks.at(-1)?.lines || [];
        check(`[${tab}] 안내 문구`, notes.includes('비대상 벌금은 청구 대상 집계에서 제외') && notes.includes('확인 필요 금액은 부과·미납 합계에서 제외'));
        check(`[${tab}] 게스트 안내 ${tab === 'member' ? '없음' : '있음'}`, notes.some((n: string) => n.startsWith('게스트는 동일 이름')) === (tab !== 'member'));
    }
}

// ═══ 2. 긴 명단 → 여러 장(행 단위) ══════════════════════════════════════════
{
    const history = M.buildPenaltyHistory(dataset(70, 45));
    const content = SH.buildPenaltyShareContent(history.records, YEAR, 'all', NOW);
    const doc = L.buildReportDocument(content);
    check('긴 명단 여러 장', doc.pages.length >= 3, String(doc.pages.length));
    invariants('[긴 명단]', doc, content);
    check('긴 명단 회원 70명 전원', doc.pages.flatMap((p: Any) => p.blocks).filter((b: Any) => b.type === 'row' && b.side === 'member').length === 70);
    check('긴 명단 게스트 45명 전원', doc.pages.flatMap((p: Any) => p.blocks).filter((b: Any) => b.type === 'row' && b.side === 'guest').length === 45);
    check('긴 이름 회원 포함', content.members.some((l: Any) => l.name === '아주아주긴이름을가진정회원님입니다'));
    const contPages = doc.pages.filter((p: Any) => !p.first && p.blocks[0]?.type === 'section' && p.blocks[0].continued);
    check("이어지는 장에 '(계속)' 제목", contPages.length >= 1);
}

// ═══ 3. 빈 기간 ════════════════════════════════════════════════════════════
{
    const history = M.buildPenaltyHistory(dataset(5, 3));
    const content = SH.buildPenaltyShareContent(history.records, { from: '2024-01-01', to: '2024-12-31' }, 'all', NOW);
    const doc = L.buildReportDocument(content);
    eq('빈 기간 1장', doc.pages.length, 1);
    eq('빈 기간 KPI 0', [doc.kpi.billable, doc.kpi.paid, doc.kpi.unpaid, doc.kpi.paidRate], [0, 0, 0, null]);
    eq('빈 기간 빈 명단 블록', doc.pages[0].blocks.filter((b: Any) => b.type === 'empty').map((b: Any) => b.side), ['member', 'guest']);
    invariants('[빈 기간]', doc, content);
}

// ═══ 4. 크기 전수 — 경계(장 끝에 딱 맞는 경우 포함) ═══════════════════════════════
{
    let docs = 0, maxPages = 0;
    for (let nm = 0; nm <= 150; nm += 1) {
        for (const ng of [0, 1, 7, 23, 60]) {
            const history = M.buildPenaltyHistory(dataset(nm, ng));
            for (const tab of ['all', 'member', 'guest']) {
                const content = SH.buildPenaltyShareContent(history.records, YEAR, tab, NOW);
                const doc = L.buildReportDocument(content);
                const before = failures.length;
                invariants(`[전수 ${tab} m${nm} g${ng}]`, doc, content);
                docs += 1; maxPages = Math.max(maxPages, doc.pages.length);
                if (failures.length > before + 5) break;
            }
        }
    }
    check(`전수 ${docs}개 문서 검사(최대 ${maxPages}장)`, docs > 2000);
}

// ═══ 5. 파일명 ═════════════════════════════════════════════════════════════
eq('파일명 1장', L.reportFileName('2026.11.22', 1), 'TEYEON_KDK_Penalty_2026-11-22_01.png');
eq('파일명 12장', L.reportFileName('2026.11.22', 12), 'TEYEON_KDK_Penalty_2026-11-22_12.png');

console.log(`\nKDK 누적 벌금 이미지 리포트 레이아웃 fixture: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures.slice(0, 30)) console.log(`  FAIL ${f}`); process.exit(1); }
