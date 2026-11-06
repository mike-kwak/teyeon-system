/**
 * TEYEON MATCH SPOTLIGHT 분석 엔진 fixture.
 *
 *   실행: node scripts/verify_match_spotlight.mts
 *   (Node 24 TypeScript type-stripping + scripts/ts-resolve-hook.mjs — 별도 러너/의존성 없음, DB 미접속)
 *
 *   검증:
 *     1) 기존 상대전적·파트너 전적(computeHeadToHead / computePartnerRecord)과 엔진 쌍 기록 완전 일치
 *     2) 공식 기록 판정(is_official · is_test · archive_type) · 기준일 컷오프 · 현재 세션 제외
 *     3) 게스트: 기본 식별 불가 · 이름만으로 병합 금지 · 운영진 확인 식별자만 포함
 *     4) 예측 등급(model/reference/insufficient) · 가짜 확률 금지 · 대칭성 · 결정성 · clamp
 *     5) SPOTLIGHT 유형 점수 · 메인 배지 · 동률 정렬 · 다양성 제한 · 부족 시 억지 채움 금지
 *     6) 세션 경기 skip(waiting 아님 · 선수 이상) · 경기 번호 · 선수 교체 hash
 *     7) 공개 DTO allow-list(내부 id 미노출) · 비공개 회원 수치 숨김 · 공유 문구
 */
import { register } from 'node:module';

register('./ts-resolve-hook.mjs', import.meta.url);

// 경로를 변수로 넘겨 프로젝트 tsc 검사 대상에서 제외(기존 verify_*.mts 관례 — 실행 시 Node 가 타입을 제거).
const load = (path: string): Promise<any> => import(path);

const { computeHeadToHead, computePartnerRecord } = await load('../lib/ranking/headToHead.ts');
const og = await load('../lib/kdk/analytics/officialGames.ts');
const pf = await load('../lib/kdk/analytics/playerForm.ts');
const pm = await load('../lib/kdk/analytics/predictionModel.ts');
const sp = await load('../lib/kdk/analytics/spotlight.ts');
const se = await load('../lib/kdk/analytics/spotlightEngine.ts');
const ps = await load('../lib/kdk/analytics/publicSpotlight.ts');
const pub = await load('../lib/kdk/analytics/spotlightPublish.ts');

