/**
 * TEYEON MY RIVAL(나의 천적 · 숙명의 라이벌) fixture.
 *
 *   실행: node scripts/verify_my_rival.mts
 *   (Node 24 TypeScript type-stripping + scripts/ts-resolve-hook.mjs — 별도 러너/의존성 없음, DB 미접속)
 *
 *   검증: 분류 경계(정수 비교) · 공식 기록 판정 · 파트너/게스트/탈회 제외 · 중복 집계 없음 ·
 *         A/B 대칭 · 빈 상태 · 상대전적(computeHeadToHead) 수치 완전 일치 · 정렬 · 기존 상대/파트너 산식 무변경.
 */
import { register } from 'node:module';

register('./ts-resolve-hook.mjs', import.meta.url);

// 경로를 변수로 넘겨 프로젝트 tsc 검사 대상에서 제외(기존 verify_*.mts 관례).
const load = (path: string): Promise<any> => import(path);
const { computeHeadToHead, computePartnerRecord } = await load('../lib/ranking/headToHead.ts');
const R = await load('../lib/ranking/myRival.ts');

let passed = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, info = '') => { if (cond) passed += 1; else failures.push(`${name}${info ? ` — ${info}` : ''}`); };

// ── fixture helpers ──────────────────────────────────────────────────────────
const NAMES: Record<string, string> = {
  me: '나', a: '상대A', b: '상대B', c: '상대C', d: '상대D', e: '상대E', f: '상대F', p: '파트너P', q: '파트너Q', w: '탈회W', x: '상대X', y: '상대Y',
  long: '아주아주긴이름을가진회원님입니다',
};
const MEMBERS = Object.entries(NAMES).map(([id, name]) => ({ id, name }));
const ACTIVE = new Set(MEMBERS.map((m) => m.id).filter((id) => id !== 'w'));
let seq = 0;
/** team1=[t1a,t1b] vs team2=[t2a,t2b], team1Won. */
function g(t1: [string, string], t2: [string, string], team1Won: boolean, extra: Record<string, unknown> = {}) {
  seq += 1;
  const ids = [...t1, ...t2];
  return { id: `m${seq}`, round: 1, status: 'complete', player_ids: ids, player_names: ids.map((i) => NAMES[i] ?? i), score1: team1Won ? 6 : 4, score2: team1Won ? 4 : 6, ...extra };
}
function arch(id: string, date: string, games: any[], o: Record<string, unknown> = {}) {
  return { id, created_at: `${date}T10:00:00Z`, archive_type: 'kdk', is_official: true, is_test: false, raw_data: { date, title: `KDK ${date}`, snapshot_data: games }, ...o };
}
/** me 가 상대 opp 와 맞대결 n 경기(나의 승 w). 파트너는 p/q 고정, 상대 팀 짝은 filler. */
function vs(opp: string, n: number, w: number, filler = 'manual-guest-짝', start = 1) {
  const out: any[] = [];
  for (let i = 0; i < n; i += 1) {
    const meWon = i < w;
    // 순서 교차: 짝수는 me 가 team1, 홀수는 team2 (A/B 위치 무관 검증)
    out.push(i % 2 === 0 ? g(['me', 'p'], [opp, filler], meWon) : g([filler, opp], ['p', 'me'], !meWon));
  }
  return out.map((x, i) => ({ ...x, round: start + i }));
}
const run = (rows: any[], me = 'me') => R.computeMyRivals(rows, me, MEMBERS, ACTIVE);
const find = (res: any, id: string) => ({ n: res.nemeses.find((o: any) => o.opponentId === id), r: res.rivals.find((o: any) => o.opponentId === id) });

