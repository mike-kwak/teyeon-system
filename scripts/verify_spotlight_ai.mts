/**
 * MATCH SPOTLIGHT AI 운영진 관전 포인트 v2 fixture — 순수 계산 + 핸들러(가짜 의존성 · 가짜 AI). 네트워크 · DB · 실제 AI 미사용.
 *
 *   실행: node scripts/verify_spotlight_ai.mts
 *   검증: 다중 경기 지시 분리 · 경기 연결(번호 · 코트 · 이름 · 동명 · 후보 여러 개 · 없는 번호 · 번호/이름 불일치) ·
 *         AI 입력 최소화(id · 연락처 · 확률 미포함) · 출력 파싱 · 경기별 검증(없는 키 · 다른 선수 · 근거 없는 숫자/전적 ·
 *         지시문 그대로 · 120자 초과 · 개인정보 · 일부 실패) · 서버 ai_matches/ai_draft(권한 · 비활성 · 입력 · 안정 id ·
 *         선수 변경 · 시간 초과 · 형식 오류 · 호출 제한 · 중복 요청) · 저장/공개 RPC 미호출.
 */
import { register } from 'node:module';

register('./ts-resolve-hook.mjs', import.meta.url);
const load = (path: string): Promise<any> => import(path);
const ai = await load('../lib/kdk/analytics/spotlightAiDraft.ts');
const srv = await load('../lib/kdk/server/spotlightAi.ts');
const prompt = await load('../lib/kdk/server/spotlightAiPrompt.ts');
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
const SID = 'KDK-20261108-QAAI';
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

// 순수 엔진용 경기 정보(서버 ai_matches 와 같은 모양)
const INFOS = SNAPS.map((s: any, i: number) => ({
  matchNo: s.matchNo, ref: s.matchId, round: s.round, court: s.court, group: 'A',
  teamA: [s.playerNames[0], s.playerNames[1]], teamB: [s.playerNames[2], s.playerNames[3]],
  badge: s.mainType, inTop: i < 5, official: i === 3 ? '4연승 도전 — 구봉준 공식 4연승 중(라운드 순서 기준). 연승 행진이 이어질까?' : i === 0 ? '숙명의 라이벌 — 구봉준 vs 김병식 · 공식 맞대결 3승 3패.' : '', status: 'waiting',
}));

