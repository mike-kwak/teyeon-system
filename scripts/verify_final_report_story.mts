/**
 * KDK FINAL REPORT v2 — 기록 기반 자동 스토리 엔진 fixture(순수 계산 · DB/네트워크 미사용 · 가상 이름).
 *
 *   실행: node --experimental-strip-types scripts/verify_final_report_story.mts
 *   범위: 무패 · 최다승 · 최고 득실 · 접전 · 완봉 · TOP3 기록 · 주요 경기 후보 · 헤드라인 · 공개본(edition 2) · v1 호환 · 크기 제한.
 */
import { register } from 'node:module';

register('./ts-resolve-hook.mjs', import.meta.url);
const load = (p: string): Promise<any> => import(p);
const fr = await load('../lib/kdk/finalReport/finalReportModel.ts');
const st = await load('../lib/kdk/finalReport/finalReportStory.ts');

let passed = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, info = '') => { if (cond) passed += 1; else failures.push(`${name}${info ? ` — ${info}` : ''}`); };
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// ── 가상 공식 Archive 만들기 ──────────────────────────────────────────────────────
const U = (n: number) => `22222222-0000-4000-8000-${String(n).padStart(12, '0')}`;
type R = [name: string, wins: number, losses: number, diff: number, id?: string];
type Mx = [round: number | null, court: number | null, group: string, ids: number[], s1: number, s2: number];
const NAMES = ['가람', '나래', '다솜', '라온', '마루', '바다', '사랑', '아라', '자람', '차오'];
function src(ranking: R[], matches: Mx[], names: string[] = NAMES) {
  return {
    id: 'sess-story', archiveType: 'kdk', isOfficial: true, isTest: false, title: '11월 정기 KDK', date: '2026-11-10',
    rankingData: ranking.map(([name, wins, losses, diff, id]) => ({ id: id ?? U(names.indexOf(name) + 1), name, wins, losses, diff })),
    snapshotData: matches.map(([round, court, group, ids, s1, s2], i) => ({
      id: `mt-${i + 1}`, round, court, group_name: group, status: 'complete',
      player_ids: ids.map((n) => (n < 0 ? 'manual-guest-g' : U(n))),
      player_names: ids.map((n) => (n < 0 ? '게스트(G)' : names[n - 1])), score1: s1, score2: s2,
    })),
    playerGroups: {},
  };
}
function model(s: unknown) {
  const r = fr.buildFinalReportModel(s);
  if (!r.ok) throw new Error(`model reject ${r.reason}`);
  return r.model;
}
const story = (s: unknown) => st.buildFinalReportStory(model(s));
const hl = (sto: any, kind: string) => sto.highlights.find((h: any) => h.kind === kind);

// 8명 · 4라운드 · 1인 4경기(라운드마다 전원 1경기). 1번은 항상 A팀 첫 자리.
const SCHED: Array<[number, number, number[]]> = [
  [1, 1, [1, 2, 3, 4]], [1, 2, [5, 6, 7, 8]],
  [2, 1, [1, 3, 5, 7]], [2, 2, [2, 4, 6, 8]],
  [3, 1, [1, 6, 2, 5]], [3, 2, [3, 8, 4, 7]],
  [4, 1, [1, 8, 3, 6]], [4, 2, [2, 7, 4, 5]],
];
/** 점수 8개로 경기 만들고, 공식 순위(승 · 득실 · 저장 순서)를 경기에서 계산해 "저장"한다. order 를 주면 그 순서로 저장. */
function scheduled(scores: Array<[number, number]>, opts: { order?: number[]; group?: (i: number) => string } = {}) {
  const matches: Mx[] = SCHED.map(([r, c, ids], i) => [r, c, opts.group ? opts.group(i) : 'A', ids, scores[i][0], scores[i][1]]);
  const rec = new Map<number, { w: number; l: number; d: number }>();
  for (let p = 1; p <= 8; p += 1) rec.set(p, { w: 0, l: 0, d: 0 });
  for (const [, , , ids, s1, s2] of matches) {
    for (const [k, p] of ids.entries()) {
      const mine = k < 2 ? s1 : s2; const theirs = k < 2 ? s2 : s1; const x = rec.get(p)!;
      if (mine > theirs) x.w += 1; else if (mine < theirs) x.l += 1;
      x.d += mine - theirs;
    }
  }
  const order = opts.order ?? [...rec.keys()].sort((a, b) => rec.get(b)!.w - rec.get(a)!.w || rec.get(b)!.d - rec.get(a)!.d || a - b);
  const ranking: R[] = order.map((p) => [NAMES[p - 1], rec.get(p)!.w, rec.get(p)!.l, rec.get(p)!.d]);
  return { src: src(ranking, matches), rec, order };
}