// ── 1~6. 분류 경계 ─────────────────────────────────────────────────────────
{
  const rows = [arch('s1', '2026-09-01', [...vs('a', 3, 0), ...vs('b', 3, 1), ...vs('c', 3, 2), ...vs('d', 5, 2), ...vs('e', 5, 3), ...vs('f', 4, 2)])];
  const res = run(rows);
  const A = find(res, 'a'), B = find(res, 'b'), Cc = find(res, 'c'), D = find(res, 'd'), E = find(res, 'e'), F = find(res, 'f');
  check('1. 3경기 0승 3패 → 천적', !!A.n && !A.r);
  check('2. 3경기 1승 2패 → 천적(2/3 경계, 부동소수점 아님)', !!B.n && !B.r, JSON.stringify(B));
  check('3. 3경기 2승 1패 → 천적 아님', !Cc.n && !Cc.r);
  check('4. 5경기 2승 3패 → 라이벌(40% 경계)', !!D.r && !D.n);
  check('5. 5경기 3승 2패 → 라이벌(60% 경계)', !!E.r && !E.n);
  check('6. 4경기 2승 2패 → 라이벌 아님(5경기 미만)', !F.r && !F.n);
  check('천적 수치: 상대 승률 66.7 · 나의 1승 2패', B.n?.myWins === 1 && B.n?.myLosses === 2 && B.n?.oppWinRate === 66.7);
  // 정수 경계 직접
  check('isNemesis(3,1)=true · (6,2)=true · (6,3)=false · (2,0)=false', R.isNemesis(3, 1) && R.isNemesis(6, 2) && !R.isNemesis(6, 3) && !R.isNemesis(2, 0));
  check('isNemesis(300,100)=true(대수 경계)', R.isNemesis(300, 100) && !R.isNemesis(300, 101));
  check('isRival(5,2/3)=true · (5,1/4)=false · (10,4/6)=true · (10,7)=false', R.isRival(5, 2) && R.isRival(5, 3) && !R.isRival(5, 1) && !R.isRival(5, 4) && R.isRival(10, 4) && R.isRival(10, 6) && !R.isRival(10, 7) && !R.isRival(10, 3));
  // 겹침 불가: 모든 (g ≤ 60, w ≤ g) 조합에서 둘 다 true 인 경우 없음
  let overlap = 0;
  for (let gg = 1; gg <= 60; gg += 1) for (let ww = 0; ww <= gg; ww += 1) if (R.isNemesis(gg, ww) && R.isRival(gg, ww)) overlap += 1;
  check('천적 · 라이벌 동시 해당 조합 없음(1~60경기 전수)', overlap === 0, String(overlap));
  // 14. 상대전적과 수치 일치(모든 후보)
  for (const o of [...res.nemeses, ...res.rivals]) {
    const h = computeHeadToHead(rows, 'me', o.opponentId, MEMBERS);
    check(`14. ${o.opponentId} 상대전적 일치`, h.totalGames === o.totalGames && h.aWins === o.myWins && h.bWins === o.myLosses && h.aWinRate === o.myWinRate
      && JSON.stringify(h.matches[0]) === JSON.stringify(o.latest), JSON.stringify({ h: [h.totalGames, h.aWins, h.bWins], o: [o.totalGames, o.myWins, o.myLosses] }));
  }
  check('맞대결 상대 수 = 회원 6명(게스트 짝 제외)', res.opponentsMet === 6, String(res.opponentsMet));
  const resQ = run([arch('q', '2026-09-01', vs('a', 3, 0, 'q'))]);
  check('상대 팀의 두 회원 모두 상대로 집계(a · q)', !!find(resQ, 'a').n && !!find(resQ, 'q').n);
}

// ── 7~10. 공식 기록 판정 · 파트너 · 중복 ─────────────────────────────────────
{
  const base = vs('a', 3, 0);
  const rowsTest = [arch('ok', '2026-09-01', vs('a', 2, 0)), arch('t', '2026-09-02', vs('a', 2, 0), { is_test: true })];
  check('7. 테스트 Archive 제외(2경기만 → 천적 아님)', !find(run(rowsTest), 'a').n);
  const rowsUnofficial = [arch('ok', '2026-09-01', vs('a', 2, 0)), arch('u', '2026-09-02', vs('a', 2, 0), { is_official: false }), arch('k', '2026-09-03', vs('a', 2, 0), { archive_type: 'tournament' })];
  check('8. 미확정(is_official=false) · KDK 아님 Archive 제외', !find(run(rowsUnofficial), 'a').n);
  // 미완료 · 무승부 · 3인 경기 제외
  const rowsIncomplete = [arch('i', '2026-09-01', [...vs('a', 2, 0), { ...g(['me', 'p'], ['a', 'q'], false), status: 'playing' }, { ...g(['me', 'p'], ['a', 'q'], false), score1: 5, score2: 5 }, { ...g(['me', 'p'], ['a', 'q'], false), player_ids: ['me', 'p', 'a'] }])];
  check('8b. 진행 중 · 무승부 · 3인 경기 제외', !find(run(rowsIncomplete), 'a').n);
  // 9. 파트너 경기 제외: p 와는 항상 같은 팀 → 상대 후보 아님
  const rowsP = [arch('p', '2026-09-01', [...base, g(['me', 'p'], ['x', 'y'], false), g(['me', 'p'], ['x', 'y'], false), g(['me', 'p'], ['x', 'y'], false)])];
  const resP = run(rowsP);
  check('9. 파트너(같은 팀)는 천적 · 라이벌 후보 아님', !find(resP, 'p').n && !find(resP, 'p').r);
  check('9b. 파트너 경기는 상대 수치에 미포함(p 상대전적 0)', computeHeadToHead(rowsP, 'me', 'p', MEMBERS).totalGames === 0 && computePartnerRecord(rowsP, 'me', 'p', MEMBERS).totalGames === 6);
  // 10. 중복 집계 없음: 상대 팀 2명이 모두 같은 회원 후보여도 한 경기는 상대별 1회
  const rowsDup = [arch('d', '2026-09-01', [g(['me', 'p'], ['a', 'b'], false), g(['me', 'p'], ['a', 'b'], false), g(['me', 'p'], ['a', 'b'], false)])];
  const resD = run(rowsDup);
  check('10. 한 경기 = 상대별 1회(a 3경기 · b 3경기, 6 아님)', find(resD, 'a').n?.totalGames === 3 && find(resD, 'b').n?.totalGames === 3);
  // 10b. 같은 회원이 두 slot 에 중복 기록된 비정상 경기 — 상대전적과 같은 방식(첫 slot)으로만 1회
  const rowsBad = [arch('b', '2026-09-01', [...vs('a', 3, 0), g(['me', 'p'], ['a', 'a'], false)])];
  const hb = computeHeadToHead(rowsBad, 'me', 'a', MEMBERS);
  check('10b. 비정상 중복 slot 도 상대전적과 동일 수치', find(run(rowsBad), 'a').n?.totalGames === hb.totalGames, `${hb.totalGames}`);
}

