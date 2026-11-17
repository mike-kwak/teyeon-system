/**
 * TEYEON MY PARTNER(나와 잘 맞는 파트너) fixture.
 *
 *   실행: node scripts/verify_my_partner.mts
 *   (Node 24 TypeScript type-stripping + scripts/ts-resolve-hook.mjs — 별도 러너/의존성 없음, DB 미접속)
 *
 *   검증: 최소 5경기 경계 · 보정 승률 (승+2)/(경기+4) 정렬(정수 비교) · 동률 정렬 · BEST/MORE TOGETHER 중복 없음 ·
 *         후보 부족 시 있는 만큼만 · 공식 기록 판정 · 게스트/탈회/상대 팀 제외 · A/B 위치 무관 ·
 *         파트너 전적(computePartnerRecord) 수치 · 득실 완전 일치 · 기존 상대전적/파트너 산식 무변경.
 */
import { register } from 'node:module';

register('./ts-resolve-hook.mjs', import.meta.url);

// 경로를 변수로 넘겨 프로젝트 tsc 검사 대상에서 제외(기존 verify_*.mts 관례).
const load = (path: string): Promise<any> => import(path);
const { computeHeadToHead, computePartnerRecord } = await load('../lib/ranking/headToHead.ts');
const P = await load('../lib/ranking/myPartner.ts');

let passed = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, info = '') => { if (cond) passed += 1; else failures.push(`${name}${info ? ` — ${info}` : ''}`); };

// ── fixture helpers ──────────────────────────────────────────────────────────
const NAMES: Record<string, string> = {
  me: '나', a: '파트너A', b: '파트너B', c: '파트너C', d: '파트너D', e: '파트너E', f: '파트너F', h: '파트너H',
  o: '상대O', x: '상대X', w: '탈회W', long: '아주아주긴이름을가진파트너회원입니다',
};
const MEMBERS = Object.entries(NAMES).map(([id, name]) => ({ id, name }));
const ACTIVE = new Set(MEMBERS.map((m) => m.id).filter((id) => id !== 'w'));
let seq = 0;
/** team1=[t1a,t1b] vs team2=[t2a,t2b], team1 점수 s1 · team2 점수 s2. */
function g(t1: [string, string], t2: [string, string], s1: number, s2: number, extra: Record<string, unknown> = {}) {
  seq += 1;
  const ids = [...t1, ...t2];
  return { id: `m${seq}`, round: seq, status: 'complete', player_ids: ids, player_names: ids.map((i) => NAMES[i] ?? i.replace(/^manual-guest-/, '') + '(G)'), score1: s1, score2: s2, ...extra };
}
function arch(id: string, date: string, games: any[], o: Record<string, unknown> = {}) {
  return { id, created_at: `${date}T10:00:00Z`, archive_type: 'kdk', is_official: true, is_test: false, raw_data: { date, title: `KDK ${date}`, snapshot_data: games }, ...o };
}
/** me 가 파트너 p 와 같은 팀으로 n 경기(w 승). 승 6:3 · 패 4:6 고정 → 득실 = w*3 − (n−w)*2. 위치(team1/2 · 0/1 자리) 교차. */
function withP(p: string, n: number, w: number, opp: [string, string] = ['o', 'x']) {
  const out: any[] = [];
  for (let i = 0; i < n; i += 1) {
    const won = i < w;
    const [a, b] = won ? [6, 3] : [4, 6];
    const k = i % 4;
    out.push(
      k === 0 ? g(['me', p], opp, a, b)
        : k === 1 ? g(opp, [p, 'me'], b, a)
          : k === 2 ? g([p, 'me'], opp, a, b)
            : g(opp, ['me', p], b, a),
    );
  }
  return out;
}
const run = (rows: any[], me = 'me') => P.computeMyPartners(rows, me, MEMBERS, ACTIVE);
const ids = (list: any[]) => list.map((x: any) => x.partnerId).join(',');