// ── 1) 단독 무패 우승 + TOP3 경기 기록 ──────────────────────────────────────────────
{
  // 1번(가람)이 4경기 모두 승. 다른 선수는 모두 1패 이상.
  const sc: Array<[number, number]> = [[6, 2], [6, 4], [6, 3], [4, 6], [6, 5], [6, 1], [6, 4], [3, 6]];
  const { src: S, rec } = scheduled(sc);
  const s = story(S);
  check('단독 무패: championUnbeaten · sole', s.unbeaten.championUnbeaten && s.unbeaten.sole && s.unbeaten.count === 1, JSON.stringify(s.unbeaten));
  check('단독 무패: UNBEATEN_CHAMPION 카드 = 4전 전승', hl(s, 'UNBEATEN_CHAMPION')?.value === '4전 전승' && eq(hl(s, 'UNBEATEN_CHAMPION')?.names, ['가람']));
  check('단독 무패: 공동 무패 카드 없음', !hl(s, 'UNBEATEN'));
  check('단독 무패: 헤드라인 1순위 = 무패 우승', s.headline === '4전 전승, 가람의 무패 우승' && s.headlines[0].kind === 'UNBEATEN_SOLE', s.headline);
  check('단독 무패: 마지막 후보는 참가 인원 문구', s.headlines.at(-1).text === '8명의 도전, 정상에 오른 가람');
  const p1 = s.podium[0];
  check('TOP3 기록: 1위 경기 4개 · 라운드 순 · 전부 W', p1.consistent && p1.matches.length === 4 && p1.matches.map((m: any) => m.round).join() === '1,2,3,4' && p1.matches.every((m: any) => m.result === 'W'));
  check('TOP3 기록: 1R 파트너 · 상대 · 점수', p1.matches[0].partner === '나래' && eq(p1.matches[0].opponents, ['다솜', '라온']) && p1.matches[0].scoreFor === 6 && p1.matches[0].scoreAgainst === 2);
  check('TOP3 기록: 요약 문구', p1.summary === `4전 전승 · 득실 +${rec.get(1)!.d}`, p1.summary);
  check('TOP3 기록: 1위 배지 무패(단독)', p1.badges.some((b: any) => b.kind === 'UNBEATEN' && b.joint === false));
  // B팀 자리 선수(2라운드 2경기의 6번 = B팀)의 득점 방향
  const any = s.podium.find((r: any) => r.matches.some((m: any) => m.round === 2));
  check('TOP3 기록: 모든 TOP3 경기 4개 · 공식 승패와 일치', s.podium.every((r: any) => r.consistent && r.matches.length === 4 && r.matches.filter((m: any) => m.result === 'W').length === r.wins), JSON.stringify(s.podium.map((r: any) => [r.name, r.wins, r.matches.length])));
  check('TOP3 기록: 존재', !!any);
}

// ── 2) 공동 무패 · 3) 무패 없음 ─────────────────────────────────────────────────────
{
  const s = story(src([['가람', 4, 0, 10], ['나래', 4, 0, 8], ['다솜', 3, 1, 6], ['라온', 2, 2, 0], ['마루', 0, 4, -24]], [[1, 1, 'A', [1, 2, 3, 4], 6, 3]]));
  check('공동 무패: count 2 · sole false', s.unbeaten.count === 2 && !s.unbeaten.sole && s.unbeaten.championUnbeaten);
  check('공동 무패: 공동 무패 카드(이름 저장 순서)', hl(s, 'UNBEATEN')?.label === '공동 무패' && hl(s, 'UNBEATEN')?.joint === true && eq(hl(s, 'UNBEATEN')?.names, ['가람', '나래']));
  check('공동 무패: 1위는 무패 우승 카드(우승 자체는 단독)', hl(s, 'UNBEATEN_CHAMPION')?.joint === false);
  check('공동 무패: 단독 무패 헤드라인 없음', !s.headlines.some((h: any) => h.kind === 'UNBEATEN_SOLE'));
  check('공동 무패: 헤드라인 = 무패 2명 가운데', s.headline === '무패 2명 가운데 정상에 오른 가람', s.headline);
  check('공동 무패: 배지 joint', s.podium[0].badges.find((b: any) => b.kind === 'UNBEATEN')?.joint === true && s.podium[1].badges.find((b: any) => b.kind === 'UNBEATEN')?.joint === true);
  check('공동 무패: 최다승도 공동 표시', hl(s, 'MOST_WINS')?.label === '공동 최다승' && hl(s, 'MOST_WINS')?.total === 2);
}
{
  const s = story(src([['가람', 3, 1, 9], ['나래', 3, 1, 4], ['다솜', 2, 2, 1], ['라온', 0, 4, -14]], [[1, 1, 'A', [1, 2, 3, 4], 6, 2]]));
  check('무패 없음: 무패 카드 · 무패 헤드라인 없음', !hl(s, 'UNBEATEN_CHAMPION') && !hl(s, 'UNBEATEN') && !s.headlines.some((h: any) => h.kind.startsWith('UNBEATEN')));
  check('무패 없음: 요약 = 4전 3승 1패', s.podium[0].summary === '4전 3승 1패 · 득실 +9');
  check('무패 없음: 공동 최다승이면 DOUBLE_CROWN 없음', !s.headlines.some((h: any) => h.kind === 'DOUBLE_CROWN'));
  check('무패 없음: 접전 0 → 헤드라인 = 참가 인원', s.headline === '4명의 도전, 정상에 오른 가람', s.headline);
}

// ── 4) 공동 최다승(4명 → 이름 3명 · total 4) · 5) 최고 득실 동률 ─────────────────────────────
{
  const s = story(src([['가람', 3, 1, 9], ['나래', 3, 1, 8], ['다솜', 3, 1, 8], ['라온', 3, 1, 2], ['마루', 1, 3, -6]], [[1, 1, 'A', [1, 2, 3, 4], 6, 2]]));
  const m = hl(s, 'MOST_WINS');
  check('공동 최다승: 라벨 · 값 · 4명 · 이름 3명(저장 순서)', m?.label === '공동 최다승' && m.value === '3승' && m.total === 4 && eq(m.names, ['가람', '나래', '다솜']), JSON.stringify(m));
  check('공동 최다승: 배지 joint', s.podium.every((r: any) => r.badges.find((b: any) => b.kind === 'MOST_WINS')?.joint === true));
  check('최고 득실 단독(+9)', hl(s, 'BEST_DIFF')?.label === '최고 득실' && hl(s, 'BEST_DIFF')?.value === '+9' && hl(s, 'BEST_DIFF')?.joint === false);
}
{
  const s = story(src([['가람', 3, 1, 8], ['나래', 3, 1, 6], ['다솜', 2, 2, 8], ['라온', 0, 4, -22]], [[1, 1, 'A', [1, 2, 3, 4], 6, 2]]));
  const d = hl(s, 'BEST_DIFF');
  check('최고 득실 동률: 공동 표시 · 저장 순서', d?.label === '공동 최고 득실' && d.value === '+8' && d.joint && eq(d.names, ['가람', '다솜']), JSON.stringify(d));
  check('최고 득실 동률: 다솜 배지 joint', s.podium[2].badges.find((b: any) => b.kind === 'BEST_DIFF')?.joint === true);
}
{
  // 단독 최다승 + 단독 최고 득실 + 무패 아님 → DOUBLE_CROWN
  const s = story(src([['가람', 4, 1, 12], ['나래', 3, 2, 5], ['다솜', 2, 3, 0]], [[1, 1, 'A', [1, 2, 3, 3], 6, 2]]));
  check('두 기록 헤드라인(단독일 때만)', s.headline === '최다승과 최고 득실, 두 기록의 주인공 가람', s.headline);
}

