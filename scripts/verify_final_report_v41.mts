/**
 * KDK FINAL REPORT V4.1 순수 로직 fixture(DB · 네트워크 미사용 · 가상 이름).
 *   실행: node --experimental-strip-types scripts/verify_final_report_v41.mts
 *   범위: 정산 스냅샷 매핑(회원 · 게스트 · 레거시 · 항등식 · 파서) · 스토리(역전 · 무실점 · 최다 게임 · 개인 최다승 · 라이벌 · 숫자 · VOL · 다음 정모) ·
 *        edition 3 공개본(정산 금지어 · 파서 · v1/v2 무영향 · 손상 시 낮춤).
 */
import { register } from 'node:module';
register('./ts-resolve-hook.mjs', import.meta.url);
const load = (p: string): Promise<any> => import(p);
const fr = await load('../lib/kdk/finalReport/finalReportModel.ts');
const ss = await load('../lib/kdk/finalReport/v41/settlementSnapshot.ts');
const sv = await load('../lib/kdk/finalReport/v41/storyV41.ts');
const pv = await load('../lib/kdk/finalReport/v41/payloadV41.ts');

let passed = 0; const failures: string[] = [];
const check = (name: string, cond: boolean, info = '') => { if (cond) passed += 1; else failures.push(`${name}${info ? ` — ${info}` : ''}`); };
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const U = (n: number) => `33333333-0000-4000-8000-${String(n).padStart(12, '0')}`;

// ════════════════════════════════════════════════════════════════════════════
// 1) 정산 스냅샷
const LIVE = '2026-11-24';
const item = (pid: string | null, name: string, isGuest: unknown, penalty: unknown) => ({ playerId: pid, name, isGuest, penalty });
const base = () => ({
  hasData: true, financeLinkAvailable: true, guestTableAvailable: true,
  items: [
    item(U(1), '회원일', false, -10000), item(U(2), '회원이', false, -10000), item(U(3), '회원삼', false, -10000),
    item(U(4), '회원사', false, -5000), item(U(5), '회원오', false, -5000), item(U(6), '회원육', false, -10000), item(U(7), '회원칠', false, -10000),
    item('manual-guest-a', '게스트A', true, -5000), item('manual-guest-b', '게스트B', true, -5000), item('manual-guest-c', '게스트C(G)', true, -5000),
    item('manual-guest-d', '게스트D', true, -5000), item('manual-guest-e', '게스트E', true, -5000), item('manual-guest-f', '게스트F', true, -5000),
    item(null, '게스트G', true, -5000), item(U(8), '플래그오류', 'true', -5000), item(U(9), '금액오류', false, '-1,000'), item(U(10), '벌금없음', false, 0),
    item(U(11), '중복', false, -5000), item(U(11), '중복', false, -5000),
  ],
  memberIds: [U(1), U(2), U(3), U(4), U(6), U(7), U(11)],
  receivables: [
    { memberId: U(1), amountDue: 10000, status: 'paid', paid: 10000 }, { memberId: U(2), amountDue: 10000, status: 'pending', paid: 0 },
    { memberId: U(3), amountDue: 10000, status: 'partial', paid: 6000 }, { memberId: U(6), amountDue: 8000, status: 'pending', paid: 0 },
    { memberId: U(7), amountDue: 10000, status: 'exempt', paid: 0 },
  ],
  guestPayments: [
    { participantId: 'manual-guest-a', status: 'paid', amount: 5000, paidAt: '2026-11-25T01:00:00Z', updatedAt: '2026-11-25T01:00:00Z' },
    { participantId: 'manual-guest-d', status: 'cancelled', amount: 5000, paidAt: '2026-11-25T01:00:00Z', cancelledAt: '2026-11-26T01:00:00Z', updatedAt: '2026-11-26T01:00:00Z' },
  ],
  reviews: [
    { participantId: 'manual-guest-c', decision: 'unpaid_confirmed', officialAmount: 5000, reviewedAt: '2026-11-27T00:00:00Z' },
    { participantId: 'manual-guest-d', decision: 'unpaid_confirmed', officialAmount: 5000, reviewedAt: '2026-11-25T12:00:00Z' }, // 취소 이전 확인 → 무효
    { participantId: 'manual-guest-e', decision: 'unpaid_confirmed', officialAmount: 4000, reviewedAt: '2026-11-27T00:00:00Z' }, // 금액 다름
    { participantId: 'manual-guest-f', decision: 'unpaid_confirmed', officialAmount: 5000, reviewedAt: '2026-11-27T00:00:00Z' },
    { participantId: 'manual-guest-f', decision: 'withdrawn', officialAmount: 5000, reviewedAt: '2026-11-28T00:00:00Z' },        // 철회
  ],
});
const LIVE_FROM = '2026-11-11'; // 시험용 기준일(운영 값은 DB 설정 · 운영자 승인)
const snap = ss.buildSettlementSnapshot(LIVE, base(), LIVE_FROM);
const row = (name: string) => snap.rows.find((r: any) => r.name === name);
const st = (name: string) => row(name)?.status;
check('정산: live 모드', snap.mode === 'live');
check('회원 완납 → PAID', st('회원일') === 'PAID' && row('회원일').paid === 10000);
check('회원 청구 + 납부 0 → UNPAID', st('회원이') === 'UNPAID' && row('회원이').paid === 0 && row('회원이').note === null);
check('회원 일부 납부 → UNPAID + 잔액 표시', st('회원삼') === 'UNPAID' && row('회원삼').paid === 6000 && row('회원삼').note === 'partial'
  && ss.settlementNoteLabel(row('회원삼')) === '일부 납부 · 잔액 4,000원');
