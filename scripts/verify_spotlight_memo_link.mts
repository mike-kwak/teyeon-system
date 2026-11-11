/**
 * MATCH SPOTLIGHT 운영진 관전 포인트 — 메모 경기 자동 연결 · 공개 문구 검증 fixture (순수 계산 + 핸들러 · 가짜 의존성). 네트워크 · DB · 외부 AI 미사용.
 *
 *   실행: node scripts/verify_spotlight_memo_link.mts
 *   검증: 다중 경기 메모 분리 · 경기 연결(번호 · 코트 · 이름 · 동명 · 후보 여러 개 · 없는 번호 · 번호/이름 불일치) ·
 *         공개 문구 검증(120자 · 꺾쇠 · 다른 경기 선수 · 개인정보 · 기존 공개 문구는 경고만) ·
 *         서버 matches(권한 · runId · 공개 대상만 · 선수 변경 제외 · fail-closed · 저장/공개 RPC 미호출) · AI action 제거.
 */
import { register } from 'node:module';

register('./ts-resolve-hook.mjs', import.meta.url);
const load = (path: string): Promise<any> => import(path);
const ml = await load('../lib/kdk/analytics/spotlightMemoLink.ts');
const { handleSpotlightAction } = await load('../lib/kdk/server/spotlightHandler.ts');
const se = await load('../lib/kdk/analytics/spotlightEngine.ts');

let passed = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, info = '') => { if (cond) passed += 1; else failures.push(`${name}${info ? ` — ${info}` : ''}`); };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// ── 가상 세션(가상 이름 · 실제 운영 데이터 아님) ────────────────────────────────────
//   matchNo 는 라운드 → 코트 → id 순. R1: 1~3경기(1~3코트), R2: 4~7경기(1~4코트)
const T = [
  ['구봉준', '김영호', '김병식', '최지훈'], ['정다은', '이상윤', '박광현', '남인우'], ['오세훈', '한지민', '윤서준', '강민호'],
  ['구봉준', '정다은', '김영호', '오세훈'], ['김병식', '이상윤', '홍길동(G)', '한지민'], ['최지훈', '박광현', '윤서준', '남인우'],
  ['강민호', '김영호', '이상윤', '오세훈'],
];
const NAMES = [...new Set(T.flat().filter((n) => !n.includes('(G)')))];
const MEMBERS = NAMES.map((name, i) => ({ id: `11111111-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, name }));
const pid = (n: string) => MEMBERS.find((m) => m.name === n)?.id || `guest-${n}`;
const SID = 'KDK-20261108-QAML';
const CLUB = 'club-qa';
const RUN_ID = '11111111-2222-3333-4444-555555555555';
const ROWS = T.map((names, i) => ({ id: `aaaaaaaa-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, session_id: SID, session_title: '11월 정모',
  round: i < 3 ? 1 : 2, court: i < 6 ? (i % 3) + 1 : 4, player_ids: names.map(pid), player_names: names, group_name: 'A', status: 'waiting' }));
const built = se.buildSpotlight({ sessionId: SID, sessionDate: '2026-11-08', sessionMatches: ROWS, archiveRows: [], members: MEMBERS });
const withType = (s: any, type: string | null, fact: any) => ({ ...s, mainType: type, score: type ? 70 : 0, candidates: type ? [{ type, score: 70, fact }] : [] });
const snapOf = (no: number) => clone(built.predictions.find((p: any) => p.matchNo === no));
const SNAPS = [
  withType(snapOf(1), 'RIVAL', { type: 'RIVAL', kind: 'fated', aSlot: 0, bSlot: 2, aWins: 3, bWins: 3, games: 6 }),
  withType(snapOf(2), 'CLOSE', { type: 'CLOSE', probA: 0.5, tier: 'reference' }),
  withType(snapOf(3), 'POWER', { type: 'POWER', minGames: 25, avgRate: 0.6 }),
  withType(snapOf(4), 'HOT_STREAK', { type: 'HOT_STREAK', slot: 0, streak: 4 }),
  withType(snapOf(5), 'CLOSE', { type: 'CLOSE', probA: 0.52, tier: 'reference' }),
  withType(snapOf(6), 'CLOSE', { type: 'CLOSE', probA: 0.49, tier: 'reference' }),
  withType(snapOf(7), null, null),
];
check('fixture: 7경기 · 번호 순서(라운드 → 코트)', SNAPS.map((s: any) => s.matchNo).join() === '1,2,3,4,5,6,7' && SNAPS[3].court === 1 && SNAPS[6].court === 4 && SNAPS[6].round === 2);