// ── 1. 최소 경기 경계 · 미달 안내 ────────────────────────────────────────────
{
  const rows = [arch('s1', '2026-09-01', [...withP('a', 4, 4), ...withP('b', 5, 1)])];
  const r = run(rows);
  check('1. 4경기(전승)는 순위 제외 · 5경기는 포함', ids(r.best) === 'b' && r.qualified === 1, ids(r.best));
  check('1b. partnersMet = 2 · maxGamesBelowMin = 4', r.partnersMet === 2 && r.maxGamesBelowMin === 4);
  const r0 = run([arch('s0', '2026-09-01', [...withP('a', 3, 3), ...withP('b', 4, 0)])]);
  check('1c. 5경기 이상 파트너 없음 → best/more 비어 있음(빈 카드 없음) · 안내용 4경기', r0.best.length === 0 && r0.moreTogether.length === 0 && r0.qualified === 0 && r0.partnersMet === 2 && r0.maxGamesBelowMin === 4);
  const re = run([]);
  check('1d. 기록 없음 → 전부 0', re.partnersMet === 0 && re.qualified === 0 && re.best.length === 0);
  check('1e. PARTNER_MIN_GAMES = 5 · 보정 (승+2)/(경기+4)', P.PARTNER_MIN_GAMES === 5 && P.PRIOR_WINS === 2 && P.PRIOR_GAMES === 4);
}

// ── 2. 보정 승률 정렬 · 실제 승률 표시 ───────────────────────────────────────
{
  // a: 5전 5승(실제 100%, 보정 7/9=.778) · b: 10전 9승(실제 90%, 보정 11/14=.786) → b 가 위
  const rows = [arch('s2', '2026-09-02', [...withP('a', 5, 5), ...withP('b', 10, 9), ...withP('c', 6, 1), ...withP('d', 8, 2)])];
  const r = run(rows);
  check('2. 보정 승률로 정렬: 10전 9승(90%)이 5전 5승(100%)보다 위', ids(r.best) === 'b,a', ids(r.best));
  const A = r.best.find((x: any) => x.partnerId === 'a');
  check('2b. 화면용 승률은 실제 값(100 · 90)', A?.winRate === 100 && r.best[0].winRate === 90);
  // c: 6전 1승(3/10=.3) · d: 8전 2승(4/12=.333) → 낮은 순 c, d
  check('2c. MORE TOGETHER 는 보정 승률 낮은 순(c 6전1승 → d 8전2승)', ids(r.moreTogether) === 'c,d', ids(r.moreTogether));
  // 교차곱 정수 비교 직접
  check('2d. compareAdjustedDesc: 9/10 > 5/5 · 동률 0', P.compareAdjustedDesc({ wins: 9, totalGames: 10 }, { wins: 5, totalGames: 5 }) < 0 && P.compareAdjustedDesc({ wins: 4, totalGames: 6 }, { wins: 7, totalGames: 11 }) === 0);
}

// ── 3. 동률 정렬(보정 승률 같음 → 경기 수 → 득실 → 최근 → 이름) ──────────────────
{
  // a: 6전 4승 (6/10=.6) · b: 11전 7승 (9/15=.6) → 같은 보정 승률, 경기 많은 b 먼저
  const r = run([arch('s3', '2026-09-03', [...withP('a', 6, 4), ...withP('b', 11, 7)])]);
  check('3. 보정 동률 → 함께 뛴 경기 많은 순(BEST)', ids(r.best) === 'b,a', ids(r.best));
  // 같은 경기 · 같은 승 → 득실 큰 쪽 먼저(득실을 바꾸기 위해 c 의 승 점수를 크게)
  const cGames = withP('c', 5, 3).map((m: any) => {
    const meTeam1 = m.player_ids.indexOf('me') <= 1;
    const won = meTeam1 ? m.score1 > m.score2 : m.score2 > m.score1;
    return won ? (meTeam1 ? { ...m, score1: 6, score2: 0 } : { ...m, score1: 0, score2: 6 }) : m;
  });
  const r2 = run([arch('s3b', '2026-09-03', [...cGames, ...withP('d', 5, 3)])]);
  check('3b. 보정 · 경기 수 같음 → 득실 큰 쪽 먼저', ids(r2.best) === 'c,d' && r2.best[0].pointDiff > r2.best[1].pointDiff, `${ids(r2.best)} ${r2.best.map((x: any) => x.pointDiff)}`);
  // 완전 동률 → 최근 경기 최신 → 이름
  const r3 = run([arch('old', '2026-08-01', withP('e', 5, 3)), arch('new', '2026-10-01', withP('f', 5, 3))]);
  check('3c. 완전 동률 → 최근 함께 뛴 날짜 최신 순', ids(r3.best) === 'f,e', ids(r3.best));
}