check('회원 미등록 → PENDING(재무 등록 전)', st('회원사') === 'PENDING' && row('회원사').note === 'unregistered');
check('회원 연결 불가 → PENDING(대상 확인 중)', st('회원오') === 'PENDING' && row('회원오').note === 'needs_link');
check('회원 금액 불일치 → PENDING(금액 확인 중)', st('회원육') === 'PENDING' && row('회원육').note === 'amount_mismatch' && row('회원육').charged === 10000);
check('회원 면제 → 목록 제외 · excluded 1', !row('회원칠') && snap.excluded === 1);
check('게스트 납부 기록 paid(금액 일치) → PAID', st('게스트A(G)') === 'PAID');
check('게스트 기록 없음 → PENDING(납부 기록 없다는 이유로 UNPAID 아님)', st('게스트B(G)') === 'PENDING' && row('게스트B(G)').note === 'awaiting_review');
check('게스트 참가자별 미납 확인(유효) → UNPAID', st('게스트C(G)') === 'UNPAID');
check('게스트 확인 이후 납부 기록 변경 → PENDING', st('게스트D(G)') === 'PENDING');
check('게스트 확인 금액 ≠ 공식 금액 → PENDING', st('게스트E(G)') === 'PENDING');
check('게스트 확인 철회 → PENDING', st('게스트F(G)') === 'PENDING');
check('게스트 참가자 id 없음 → REVIEW(금액 0 · 집계 제외)', st('게스트G(G)') === 'REVIEW' && row('게스트G(G)').charged === 0);
check('is_guest 비정상 → REVIEW', snap.rows.some((r: any) => r.note === 'invalid_flag' && r.status === 'REVIEW'));
check('금액 형식 오류 → REVIEW', snap.rows.some((r: any) => r.note === 'invalid_amount' && r.status === 'REVIEW'));
check('벌금 0 → 대상 아님', !snap.rows.some((r: any) => r.name === '벌금없음'));
check('같은 참가자 중복 → 둘 다 REVIEW', snap.rows.filter((r: any) => r.name === '중복' && r.status === 'REVIEW').length === 2);
const t = snap.totals;
check('항등식: 청구 = 납부 + 미납 확정 + 확인 중', t.charged === t.paid + t.unpaid + t.pending, JSON.stringify(t));
check('합계 값', t.paid === 10000 + 6000 + 5000 && t.unpaid === 10000 + 4000 + 5000 && t.pending === 5000 + 5000 + 10000 + 5000 * 4, JSON.stringify(t));
check('인원 집계', eq(snap.counts, { targets: 12, paid: 2, unpaid: 3, pending: 7, review: 5 }), JSON.stringify(snap.counts));
check('스냅샷에 내부 id · manual-guest 없음', !/manual-guest|3333/.test(JSON.stringify(snap)));
// 레거시 · 준비 전 · 대상 없음 · 연결 없음
const legacy = ss.buildSettlementSnapshot('2026-11-10', base(), LIVE_FROM);
check('과거 회차 → legacy_closed · 개인 행 · 금액 없음', legacy.mode === 'legacy_closed' && legacy.rows.length === 0 && legacy.totals.charged === 0);
check('날짜 형식 오류 → unconfigured(단정 안 함)', ss.buildSettlementSnapshot('', base(), LIVE_FROM).mode === 'unconfigured');
for (const lf of [null, undefined, '', '2026/11/11']) { const u = ss.buildSettlementSnapshot(LIVE, base(), lf); check(`기준일 미설정(${String(lf)}) → unconfigured · 행 · 금액 없음`, u.mode === 'unconfigured' && u.rows.length === 0 && u.totals.charged === 0); }
check('기준일 미설정 스냅샷 파서 왕복', ss.parseSettlementSnapshot(clone(ss.buildSettlementSnapshot(LIVE, base(), null)))?.mode === 'unconfigured');
check('기준일은 코드 상수가 아님(모듈에 고정 날짜 export 없음)', !('FR_SETTLEMENT_LIVE_FROM' in ss));
check('경계: 기준일 당일 회차는 live', ss.buildSettlementSnapshot(LIVE_FROM, base(), LIVE_FROM).mode === 'live');
check('기준일 변경: 같은 회차도 기준일이 더 늦으면 legacy', ss.buildSettlementSnapshot(LIVE, base(), '2026-12-01').mode === 'legacy_closed');
check('정산 데이터 없음 → not_ready', ss.buildSettlementSnapshot(LIVE, { ...base(), hasData: false }, LIVE_FROM).mode === 'not_ready');
check('벌금 대상 0 → none', ss.buildSettlementSnapshot(LIVE, { ...base(), items: [item(U(1), 'a', false, 0)] }, LIVE_FROM).mode === 'none');
const noLink = ss.buildSettlementSnapshot(LIVE, { ...base(), financeLinkAvailable: false }, LIVE_FROM);
check('Finance 연결 컬럼 없음 → 회원 PENDING(완납 · 미납 단정 안 함)', ['회원일', '회원이', '회원삼'].every((n) => noLink.rows.find((r: any) => r.name === n)?.status === 'PENDING'));
const noGuest = ss.buildSettlementSnapshot(LIVE, { ...base(), guestTableAvailable: false }, LIVE_FROM);
check('게스트 납부 표 없음 → 게스트 PENDING', ['게스트A(G)', '게스트C(G)'].every((n) => noGuest.rows.find((r: any) => r.name === n)?.status === 'PENDING'));
// 파서
check('파서: 정상 왕복', eq(ss.parseSettlementSnapshot(clone(snap)), snap));
const tamper = clone(snap); tamper.totals.unpaid += 1;
check('파서: 합계 변조 → null', ss.parseSettlementSnapshot(tamper) === null);
const t2 = clone(snap); t2.rows[0].paid = t2.rows[0].charged + 1;
check('파서: 납부 > 청구 → null', ss.parseSettlementSnapshot(t2) === null);
const t3 = clone(legacy); t3.rows = [clone(snap.rows[0])];
check('파서: 레거시에 개인 행 → null', ss.parseSettlementSnapshot(t3) === null);
const t4 = clone(snap); t4.rows[0].status = 'DONE';
check('파서: 상태 오류 → null', ss.parseSettlementSnapshot(t4) === null);
check('파서: 빈 값 → null(0원 표시 금지)', ss.parseSettlementSnapshot(null) === null && ss.parseSettlementSnapshot({}) === null);