// ── 6) 1점 차 다수 · 7) 접전 없음 · 8) 완봉 없음 / 있음 ───────────────────────────────────
{
  const sc: Array<[number, number]> = [[6, 5], [5, 6], [6, 5], [6, 5], [6, 5], [6, 2], [6, 0], [6, 3]];
  const { src: S } = scheduled(sc);
  const s = story(S);
  check('접전 다수: 1점 차 5경기', s.closeMatchCount === 5 && hl(s, 'CLOSE_MATCHES')?.value === '5경기');
  check('접전 다수: 헤드라인 후보에 접전 문구', s.headlines.some((h: any) => h.kind === 'CLOSE_BATTLES' && h.text === `1점 차 접전 5경기, 오늘의 챔피언은 ${s.champion.name}`));
  check('접전 다수: "단 하나" 같은 단정 없음', s.headlines.every((h: any) => !/단 하나|유일한 명승부/.test(h.text)));
  // v2.1: 같은 1점 차 접전만 반복하지 않는다 — 접전은 1경기, 나머지는 다른 특징(TOP3 맞대결 · 완봉).
  const KEY = ['ONE_POINT', 'TOP3_CLASH', 'SHUTOUT'];
  check('접전 다수: 1점 차 후보는 1경기만', s.candidates.filter((c: any) => c.reasons.includes('ONE_POINT')).length === 1, JSON.stringify(s.candidates.map((c: any) => c.reasons)));
  check('접전 다수: 후보마다 새 특징을 더함(중복 특징만인 경기 없음)', s.candidates.every((c: any, i: number, a: any[]) => c.reasons.some((r: string) => KEY.includes(r) && !a.slice(0, i).some((p: any) => p.reasons.includes(r)))));
  check('접전 다수: 완봉 경기 포함 · 후보 1~3', s.candidates.some((c: any) => c.reasons.includes('SHUTOUT')) && s.candidates.length >= 1 && s.candidates.length <= 3);
  check('접전 다수: 첫 후보 = 1점 차 중 TOP3 출전이 가장 많은 경기', s.candidates[0].margin === 1 && s.candidates[0].podiumPlayers === Math.max(...model(scheduled(sc).src).matches.filter((x: any) => Math.abs(x.score1 - x.score2) === 1).map((x: any) => [...x.keysA, ...x.keysB].filter((k: string) => model(scheduled(sc).src).standings.slice(0, 3).some((t: any) => t.key === k)).length)));
  check('완봉 1경기: SHUTOUT 카드 · 노트', s.shutoutCount === 1 && hl(s, 'SHUTOUT')?.value === '1경기');
  const m = model(S);
  const shut = m.matches.find((x: any) => x.score2 === 0);
  check('완봉 노트에 "완봉"', (st.matchNote(shut, new Set(m.standings.slice(0, 3).map((x: any) => x.key))) ?? '').includes('완봉'));
}
{
  const sc: Array<[number, number]> = [[6, 2], [6, 3], [6, 4], [2, 6], [6, 1], [6, 3], [6, 4], [3, 6]];
  const { src: S } = scheduled(sc);
  const s = story(S);
  check('접전 없음: closeMatchCount 0 · 카드 · 헤드라인 없음', s.closeMatchCount === 0 && !hl(s, 'CLOSE_MATCHES') && !s.headlines.some((h: any) => h.kind === 'CLOSE_BATTLES'));
  check('완봉 없음: shutout 0 · 카드 없음', s.shutoutCount === 0 && !hl(s, 'SHUTOUT'));
  check('접전 없음: 1점 차 후보 없음 · 특징(TOP3 맞대결) 있는 경기만 · 1~3경기', s.candidates.length >= 1 && s.candidates.length <= 3 && s.candidates.every((c: any) => !c.reasons.includes('ONE_POINT')), JSON.stringify(s.candidates.map((c: any) => [c.margin, c.reasons])));
  // 특징 있는 경기가 하나도 없으면 점수 차가 가장 작은 1경기만
  //   (두 경기 모두 3점 차 · 한쪽 팀에만 TOP3 · 완봉 없음)
  const flat = story(src([['가람', 1, 0, 3], ['나래', 1, 0, 3], ['다솜', 1, 0, 3], ['라온', 0, 1, -3], ['마루', 0, 1, -3], ['바다', 0, 1, -3]],
    [[1, 1, 'A', [5, 6, 4, 3], 3, 6], [1, 2, 'A', [1, 2, 5, 6], 6, 3]]));
  check('특징 없음: 점수 차 가장 작은 1경기만', flat.candidates.length === 1 && flat.candidates[0].reasons.every((r: string) => r === 'TOP3_INVOLVED'), JSON.stringify(flat.candidates.map((c: any) => [c.margin, c.reasons])));
}

// ── 9) 게스트 우승 ───────────────────────────────────────────────────────────────
{
  const s = story(src([['게스트', 4, 0, 11, 'manual-guest-g'], ['가람', 3, 1, 6], ['나래', 2, 2, 0]], [[1, 1, 'A', [-1, 1, 2, 3], 6, 4]]));
  check('게스트 우승: 이름 (G) 유지', s.champion.name === '게스트(G)' && s.champion.guest === true);
  check('게스트 우승: 헤드라인 (G) 포함', s.headline === '4전 전승, 게스트(G)의 무패 우승', s.headline);
  check('게스트 우승: 하이라이트 이름 (G)', eq(hl(s, 'UNBEATEN_CHAMPION')?.names, ['게스트(G)']));
}