// ── 4. 두 목록 중복 없음 · 후보 부족 ─────────────────────────────────────────
{
  const three = run([arch('s4', '2026-09-04', [...withP('a', 5, 4), ...withP('b', 5, 3), ...withP('c', 5, 1)])]);
  check('4. 대상 3명 → BEST 2 · MORE 1(겹침 없음)', three.best.length === 2 && three.moreTogether.length === 1 && ids(three.moreTogether) === 'c' && !three.best.some((x: any) => x.partnerId === 'c'));
  const one = run([arch('s4b', '2026-09-04', withP('a', 7, 1))]);
  check('4b. 대상 1명 → BEST 1 · MORE 0(낮은 승률이어도 BEST 에만)', one.best.length === 1 && one.moreTogether.length === 0);
  const two = run([arch('s4c', '2026-09-04', [...withP('a', 5, 4), ...withP('b', 5, 0)])]);
  check('4c. 대상 2명 → BEST 2 · MORE 0', two.best.length === 2 && two.moreTogether.length === 0);
  const six = run([arch('s4d', '2026-09-04', [...withP('a', 5, 5), ...withP('b', 5, 4), ...withP('c', 5, 3), ...withP('d', 5, 2), ...withP('e', 5, 1), ...withP('f', 5, 0)])]);
  const all = [...six.best, ...six.moreTogether].map((x: any) => x.partnerId);
  check('4d. 대상 6명 → BEST a,b · MORE f,e · 중복 없음', ids(six.best) === 'a,b' && ids(six.moreTogether) === 'f,e' && new Set(all).size === all.length, `${ids(six.best)} / ${ids(six.moreTogether)}`);
}

// ── 5. 후보 범위 · 공식 기록 판정 ────────────────────────────────────────────
{
  const rows = [
    arch('ok', '2026-09-05', [
      ...withP('a', 5, 3),
      ...withP('w', 6, 6),                                                         // 탈회 파트너 → 제외
      ...Array.from({ length: 6 }, () => g(['me', 'manual-guest-손님'], ['o', 'x'], 6, 1)), // 게스트 파트너 → 제외
      ...Array.from({ length: 6 }, () => g(['me', 'a'], ['b', 'x'], 6, 1)),         // b 는 상대 팀
    ]),
    arch('test', '2026-09-06', withP('c', 6, 6), { is_test: true }),
    arch('unofficial', '2026-09-07', withP('c', 6, 6), { is_official: false }),
    arch('tour', '2026-09-08', withP('c', 6, 6), { archive_type: 'tournament' }),
    arch('bad', '2026-09-09', [
      ...withP('d', 6, 6).map((m: any) => ({ ...m, status: 'playing' })),         // 미완료
      ...withP('d', 6, 6).map((m: any) => ({ ...m, score2: m.score1 })),          // 무승부
    ]),
  ];
  const r = run(rows);
  const listed = [...r.best, ...r.moreTogether].map((x: any) => x.partnerId);
  check('5. 탈회 파트너 제외', !listed.includes('w'));
  check('5b. 게스트 파트너 제외', !listed.some((x: string) => /guest|손님/.test(x)));
  check('5c. 상대 팀으로만 만난 회원(b)은 파트너 아님', !listed.includes('b'));
  check('5d. 테스트 · 비공식 · 대회 Archive 제외(c 없음)', !listed.includes('c'));
  check('5e. 미완료 · 무승부 경기 제외(d 없음)', !listed.includes('d'));
  const A = r.best.find((x: any) => x.partnerId === 'a');
  check('5f. a = 5경기(3승) + 같은 팀 6경기(6승) = 11경기 9승', A?.totalGames === 11 && A?.wins === 9, JSON.stringify({ g: A?.totalGames, w: A?.wins }));
  check('5g. partnersMet 은 현재 회원만(a 1명)', r.partnersMet === 1, String(r.partnersMet));
}