// 경기 정보(서버 matches 와 같은 모양)
const INFOS = SNAPS.map((s: any, i: number) => ({
  matchNo: s.matchNo, round: s.round, court: s.court, group: 'A',
  teamA: [s.playerNames[0], s.playerNames[1]], teamB: [s.playerNames[2], s.playerNames[3]],
  badge: s.mainType, inTop: i < 5, status: 'waiting',
}));

// ── 1) 메모 분리 · 경기 연결 ────────────────────────────────────────────────────
{
  const L = (memo: string) => ml.linkInstructions(memo, INFOS);
  const one = L('구봉준·김영호 호흡이 좋아서 기대돼');
  check('메모 1개 → 경기 1개 연결(같은 팀 단서)', one.length === 1 && one[0].status === 'linked' && one[0].matchNo === 1, JSON.stringify(one));
  const memo3 = '2번 경기는 오픈부 선수들이 나오는 경기라서 좀 강조해 줘. 3번 경기는 두 팀의 실력이 비슷해서 접전이 예상돼. 5번 경기는 김병식 선수가 최근 상승세니까 주목해 줘.';
  const three = L(memo3);
  check('메모 1개 → 경기 3개 분리(2 · 3 · 5)', three.length === 3 && three.map((l: any) => l.matchNo).join() === '2,3,5', JSON.stringify(three.map((l: any) => [l.status, l.matchNo])));
  check('번호만 → 확인 요청(confirm) · 번호+이름 일치 → 자동 연결', three[0].status === 'confirm' && three[1].status === 'confirm' && three[2].status === 'linked');
  check('조각별 원문 보존(다른 경기 메모 섞이지 않음)', three[0].instruction.includes('오픈부') && !three[0].instruction.includes('접전') && three[2].instruction.includes('상승세'));
  const commas = L('2번은 오픈부 경기라 강조하고, 3번은 접전 예상, 5번은 특별히 주목해 줘.');
  check('한 문장 쉼표 나열 → 3개 분리 · 연결어 정리', commas.length === 3 && commas[0].instruction === '2번은 오픈부 경기라 강조하고' && commas[1].instruction === '3번은 접전 예상', JSON.stringify(commas.map((l: any) => l.instruction)));
  const oneLine = L('2번 3번 5번 경기 모두 기대돼');
  check('한 줄 번호 나열(2 · 3 · 5) → 3개 분리', oneLine.length === 3 && oneLine.map((l: any) => l.matchNo).join() === '2,3,5', JSON.stringify(oneLine.map((l: any) => [l.status, l.matchNo])));
  const rc = L('R2 1코트 구봉준 팀 기대\n2라운드 3코트 접전');
  check('라운드+코트 → 자동 연결(R2 1코트 = 4경기, 2라운드 3코트 = 6경기)', rc[0].status === 'linked' && rc[0].matchNo === 4 && rc[1].status === 'linked' && rc[1].matchNo === 6, JSON.stringify(rc));
  const conflict = L('3번 경기 구봉준 출전');
  check('번호와 선수 불일치(3경기에 구봉준 없음) → conflict · 자동 확정 안 함', conflict[0].status === 'conflict' && conflict[0].matchNo === null && conflict[0].candidates.includes(3) && conflict[0].candidates.includes(1), JSON.stringify(conflict));
  const same = L('김영호 선수 응원해');
  check('같은 선수가 여러 경기(김영호 1 · 4 · 7경기) → 후보 선택', same[0].status === 'choose' && same[0].candidates.join() === '1,4,7', JSON.stringify(same));
  const missing = L('9번 경기 강조');
  check('없는 경기 번호 → missing(경기 선택 요청)', missing[0].status === 'missing' && missing[0].matchNo === null);
  const court = L('1코트 주목');
  check('코트만(라운드 없음) → 후보 여러 개(1 · 4경기)', court[0].status === 'choose' && court[0].candidates.join() === '1,4');
  const top = L('R2 3코트 박광현 팀 기대');
  check('TOP5 밖 경기(6경기)도 연결', top[0].status === 'linked' && top[0].matchNo === 6 && !INFOS[5].inTop);
  const cont = L('2번은 오픈부. 정말 기대돼.');
  check('단서 없는 이어지는 문장은 앞 조각에 합침', cont.length === 1 && cont[0].instruction.includes('정말 기대돼'));
  const nums = L('3연승 중인 팀 주목\n1.5세트 같은 접전');
  check('"3연승" · 소수점은 경기 번호로 보지 않음', nums.every((l: any) => l.status !== 'missing' && l.refText === ''), JSON.stringify(nums));
  check('연결 최대 8개', L(Array.from({ length: 12 }, (_, i) => `${(i % 7) + 1}번 경기 주목`).join('\n')).length === 8);
  check('메모 조각 최대 200자 · 메모 1000자', [...L(`2번 경기 ${'가'.repeat(300)}`)[0].instruction].length === 200
    && ml.splitInstructions('가'.repeat(1500)).reduce((n: number, p: any) => n + [...p.text].length, 0) <= 1000);
  check('꺾쇠 · 제어문자 정리', !L('2번 <b>강조</b>')[0].instruction.includes('<'));
  check('빈 메모 → 연결 없음', L('   \n  ').length === 0);
  // 동명이인: 다른 회원이지만 표시명이 같은 경우 → 두 경기 후보
  const twins = INFOS.map((m: any) => (m.matchNo === 6 ? { ...m, teamA: ['김병식', m.teamA[1]] } : m));
  const tw = ml.linkInstructions('김병식 선수 기대', twins);
  check('동명이인(김병식 1 · 5 · 6경기) → 자동 확정 안 함', tw[0].status === 'choose' && tw[0].candidates.includes(6) && tw[0].candidates.includes(1));
}