// ── 10) A/B조 세션 · 11) 공식 순위 저장 순서 유지 ───────────────────────────────────────
{
  const sc: Array<[number, number]> = [[6, 2], [6, 4], [6, 3], [4, 6], [6, 5], [6, 1], [6, 4], [3, 6]];
  const { src: S } = scheduled(sc, { group: (i) => (i % 2 === 0 ? 'A' : 'B') });
  const m = model(S);
  const s = st.buildFinalReportStory(m);
  check('A/B조: 모델 조 표시 유지(조 정보는 스토리에 영향 없음)', m.matches.some((x: any) => x.group === 'B') && s.headline === '4전 전승, 가람의 무패 우승');
  const p = fr.buildFinalReportPayload(m, fr.EMPTY_CONTENT);
  check('A/B조: 공개본 순위표 조 그대로', p.ok && eq(p.payload.standings.map((x: any) => x.group), m.standings.map((x: any) => x.group)));
}
{
  // 3 · 4위 동률(승 · 득실 같음)을 저장 순서 [라온, 다솜] 으로 — 재정렬 금지
  const s = story(src([['가람', 3, 1, 6], ['나래', 3, 1, 6], ['라온', 2, 2, 2], ['다솜', 2, 2, 2]], [[1, 1, 'A', [1, 2, 3, 4], 6, 2]]));
  check('저장 순서: TOP3 = 가람 · 나래 · 라온', eq(s.podium.map((r: any) => r.name), ['가람', '나래', '라온']));
  check('저장 순서: 공동 최다승 이름 순서 그대로', eq(hl(s, 'MOST_WINS').names, ['가람', '나래']));
  check('저장 순서: 공동 최고 득실 이름 순서 그대로', eq(hl(s, 'BEST_DIFF').names, ['가람', '나래']));
  check('저장 순서: rank = 저장 위치', eq(s.podium.map((r: any) => r.rank), [1, 2, 3]));
}

// ── 비정상 · 누락 데이터 ─────────────────────────────────────────────────────────
{
  // TOP3 선수 경기 기록이 공식 승패와 다름 → 경기 목록 숨김(요약은 공식 값)
  const s = story(src([['가람', 4, 0, 12], ['나래', 3, 1, 5], ['다솜', 2, 2, 0], ['라온', 0, 4, -17]], [[null, null, 'A', [1, 2, 3, 4], 6, 3]]));
  check('불일치: 경기 목록 비움 · consistent false', s.podium[0].consistent === false && s.podium[0].matches.length === 0 && s.podium[0].summary === '4전 전승 · 득실 +12');
  check('불일치: 라운드 · 코트 null 경기도 처리', s.candidates.length === 1 && s.candidates[0].margin === 3);
}
{
  // 전원 0승(점수 기록상 무승부만) · 득실 0 이하 → 최다승 · 최고 득실 · 무패 카드 없음, 헤드라인은 참가 인원 문구
  const s = story(src([['가람', 0, 0, 0], ['나래', 0, 0, 0], ['다솜', 0, 0, 0], ['라온', 0, 0, 0]], [[1, 1, 'A', [1, 2, 3, 4], 5, 5]]));
  check('무승부만: 선수 기록 카드 없음', !hl(s, 'MOST_WINS') && !hl(s, 'BEST_DIFF') && !hl(s, 'UNBEATEN_CHAMPION'));
  check('무승부만: 헤드라인 참가 인원', s.headline === '4명의 도전, 정상에 오른 가람', s.headline);
  check('무승부만: 요약에 무승부 표기', s.podium[0].summary === '1전 0승 1무 0패 · 득실 0', s.podium[0].summary);
}
{
  // 무승부 경기 결과 D
  const s = story(src([['가람', 1, 0, 2], ['나래', 1, 0, 2], ['다솜', 0, 1, -2], ['라온', 0, 1, -2]], [[1, 1, 'A', [1, 2, 3, 4], 6, 4], [2, 1, 'A', [1, 2, 3, 4], 5, 5]]));
  check('무승부 경기: result D · 승패 일치 판정', s.podium[0].matches.length === 2 && s.podium[0].matches[1].result === 'D' && s.podium[0].consistent);
  check('무승부 경기: 요약 2전 1승 1무 0패', s.podium[0].summary === '2전 1승 1무 0패 · 득실 +2', s.podium[0].summary);
  check('무승부 경기: "전승" 대신 "무패"', hl(s, 'UNBEATEN_CHAMPION')?.value === '2전 무패' && s.headlines.every((h: any) => !h.text.includes('전승')), JSON.stringify(s.headlines));
}
{
  // 아주 긴 1위 이름 → 이름 넣은 헤드라인이 40자 초과면 제외, 이름 없는 문구로 대체
  const long = '가'.repeat(36);
  const names = [long, '나래', '다솜', '라온'];
  const s = story(src([[long, 4, 0, 12, U(1)], ['나래', 3, 1, 5, U(2)], ['다솜', 2, 2, 0, U(3)], ['라온', 0, 4, -17, U(4)]], [[1, 1, 'A', [1, 2, 3, 4], 6, 3]], names));
  check('긴 이름: 모든 헤드라인 40자 이하', s.headlines.every((h: any) => [...h.text].length <= st.FR_HEADLINE_MAX));
  check('긴 이름: 이름 없는 대체 문구', s.headline === '4명의 도전, 오늘의 챔피언', s.headline);
}

// ── 금지 표현(기록 근거 없는 이야기) ─────────────────────────────────────────────────
{
  const sc: Array<[number, number]> = [[6, 5], [5, 6], [6, 5], [6, 5], [6, 5], [6, 2], [6, 0], [6, 3]];
  const s = story(scheduled(sc).src);
  const texts = [...s.headlines.map((h: any) => h.text), ...s.highlights.flatMap((h: any) => [h.label, h.value]), ...s.podium.map((r: any) => r.summary), ...s.candidates.map((c: any) => c.note ?? '')];
  const banned = /역전|매치\s?포인트|분위기|연승|감동|극적|짜릿|눈물|환호|압도|완벽/;
  check('금지 표현 없음', texts.every((t: string) => !banned.test(t)), texts.filter((t: string) => banned.test(t)).join(' / '));
}