let passed = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, info = '') => {
  if (cond) passed += 1;
  else failures.push(`${name}${info ? ` — ${info}` : ''}`);
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ── fixture ──────────────────────────────────────────────────────────────────
const MEMBERS = Array.from({ length: 8 }, (_, i) => ({ id: `mem-${i + 1}`, name: `회원${i + 1}` }));
const nm = (id: string) => MEMBERS.find((m) => m.id === id)?.name ?? id.replace(/^manual-guest-/, '') + '(G)';

let rngState = 20261103;
const rnd = () => { rngState = (Math.imul(rngState, 1103515245) + 12345) >>> 0; return rngState / 2 ** 32; };

/** 강도(높을수록 강함) 기반 결정적 결과 생성. */
const STRENGTH: Record<string, number> = { 'mem-1': 0.9, 'mem-2': 0.75, 'mem-3': 0.6, 'mem-4': 0.5, 'mem-5': 0.45, 'mem-6': 0.4, 'mem-7': 0.3, 'mem-8': 0.2 };
function game(id: string, round: number, ids: string[], forceA?: boolean) {
  const sa = (STRENGTH[ids[0]] ?? 0.5) + (STRENGTH[ids[1]] ?? 0.5);
  const sb = (STRENGTH[ids[2]] ?? 0.5) + (STRENGTH[ids[3]] ?? 0.5);
  const aWins = forceA ?? rnd() < sa / (sa + sb);
  return { id, round, court: 1, status: 'complete', player_ids: ids, player_names: ids.map(nm), score1: aWins ? 6 : 3, score2: aWins ? 3 : 6, group_name: 'A' };
}
function session(id: string, date: string, extra: Record<string, unknown> = {}, guest = 'manual-guest-손님') {
  const pool = MEMBERS.map((m) => m.id);
  const snapshot: any[] = [];
  for (let r = 1; r <= 4; r += 1) {
    const order = pool.slice().sort(() => rnd() - 0.5);
    snapshot.push(game(`${id}-r${r}a`, r, order.slice(0, 4)));
    snapshot.push(game(`${id}-r${r}b`, r, order.slice(4, 8)));
  }
  snapshot.push(game(`${id}-g`, 5, [guest, 'mem-1', 'mem-2', 'mem-3']));
  snapshot.push({ ...game(`${id}-draw`, 5, ['mem-4', 'mem-5', 'mem-6', 'mem-7']), score1: 5, score2: 5 }); // 무승부 제외
  snapshot.push({ ...game(`${id}-pend`, 5, ['mem-4', 'mem-5', 'mem-6', 'mem-8']), status: 'pending' });   // 미완료 제외
  return { id, created_at: `${date}T12:00:00Z`, archive_type: 'kdk', is_official: true, is_test: false, raw_data: { title: `세션 ${id}`, date, snapshot_data: snapshot }, ...extra };
}

const ARCHIVES: any[] = [];
for (let i = 0; i < 10; i += 1) ARCHIVES.push(session(`s${i + 1}`, `2026-09-${String(i + 1).padStart(2, '0')}`));
ARCHIVES.push(session('test1', '2026-09-20', { is_test: true }));            // 테스트 — 제외
ARCHIVES.push(session('unoff', '2026-09-21', { is_official: false }));       // 미확정 — 제외
ARCHIVES.push(session('today', '2026-10-01'));                               // 기준일 당일 — 제외
ARCHIVES.push(session('future', '2026-10-05'));                              // 기준일 이후 — 제외
ARCHIVES.push({ ...session('nodate', '2026-09-15'), created_at: null, raw_data: { ...session('nodate', '2026-09-15').raw_data, date: '' } }); // 날짜 미상 — 제외
const CUTOFF = { beforeDate: '2026-10-01', excludeArchiveIds: ['live-session'] };

// ── 1) 기존 상대전적·파트너 전적과 일치 ─────────────────────────────────────
{
  const pastRows = ARCHIVES.filter((r) => ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10'].includes(r.id));
  const set = og.extractOfficialGames(pastRows, MEMBERS, { beforeDate: '9999-12-31' });
  const idx = pf.buildGameIndex(set.games);
  let pairs = 0;
  for (const a of MEMBERS) for (const b of MEMBERS) {
    if (a.id === b.id) continue;
    const h = computeHeadToHead(pastRows, a.id, b.id, MEMBERS);
    const e = pf.pairRecord(idx, og.memberKey(a.id), og.memberKey(b.id), 'opponent');
    check(`h2h ${a.id}-${b.id}`, h.totalGames === e.games && h.aWins === e.wins && h.bWins === e.losses, `${h.totalGames}/${h.aWins} vs ${e.games}/${e.wins}`);
    const p = computePartnerRecord(pastRows, a.id, b.id, MEMBERS);
    const ep = pf.pairRecord(idx, og.memberKey(a.id), og.memberKey(b.id), 'partner');
    check(`partner ${a.id}-${b.id}`, p.totalGames === ep.games && p.wins === ep.wins, `${p.totalGames}/${p.wins} vs ${ep.games}/${ep.wins}`);
    pairs += 1;
  }
  check('h2h 비교 쌍 수', pairs === 56);
  check('h2h fixture 유효성(맞대결 실재)', computeHeadToHead(pastRows, 'mem-1', 'mem-2', MEMBERS).totalGames > 0);
  // 테스트·미확정 세션은 기존 helper 와 엔진 모두 제외
  const h = computeHeadToHead(ARCHIVES.filter((r) => r.id === 'test1' || r.id === 'unoff'), 'mem-1', 'mem-2', MEMBERS);
  const e = og.extractOfficialGames(ARCHIVES.filter((r) => r.id === 'test1' || r.id === 'unoff'), MEMBERS, { beforeDate: '9999-12-31' });
  check('테스트/미확정 세션 제외(기존 helper)', h.totalGames === 0);
  check('테스트/미확정 세션 제외(엔진)', e.games.length === 0);
}

// ── 2) 컷오프 ────────────────────────────────────────────────────────────────
const SET = og.extractOfficialGames(ARCHIVES, MEMBERS, CUTOFF);
{
  check('컷오프: 포함 세션은 s1~s10 만', eq(SET.archiveIds.slice().sort(), ['s1', 's10', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9']), SET.archiveIds.join(','));
  check('컷오프: 기준일 이상 날짜 없음', SET.games.every((g: any) => g.date < '2026-10-01'));
  check('경기 필터: 세션당 9경기(무승부·미완료 제외)', SET.games.length === 90, String(SET.games.length));
  check('시간 순 정렬', SET.games.every((g: any, i: number, arr: any[]) => i === 0 || arr[i - 1].date < g.date || (arr[i - 1].date === g.date && arr[i - 1].round <= g.round)));
  const set2 = og.extractOfficialGames(ARCHIVES, MEMBERS, { beforeDate: '2026-10-01', excludeArchiveIds: ['s10'] });
  check('현재 세션 id 명시 제외', !set2.archiveIds.includes('s10') && set2.games.length === 81);
  check('결정적 서명', og.extractOfficialGames(ARCHIVES, MEMBERS, CUTOFF).sourceSignature === SET.sourceSignature);
  check('서명은 입력이 바뀌면 달라짐', set2.sourceSignature !== SET.sourceSignature);
  check('빈 beforeDate 는 전부 제외', og.extractOfficialGames(ARCHIVES, MEMBERS, { beforeDate: '' }).games.length === 0);
}

// ── 3) 게스트 ────────────────────────────────────────────────────────────────
{
  check('게스트 기본 식별 불가', SET.games.filter((g: any) => g.matchId.endsWith('-g')).every((g: any) => g.teamA[0] === null));
  check('게스트 slot 집계', SET.guestSlots === 10 && SET.unidentifiedSlots === 10, `${SET.guestSlots}/${SET.unidentifiedSlots}`);
  const idx = pf.buildGameIndex(SET.games);
  check('게스트 기록 미생성(이름 병합 금지)', ![...idx.records.keys()].some((k: string) => k.startsWith('g:')));
  // 운영진 확인 식별자: s1·s2 만 확인 → 그 2경기만 포함, 나머지는 같은 키여도 제외
  const policy = og.confirmedGuestIdentity({ 's1::manual-guest-손님': 'guest-A', 's2::manual-guest-손님': 'guest-A' });
  const gset = og.extractOfficialGames(ARCHIVES, MEMBERS, CUTOFF, policy);
  const gidx = pf.buildGameIndex(gset.games);
  check('확인된 게스트만 포함', gidx.records.get('g:guest-A')?.games === 2, String(gidx.records.get('g:guest-A')?.games));
  check('게스트 2경기 → 분석 불가(3경기 미만)', pm.predictMatch(gidx, ['g:guest-A', 'm:mem-1'], ['m:mem-2', 'm:mem-3']).tier === 'insufficient');
  const all = og.confirmedGuestIdentity({ '*::manual-guest-손님': 'guest-A' });
  const aidx = pf.buildGameIndex(og.extractOfficialGames(ARCHIVES, MEMBERS, CUTOFF, all).games);
  check('확인 게스트 10경기 → 분석 포함', pm.predictMatch(aidx, ['g:guest-A', 'm:mem-1'], ['m:mem-2', 'm:mem-3']).tier === 'model');
}

// ── 4) 예측 ──────────────────────────────────────────────────────────────────
const IDX = pf.buildGameIndex(SET.games);
{
  const A = ['m:mem-1', 'm:mem-2'] as const;
  const B = ['m:mem-7', 'm:mem-8'] as const;
  const p = pm.predictMatch(IDX, A, B);
  check('강팀 우세', p.tier === 'model' && p.probA !== null && p.probA > 0.5 && p.label === 'favoredA', JSON.stringify(p.probA));
  const q = pm.predictMatch(IDX, B, A);
  check('대칭성 p(A,B)=1−p(B,A)', Math.abs((p.probA ?? 0) + (q.probA ?? 0) - 1) < 1e-3, `${p.probA} ${q.probA}`);
  check('결정성', eq(pm.predictMatch(IDX, A, B), p));
  check('clamp 범위', (p.probA ?? 0) <= pm.MODEL_V1.clampMax && (p.probA ?? 1) >= pm.MODEL_V1.clampMin);
  const extreme = pm.predictMatch(IDX, A, B, { ...pm.MODEL_V1, weights: { base: 50, form: 0, partner: 0, h2h: 0 } });
  check('clamp 상한 적용', extreme.probA === pm.MODEL_V1.clampMax);
  const g = pm.predictMatch(IDX, [null, 'm:mem-1'], ['m:mem-2', 'm:mem-3']);
  check('식별 불가 포함 → 확률 없음', g.tier === 'insufficient' && g.probA === null && g.factors === null);
  check('식별 불가여도 가능한 선수 표본 보존', g.samples.slots[1].games === IDX.records.get('m:mem-1').games && g.samples.slots[0].games === null);
  // 표본 단계: 3~7 → reference, ≥8 → model, <3 → insufficient
  const mkIdx = (n: number) => pf.buildGameIndex(Array.from({ length: n }, (_, i) => ({
    archiveId: 'x', date: '2026-01-01', matchId: `x${i}`, round: i, seq: 0,
    teamA: ['m:a', 'm:b'], teamB: ['m:c', 'm:d'], names: ['a', 'b', 'c', 'd'], scoreA: 6, scoreB: i % 2 ? 6 - 1 : 3, winner: i % 3 ? 'A' : 'B',
  })));
  check('2경기 → insufficient', pm.predictMatch(mkIdx(2), ['m:a', 'm:b'], ['m:c', 'm:d']).tier === 'insufficient');
  check('3경기 → reference', pm.predictMatch(mkIdx(3), ['m:a', 'm:b'], ['m:c', 'm:d']).tier === 'reference');
  check('7경기 → reference', pm.predictMatch(mkIdx(7), ['m:a', 'm:b'], ['m:c', 'm:d']).tier === 'reference');
  check('8경기 → model', pm.predictMatch(mkIdx(8), ['m:a', 'm:b'], ['m:c', 'm:d']).tier === 'model');
  check('연승 계산', pf.streakOf([false, true, true, true]) === 3 && pf.streakOf([true, false, false]) === -2 && pf.streakOf([]) === 0);
}

// ── 5) SPOTLIGHT 선정 ────────────────────────────────────────────────────────
{
  const mk = (matchId: string, matchNo: number, score: number, type: string, keys: string[], sampleGames = 40, round = 1) =>
    ({ matchId, matchNo, round, candidates: [], mainType: type, score, sampleGames, playerKeys: keys });
  const pool = [
    mk('a', 1, 70, 'RIVAL', ['p1', 'p2', 'p3', 'p4']),
    mk('b', 2, 70, 'RIVAL', ['p5', 'p6', 'p7', 'p8'], 50),       // 동점 → 근거 경기 수 많은 b 먼저
    mk('c', 3, 69, 'RIVAL', ['p9', 'p10', 'p11', 'p12']),
    mk('d', 4, 68, 'RIVAL', ['p13', 'p14', 'p15', 'p16']),     // 같은 배지 4번째 → 제외
    mk('e', 5, 67, 'CLOSE', ['p1', 'p5', 'p9', 'p17']),
    mk('f', 6, 66, 'CLOSE', ['p1', 'p18', 'p19', 'p20']),      // p1 3회째 → 제외
    mk('g', 7, 59, 'POWER', ['p21', 'p22', 'p23', 'p24']),     // 기준 미달
    mk('h', 8, 65, 'HOT_STREAK', ['p25', 'p26', 'p27', 'p28']),
  ];
  const s = sp.selectSpotlight(pool);
  check('선정 순서·제한', eq(s.selected.map((x: any) => x.matchId), ['b', 'a', 'c', 'e', 'h']), s.selected.map((x: any) => x.matchId).join(','));
  check('최대 5개', s.selected.length === 5);
  check('기준 미달 제외 · qualified 수', s.qualified === 7);
  const few = sp.selectSpotlight([pool[0], pool[6]]);
  check('부족하면 억지로 채우지 않음', few.selected.length === 1 && few.shortfall === true);
  check('입력 순서와 무관', eq(sp.selectSpotlight(pool.slice().reverse()).selected.map((x: any) => x.matchId), s.selected.map((x: any) => x.matchId)));
  const tie = sp.selectSpotlight([mk('z', 9, 70, 'RIVAL', ['q1', 'q2', 'q3', 'q4'], 40, 2), mk('y', 3, 70, 'RIVAL', ['q5', 'q6', 'q7', 'q8'], 40, 1)]);
  check('동률: round↑ 우선', tie.selected[0].matchId === 'y');

  // 유형 판정(실제 index)
  const pred = pm.predictMatch(IDX, ['m:mem-1', 'm:mem-8'], ['m:mem-2', 'm:mem-7']);
  const an = sp.analyzeSpotlightMatch(IDX, { matchId: 'x', matchNo: 1, round: 1, teamA: ['m:mem-1', 'm:mem-8'], teamB: ['m:mem-2', 'm:mem-7'], prediction: pred });
  const rival = an.candidates.find((c: any) => c.type === 'RIVAL');
  const rec = pf.pairRecord(IDX, 'm:mem-1', 'm:mem-2', 'opponent');
  check('RIVAL 후보 존재(맞대결 ≥3)', !!rival && rival.fact.games >= 3);
  check('메인 배지 = 최고 점수', an.mainType === an.candidates[0]?.type);
  check('경기 점수 = 메인 + 2·추가', an.score === Math.round((an.candidates[0].score + 2 * (an.candidates.length - 1)) * 100) / 100);
  const slotKeys = ['m:mem-1', 'm:mem-8', 'm:mem-2', 'm:mem-7'];
  const rivalRec = rival ? pf.pairRecord(IDX, slotKeys[rival.fact.aSlot], slotKeys[rival.fact.bSlot], 'opponent') : null;
  check('RIVAL 사실은 실제 쌍 기록', !!rivalRec && rival.fact.games === rivalRec.games && rival.fact.aWins === rivalRec.wins && rival.fact.bWins === rivalRec.losses);
  check('쌍 기록 실재(fixture 유효성)', rec.games > 0);
  const restricted = sp.analyzeSpotlightMatch(IDX, { matchId: 'x', matchNo: 1, round: 1, teamA: ['m:mem-1', 'm:mem-8'], teamB: ['m:mem-2', 'm:mem-7'], prediction: pred }, sp.SPOTLIGHT_V1, new Set(['m:mem-1', 'm:mem-2', 'm:mem-7', 'm:mem-8']));
  check('비공개 회원은 RIVAL·HOT_STREAK 근거 제외', !restricted.candidates.some((c: any) => c.type === 'RIVAL' || c.type === 'HOT_STREAK'));
}

// ── 6) 세션 경기 → buildSpotlight ───────────────────────────────────────────
const LIVE = [
  { id: 'L3', round: 2, court: 1, status: 'waiting', group_name: 'A', player_ids: ['mem-1', 'mem-8', 'mem-2', 'mem-7'], player_names: ['회원1', '회원8', '회원2', '회원7'] },
  { id: 'L1', round: 1, court: 1, status: 'waiting', group_name: 'A', player_ids: ['mem-1', 'mem-2', 'mem-3', 'mem-4'], player_names: ['회원1', '회원2', '회원3', '회원4'] },
  { id: 'L2', round: 1, court: 2, status: 'playing', group_name: 'A', player_ids: ['mem-5', 'mem-6', 'mem-7', 'mem-8'], player_names: ['회원5', '회원6', '회원7', '회원8'] },
  { id: 'L4', round: 2, court: 2, status: 'waiting', group_name: 'A', player_ids: ['manual-guest-손님', 'mem-3', 'mem-5', 'mem-6'], player_names: ['손님(G)', '회원3', '회원5', '회원6'] },
  { id: 'L5', round: 3, court: 1, status: 'waiting', group_name: 'A', player_ids: ['mem-1', 'mem-1', 'mem-2', 'mem-3'], player_names: ['회원1', '회원1', '회원2', '회원3'] },
  { id: 'L6', round: 3, court: 2, status: 'complete', group_name: 'A', player_ids: ['mem-4', 'mem-5', 'mem-6', 'mem-7'], player_names: ['회원4', '회원5', '회원6', '회원7'] },
];
const INPUT = { sessionId: 'live-session', sessionDate: '2026-10-01', sessionMatches: LIVE, archiveRows: ARCHIVES, members: MEMBERS };
const RESULT = se.buildSpotlight(INPUT);
{
  check('waiting 만 예측', eq(RESULT.predictions.map((p: any) => p.matchId), ['L1', 'L3', 'L4']), RESULT.predictions.map((p: any) => p.matchId).join(','));
  check('skip 사유', eq(RESULT.skipped.map((s: any) => [s.matchId, s.reason]), [['L2', 'not_waiting'], ['L5', 'invalid_players'], ['L6', 'not_waiting']]), JSON.stringify(RESULT.skipped));
  check('경기 번호 round→court', eq(RESULT.predictions.map((p: any) => p.matchNo), [1, 3, 4]));
  check('게스트 경기 데이터 부족', RESULT.predictions.find((p: any) => p.matchId === 'L4').prediction.tier === 'insufficient');
  check('결정성(전체 결과)', eq(se.buildSpotlight(INPUT), RESULT));
  check('컷오프 근거 보존', RESULT.cutoffDate === '2026-10-01' && RESULT.source.archiveCount === 10 && RESULT.source.gameCount === 90);
  check('선정은 예측된 경기 중에서만', RESULT.selection.matchIds.every((id: string) => ['L1', 'L3', 'L4'].includes(id)));
  check('선수 교체 시 hash 변경', se.playersHashOf(['a', 'b', 'c', 'd']) !== se.playersHashOf(['a', 'b', 'd', 'c']));
  check('입력 순서와 무관한 결과', eq(se.buildSpotlight({ ...INPUT, sessionMatches: LIVE.slice().reverse() }), RESULT));
  check('모델 버전 기록', RESULT.modelVersion === 'spotlight-v1' && RESULT.selectVersion === 'spotlight-select-v1');
}

// ── 7) 공개 DTO · 공유 문구 ─────────────────────────────────────────────────
{
  const payload = ps.buildPublicSpotlightPayload(RESULT, { title: '11월 정모 KDK', date: '2026-10-01' });
  const json = JSON.stringify(payload);
  check('공개 DTO 에 member id 없음', !/mem-\d/.test(json));
  check('공개 DTO 에 분석 키·factors 없음', !/"m:|"g:|factors|playerIds|playersHash/.test(json));
  check('전체 경기 분석 = 예측 경기 수', payload.matches.length === RESULT.predictions.length);
  check('데이터 부족 경기 % 없음', payload.matches.filter((m: any) => m.confidence === '데이터 부족').every((m: any) => m.prediction.kind === 'insufficient'));
  check('items 는 선정 순서', eq(payload.items.map((i: any) => i.matchNo), RESULT.selection.matchIds.map((id: string) => RESULT.predictions.find((p: any) => p.matchId === id).matchNo)));
  check('items 문구 존재', payload.items.every((i: any) => i.headline && i.viewpoint));
  check('percent 합 100', payload.matches.every((m: any) => m.prediction.kind !== 'percent' || m.prediction.teamA + m.prediction.teamB === 100));
  const rres = se.buildSpotlight({ ...INPUT, restrictedMemberIds: ['mem-1'] });
  const rp = ps.buildPublicSpotlightPayload(rres, { title: 't', date: '2026-10-01' });
  const l1 = rres.predictions.find((p: any) => p.matchId === 'L1');
  check('비공개 회원 slot 표시', l1.restrictedSlots[0] === true);
  check('비공개 회원 표본 수 미포함', (() => {
    const pub = ps.toPublicMatch(l1);
    const others = l1.prediction.samples.slots.filter((s: any) => s.slot !== 0).map((s: any) => s.games);
    return pub.sampleRange !== null && pub.sampleRange.min === Math.min(...others) && pub.sampleRange.max === Math.max(...others);
  })());
  check('비공개 회원 RIVAL·연승 문구 미포함', rp.items.every((i: any) => !(i.viewpoint.includes('회원1') && (i.badge === 'RIVAL' || i.badge === 'HOT_STREAK'))));
  const text = ps.buildSpotlightShareText(payload, 'https://teyeon-system.vercel.app/kdk/spotlight/abc');
  check('공유 문구: 링크·고지 포함', text.includes('https://teyeon-system.vercel.app/kdk/spotlight/abc') && text.includes(ps.SPOTLIGHT_DISCLAIMER));
  check('공유 문구: id 미포함', !/mem-\d/.test(text));
  const empty = ps.buildSpotlightShareText({ ...payload, items: [] }, 'u');
  check('선정 0개 공유 문구', empty.includes('선정되지 않았습니다'));
  const desc = ps.describeSpotlight({ ...l1, mainType: 'HOT_STREAK', candidates: [{ type: 'HOT_STREAK', score: 65, fact: { type: 'HOT_STREAK', slot: 2, streak: 4 } }] });
  check('연승 문구는 라운드 기준 명시', !!desc && desc.viewpoint.includes('라운드 순서 기준') && desc.headline === '4연승 도전');
}

// ── 8) 1차 공개 정책: 숫자 확률 비공개 · 라벨만 ─────────────────────────────
{
  const payload = ps.buildPublicSpotlightPayload(RESULT, { title: 't', date: '2026-10-01' });
  const json = JSON.stringify(payload);
  check('공개 DTO 에 숫자 확률 없음(percent·probA·%)', !/percent|probA|prob_a|\d+%/.test(json), json.slice(0, 200));
  check('예측은 라벨 또는 데이터 부족만', payload.matches.every((m: any) => m.prediction.kind === 'insufficient' || (m.prediction.kind === 'label' && ['팀 A 우세', '팀 B 우세', '박빙'].includes(m.prediction.text))));
  check('model 등급도 라벨로 표시', RESULT.predictions.some((p: any) => p.prediction.tier === 'model') && payload.matches.some((m: any) => m.prediction.kind === 'label'));
  const close = ps.describeSpotlight({ ...RESULT.predictions[0], mainType: 'CLOSE', candidates: [{ type: 'CLOSE', score: 70, fact: { type: 'CLOSE', probA: 0.51, tier: 'model' } }] });
  check('CLOSE 문구에 숫자 확률 없음', !!close && !/%|\d+\s*:\s*\d+/.test(close.viewpoint));
  check('고지 문구: 참고용 · 결과 보장 안 함', ps.SPOTLIGHT_DISCLAIMER.includes('참고용') && ps.SPOTLIGHT_DISCLAIMER.includes('보장하지 않습니다'));
  const text = ps.buildSpotlightShareText(payload, 'https://x/club/spotlight/abcdefabcdef');
  check('공유 문구에 숫자 확률 없음', !/\d+%/.test(text));
  // POWER 는 비공개 회원 포함 시 제외
  const powerCfg = { ...sp.SPOTLIGHT_V1, powerMinGames: 1, powerMinRate: 0 };
  const pr = pm.predictMatch(IDX, ['m:mem-1', 'm:mem-2'], ['m:mem-3', 'm:mem-4']);
  const base = sp.analyzeSpotlightMatch(IDX, { matchId: 'p', matchNo: 1, round: 1, teamA: ['m:mem-1', 'm:mem-2'], teamB: ['m:mem-3', 'm:mem-4'], prediction: pr }, powerCfg);
  const restr = sp.analyzeSpotlightMatch(IDX, { matchId: 'p', matchNo: 1, round: 1, teamA: ['m:mem-1', 'm:mem-2'], teamB: ['m:mem-3', 'm:mem-4'], prediction: pr }, powerCfg, new Set(['m:mem-4']));
  check('POWER 후보 존재(기준 완화 시)', base.candidates.some((c: any) => c.type === 'POWER'));
  check('비공개 회원 포함 시 POWER 제외', !restr.candidates.some((c: any) => c.type === 'POWER'));
}

// ── 9) 공개 직전 재검증(preparePublish) ──────────────────────────────────────
{
  const stored = RESULT.predictions.map((p: any) => ({
    matchId: p.matchId, status: 'active', selected: RESULT.selection.matchIds.includes(p.matchId), snapshot: p, currentPlayerIds: p.playerIds,
  }));
  const base = { modelVersion: RESULT.modelVersion, selectVersion: RESULT.selectVersion, sessionId: 'live-session', cutoffDate: '2026-10-01', title: 't', date: '2026-10-01' };
  const same = pub.preparePublish({ ...base, predictions: stored, restrictedMemberIds: [] });
  const direct = ps.buildPublicSpotlightPayload(RESULT, { title: 't', date: '2026-10-01' });
  check('변경 없음 → 생성 시 DTO 와 동일', eq(same.payload, direct), JSON.stringify(same.payload.items.map((i: any) => i.matchNo)));
  check('변경 없음 → 무효화 0', same.invalidateMatchIds.length === 0 && same.droppedForPrivacy.length === 0);
  // 선수 교체
  const changed = stored.map((s: any) => s.matchId === 'L1' ? { ...s, currentPlayerIds: ['mem-1', 'mem-2', 'mem-3', 'mem-8'] } : s);
  const c = pub.preparePublish({ ...base, predictions: changed, restrictedMemberIds: [] });
  check('선수 교체 경기 무효화', eq(c.invalidateMatchIds, ['L1']));
  check('무효화 경기 공개 DTO 제외(주목·전체 모두)', !c.payload.items.some((i: any) => i.matchNo === 1) && !c.payload.matches.some((m: any) => m.matchNo === 1));
  // 세션 종료(행 없음) → 비교 생략·유지
  const gone = stored.map((s: any) => ({ ...s, currentPlayerIds: null }));
  check('LIVE 행 없음 → 유지', pub.preparePublish({ ...base, predictions: gone, restrictedMemberIds: [] }).invalidateMatchIds.length === 0);
  // 이미 무효/대체된 예측은 제외
  const inactive = stored.map((s: any) => s.matchId === 'L3' ? { ...s, status: 'superseded' } : s);
  check('active 아닌 예측 제외', !pub.preparePublish({ ...base, predictions: inactive, restrictedMemberIds: [] }).payload.matches.some((m: any) => m.matchNo === 3));
  // 공개 시점 비공개 전환 회원
  const all = ['mem-1', 'mem-2', 'mem-3', 'mem-4', 'mem-5', 'mem-6', 'mem-7', 'mem-8'];
  const priv = pub.preparePublish({ ...base, predictions: stored, restrictedMemberIds: all });
  check('전원 비공개 → 개인 표본 숫자 없음', priv.payload.matches.every((m: any) => m.sampleRange === null));
  check('전원 비공개 → RIVAL·연승·POWER 주목 경기 제외', priv.payload.items.every((i: any) => i.badge === 'CLOSE'));
  check('비공개 제외 수 보고', priv.droppedForPrivacy.length === same.payload.items.filter((i: any) => i.badge !== 'CLOSE').length);
  check('빈자리 억지 채움 없음', priv.payload.items.length <= same.payload.items.length);
}

// ── 10) 공개 응답 파서(allow-list) ───────────────────────────────────────────
{
  const payload = ps.buildPublicSpotlightPayload(RESULT, { title: 't', date: '2026-10-01' });
  check('파서 왕복 동일', eq(ps.parsePublicSpotlightPayload(JSON.parse(JSON.stringify(payload))), payload));
  const dirty = JSON.parse(JSON.stringify(payload));
  dirty.memberIds = ['mem-1']; dirty.items[0] = { ...(dirty.items[0] || { matchNo: 1, badge: 'RIVAL' }), playerIds: ['mem-1'], email: 'a@b.c', prediction: { kind: 'percent', teamA: 70, teamB: 30 } };
  dirty.matches.push({ matchNo: 99, teamA: ['<script>', 'x'], teamB: ['y', 'z'], prediction: { kind: 'label', text: '<b>' }, confidence: 'X', extra: 'mem-2' });
  const parsed = ps.parsePublicSpotlightPayload(dirty);
  const pj = JSON.stringify(parsed);
  check('파서: 예상 밖 필드 제거', !/memberIds|playerIds|email|extra|mem-\d/.test(pj), pj.slice(0, 200));
  check('파서: 숫자 확률 차단', !/percent|70/.test(JSON.stringify(parsed.items[0].prediction)));
  check('파서: 허용 외 라벨 → 데이터 부족', parsed.matches.find((m: any) => m.matchNo === 99).prediction.kind === 'insufficient');
  check('파서: 허용 외 신뢰도 → 데이터 부족', parsed.matches.find((m: any) => m.matchNo === 99).confidence === '데이터 부족');
  check('파서: 잘못된 입력 → null', ps.parsePublicSpotlightPayload(null) === null && ps.parsePublicSpotlightPayload('x') === null);
  check('파서: 주목 경기 최대 5', ps.parsePublicSpotlightPayload({ items: Array.from({ length: 9 }, () => payload.items[0] || { badge: 'RIVAL' }), matches: [] }).items.length <= 5);
}

// ── 긴 게스트 이름의 "(G)" 보존(STEP 2) — 표시만 바뀌고 계산은 그대로 ─────────
{
  const pn = await load('../lib/kdk/analytics/playerName.ts');
  const LONG_G = '가나다라마바사아자차카타파하가나다라마바사아자(G)';      // 26자
  check('이름: 24자 이하는 그대로', pn.clipPlayerName('김철수(G)') === '김철수(G)' && pn.clipPlayerName(' 홍  길동 ') === '홍 길동');
  check('이름: 긴 게스트 → …(G) 보존 · 24자', pn.clipPlayerName(LONG_G).endsWith('…(G)') && pn.clipPlayerName(LONG_G).length === 24, pn.clipPlayerName(LONG_G));
  check('이름: 긴 회원 이름은 기존과 같은 24자 절단', pn.clipPlayerName('가'.repeat(30)) === '가'.repeat(24));
  check('이름: 비문자/빈값 안전', pn.clipPlayerName(null) === '' && pn.clipPlayerName(undefined) === '');

  // 엔진: 긴 게스트 이름이 들어간 세션 — 표시 이름만 다르고 예측·선정 결과는 이름 무관(같은 pid 면 동일)
  const row = LIVE[0];
  const withLong = LIVE.map((r: any, i: number) => i === 0 ? { ...r, player_names: [r.player_names[0], r.player_names[1], r.player_names[2], LONG_G] } : r);
  const a = se.buildSpotlight({ ...INPUT, sessionMatches: withLong });
  const pA = a.predictions.find((p: any) => p.matchId === String(row.id));
  const pR = RESULT.predictions.find((p: any) => p.matchId === String(row.id));
  if (pA && pR) {
    check('엔진: 긴 게스트 표시 이름에 (G) 보존', pA.playerNames[3].endsWith('…(G)'), pA.playerNames[3]);
    check('엔진: 표시 이름 외 예측 결과 동일(계산 무변경)', eq({ ...pA, playerNames: null }, { ...pR, playerNames: null })
      || eq(pA.prediction, pR.prediction));
  } else {
    check('엔진: 대상 경기 존재', false, String(row.id));
  }
  const parsedLong = ps.parsePublicSpotlightPayload({ items: [], matches: [{ matchNo: 1, round: 1, teamA: ['a', 'b'], teamB: ['c', LONG_G] }] });
  check('파서: 긴 게스트 이름 (G) 보존', parsedLong.matches[0].teamB[1].endsWith('…(G)'), parsedLong.matches[0].teamB[1]);
}

console.log(`MATCH SPOTLIGHT fixture: ${passed} passed / ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