// ── 1) 지시 분리 · 경기 연결 ────────────────────────────────────────────────────
{
  const L = (memo: string) => ai.linkInstructions(memo, INFOS);
  const one = L('구봉준·김영호 호흡이 좋아서 기대돼');
  check('[1] 메모 1개 → 경기 1개 연결(같은 팀 단서)', one.length === 1 && one[0].status === 'linked' && one[0].matchNo === 1, JSON.stringify(one));
  const memo3 = '2번 경기는 오픈부 선수들이 나오는 경기라서 좀 강조해 줘. 3번 경기는 두 팀의 실력이 비슷해서 접전이 예상돼. 5번 경기는 김병식 선수가 최근 상승세니까 주목해 줘.';
  const three = L(memo3);
  check('[2] 메모 1개 → 경기 3개 분리', three.length === 3 && three.map((l: any) => l.matchNo).join() === '2,3,5', JSON.stringify(three.map((l: any) => [l.status, l.matchNo])));
  check('[2] 번호만 → 확인 요청(confirm) · 번호+이름 일치 → 자동 연결', three[0].status === 'confirm' && three[1].status === 'confirm' && three[2].status === 'linked');
  check('[2] 지시별 원문 보존(다른 경기 지시 섞이지 않음)', three[0].instruction.includes('오픈부') && !three[0].instruction.includes('접전') && three[2].instruction.includes('상승세'));
  const commas = L('2번은 오픈부 경기라 강조하고, 3번은 접전 예상, 5번은 특별히 주목해 줘.');
  check('[2] 한 문장 쉼표 나열 → 3개 분리 · 연결어 정리', commas.length === 3 && commas[0].instruction === '2번은 오픈부 경기라 강조하고' && commas[1].instruction === '3번은 접전 예상', JSON.stringify(commas.map((l: any) => l.instruction)));
  const rc = L('R2 1코트 구봉준 팀 기대\n2라운드 3코트 접전');
  check('[3] 화면 번호 대신 라운드+코트 → 자동 연결(R2 1코트 = 4경기, 2라운드 3코트 = 6경기)', rc[0].status === 'linked' && rc[0].matchNo === 4 && rc[1].status === 'linked' && rc[1].matchNo === 6, JSON.stringify(rc));
  const conflict = L('3번 경기 구봉준 출전');
  check('[3] 번호와 선수 불일치(3경기에 구봉준 없음) → conflict · 자동 확정 안 함', conflict[0].status === 'conflict' && conflict[0].matchNo === null && conflict[0].candidates.includes(3) && conflict[0].candidates.includes(1), JSON.stringify(conflict));
  const same = L('김영호 선수 응원해');
  check('[4] 같은 선수가 여러 경기(김영호 1 · 4 · 7경기) → 후보 선택', same[0].status === 'choose' && same[0].candidates.join() === '1,4,7', JSON.stringify(same));
  const missing = L('9번 경기 강조');
  check('[6] 없는 경기 번호 → missing(경기 선택 요청)', missing[0].status === 'missing' && missing[0].matchNo === null);
  const court = L('1코트 주목');
  check('[7] 코트만(라운드 없음) → 후보 여러 개(1 · 4경기)', court[0].status === 'choose' && court[0].candidates.join() === '1,4');
  const cont = L('2번은 오픈부. 정말 기대돼.');
  check('단서 없는 이어지는 문장은 앞 지시에 합침', cont.length === 1 && cont[0].instruction.includes('정말 기대돼'));
  const nums = L('3연승 중인 팀 주목\n1.5세트 같은 접전');
  check('"3연승" · 소수점은 경기 번호로 보지 않음', nums.every((l: any) => l.status !== 'missing' && l.refText === ''), JSON.stringify(nums));
  check('지시 최대 8개', L(Array.from({ length: 12 }, (_, i) => `${(i % 7) + 1}번 경기 주목`).join('\n')).length === 8);
  check('지시 최대 200자 · 메모 1000자', [...L(`2번 경기 ${'가'.repeat(300)}`)[0].instruction].length === 200
    && ai.splitInstructions('가'.repeat(1500)).reduce((n: number, p: any) => n + [...p.text].length, 0) <= 1000);
  check('꺾쇠 · 제어문자 정리', !L('2번 <b>강조</b>')[0].instruction.includes('<'));
  check('빈 메모 → 연결 없음', L('   \n  ').length === 0);
  // 동명이인: 다른 회원이지만 표시명이 같은 경우 → 두 경기 후보
  const twins = INFOS.map((m: any) => (m.matchNo === 6 ? { ...m, teamA: ['김병식', m.teamA[1]] } : m));
  const tw = ai.linkInstructions('김병식 선수 기대', twins);
  check('[5] 동명이인(김병식 5 · 1 · 6경기) → 자동 확정 안 함', tw[0].status === 'choose' && tw[0].candidates.includes(6) && tw[0].candidates.includes(1));
}

// ── 2) AI 입력 최소화 ────────────────────────────────────────────────────────────
{
  const items = [{ key: 'M1', match: INFOS[1], instruction: '오픈부 선수들 경기' }, { key: 'M2', match: INFOS[3], instruction: '' }];
  const p = prompt.buildDraftPrompt(items);
  const u = JSON.parse(p.user);
  check('AI 입력: 요청 경기만 · 불투명 키', u.matches.length === 2 && u.matches[0].matchKey === 'M1' && u.matches[1].matchKey === 'M2');
  const s = p.user;
  check('AI 입력: matchId · 회원 id · 경기 번호 미포함', !s.includes(INFOS[1].ref) && !s.includes('11111111-0000') && !/"matchNo"/.test(s) && !/"ref"/.test(s));
  check('AI 입력: 확률 숫자 · 표본 · 비공개 정보 필드 없음', !/prob|sample|restricted|player_ids|email|phone/i.test(s));
  check('AI 입력: 공식 문구 · 배지 · 라운드 · 코트 · 지시 포함', u.matches[1].official.includes('4연승') && u.matches[1].badge === '연승 도전' && u.matches[0].court === 2 && u.matches[0].operatorNote === '오픈부 선수들 경기');
  check('AI 시스템 지침: 지어내기 금지 · 지시문 복사 금지 · JSON', /지어내지 않습니다/.test(p.system) && /그대로 옮기거나/.test(p.system) && /JSON/.test(p.system));
  check('출력 스키마: drafts[matchKey,text]', prompt.DRAFT_OUTPUT_SCHEMA.required[0] === 'drafts' && ai.DRAFT_SYSTEM_PROMPT === undefined);
}