// ── 공개본(edition 2) · 운영진 헤드라인 · 내부 키 비노출 ───────────────────────────────────
{
  const sc: Array<[number, number]> = [[6, 2], [6, 4], [6, 3], [4, 6], [6, 5], [6, 1], [6, 4], [3, 6]];
  const { src: S } = scheduled(sc);
  const m = model(S);
  const p = fr.buildFinalReportPayload(m, fr.EMPTY_CONTENT);
  check('v2 공개본: schema 1 · edition 2', p.ok && p.payload.schema === 1 && p.payload.edition === 2);
  check('v2 공개본: 자동 헤드라인', p.payload.headline === '4전 전승, 가람의 무패 우승');
  check('v2 공개본: 하이라이트 · TOP3 기록 · 경기 노트', p.payload.highlights.length >= 2 && p.payload.podium.every((x: any) => x.record && x.record.summary) && p.payload.featured.every((f: any) => 'note' in f));
  check('v2 공개본: 운영진 문구 없으면 opening/closing/story null 유지', p.payload.opening === null && p.payload.closing === null && p.payload.podium.every((x: any) => x.story === null));
  const json = JSON.stringify(p.payload);
  check('v2 공개본: 선수 id · 경기 id · 세션 id 없음', !/22222222-|mt-\d|sess-story|manual-guest/.test(json));
  check('v2 공개본: 코트 번호는 기록에 없음(공개본 최소화)', p.payload.podium.every((x: any) => x.record.matches.every((mm: any) => !('court' in mm))));
  const rt = fr.parsePublicFinalReport(clone(p.payload));
  check('v2 공개본: 파서 왕복 동일', eq(rt, p.payload), JSON.stringify(rt).slice(0, 200));

  const c = fr.parseFinalReportContent({ schema: 1, headline: '11월의 주인공, 가람', opening: '', closing: '', stories: [], featured: null });
  check('운영진 헤드라인: 저장 · 공개본 우선', c.ok && c.content.headline === '11월의 주인공, 가람' && fr.buildFinalReportPayload(m, c.content).payload.headline === '11월의 주인공, 가람');
  check('운영진 헤드라인: 41자 거부', fr.parseFinalReportContent({ schema: 1, headline: '가'.repeat(41) }).reason === 'too_long');
  check('운영진 헤드라인: 꺾쇠 거부', fr.parseFinalReportContent({ schema: 1, headline: '<b>x</b>' }).reason === 'html');
  check('예전 content(헤드라인 없음): 모양 유지', eq(Object.keys(fr.parseFinalReportContent({ schema: 1, opening: 'a' }).content), ['schema', 'opening', 'closing', 'stories', 'featured']));
  const issues = fr.validateContentTexts({ ...fr.EMPTY_CONTENT, headline: '연락처 010-1234-5678' }, m);
  check('운영진 헤드라인: 공개 문구 검사 적용', issues.some((x: any) => x.field === 'headline'));
}

// ── v1 공개본 호환(기존 발행본 구조) ─────────────────────────────────────────────────
{
  const V1 = {
    schema: 1,
    session: { title: '11월 정기 KDK', date: '2026-11-10', officialConfirmed: true, participantCount: 4, matchCount: 2 },
    opening: null, closing: null,
    podium: [1, 2, 3].map((r) => ({ rank: r, name: NAMES[r - 1], wins: 4 - r, losses: r - 1, diff: 9 - r * 3, group: '', guest: false, story: null })),
    featured: [{ round: 1, court: 1, group: '', teamA: ['가람', '나래'], teamB: ['다솜', '라온'], score1: 6, score2: 5, tags: ['CLOSEST_BATTLE'], review: null }],
    standings: [1, 2, 3, 4].map((r) => ({ rank: r, name: NAMES[r - 1], wins: 4 - r, losses: r - 1, diff: 9 - r * 3, group: '', guest: false })),
  };
  const p = fr.parsePublicFinalReport(clone(V1));
  check('v1: 정상 파싱', !!p && p.standings.length === 4 && p.podium.length === 3 && p.featured.length === 1);
  check('v1: 파싱 결과 = 원본(그대로)', eq(p, V1), JSON.stringify(p).slice(0, 160));
  check('v1: v2 필드 없음(edition · headline · highlights · record · note)', !('edition' in p) && !('headline' in p) && !('highlights' in p) && p.podium.every((x: any) => !('record' in x)) && p.featured.every((x: any) => !('note' in x)));
  const forged = { ...clone(V1), headline: '가짜 헤드라인', highlights: [{ kind: 'MOST_WINS', label: '최다승', value: '9승', names: ['가람'], total: 1, joint: false }] };
  (forged.podium[0] as any).record = { played: 4, summary: '4전 전승', badges: [], matches: [] };
  const pf = fr.parsePublicFinalReport(forged);
  check('v1: edition 없이 v2 필드가 섞여도 표시 안 함(소급 금지)', !('headline' in pf) && !('highlights' in pf) && !('record' in pf.podium[0]));
  check('v1: 다른 schema 거부', fr.parsePublicFinalReport({ ...clone(V1), schema: 2 }) === null);
}

// ── 공개본 파서: v2 필드 허용 목록 · 길이 제한 ─────────────────────────────────────────
{
  const sc: Array<[number, number]> = [[6, 2], [6, 4], [6, 3], [4, 6], [6, 5], [6, 1], [6, 4], [3, 6]];
  const p = fr.buildFinalReportPayload(model(scheduled(sc).src), fr.EMPTY_CONTENT).payload;
  const bad = clone(p);
  bad.headline = '가'.repeat(80);
  bad.highlights.push({ kind: 'EVIL', label: 'x', value: 'y', names: [], total: 1, joint: false });
  bad.highlights.push({ kind: 'MOST_WINS', label: '', value: '3승', names: [], total: 1, joint: false });
  bad.podium[0].record.badges.push({ kind: 'FAKE', joint: true });
  bad.podium[0].record.matches.push({ round: 9, partner: 'x', opponents: ['a', 'b'], scoreFor: 6, scoreAgainst: 0, result: 'X' });
  bad.podium[1].record = 'not-object';
  bad.featured[0].note = '가'.repeat(99);
  const q = fr.parsePublicFinalReport(bad);
  check('파서: 헤드라인 40자 자름', [...q.headline].length === st.FR_HEADLINE_MAX);
  check('파서: 모르는 하이라이트 종류 · 빈 라벨 버림', q.highlights.length === p.highlights.length);
  check('파서: 모르는 배지 · 잘못된 결과 버림', q.podium[0].record.badges.length === p.podium[0].record.badges.length && q.podium[0].record.matches.length === p.podium[0].record.matches.length);
  check('파서: 객체 아닌 record → null', q.podium[1].record === null);
  check('파서: 노트 30자 자름', [...q.featured[0].note].length === st.FR_NOTE_MAX);
}