// ── 11. A/B 위치 교환 일관성 ─────────────────────────────────────────────────
{
  const games = vs('d', 5, 2);
  const swapped = games.map((m: any) => ({ ...m, player_ids: [...m.player_ids.slice(2), ...m.player_ids.slice(0, 2)], player_names: [...m.player_names.slice(2), ...m.player_names.slice(0, 2)], score1: m.score2, score2: m.score1 }));
  const r1 = find(run([arch('s', '2026-09-01', games)]), 'd').r;
  const r2 = find(run([arch('s', '2026-09-01', swapped)]), 'd').r;
  check('11. 팀 순서(score1/2) 교환해도 결과 동일', !!r1 && !!r2 && r1.myWins === r2.myWins && r1.totalGames === r2.totalGames);
  const inner = games.map((m: any) => ({ ...m, player_ids: [m.player_ids[1], m.player_ids[0], m.player_ids[3], m.player_ids[2]], player_names: [m.player_names[1], m.player_names[0], m.player_names[3], m.player_names[2]] }));
  const r3 = find(run([arch('s', '2026-09-01', inner)]), 'd').r;
  check('11b. 팀 안 선수 순서 교환해도 결과 동일', !!r3 && r3.myWins === r1.myWins);
  // 상대 관점 대칭: d 기준으로 me 는 3승 2패 → 라이벌
  const rd = R.computeMyRivals([arch('s', '2026-09-01', games)], 'd', MEMBERS, ACTIVE);
  const meAsOpp = rd.rivals.find((o: any) => o.opponentId === 'me');
  check('11c. 상대 기준 대칭(3승 2패, 승패 합 일치)', !!meAsOpp && meAsOpp.myWins === r1.myLosses && meAsOpp.myLosses === r1.myWins);
}

// ── 12. 기록 없는 회원 빈 상태 ──────────────────────────────────────────────
{
  const res = run([arch('s', '2026-09-01', vs('a', 3, 0))], 'long');
  check('12. 기록 없는 회원: 천적 · 라이벌 0 · 만난 상대 0', res.nemeses.length === 0 && res.rivals.length === 0 && res.opponentsMet === 0);
  check('12b. 빈 rows · 빈 meId 안전', run([]).nemeses.length === 0 && R.computeMyRivals([], '', MEMBERS, ACTIVE).rivals.length === 0);
  const res2 = run([arch('s', '2026-09-01', [...vs('a', 2, 0), ...vs('b', 4, 2)])]);
  check('12c. 데이터 부족이면 억지 생성 없음', res2.nemeses.length === 0 && res2.rivals.length === 0 && res2.opponentsMet >= 2);
}