// ── 3) 출력 파싱 · 경기별 검증 ───────────────────────────────────────────────────
const ALL = ai.allNamesOf(INFOS);
const REQ = [
  { key: 'M1', match: INFOS[1], instruction: '2번 경기는 오픈부 선수들이 나오는 경기라서 좀 강조해 줘.' },
  { key: 'M2', match: INFOS[2], instruction: '3번 경기는 두 팀의 실력이 비슷해서 접전이 예상돼.' },
  { key: 'M3', match: INFOS[3], instruction: '구봉준 선수가 최근 상승세니까 주목해 줘.' },
];
{
  const good = { drafts: [
    { matchKey: 'M1', text: '오픈부 출전 선수들이 함께하는 경기입니다. 정다은·이상윤 팀과 박광현·남인우 팀의 승부를 주목해 주세요.' },
    { matchKey: 'M2', text: '두 팀의 전력이 비슷해 마지막까지 접전이 기대되는 경기입니다.' },
    { matchKey: 'M3', text: '최근 상승세의 구봉준 선수가 공식 4연승에 이어 연승을 이어갈지 주목됩니다.' },
  ] };
  const r = ai.assembleDrafts(good, REQ, ALL);
  check('정상 출력 → 3카드 ok', r.ok && r.cards.length === 3 && r.cards.every((c: any) => c.status !== 'needs_fix'), JSON.stringify(r.cards?.map((c: any) => [c.status, c.issues.map((i: any) => i.code)])));
  check('운영진 제공 정보(오픈부 · 상승세) → info 표시(공식 기록 아님)', r.cards[0].issues.some((i: any) => i.code === 'operator_fact' && i.detail.includes('오픈부')) && r.cards[2].issues.some((i: any) => i.code === 'operator_fact' && i.detail.includes('상승세')));
  check('공식 기록 숫자(4연승)는 허용', !r.cards[2].issues.some((i: any) => i.code === 'unsupported_number'));
  check('카드 → 요청 경기 번호 · 안정 id 로 매핑', r.cards[0].matchNo === 2 && r.cards[0].ref === INFOS[1].ref && r.cards[2].ref === INFOS[3].ref);
  const fenced = '```json\n' + JSON.stringify(good) + '\n```';
  check('코드 펜스 · 앞뒤 설명 섞인 출력 파싱', ai.assembleDrafts(`설명입니다 ${fenced}`, REQ, ALL).ok === true);
  check('형식 오류 → ai_bad_output(카드 없음)', ai.assembleDrafts('그냥 문장', REQ, ALL).ok === false && ai.assembleDrafts({ foo: 1 }, REQ, ALL).ok === false && ai.assembleDrafts(null, REQ, ALL).ok === false);

  const bad = { drafts: [
    { matchKey: 'M9', text: '없는 경기 문구' },                                            // [10] 없는 키
    { matchKey: 'M1', text: '구봉준 선수도 응원 온 오픈부 경기!' },                          // [11] 다른 경기 선수
    { matchKey: 'M1', text: '중복 키는 버린다' },
    { matchKey: 'M2', text: '두 팀은 지난 시즌 7승 2패, 클럽 랭킹 1위 출신 맞대결 우승 후보입니다.' }, // [12] 근거 없는 전적 · 숫자 · 우승
    { matchKey: 'M3', text: '구봉준 선수가 최근 상승세니까 주목해 줘.' },                     // [13] 지시문 그대로
  ] };
  const b = ai.assembleDrafts(bad, REQ, ALL);
  check('[10] 없는 경기 키 · 중복 키 무시(ignoredKeys)', b.ok && b.ignoredKeys.includes('M9') && b.ignoredKeys.includes('M1') && b.cards.length === 3);
  const c1 = b.cards[0]; const c2 = b.cards[1]; const c3 = b.cards[2];
  check('[11] 다른 경기 선수 이름 → needs_fix(차단)', c1.status === 'needs_fix' && c1.issues.some((i: any) => i.code === 'other_player' && i.detail.includes('구봉준')));
  check('[12] 근거 없는 숫자(7 · 2 · 1) → 경고', c2.issues.some((i: any) => i.code === 'unsupported_number' && i.detail.includes('7')));
  check('[12] 근거 없는 전적 · 랭킹 · 우승 · 맞대결 → 경고', c2.issues.some((i: any) => i.code === 'unsupported_claim' && /우승/.test(i.detail) && /랭킹/.test(i.detail) && /맞대결/.test(i.detail)));
  check('[12] 경고만 있는 카드 = review(운영진 확인)', c2.status === 'review');
  check('[13] 지시문 그대로 → needs_fix(copies_instruction) + 명령형 경고', c3.status === 'needs_fix' && c3.issues.some((i: any) => i.code === 'copies_instruction') && c3.issues.some((i: any) => i.code === 'instruction_like'));
  const long = ai.assembleDrafts({ drafts: [{ matchKey: 'M1', text: '가'.repeat(130) }] }, REQ.slice(0, 1), ALL);
  check('[14] 120자 초과 → needs_fix · 원문 자르지 않음', long.cards[0].status === 'needs_fix' && long.cards[0].issues[0].code === 'too_long' && [...long.cards[0].text].length === 130);
  const partial = ai.assembleDrafts({ drafts: [{ matchKey: 'M1', text: '오픈부 출전 선수들의 경기입니다.' }] }, REQ, ALL);
  check('[15] 일부 경기만 실패(누락) → 해당 카드만 missing · 다른 카드 유지', partial.cards[0].status !== 'missing' && partial.cards[0].text && partial.cards[1].status === 'missing' && partial.cards[2].status === 'missing');
  const pii = ai.validateDraftText('문의 010-1234-5678 / qa@example.com', ai.checkContextFor(INFOS[1], '', ALL));
  check('개인정보(전화 · 이메일) → 차단', pii.some((i: any) => i.code === 'pii' && i.severity === 'block'));
  check('꺾쇠 → 차단', ai.validateDraftText('<b>경기</b>', ai.checkContextFor(INFOS[1], '', ALL)).some((i: any) => i.code === 'html'));
  check('빈 문구 → 차단', ai.validateDraftText('  ', ai.checkContextFor(INFOS[1], '', ALL))[0].code === 'empty');
  const rival = ai.validateDraftText('숙명의 라이벌 구봉준과 김병식의 맞대결!', ai.checkContextFor(INFOS[0], '', ALL));
  check('공식 문구에 있는 라이벌 · 맞대결은 경고 없음', !rival.some((i: any) => i.code === 'unsupported_claim'), JSON.stringify(rival));
  const round = ai.validateDraftText('2라운드 2코트에서 열리는 접전', ai.checkContextFor(INFOS[4], '', ALL));
  check('라운드 · 코트 숫자는 허용', !round.some((i: any) => i.code === 'unsupported_number'), JSON.stringify(round));
  check('문제 없는 문장 → 문제 없음', ai.validateDraftText('두 팀 모두 호흡이 좋아 기대되는 경기입니다.', ai.checkContextFor(INFOS[1], '', ALL)).length === 0);
  check('issueText 한국어', /다른|선수/.test(ai.issueText({ code: 'other_player', severity: 'block', detail: '구봉준' })));
}