// ── 64KB 크기 제한 ─────────────────────────────────────────────────────────────
{
  // 80명 · 긴 이름(20자) · 경기 160개 — 정상 범위 최대에 가까운 세션
  const names = Array.from({ length: 80 }, (_, i) => `선수${String(i + 1).padStart(2, '0')}${'가'.repeat(16)}`);
  const ranking: R[] = names.map((n, i) => [n, Math.max(0, 4 - (i % 5)), i % 5, 10 - i, U(i + 1)]);
  const ms: Mx[] = Array.from({ length: 160 }, (_, i) => [1 + (i % 4), 1 + (i % 10), i % 2 ? 'A' : 'B', [(i % 80) + 1, ((i + 1) % 80) + 1, ((i + 2) % 80) + 1, ((i + 3) % 80) + 1], 6, i % 6]);
  const p = fr.buildFinalReportPayload(model(src(ranking, ms, names)), fr.EMPTY_CONTENT);
  const bytes = p.ok ? new TextEncoder().encode(JSON.stringify(p.payload)).length : -1;
  check('크기: 80명 · 160경기 공개본 허용 · 60,000바이트 이하', p.ok && bytes > 0 && bytes <= fr.FR_PAYLOAD_MAX_BYTES, `bytes=${bytes}`);
  // 비정상적으로 긴 이름(모델은 길이를 자르지 않음) → 서버가 먼저 거부(SQL 64KB 전에)
  const huge = Array.from({ length: 80 }, (_, i) => `${i}${'가'.repeat(300)}`);
  const hr: R[] = huge.map((n, i) => [n, 1, 0, 1, U(i + 1)]);
  const hp = fr.buildFinalReportPayload(model(src(hr, [[1, 1, 'A', [1, 2, 3, 4], 6, 2]], huge)), fr.EMPTY_CONTENT);
  check('크기: 초과 공개본 거부(payload_too_large)', !hp.ok && hp.reason === 'payload_too_large');
}