// ════════════════════════════════════════════════════════════════════════════
// 2) 스토리
const N = ['일번', '이번', '삼번', '사번', '오번', '육번', '칠번', '팔번'];
const pid = (i: number) => (i === 8 ? 'manual-guest-8' : U(100 + i));
const Mx = (id: string, round: number, court: number, a: number[], b: number[], s1: number, s2: number) =>
  ({ id, round, court, group_name: 'A', status: 'complete', player_ids: [...a, ...b].map(pid), player_names: [...a, ...b].map((i) => (i === 8 ? `${N[i - 1]}(G)` : N[i - 1])), score1: s1, score2: s2 });
const W = [3, 3, 3, 2, 2, 3, 1, 1];
const src = {
  id: 'KDK-V41-STORY', archiveType: 'kdk', isOfficial: true, isTest: false, title: '11월 4주 정모', date: '2026-11-24',
  rankingData: N.map((n, i) => ({ id: pid(i + 1), name: n, wins: W[i], losses: 4 - W[i], diff: 10 - i * 3 })),
  snapshotData: [
    Mx('r1c1', 1, 1, [1, 2], [6, 7], 6, 4), Mx('r1c2', 1, 2, [3, 4], [5, 8], 6, 0),
    Mx('r2c1', 2, 1, [6, 3], [4, 5], 6, 2), Mx('r2c2', 2, 2, [1, 7], [2, 8], 6, 5),
    Mx('r3c1', 3, 1, [6, 8], [1, 4], 6, 3), Mx('r3c2', 3, 2, [2, 5], [3, 7], 6, 1),
    Mx('r4c1', 4, 1, [6, 5], [7, 4], 6, 5), Mx('r4c2', 4, 2, [1, 3], [2, 8], 6, 4),
  ],
  playerGroups: {},
};
const mres = fr.buildFinalReportModel(src); if (!mres.ok) throw new Error('model');
const model = mres.model;
const hist = (date: string, ranking: Array<[number, number]>, matches: Array<[number[], number[], number, number]>, self = false) =>
  ({ self, date, ranking: ranking.map(([i, w]) => ({ id: pid(i), wins: w })), matches: matches.map(([a, b, s1, s2]) => ({ ids: [...a, ...b].map(pid), score1: s1, score2: s2 })) });