// ── 2) 공개 문구 검증 ────────────────────────────────────────────────────────────
const ALL = ml.allNamesOf(INFOS);
const own = (i: number) => [...INFOS[i].teamA, ...INFOS[i].teamB];
{
  const C = (t: string, i = 1, approved = false) => ml.checkPublicText(t, own(i), ALL, approved);
  check('문제 없는 문장 → 문제 없음', C('두 팀 모두 호흡이 좋아 기대되는 경기입니다.').length === 0);
  check('빈 문구 → 검증 안 함(관전 포인트 없이 공개)', C('   ').length === 0);
  check('120자 초과 → 차단 · 120자는 허용', C('가'.repeat(121))[0]?.code === 'too_long' && C('가'.repeat(121))[0].severity === 'block' && C('가'.repeat(120)).length === 0);
  check('꺾쇠 → 차단', C('<b>경기</b>').some((x: any) => x.code === 'html' && x.severity === 'block'));
  check('다른 경기 선수 이름 → 차단(경기 변경 후 이전 문구 오연결 방지)', C('구봉준 선수도 응원 오는 경기').some((x: any) => x.code === 'other_player' && x.detail.includes('구봉준') && x.severity === 'block'));
  check('이 경기 선수 이름은 허용', C('정다은·이상윤 팀의 호흡을 주목해 주세요.').length === 0);
  check('개인정보(전화 · 이메일 · 계좌) → 차단', C('문의 010-1234-5678').some((x: any) => x.code === 'pii') && C('qa@example.com 으로 연락').some((x: any) => x.code === 'pii') && C('계좌 알려드려요').some((x: any) => x.code === 'pii'));
  check('날짜 · 점수는 개인정보로 보지 않음 · 긴 계좌번호는 차단', C('2026-11-08 정모 6-4 접전').length === 0 && C('입금 110 123 456789').some((x: any) => x.code === 'pii'));
  check('라운드 · 코트 · 연승 같은 운영진 표현은 막지 않음', C('2라운드 2코트 4연승 도전 오픈부 경기').length === 0);
  const ap = C('구봉준 선수와 리턴매치', 1, true);
  check('이미 공개 중인 같은 문구 → 차단 대신 경고(기존 승인 문구 보호)', ap.length === 1 && ap[0].severity === 'warn' && ml.blockingIssues(ap).length === 0);
  check('issueText 한국어', /선수/.test(ml.issueText({ code: 'other_player', severity: 'block', detail: '구봉준' })) && /120자/.test(ml.issueText({ code: 'too_long', severity: 'block', detail: '130' })));
  check('matchInfoLabel: 라운드 · 코트 · 조 · 번호 · 선수', ml.matchInfoLabel(INFOS[3]) === `R2 · 1코트 · A조 · 4경기 — ${INFOS[3].teamA.join('·')} vs ${INFOS[3].teamB.join('·')}`);
}