// ── Phase 3: 제안 문구 · 편집기 데이터 · 표시 규칙 · 게스트 연결 ─────────────────────────────
const ed = await load('../lib/kdk/finalReport/finalReportEditor.ts');
const view = await load('../lib/kdk/finalReport/finalReportView.ts');
{
  check('조사: 숫자 받침', st.josaRo(12) === '로' && st.josaRo(10) === '으로' && st.josaRo(3) === '으로' && st.josaRo(6) === '으로' && st.josaRo(1) === '로' && st.josaRo(7) === '로' && st.josaRo(0) === '으로' && st.josaRo(-6) === '으로');
  const sc: Array<[number, number]> = [[6, 2], [6, 4], [6, 3], [4, 6], [6, 5], [6, 1], [6, 4], [3, 6]];
  const S = scheduled(sc).src;
  const m = model(S);
  const s = st.buildFinalReportStory(m);
  const podiumKeys = new Set(m.standings.slice(0, 3).map((x: any) => x.key));
  const sug = s.podium.map((r: any) => st.storySuggestion(r));
  check('스토리 제안: 1위 무패 문구', sug[0].startsWith('4전 전승, 득실 +') && sug[0].endsWith('정상에 올랐습니다.'), sug[0]);
  check('스토리 제안: 2 · 3위 문구', sug[1].endsWith('준우승을 차지했습니다.') && sug[2].endsWith('3위에 올랐습니다.'), sug.join(' / '));
  check('스토리 제안: 이름 없음 · 80자 이하', sug.every((t: string, i: number) => !t.includes(s.podium[i].name) && [...t].length <= fr.FR_STORY_MAX));
  // 제안을 그대로 저장해도 공개 문구 검사(다른 선수 이름 · 개인정보 숫자) 통과
  const content = { ...fr.EMPTY_CONTENT, stories: s.podium.map((r: any, i: number) => ({ playerKey: m.standings[i].key, rank: r.rank, text: st.storySuggestion(r) })) };
  check('스토리 제안: 공개 문구 검사 통과', fr.validateContentTexts(content, m).filter((x: any) => x.issue.severity === 'block').length === 0, JSON.stringify(fr.validateContentTexts(content, m)));
  const reviews = m.matches.map((x: any) => st.reviewSuggestion(x, podiumKeys));
  check('리뷰 제안: 승리 팀 · 점수 · 조사', reviews.some((t: string) => /팀이 1점 차 접전 끝에 6:5로 승리했습니다/.test(t)) && reviews.every((t: string) => [...t].length <= 100), reviews.join(' / '));
  const fcontent = { ...fr.EMPTY_CONTENT, featured: m.matches.slice(0, 4).map((x: any) => ({ matchId: x.matchId, fingerprint: fr.matchFingerprint(x), review: st.reviewSuggestion(x, podiumKeys), tag: null })) };
  check('리뷰 제안: 공개 문구 검사 통과(그 경기 4명만)', fr.validateContentTexts(fcontent, m).filter((x: any) => x.issue.severity === 'block').length === 0, JSON.stringify(fr.validateContentTexts(fcontent, m).slice(0, 2)));
  const banned = /역전|매치\s?포인트|분위기|연승|감동|극적|짜릿|압도|완벽/;
  check('제안 문구 금지 표현 없음', [...sug, ...reviews].every((t: string) => !banned.test(t)));
  // 이름이 길어 100자를 넘으면 이름 없는 점수 문구
  const longNames = ['가'.repeat(48), '나'.repeat(48), '다'.repeat(48), '라'.repeat(48)];
  const lm = model(src([[longNames[0], 1, 0, 1, U(1)], [longNames[1], 1, 0, 1, U(2)], [longNames[2], 0, 1, -1, U(3)], [longNames[3], 0, 1, -1, U(4)]], [[1, 1, 'A', [1, 2, 3, 4], 6, 5]], longNames));
  const lr = st.reviewSuggestion(lm.matches[0], new Set(), 100);
  check('리뷰 제안: 긴 이름 → 점수만', lr === '1점 차 접전, 6:5로 끝난 경기입니다.', lr);
  const shut = model(src([['가람', 1, 0, 6], ['나래', 1, 0, 6], ['다솜', 0, 1, -6], ['라온', 0, 1, -6]], [[1, 1, 'A', [1, 2, 3, 4], 6, 0]]));
  check('리뷰 제안: 완봉 문구', st.reviewSuggestion(shut.matches[0], new Set()) === '가람·나래 팀이 6:0 완봉승을 거뒀습니다.', st.reviewSuggestion(shut.matches[0], new Set()));
  const plainM = model(src([['가람', 1, 0, 3], ['나래', 1, 0, 3], ['다솜', 0, 1, -3], ['라온', 0, 1, -3]], [[1, 1, 'A', [3, 4, 1, 2], 3, 6]]));
  check('리뷰 제안: B팀 승리 · 6:3으로', st.reviewSuggestion(plainM.matches[0], new Set()) === '가람·나래 팀이 6:3으로 승리했습니다.', st.reviewSuggestion(plainM.matches[0], new Set()));
  const drawM = model(src([['가람', 0, 0, 0], ['나래', 0, 0, 0], ['다솜', 0, 0, 0], ['라온', 0, 0, 0]], [[1, 1, 'A', [1, 2, 3, 4], 5, 5]]));
  check('리뷰 제안: 무승부', st.reviewSuggestion(drawM.matches[0], new Set()) === '가람·나래 팀과 다솜·라온 팀이 5:5로 비겼습니다.', st.reviewSuggestion(drawM.matches[0], new Set()));

  // 편집기 데이터
  const E = ed.toEditorData(m, { id: 's', signature: 'v1:x', report: null, content: fr.EMPTY_CONTENT, contentReset: false });
  check('편집기: 헤드라인 후보 · 자동 헤드라인', E.story.headlines.length >= 2 && E.story.autoHeadline === s.headline);
  check('편집기: TOP3 기록 · 제안(선수 키 연결)', E.story.podium.length === 3 && E.story.podium.every((p: any, i: number) => p.key === m.standings[i].key && p.summary && p.suggestion));
  check('편집기: 경기별 노트 · 리뷰 제안(모든 경기)', Object.keys(E.story.matches).length === m.matches.length && Object.values(E.story.matches).every((x: any) => x.suggestion));
  check('편집기: 추천 = 공개본 자동 모드 후보', eq(E.recommended, s.candidates.map((c: any) => c.matchId)));
  check('편집기: 헤드라인 변경 = 저장 필요(contentKey)', ed.contentKey(fr.EMPTY_CONTENT) !== ed.contentKey({ ...fr.EMPTY_CONTENT, headline: '새 헤드라인' }) && ed.contentKey(fr.EMPTY_CONTENT) === ed.contentKey({ ...fr.EMPTY_CONTENT, headline: '' }));
  check('편집기: 글자 제한에 헤드라인', ed.FR_LIMITS.headline === 40);

  // 공개본 선정 방식
  const pa = fr.buildFinalReportPayload(m, fr.EMPTY_CONTENT).payload;
  const pm = fr.buildFinalReportPayload(m, fcontent).payload;
  check('선정 방식: 자동 auto · 직접 manual · 파서 왕복', pa.featuredMode === 'auto' && pm.featuredMode === 'manual' && fr.parsePublicFinalReport(clone(pm)).featuredMode === 'manual' && fr.parsePublicFinalReport({ ...clone(pa), featuredMode: 'evil' }).featuredMode === 'auto');
  check('선정 방식: 자동 모드 경기 = 후보 순서', eq(pa.featured.map((f: any) => `${f.score1}:${f.score2}`), s.candidates.map((c: any) => { const x = m.matches.find((y: any) => y.matchId === c.matchId); return `${x.score1}:${x.score2}`; })));

  // 표시 규칙
  check('표시: 배지 이름(공동 표시)', view.badgeLabel({ kind: 'UNBEATEN', joint: false }, 1) === '무패 우승' && view.badgeLabel({ kind: 'UNBEATEN', joint: true }, 1) === '공동 무패' && view.badgeLabel({ kind: 'MOST_WINS', joint: true }, 2) === '공동 최다승' && view.badgeLabel({ kind: 'BEST_DIFF', joint: false }, 3) === '최고 득실');
  check('표시: MOTD = 운영진 태그 경기, 없으면 첫 경기', view.heroIndex([{ tags: [] }, { tags: ['MATCH_OF_THE_DAY'] }]) === 1 && view.heroIndex([{ tags: ['CLOSEST_BATTLE'] }, { tags: [] }]) === 0);
  check('표시: 기록 한 줄', view.matchFallbackLine({ score1: 5, score2: 6, note: '1점 차 접전' }) === '6:5 · 1점 차 접전' && view.matchFallbackLine({ score1: 6, score2: 2, note: null }) === '6:2 · 4점 차 승부' && view.matchFallbackLine({ score1: 4, score2: 4, note: null }) === '4:4 무승부');
  const chV2 = view.chaptersOfV2(pa).map((c: any) => c.id).join();
  check('표시: v2 챕터 순서', chV2 === 'podium,records,review,standings', chV2);
  check('표시: v1 챕터는 그대로(records 없음)', view.chaptersOf(pa).map((c: any) => c.id).join() === 'podium,review,standings');
  check('표시: 선정 방식 문구', view.chaptersOfV2(pm).find((c: any) => c.id === 'review').kicker === '운영진 선정 경기' && view.chaptersOfV2(pa).find((c: any) => c.id === 'review').kicker === '기록 기준 추천 경기');
}
{
  // 게스트 TOP3: 순위표 · 경기 기록의 id 가 같으면 경기 기록 표시, id 가 없고 이름 표기만 다르면 추정하지 않고 숨김.
  const withId = story(src([['게스트', 1, 0, 2, 'manual-guest-g'], ['가람', 1, 0, 2], ['나래', 0, 1, -2], ['다솜', 0, 1, -2]], [[1, 1, 'A', [-1, 1, 2, 3], 6, 4]]));
  check('게스트 id 일치: 경기 기록 표시', withId.podium[0].consistent && withId.podium[0].matches.length === 1 && withId.podium[0].matches[0].partner === '가람');
  const noId = {
    id: 'x', archiveType: 'kdk', isOfficial: true, isTest: false, title: 't', date: '2026-11-10', playerGroups: {},
    rankingData: [{ id: '', name: 'manual-guest-게스트', wins: 1, losses: 0, diff: 2 }, { id: '', name: '가람', wins: 1, losses: 0, diff: 2 }, { id: '', name: '나래', wins: 0, losses: 1, diff: -2 }, { id: '', name: '다솜', wins: 0, losses: 1, diff: -2 }],
    snapshotData: [{ id: 'm1', round: 1, court: 1, group_name: 'A', status: 'complete', player_ids: ['', '', '', ''], player_names: ['게스트(G)', '가람', '나래', '다솜'], score1: 6, score2: 4 }],
  };
  const sn = story(noId);
  check('게스트 id 없음 · 표기 다름: 경기 기록 숨김(추정 안 함) · 공식 요약은 유지', !sn.podium[0].consistent && sn.podium[0].matches.length === 0 && sn.podium[0].summary === '1전 전승 · 득실 +2' && sn.podium[0].name === '게스트(G)');
  check('게스트 id 없음: 다른 선수 기록은 정상', sn.podium[1].consistent && sn.podium[1].matches.length === 1);
}