// ── 4) 서버 핸들러(가짜 의존성 · 가짜 AI) ───────────────────────────────────────────
function makeDeps(o: { ai?: any; manage?: boolean; rows?: any[]; rpcFail?: boolean; restricted?: string[] | null } = {}) {
  const calls: string[] = [];
  const aiCalls: any[] = [];
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
  if (o.ai !== null) {
    const gen = o.ai?.generate ?? (async (req: any) => {
      aiCalls.push(req);
      const u = JSON.parse(req.user);
      return { drafts: u.matches.map((m: any) => ({ matchKey: m.matchKey, text: `${m.teamA.join('·')} 팀과 ${m.teamB.join('·')} 팀의 기대되는 승부입니다.` })) };
    });
    deps.ai = { available: o.ai?.available ?? true, reason: o.ai?.reason, timeoutMs: o.ai?.timeoutMs ?? 2000, generate: o.ai?.available === false ? null : gen,
      limiter: o.ai?.limiter ?? srv.createMemoryAiLimiter() };
  }
  return { deps, calls, aiCalls };
}
const call = (deps: any, body: any, token = 'good') => handleSpotlightAction(deps, token ? `Bearer ${token}` : null, body);
const item = (no: number, instruction = '기대되는 경기') => ({ matchNo: no, ref: SNAPS[no - 1].matchId, instruction });
{
  // [26] 권한
  const { deps, aiCalls } = makeDeps();
  check('[26] 비로그인 → 401', (await call(deps, { action: 'ai_draft', runId: RUN_ID, items: [item(2)] }, '')).status === 401);
  check('[26] 위조 토큰 → 401', (await call(deps, { action: 'ai_matches', runId: RUN_ID }, 'bad')).status === 401);
  const nm = makeDeps({ manage: false });
  check('[26] 관리자 아님 → 403(ai_matches · ai_draft)', (await call(nm.deps, { action: 'ai_matches', runId: RUN_ID })).status === 403 && (await call(nm.deps, { action: 'ai_draft', runId: RUN_ID, items: [item(2)] })).status === 403);
  check('[26] 거부 시 AI 미호출', aiCalls.length === 0 && nm.aiCalls.length === 0);
  check('runId 형식 오류 → 400', (await call(deps, { action: 'ai_matches', runId: 'x' })).status === 400);

  // ai_matches
  const m = await call(deps, { action: 'ai_matches', runId: RUN_ID });
  const ms = m.body.matches;
  check('ai_matches: 공개 대상 7경기 · 라운드 · 코트 · ref', m.status === 200 && ms.length === 7 && ms[3].court === 1 && ms[3].round === 2 && ms[3].ref === SNAPS[3].matchId);
  check('ai_matches: TOP · 공식 문구(TOP 만)', ms[0].inTop && ms[0].official.includes('라이벌') && !ms[5].inTop && ms[5].official === '');
  check('ai_matches: AI 사용 가능 표시', m.body.ai.available === true);
  check('ai_matches: 저장 · 공개 RPC 미호출', !makeDeps().calls.includes('publish_kdk_spotlight_run'));
  const off = makeDeps({ ai: { available: false, reason: 'provider_not_connected' } });
  const offM = await call(off.deps, { action: 'ai_matches', runId: RUN_ID });
  check('[23] AI 비활성 → ai_matches 는 정상(수동 모드) · reason 전달', offM.status === 200 && offM.body.ai.available === false && offM.body.ai.reason === 'provider_not_connected');
  check('[23] AI 비활성 → ai_draft 503 ai_disabled', (await call(off.deps, { action: 'ai_draft', runId: RUN_ID, items: [item(2)] })).body.reason === 'ai_disabled');
  const none = makeDeps({ ai: null });
  check('[23] AI 의존성 없음(기존 배포 형태) → ai_disabled', (await call(none.deps, { action: 'ai_draft', runId: RUN_ID, items: [item(2)] })).body.reason === 'ai_disabled'
    && (await call(none.deps, { action: 'ai_matches', runId: RUN_ID })).body.ai.available === false);

  // 정상 생성
  const d0 = makeDeps();
  const ok = await call(d0.deps, { action: 'ai_draft', runId: RUN_ID, items: [item(2, '오픈부 선수들'), item(3, '접전 예상'), item(6, 'TOP 밖 경기')] });
  check('ai_draft: 3경기 한 번에 생성(AI 1회 호출)', ok.status === 200 && ok.body.cards.length === 3 && d0.aiCalls.length === 1, JSON.stringify(ok.body));
  check('[8] TOP 밖 경기도 초안 생성(공개 목록 변경은 PICK 으로만)', ok.body.cards[2].matchNo === 6 && ok.body.cards[2].text.length > 0);
  check('ai_draft: 저장 · 공개 · 비공개 RPC 미호출', !d0.calls.some((c) => /^(publish|save|unpublish)_/.test(c)) && d0.calls.every((c) => c === 'get_kdk_spotlight_run_for_publish'));
  check('ai_draft: AI 입력에 다른 경기 · id 없음', !d0.aiCalls[0].user.includes(SNAPS[0].matchId) && !d0.aiCalls[0].user.includes('구봉준'));
  // 입력 검증
  check('items 없음 · 9개 초과 → 400', (await call(d0.deps, { action: 'ai_draft', runId: RUN_ID, items: [] })).status === 400
    && (await call(makeDeps().deps, { action: 'ai_draft', runId: RUN_ID, items: Array.from({ length: 9 }, (_, i) => item((i % 7) + 1)) })).body.reason === 'ai_too_many');
  check('같은 경기 두 번 → 400', (await call(makeDeps().deps, { action: 'ai_draft', runId: RUN_ID, items: [item(2), item(2)] })).status === 400);
  check('빈 지시 → ai_invalid · AI 미호출', await (async () => { const d = makeDeps(); const r = await call(d.deps, { action: 'ai_draft', runId: RUN_ID, items: [item(2, '  ')] }); return r.status === 400 && r.body.reason === 'ai_invalid' && d.aiCalls.length === 0; })());
  check('지시 200자 초과 → ai_instruction_too_long', (await call(makeDeps().deps, { action: 'ai_draft', runId: RUN_ID, items: [item(2, '가'.repeat(201))] })).body.reason === 'ai_instruction_too_long');
  // 안정 id
  const wrongRef = await call(makeDeps().deps, { action: 'ai_draft', runId: RUN_ID, items: [{ matchNo: 2, ref: SNAPS[2].matchId, instruction: 'x' }, item(3)] });
  check('[3] 번호와 안정 id 불일치 → 그 경기만 match_changed · 다른 경기는 생성', wrongRef.body.unavailable[0]?.reason === 'match_changed' && wrongRef.body.cards.length === 1 && wrongRef.body.cards[0].matchNo === 3);
  const noMatch = await call(makeDeps().deps, { action: 'ai_draft', runId: RUN_ID, items: [{ matchNo: 42, ref: 'zzz', instruction: 'x' }] });
  check('[6] 없는 경기 → match_unavailable · AI 미호출', noMatch.body.unavailable[0]?.reason === 'match_unavailable' && noMatch.body.cards.length === 0);
  // [21] 선수 변경 → 무효 경기 제외
  const changedRows = ROWS.map((r: any, i: number) => (i === 1 ? { ...r, player_ids: [r.player_ids[0], r.player_ids[1], r.player_ids[3], r.player_ids[2]] } : r));
  const ch = makeDeps({ rows: changedRows });
  const chM = await call(ch.deps, { action: 'ai_matches', runId: RUN_ID });
  check('[21] 선수 변경 경기(2경기)는 ai_matches 에서 제외', !chM.body.matches.some((x: any) => x.matchNo === 2) && chM.body.matches.length === 6);
  const chD = await call(ch.deps, { action: 'ai_draft', runId: RUN_ID, items: [item(2), item(3)] });
  check('[21] 선수 변경 경기 초안 요청 → match_unavailable · 다른 경기 정상', chD.body.unavailable[0]?.matchNo === 2 && chD.body.cards[0].matchNo === 3);
  // 공개 범위 조회 실패 → fail-closed
  check('공개 범위 조회 실패 → 502(비공개 보호)', (await call(makeDeps({ restricted: null }).deps, { action: 'ai_matches', runId: RUN_ID })).body.reason === 'visibility_unavailable');
  // AI 장애
  const slow = makeDeps({ ai: { timeoutMs: 50, generate: (_r: any, signal: AbortSignal) => new Promise((res) => { const t = setTimeout(() => res({ drafts: [] }), 500); signal.addEventListener('abort', () => clearTimeout(t)); }) } });
  check('AI 시간 초과 → 504 ai_timeout', (await call(slow.deps, { action: 'ai_draft', runId: RUN_ID, items: [item(2)] })).body.reason === 'ai_timeout');
  const boom = makeDeps({ ai: { generate: async () => { throw new Error('network'); } } });
  check('AI 오류 → 502 ai_failed(내부 오류 문구 미노출)', (await call(boom.deps, { action: 'ai_draft', runId: RUN_ID, items: [item(2)] })).body.reason === 'ai_failed');
  const junk = makeDeps({ ai: { generate: async () => 'not json' } });
  check('AI 형식 오류 → ai_bad_output', (await call(junk.deps, { action: 'ai_draft', runId: RUN_ID, items: [item(2)] })).body.reason === 'ai_bad_output');
  const leak = makeDeps({ ai: { generate: async (req: any) => ({ drafts: [{ matchKey: 'M1', text: '구봉준 선수 오픈부 우승!' }, { matchKey: 'M2', text: '접전이 기대되는 경기입니다.' }] }) } });
  const lk = await call(leak.deps, { action: 'ai_draft', runId: RUN_ID, items: [item(2, '오픈부'), item(3, '접전')] });
  check('[11][15] 한 카드 검증 실패 → 그 카드만 needs_fix · 다른 카드 ok', lk.body.cards[0].status === 'needs_fix' && lk.body.cards[1].status === 'ok');
  // [27] 호출 제한 · 중복 요청
  const lim = srv.createMemoryAiLimiter({ perUserWindowMs: 60000, perUserMax: 2, perRunMax: 5, perMatchRegenerateMax: 1 });
  const a1 = lim.acquire('u', 'r', [1], false);
  check('[27] 진행 중 중복 요청 → ai_busy', a1.ok && lim.acquire('u', 'r', [2], false).reason === 'ai_busy');
  a1.release(); a1.release();
  const a2 = lim.acquire('u', 'r', [2], true); a2.release();
  const a3 = lim.acquire('x', 'r', [2], false); if (a3.ok) a3.release();
  check('[18] 경기별 생성 한도(최초 1 + 재생성 1) — 서버가 직접 셈', a3.ok && lim.acquire('x2', 'r', [2], true).reason === 'ai_regenerate_limit');
  check('[18] regenerate=false 로 보내도 경기별 한도 우회 불가', lim.acquire('x3', 'r', [2], false).reason === 'ai_regenerate_limit');
  check('[27] 사용자별 요청 한도', lim.acquire('u', 'r', [3], false).reason === 'ai_rate_limited');
  check('회차별 생성 한도', lim.acquire('y', 'r', [3, 4, 5, 6], false).reason === 'ai_run_limit');
  const busyDeps = makeDeps({ ai: { limiter: { acquire: () => ({ ok: false, reason: 'ai_busy' }) } } });
  check('[27] 제한 거부 → 429 · AI 미호출', (await call(busyDeps.deps, { action: 'ai_draft', runId: RUN_ID, items: [item(2)] })).status === 429 && busyDeps.aiCalls.length === 0);
  let released = 0;
  const relDeps = makeDeps({ ai: { generate: async () => { throw new Error('x'); }, limiter: { acquire: () => ({ ok: true, release: () => { released += 1; } }) } } });
  await call(relDeps.deps, { action: 'ai_draft', runId: RUN_ID, items: [item(2)] });
  check('[27] 실패해도 진행 중 잠금 해제', released === 1);
}