// ── 6. 파트너 전적과 수치 · 득실 완전 일치 ─────────────────────────────────────
{
  const rows = [
    arch('k1', '2026-08-02', [...withP('a', 7, 5), ...withP('b', 9, 4), ...withP('c', 5, 1), ...withP('long', 6, 3)]),
    arch('k2', '2026-09-06', [...withP('a', 3, 1), ...withP('b', 2, 2), ...withP('h', 5, 2)]),
  ];
  const r = run(rows);
  for (const p of [...r.best, ...r.moreTogether]) {
    const pr = computePartnerRecord(rows, 'me', p.partnerId, MEMBERS);
    const pf = pr.matches.reduce((s: number, m: any) => s + m.pairScore, 0);
    const pa = pr.matches.reduce((s: number, m: any) => s + m.oppScore, 0);
    check(`6. ${p.partnerId} 수치 = 파트너 전적(경기 · 승 · 패 · 승률 · 득실 · 최근)`,
      p.totalGames === pr.totalGames && p.wins === pr.wins && p.losses === pr.losses && p.winRate === pr.winRate
        && p.pointsFor === pf && p.pointsAgainst === pa && p.pointDiff === pf - pa && p.latest?.archiveId === pr.matches[0]?.archiveId
        && JSON.stringify(p.recentForm) === JSON.stringify(pr.matches.slice(0, 5).map((m: any) => m.won)),
      JSON.stringify({ p: [p.totalGames, p.wins, p.pointDiff], pr: [pr.totalGames, pr.wins, pf - pa] }));
    const rev = computePartnerRecord(rows, p.partnerId, 'me', MEMBERS);
    check(`6b. ${p.partnerId} A/B 교환해도 같은 파트너 전적`, rev.totalGames === pr.totalGames && rev.wins === pr.wins);
  }
  check('6c. 득실 계산 예: a 10경기 6승 → 6*3 − 4*2 = +10', r.best.concat(r.moreTogether).find((x: any) => x.partnerId === 'a')?.pointDiff === 10);
  check('6d. 최근 경기는 가장 최신 Archive', r.best.concat(r.moreTogether).find((x: any) => x.partnerId === 'a')?.latest?.archiveId === 'k2');
}

// ── 7. 기존 이름(legacy) 기록 해석 · 식별 불가 안내 — 파트너 전적과 같은 resolver ─────────────
{
  const legacy = withP('a', 5, 4).map((m: any) => ({ ...m, player_ids: m.player_ids.map((id: string) => (id === 'a' ? 'old-uuid-a' : id)) }));
  // 식별 불가(명단에 없는 id · 이름, 게스트 표시 없음) 선수가 상대 팀에 있는 경기
  const orphan = [{ ...g(['me', 'a'], ['ghost-id', 'x'], 6, 2), player_names: ['나', '파트너A', '명단에없는사람', '상대X'] }];
  const rows = [arch('lg', '2026-09-10', [...legacy, ...orphan])];
  const r = run(rows);
  const pr = computePartnerRecord(rows, 'me', 'a', MEMBERS);
  check('7. 예전 id(이름만 일치)도 파트너 전적과 같게 해석', r.best[0]?.partnerId === 'a' && r.best[0].totalGames === pr.totalGames && pr.totalGames === 6);
  check('7b. 식별 불가 경기 → 안내 플래그(파트너 전적과 동일)', r.hasUnresolvableRecords === pr.hasUnresolvableRecords && r.hasUnresolvableRecords === true);
}

// ── 8. 본인 고정 · 입력 방어 ─────────────────────────────────────────────────
{
  const rows = [arch('s8', '2026-09-11', withP('a', 6, 3))];
  check('8. meId 없음 → 빈 결과', run(rows, '').best.length === 0 && run(rows, '').partnersMet === 0);
  const asA = run(rows, 'a');
  check('8b. 기준 회원 기준으로만 계산(a 기준이면 me 가 파트너)', asA.best[0]?.partnerId === 'me');
  check('8c. collectPartnerIds 는 같은 팀만', [...P.collectPartnerIds([arch('c8', '2026-09-11', [g(['me', 'a'], ['b', 'c'], 6, 1)])], 'me', MEMBERS)].join(',') === 'a');
}

// ── 9. 기존 산식 회귀(상대전적 · 파트너 전적 값 그대로) ───────────────────────────
{
  const rows = [arch('rg', '2026-09-12', [g(['me', 'a'], ['b', 'c'], 6, 4), g(['me', 'b'], ['a', 'c'], 3, 6), g(['a', 'b'], ['me', 'c'], 6, 2)])];
  const h = computeHeadToHead(rows, 'me', 'a', MEMBERS);
  const pr = computePartnerRecord(rows, 'me', 'a', MEMBERS);
  check('9. 회귀: 상대전적 me vs a = 2경기 0승', h.totalGames === 2 && h.aWins === 0 && h.aWinRate === 0);
  check('9b. 회귀: 파트너 me+a = 1경기 1승(100.0)', pr.totalGames === 1 && pr.wins === 1 && pr.winRate === 100);
}

console.log(JSON.stringify({ passed, failed: failures.length, failures }, null, 1));
process.exit(failures.length ? 1 : 0);