const HISTORY = [
  hist('2026-10-01', [[4, 1], [5, 2]], [[[2, 3], [7, 1], 6, 2], [[2, 1], [7, 3], 6, 4]]),
  hist('2026-10-15', [[4, 1], [5, 1]], [[[7, 4], [2, 5], 6, 4], [[2, 3], [7, 8], 6, 1], [[1, 4], [2, 3], 6, 3]]),
  hist('2026-11-01', [[4, 1], [5, 2]], [[[2, 6], [7, 3], 6, 3], [[2, 8], [1, 5], 3, 6], [[1, 3], [2, 6], 6, 2]]),
  hist('2026-11-24', N.map((_, i) => [i + 1, W[i]] as [number, number]), [], true),
];
const ctx = { date: '2026-11-24', history: HISTORY, next: { date: '2026-12-01', startTime: '08:00' } };
const story = sv.buildV41Story(model, ctx);
const hero = (k: string) => story.heroes.find((h: any) => h.kind === k);
check('역전: 첫 경기 패 후 3연승 → COMEBACK(육번)', hero('COMEBACK')?.name === '육번' && hero('COMEBACK')?.stat === '3연승' && /1라운드 4:6 패배/.test(hero('COMEBACK')?.line));
check('개인 최다승 경신(회원 · 이전 3회차 · 1승 → 2승) → BREAKTHROUGH(사번)', hero('BREAKTHROUGH')?.name === '사번' && hero('BREAKTHROUGH')?.source === 'archive');
check('개인 최다승 타이 → ALSO ON THE RECORD(오번)', story.mentions.some((m: any) => m.name === '오번' && /타이/.test(m.line)));
check('시상대(1~3위) 선수는 HEROES 아님', !story.heroes.some((h: any) => ['일번', '이번', '삼번'].includes(h.name)));
check('한 사람은 한 번만 특집(육번 최다 게임 중복 없음)', story.heroes.filter((h: any) => h.name === '육번').length === 1);
check('HEROES ≤ 3', story.heroes.length <= 3);
check('라이벌: 이전 맞대결 5경기(1승 4패) 칠번 vs 이번 → 열세 역전', story.rivalry?.winner === '칠번' && story.rivalry?.loser === '이번'
  && story.rivalry?.priorWins === 1 && story.rivalry?.priorLosses === 4 && /열세/.test(story.rivalry?.title), JSON.stringify(story.rivalry));