// ── 13. 탈회 회원 제외 · 게스트 · 식별 불가 ─────────────────────────────────
{
  const rows = [arch('s', '2026-09-01', [...vs('w', 3, 0), ...vs('a', 3, 0)])];
  const res = run(rows);
  check('13. 탈회 회원은 천적 후보 제외', !find(res, 'w').n && !!find(res, 'a').n);
  check('13b. 탈회 회원과의 과거 상대전적 자체는 유지(상세 화면 기준)', computeHeadToHead(rows, 'me', 'w', MEMBERS).totalGames === 3);
  const gst = [arch('g', '2026-09-01', [g(['me', 'p'], ['manual-guest-손님', 'g-1'], false), g(['me', 'p'], ['manual-guest-손님', 'g-1'], false), g(['me', 'p'], ['manual-guest-손님', 'g-1'], false)].map((m: any) => ({ ...m, player_names: ['나', '파트너P', '손님(G)', '게스트'] })))];
  const rg = run(gst);
  check('13c. 게스트는 회원으로 취급하지 않음(후보 0)', rg.nemeses.length === 0 && rg.rivals.length === 0 && rg.opponentsMet === 0);
  // 이름만 남은 legacy slot(id 없음) → 상대전적과 같은 exact-name fallback
  const legacy = [arch('l', '2026-09-01', [0, 1, 2].map(() => ({ ...g(['me', 'p'], ['legacy-x', 'q'], false), player_names: ['나', '파트너P', '상대A', '파트너Q'] })))];
  const rl = run(legacy);
  check('13d. legacy 이름 exact → 상대전적과 같은 회원으로 해석', find(rl, 'a').n?.totalGames === 3 && computeHeadToHead(legacy, 'me', 'a', MEMBERS).totalGames === 3);
  const orphan = [arch('o', '2026-09-01', [0, 1, 2].map(() => ({ ...g(['me', 'p'], ['zz-1', 'q'], false), player_names: ['나', '파트너P', '모르는사람', '파트너Q'] })))];
  const ro = run(orphan);
  check('13e. 식별 불가(orphan)는 후보 아님 · 안내 플래그', !ro.nemeses.some((o: any) => o.opponentId === 'zz-1') && ro.hasUnresolvableRecords === true);
  check('13f. 기준 회원이 탈회 명단 밖이어도 계산은 id 기준(화면은 본인만)', R.computeMyRivals(rows, 'me', MEMBERS, new Set(['a'])).nemeses.length === 1);
}

// ── 정렬 ────────────────────────────────────────────────────────────────────
{
  const rows = [
    arch('s1', '2026-08-01', [...vs('a', 3, 0), ...vs('b', 6, 2), ...vs('c', 4, 1), ...vs('x', 3, 1)]),
    arch('s2', '2026-09-01', [...vs('d', 6, 3), ...vs('e', 5, 2), ...vs('f', 10, 5), ...vs('y', 5, 3)]),
  ];
  const res = run(rows);
  // 천적: 패 많은 순 b(4패) > c(3패, 75%) = a(3패, 100%) → a 먼저(상대 승률), c → x(2패)
  check('정렬: 천적 = 패 많은 순 → 상대 승률', res.nemeses.map((o: any) => o.opponentId).join(',') === 'b,a,c,x', res.nemeses.map((o: any) => o.opponentId).join(','));
  // 라이벌: 동률(f 10경기 · d 6경기) → 경기 많은 f 먼저, 그다음 1경기 차 e/y(5경기) → 최근 날짜 같으면 이름순
  check('정렬: 라이벌 = 팽팽 → 경기 수 → 최근 → 이름', res.rivals.map((o: any) => o.opponentId).join(',') === 'f,d,e,y', res.rivals.map((o: any) => o.opponentId).join(','));
  const res2 = run(rows.slice().reverse());
  check('정렬: 입력 순서와 무관(결정적)', JSON.stringify(res2) === JSON.stringify(res));
  check('최근 맞대결 = 상대전적 상세 첫 행 · 최근 흐름 ≤ 5', res.rivals.every((o: any) => o.recentForm.length === Math.min(5, o.totalGames)));
}

// ── 기존 상대전적 · 파트너 전적 산식 무변경(대표 값) ─────────────────────────
{
  const rows = [arch('s', '2026-09-01', [g(['me', 'p'], ['a', 'b'], true), g(['a', 'me'], ['p', 'b'], false), g(['p', 'a'], ['me', 'b'], true)])];
  const h = computeHeadToHead(rows, 'me', 'a', MEMBERS);
  const pr = computePartnerRecord(rows, 'me', 'a', MEMBERS);
  check('회귀: 상대전적 me vs a = 2경기 1승(50.0)', h.totalGames === 2 && h.aWins === 1 && h.aWinRate === 50 && h.leader === 'tie');
  check('회귀: 파트너 me+a = 1경기 0승', pr.totalGames === 1 && pr.wins === 0);
  const hr = computeHeadToHead(rows, 'a', 'me', MEMBERS);
  check('회귀: 상대전적 A/B 교환 대칭', hr.aWins === h.bWins && hr.bWins === h.aWins);
}

console.log(JSON.stringify({ passed, failed: failures.length, failures }, null, 1));
process.exit(failures.length ? 1 : 0);