// ── v2.1: 공동 무패 제안 문구 · RECORDS 중복 제외 · 접전 요약 ─────────────────────────────
{
  const j = story(src([['가람', 4, 0, 10], ['나래', 4, 0, 8], ['다솜', 3, 1, 6], ['라온', 0, 4, -24]], [[1, 1, 'A', [1, 2, 3, 4], 6, 3]]));
  const s1 = st.storySuggestion(j.podium[0]); const s2 = st.storySuggestion(j.podium[1]);
  check('공동 무패 제안: 1 · 2위 모두 "공동 무패" 명시', s1.includes('공동 무패') && s2.includes('공동 무패') && s2.endsWith('준우승을 차지했습니다.'), `${s1} / ${s2}`);
  const sole = story(src([['가람', 4, 0, 12], ['나래', 3, 1, 5], ['다솜', 2, 2, 0]], [[1, 1, 'A', [1, 2, 3, 3], 6, 2]]));
  const t = st.storySuggestion(sole.podium[0]);
  check('단독 기록 제안: 괄호 표기 · 조사는 숫자 기준', t === '4전 전승, 득실 +12(최다승)로 정상에 올랐습니다.', t);

  const sc: Array<[number, number]> = [[6, 5], [6, 3], [6, 2], [5, 6], [6, 4], [6, 0], [6, 5], [4, 6]];
  const p = fr.buildFinalReportPayload(model(scheduled(sc).src), fr.EMPTY_CONTENT).payload;
  const rv = view.recordsView(p);
  const champ = p.podium[0].name;
  check('RECORDS: 우승자 단독 기록(무패 우승 · 단독 최다승 · 단독 최고 득실) 제외', !rv.players.some((h: any) => h.kind === 'UNBEATEN_CHAMPION') && rv.players.every((h: any) => h.joint || h.names[0] !== champ), JSON.stringify(rv.players.map((h: any) => [h.kind, h.joint, h.names])));
  check('RECORDS: 공동 기록은 유지', p.highlights.filter((h: any) => h.joint && h.kind !== 'CLOSE_MATCHES').every((h: any) => rv.players.some((x: any) => x.kind === h.kind)));
  check('RECORDS: 경기 수 기록은 한 영역', rv.matchStats.every((h: any) => h.kind === 'CLOSE_MATCHES' || h.kind === 'SHUTOUT') && rv.matchStats.length === p.highlights.filter((h: any) => h.kind === 'CLOSE_MATCHES' || h.kind === 'SHUTOUT').length);
  const none = view.recordsView({ podium: [{ name: '가람' }], highlights: [{ kind: 'UNBEATEN_CHAMPION', label: '무패 우승', value: '4전 전승', names: ['가람'], total: 1, joint: false }, { kind: 'MOST_WINS', label: '최다승', value: '4승', names: ['가람'], total: 1, joint: false }] });
  check('RECORDS: 남는 기록 없으면 챕터 없음', !none.any && !view.chaptersOfV2({ ...p, highlights: none.players }).some((c: any) => c.id === 'records'));
  const other = view.recordsView({ podium: [{ name: '가람' }], highlights: [{ kind: 'BEST_DIFF', label: '최고 득실', value: '+9', names: ['라온'], total: 1, joint: false }] });
  check('RECORDS: 우승자가 아닌 선수의 단독 기록은 표시', other.players.length === 1);
  const cs = view.closeSummary(p);
  const totalClose = p.highlights.find((h: any) => h.kind === 'CLOSE_MATCHES')?.total ?? 0;
  const shownClose = p.featured.filter((m: any) => Math.abs(m.score1 - m.score2) === 1).length;
  check('접전 요약: 다 싣지 못한 1점 차 접전 수', totalClose > shownClose ? cs === `이날 1점 차 접전은 모두 ${totalClose}경기였습니다.` : cs === null, `${cs} total=${totalClose} shown=${shownClose}`);
  check('접전 요약: 모두 실렸으면 없음', view.closeSummary({ highlights: [{ kind: 'CLOSE_MATCHES', total: 1 }], featured: [{ score1: 6, score2: 5 }] }) === null);
}

console.log(`KDK FINAL REPORT v2 story engine fixture: ${passed} passed / ${failures.length} failed`);
for (const f of failures) console.log('  FAIL', f);
process.exit(failures.length ? 1 : 0);