check('라이벌: 게스트 제외 · 날짜 범위', story.rivalry?.from === '2026.10' && story.rivalry?.to === '2026.11' && story.rivalry?.recent.length === 5 && story.rivalry?.loserTeam[1] === '팔번(G)');
const few = sv.buildV41Story(model, { ...ctx, history: HISTORY.map((h, i) => (i === 0 ? { ...h, matches: [] } : h)) });
check('라이벌: 이전 맞대결 < 3 이면 생성 안 함(→ BY THE NUMBERS)', few.rivalry === null || few.rivalry.priorWins + few.rivalry.priorLosses >= 3);
const noHist = sv.buildV41Story(model, { ...ctx, history: [HISTORY[3]] });
check('과거 기록 없음 → 라이벌 · 개인 최다승 없음', noHist.rivalry === null && !noHist.heroes.some((h: any) => h.kind === 'BREAKTHROUGH'));
check('과거 기록 없음 → 무실점 승리 특집(사번 1라운드 6:0)', noHist.heroes.some((h: any) => h.kind === 'SHUTOUT' && h.name === '사번' && h.stat === '6:0'));
check('BY THE NUMBERS: 경기 8 · 1점 차 2 · 무실점 1 · 게스트 1', eq(story.numbers.map((n: any) => [n.kind, n.value]), [['MATCHES', 8], ['ONE_POINT', 2], ['SHUTOUTS', 1], ['GUESTS', 1]]));
check('VOL: 날짜순 4번째', story.vol === 4);
check('VOL: 같은 날 복수 회차 → null', sv.computeVol('2026-11-24', [...HISTORY, hist('2026-11-24', [], [])]) === null);
check('VOL: 날짜 없는 회차 → null', sv.computeVol('2026-11-24', [...HISTORY, hist('', [], [])]) === null);
check('VOL: 자기 날짜 형식 오류 → null', sv.computeVol('11/24', HISTORY) === null);
check('NEXT: 취소 여부 확인 불가(nextReliable 없음) → 공개본에 날짜 없음', story.next === null);
check('NEXT: 확정 · 취소를 확인할 수 있는 일정(nextReliable)만 날짜 전달', eq(sv.buildV41Story(model, { ...ctx, nextReliable: true }).next, { date: '2026-12-01', startTime: '08:00' }));
check('NEXT: 없으면 null', sv.buildV41Story(model, { ...ctx, next: null }).next === null);
check('스토리에 타이브레이크 · 종료 시각 · 첫 참가 문구 없음', !/타이브레이크|tiebreak|종료 시각|첫 참가/i.test(JSON.stringify(story)));
// 역전 조건: round 중복이면 생성 안 함
const dupRound = clone(src); dupRound.snapshotData[2].round = 1; dupRound.snapshotData[0].round = 1;
const dm = fr.buildFinalReportModel(dupRound);
check('역전: round 중복 → 생성 안 함', dm.ok && !sv.buildV41Story(dm.model, ctx).heroes.some((h: any) => h.kind === 'COMEBACK' && h.name === '육번'));

// ════════════════════════════════════════════════════════════════════════════
// 3) edition 3 공개본
const content = { ...fr.EMPTY_CONTENT };
const p3 = pv.buildFinalReportPayloadV41(model, content, ctx);
check('공개본 생성 · edition 3', p3.ok && p3.payload.edition === 3 && p3.payload.schema === 1 && !!p3.payload.v41);
const txt = JSON.stringify(p3.payload);
check('공개본에 정산 금지어 없음', !pv.V41_PUBLIC_FORBIDDEN.test(txt));
check('공개본에 내부 id 없음', !/manual-guest|33333333|KDK-V41-STORY/.test(txt));
check('공개본 schema 1 공통 필드 유지(되돌림 대비)', Array.isArray(p3.payload.standings) && p3.payload.standings.length === 8 && Array.isArray(p3.payload.podium));
const bad = pv.buildFinalReportPayloadV41(model, { ...content, closing: '다음 주 벌금 정산 안내' }, ctx);
check('운영진 문구에 정산 단어 → settlement_word(발행 전 차단)', !bad.ok && bad.reason === 'settlement_word');
const parsed = fr.parsePublicFinalReport(clone(p3.payload));
check('파서: edition 3 · v41 왕복', parsed?.edition === 3 && eq(parsed?.v41, p3.payload.v41));
const broken = clone(p3.payload); broken.v41 = 'x';
const pb = fr.parsePublicFinalReport(broken);
check('파서: v41 손상 → edition 2 화면으로 낮춤', pb?.edition === 2 && !pb.v41);
const p2 = fr.buildFinalReportPayload(model, content);
check('edition 2 공개본은 v41 없음', p2.ok && !('v41' in fr.parsePublicFinalReport(clone(p2.payload))));
const v1 = clone(p3.payload); delete v1.edition; delete v1.v41;
const pv1 = fr.parsePublicFinalReport(v1);
check('v1 공개본: v2 · v41 필드 소급 없음', pv1 && !pv1.edition && !pv1.v41 && !pv1.headline);
const injected = clone(p3.payload); injected.v41.heroes[0].secret = 'x'; injected.v41.settlement = { total: 1 };
check('파서 allow-list: 모르는 키 버림', !JSON.stringify(fr.parsePublicFinalReport(injected)).includes('secret') && !JSON.stringify(fr.parsePublicFinalReport(injected)).includes('settlement'));

console.log(`KDK FINAL REPORT V4.1 logic fixture: ${passed} passed / ${failures.length} failed`);
for (const f of failures) console.log('  FAIL', f);
process.exit(failures.length ? 1 : 0);