// ── 3) 서버 핸들러(가짜 의존성) ─────────────────────────────────────────────────
function makeDeps(o: { manage?: boolean; rows?: any[]; rpcFail?: boolean; restricted?: string[] | null } = {}) {
  const calls: string[] = [];
  const deps: any = {
    configured: true, clubId: CLUB,
    verifyUser: async (t: string) => (t === 'good' ? 'user-1' : null),
    getRole: async () => 'MEMBER',
    canManageKdk: async () => (o.manage === false ? false : true),
    loadSessionMatches: async () => o.rows ?? ROWS,
    loadOfficialArchives: async () => [], loadMembers: async () => MEMBERS,
    loadRestrictedMemberIds: async () => (o.restricted === undefined ? [] : o.restricted),
    latestRunRevision: async () => 1, randomSlug: () => 'qaslug000000001', today: () => '2026-11-08',
    rpc: async (fn: string) => {
      calls.push(fn);
      if (o.rpcFail) return { ok: false, status: 500, code: 'x' };
      if (fn === 'get_kdk_spotlight_run_for_publish') {
        const cur = new Map((o.rows ?? ROWS).map((r: any) => [r.id, r.player_ids]));
        return { ok: true, data: { ok: true, run: { id: RUN_ID, club_id: CLUB, session_id: SID, status: 'draft', revision: 1, model_version: 'm', select_version: 's',
          cutoff_date: '2026-11-08', session_title: '11월 정모', session_date: '2026-11-08' },
          predictions: SNAPS.map((s: any, i: number) => ({ match_id: s.matchId, status: 'active', selected: i < 5, snapshot: s, current_player_ids: cur.get(s.matchId) ?? null })) } };
      }
      return { ok: false, status: 404, code: 'PGRST202' };
    },
  };
  return { deps, calls };
}
const call = (deps: any, body: any, token = 'good') => handleSpotlightAction(deps, token ? `Bearer ${token}` : null, body);
{
  const { deps, calls } = makeDeps();
  check('비로그인 → 401', (await call(deps, { action: 'matches', runId: RUN_ID }, '')).status === 401);
  check('위조 토큰 → 401', (await call(deps, { action: 'matches', runId: RUN_ID }, 'bad')).status === 401);
  check('관리자 아님 → 403', (await call(makeDeps({ manage: false }).deps, { action: 'matches', runId: RUN_ID })).status === 403);
  check('runId 형식 오류 → 400', (await call(deps, { action: 'matches', runId: 'x' })).status === 400);
  const m = await call(deps, { action: 'matches', runId: RUN_ID });
  const ms = m.body.matches;
  check('matches: 공개 대상 7경기 · 라운드 · 코트 · TOP', m.status === 200 && ms.length === 7 && ms[3].court === 1 && ms[3].round === 2 && ms[0].inTop && !ms[5].inTop);
  check('matches: 경기 id · 회원 id · 확률 미포함', !JSON.stringify(ms).includes(SNAPS[0].matchId) && !JSON.stringify(ms).includes('11111111-0000') && !/prob|"ref"|official/.test(JSON.stringify(ms)));
  check('matches: 읽기 RPC 만(저장 · 공개 · 비공개 RPC 미호출)', calls.length > 0 && calls.every((c) => c === 'get_kdk_spotlight_run_for_publish'));
  const changedRows = ROWS.map((r: any, i: number) => (i === 1 ? { ...r, player_ids: [r.player_ids[0], r.player_ids[1], r.player_ids[3], r.player_ids[2]] } : r));
  const chM = await call(makeDeps({ rows: changedRows }).deps, { action: 'matches', runId: RUN_ID });
  check('선수 변경 경기(2경기)는 목록에서 제외', !chM.body.matches.some((x: any) => x.matchNo === 2) && chM.body.matches.length === 6);
  check('공개 범위 조회 실패 → 502(비공개 보호)', (await call(makeDeps({ restricted: null }).deps, { action: 'matches', runId: RUN_ID })).body.reason === 'visibility_unavailable');
  check('DB 오류 → 502', (await call(makeDeps({ rpcFail: true }).deps, { action: 'matches', runId: RUN_ID })).status === 502);
  check('AI action 제거(ai_matches · ai_draft → invalid_action)', (await call(deps, { action: 'ai_matches', runId: RUN_ID })).body.reason === 'invalid_action'
    && (await call(deps, { action: 'ai_draft', runId: RUN_ID, items: [] })).body.reason === 'invalid_action');
}

console.log(`MATCH SPOTLIGHT memo link fixture: ${passed} passed / ${failures.length} failed`);
for (const f of failures) console.log('  FAIL', f);
process.exit(failures.length ? 1 : 0);