// ── 5) 설정 · 가용성(실제 공급자 미연결) ─────────────────────────────────────────────
{
  const cfg = srv.readSpotlightAiConfig({ SPOTLIGHT_AI_ENABLED: '1', SPOTLIGHT_AI_MODEL: 'model-x', ANTHROPIC_API_KEY: 'k' });
  check('설정: 모델 코드 고정 없음(env 로만)', srv.readSpotlightAiConfig({}).model === '' && cfg.model === 'model-x');
  check('가용성: 꺼짐 · 모델 없음 · 키 없음 순서', srv.availabilityOf(srv.readSpotlightAiConfig({})).reason === 'disabled'
    && srv.availabilityOf(srv.readSpotlightAiConfig({ SPOTLIGHT_AI_ENABLED: '1' })).reason === 'no_model'
    && srv.availabilityOf(srv.readSpotlightAiConfig({ SPOTLIGHT_AI_ENABLED: '1', SPOTLIGHT_AI_MODEL: 'm' })).reason === 'no_key');
  check('가용성: 모두 설정돼도 공급자 어댑터 없으면 provider_not_connected(외부 호출 없음)', srv.availabilityOf(cfg).reason === 'provider_not_connected' && srv.adapterFor(cfg) === null);
  check('가용성: 어댑터 주입 시 available', srv.availabilityOf(cfg, { anthropic: () => async () => ({}) }).available === true);
  check('타임아웃 범위 5~30초', srv.readSpotlightAiConfig({ SPOTLIGHT_AI_TIMEOUT_MS: '999999' }).timeoutMs === 30000 && srv.readSpotlightAiConfig({ SPOTLIGHT_AI_TIMEOUT_MS: '1' }).timeoutMs === 5000);
  const d = srv.createSpotlightAiDeps({ SPOTLIGHT_AI_ENABLED: '1', SPOTLIGHT_AI_MODEL: 'm', ANTHROPIC_API_KEY: 'secret-key' }, srv.createMemoryAiLimiter());
  check('서비스 기본: 사용 불가 · 키 값 미보관', d.available === false && !JSON.stringify({ ...d, limiter: null }).includes('secret-key'));
}

console.log(`MATCH SPOTLIGHT AI fixture: ${passed} passed / ${failures.length} failed`);
for (const f of failures) console.log('  FAIL', f);
process.exit(failures.length ? 1 : 0);
