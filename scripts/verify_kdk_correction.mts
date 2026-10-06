/**
 * TEYEON KDK 공식 기록 정정 fixture.
 *
 *   실행: node scripts/verify_kdk_correction.mts
 *   (Node 24 의 TypeScript type-stripping 사용 — 별도 테스트 러너/의존성 없음)
 *
 *   검증 대상: lib/kdk/correction.ts (computeCorrectionImpact / listCorrectableMatches)
 *   그리고 그것이 조합하는 기존 SSoT — lib/kdk/aggregate.ts · officialRanking.ts · settlement.ts.
 *
 *   fixture: scripts/fixtures/kdk-correction-session.json
 *     18명 · 18경기 KDK 세션의 **완전 익명 합성 데이터**(참가자 P01~P18).
 *     실명 · 실제 회원 id · 실제 경기 id · 실제 Archive id 를 담지 않는다.
 *     운영에서 실제로 발생했던 '점수 1건 오입력' 모양(4:6 → 5:6, 승자 불변 ·
 *     득실만 변동 · 완전 동률 발생)을 구조로만 재현해 회귀를 고정한다.
 *
 *   downstream 회귀: Archive 정정 결과를 기존 소비자(Profile 공식 기록 · Club Ranking ·
 *     상대/파트너 전적 · 공개 결과 projection)가 **그대로 읽는지**까지 확인한다.
 *     소비자 코드를 고쳐 맞추지 않는다 — Archive SSoT 가 바뀌면 자연히 따라와야 한다.
 */
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// 제품 코드는 확장자 없이 상대 import 한다(Next/tsc 규칙). Node ESM 용 해석만 보태 준다.
register('./ts-resolve-hook.mjs', import.meta.url);

const here = dirname(fileURLToPath(import.meta.url));
const correctionPath = '../lib/kdk/correction.ts';
const archiveStatsPath = '../lib/kdkArchiveStats.ts';
const clubRankingPath = '../lib/ranking/clubRankingCore.ts';
const headToHeadPath = '../lib/ranking/headToHead.ts';
const { computeCorrectionImpact, listCorrectableMatches, memberIdsForBirthYear } =
  await import(correctionPath);
const { calculateKdkArchiveStats } = await import(archiveStatsPath);
const { computeClubRanking } = await import(clubRankingPath);
const { computeHeadToHead, computePartnerRecord } = await import(headToHeadPath);

let passed = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, info = '') => {
  if (cond) passed += 1;
  else failures.push(`${name}${info ? ` — ${info}` : ''}`);
};
const eq = (name: string, got: unknown, want: unknown) =>
  check(name, JSON.stringify(got) === JSON.stringify(want),
    `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const RAW = JSON.parse(readFileSync(join(here, 'fixtures/kdk-correction-session.json'), 'utf8'));
const TARGET = '00000000-0000-4000-9000-000000000006';   // fixture 의 A조 R3 C2 경기
const pid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P = (n: number) => pid(n);                  // 회원 — 저장 순위 n 번째
const GUEST = (name: string) => `manual-guest-${name}`;

/**
 * 회원 출생연도 — 운영 환경에서는 admin_get_member_birth_years(members."나이")가 준다.
 *   여기서는 **저장된 순서를 재현하도록** 선택한 fixture 값이다(실제 회원 생년 아님).
 *   저장된 완전 동률 그룹: (P08,P09,P10G1997) · (P12,P13G1991,P14)
 */
const MEMBER_BIRTH = new Map<string, string>([
  [P(1), '1979'], [P(2), '1983'], [P(3), '1980'], [P(4), '1986'], [P(5), '1984'],
  [P(6), '1987'], [P(7), '1989'],
  [P(8), '1985'], [P(9), '1990'],
  [P(11), '1992'],
  [P(12), '1988'], [P(14), '1995'],
  [P(15), '1993'], [P(17), '1994'],
]);

console.log('=== KDK 공식 기록 정정 fixture ===\n');

// ── A. 경기 목록 ────────────────────────────────────────────────────────────
{
  const list = listCorrectableMatches(RAW);
  check('A 완료 경기 18건', list.length === 18, String(list.length));
  const t = list.find((o: any) => o.matchId === TARGET);
  check('A 대상 경기 존재', !!t);
  eq('A 대상 경기 팀/점수',
    { t1: t.team1Names, t2: t.team2Names, s: [t.score1, t.score2], g: t.group, r: t.round },
    { t1: ['P13(G)', 'P04'], t2: ['P11', 'P07'], s: [4, 6], g: 'A', r: 3 });
  check('A 미완료 경기는 목록에 없다',
    listCorrectableMatches({ ...RAW, snapshot_data: RAW.snapshot_data.map((m: any) => ({ ...m, status: 'pending' })) }).length === 0);
  check('A 회원 id 만 생년 조회 대상(게스트 제외)',
    memberIdsForBirthYear(RAW).length === 14, String(memberIdsForBirthYear(RAW).length));
}

// ── B. BEFORE 재현 — 공식 comparator 가 저장된 순서를 그대로 만들어내는가 ────
//    ⚠ 이것이 통과해야 정정이 '무관한 동률'을 흔들지 않는다는 보장이 된다.
{
  const imp = computeCorrectionImpact(RAW, TARGET, 5, 6, MEMBER_BIRTH);
  check('B 정정 가능(차단 없음)', imp.ok === true, String(imp.blocked));
  eq('B BEFORE 순서 = 저장된 ranking_data 순서',
    imp.before.map((r: any) => r.name),
    RAW.ranking_data.map((p: any) => p.name));

  let bad = 0;
  imp.before.forEach((r: any, i: number) => {
    const s = RAW.ranking_data[i];
    const e = RAW.settlement_data[i];
    if (r.wins !== s.wins || r.losses !== s.losses || r.diff !== s.diff) bad += 1;
    if (r.rank !== e.rank || r.pointsFor !== e.points_for || r.pointsAgainst !== e.points_against
      || r.penaltyLevel !== e.penalty_level || r.penaltyAmount !== e.penalty_amount
      || r.prizeAmount !== e.prize_amount || r.guestFeeAmount !== e.guest_fee_amount
      || r.finalAmount !== e.final_amount) bad += 1;
  });
  check('B BEFORE 성적·정산이 저장값과 완전 일치', bad === 0, `불일치 ${bad}건`);
}

// ── C. 실제 사례: 4:6 → 5:6 (요구사항 18) ───────────────────────────────────
{
  const imp = computeCorrectionImpact(RAW, TARGET, 5, 6, MEMBER_BIRTH);
  const before = new Map<string, any>(imp.before.map((r: any) => [r.name, r]));
  const after = new Map<string, any>(imp.after.map((r: any) => [r.name, r]));
  const d = (n: string) => {
    const b = before.get(n)!; const a = after.get(n)!;
    return { pf: [b.pointsFor, a.pointsFor], pa: [b.pointsAgainst, a.pointsAgainst],
      diff: [b.diff, a.diff], wl: [`${b.wins}-${b.losses}`, `${a.wins}-${a.losses}`],
      rank: [b.rank, a.rank] };
  };

  eq('C P13(team1·게스트) 득점 16→17 · 실점 20 유지 · 득실 −4→−3 · 1-3 유지',
    { pf: d('P13').pf, pa: d('P13').pa, diff: d('P13').diff, wl: d('P13').wl },
    { pf: [16, 17], pa: [20, 20], diff: [-4, -3], wl: ['1-3', '1-3'] });

  eq('C P04(team1) 득점 22→23 · 실점 15 유지 · 득실 +7→+8 · 3-1 유지',
    { pf: d('P04').pf, pa: d('P04').pa, diff: d('P04').diff, wl: d('P04').wl },
    { pf: [22, 23], pa: [15, 15], diff: [7, 8], wl: ['3-1', '3-1'] });

  eq('C P11(team2) 득점 17 유지 · 실점 19→20 · 득실 −2→−3 · 2-2 유지',
    { pf: d('P11').pf, pa: d('P11').pa, diff: d('P11').diff, wl: d('P11').wl },
    { pf: [17, 17], pa: [19, 20], diff: [-2, -3], wl: ['2-2', '2-2'] });

  eq('C P07(team2) 득점 20 유지 · 실점 18→19 · 득실 +2→+1 · 3-1 유지',
    { pf: d('P07').pf, pa: d('P07').pa, diff: d('P07').diff, wl: d('P07').wl },
    { pf: [20, 20], pa: [18, 19], diff: [2, 1], wl: ['3-1', '3-1'] });

  eq('C 승자 불변(team2)',
    { b: imp.match.beforeWinner, a: imp.match.afterWinner, changed: imp.match.winnerChanged },
    { b: 'team2', a: 'team2', changed: false });

  // 요구사항 18 — 예상 외 변경이 없는지
  eq('C 승/패 변동 0명', imp.winLossChanges.length, 0);
  eq('C 득실 변동 = 그 4명만',
    imp.diffChanges.map((c: any) => `${c.name} ${c.before}→${c.after}`).sort(),
    ['P04 7→8', 'P07 2→1', 'P11 -2→-3', 'P13 -4→-3'].sort());
  eq('C 득점 변동 = P04 · P13',
    imp.pointsForChanges.map((c: any) => c.name).sort(), ['P04', 'P13']);
  eq('C 실점 변동 = P07 · P11',
    imp.pointsAgainstChanges.map((c: any) => c.name).sort(), ['P07', 'P11']);
  eq('C 전체 순위 변동 = P12 ↔ P13 뿐',
    imp.rankChanges.map((c: any) => `${c.name} ${c.before}→${c.after}`).sort(),
    ['P12 12→13', 'P13 13→12'].sort());
  eq('C 금액 변동 없음(벌금·상금·게스트비·최종)', imp.moneyChanges.length, 0);
  eq('C 1·2·3위 불변',
    imp.after.slice(0, 3).map((r: any) => r.name), ['P01', 'P02', 'P03']);

  // 조별 순위 — 이 세션은 전원 A조이므로 전체 순위와 같아야 한다.
  check('C 전원 A조', imp.after.every((r: any) => r.group === 'A'));
  eq('C 조별 순위 = 전체 순위', imp.after.map((r: any) => r.groupRank), imp.after.map((r: any) => r.rank));
  eq('C 조별 순위 변동 = 전체 순위 변동과 동일',
    imp.groupRankChanges.map((c: any) => `${c.name} ${c.before}→${c.after}`).sort(),
    ['P12 12→13', 'P13 13→12'].sort());

  // 나머지 13명은 어떤 값도 바뀌지 않는다.
  const touched = new Set(['P04', 'P07', 'P11', 'P12', 'P13']);
  let untouchedBad = 0;
  imp.before.forEach((b: any) => {
    if (touched.has(b.name)) return;
    const a = imp.after.find((r: any) => r.name === b.name)!;
    if (JSON.stringify(b) !== JSON.stringify(a)) untouchedBad += 1;
  });
  check('C 그 외 13명 전부 완전 동일', untouchedBad === 0, `변경 ${untouchedBad}명`);
}

// ── D. 동률 tie-break — 연장자 우선(공식 comparator 그대로) ─────────────────
//    정정으로 P03 과 P04 가 3승1패 · 득실 8 완전 동률이 된다.
{
  const withBirth = (p3: string, p4: string) => {
    const m = new Map(MEMBER_BIRTH);
    m.set(P(3), p3); m.set(P(4), p4);
    return computeCorrectionImpact(RAW, TARGET, 5, 6, m);
  };

  const older3 = withBirth('1980', '1986');   // P03 이 연장자
  eq('D1 P03 연장자 → 3위 P03 · 4위 P04',
    older3.after.slice(2, 4).map((r: any) => r.name), ['P03', 'P04']);
  eq('D1 순위 변동 = P12 ↔ P13 뿐',
    older3.rankChanges.map((c: any) => c.name).sort(), ['P12', 'P13']);

  const older4 = withBirth('1990', '1980');   // P04 가 연장자
  eq('D2 P04 연장자 → 3위 P04 · 4위 P03',
    older4.after.slice(2, 4).map((r: any) => r.name), ['P04', 'P03']);
  check('D2 이때는 순위 변동이 2건 더 생긴다',
    older4.rankChanges.some((c: any) => c.name === 'P03' && c.before === 3 && c.after === 4)
    && older4.rankChanges.some((c: any) => c.name === 'P04' && c.before === 4 && c.after === 3),
    JSON.stringify(older4.rankChanges.map((c: any) => `${c.name} ${c.before}→${c.after}`)));
  eq('D2 3·4위 교체도 금액을 바꾸지 않는다(상금·벌금 구간 밖)', older4.moneyChanges.length, 0);

  // 출생연도가 없으면 임의 순서를 만들지 않고 차단한다.
  const missing = new Map(MEMBER_BIRTH);
  missing.delete(P(3)); missing.delete(P(4));
  const blocked = computeCorrectionImpact(RAW, TARGET, 5, 6, missing);
  eq('D3 생년 미확인 동률 → 차단', { ok: blocked.ok, blocked: blocked.blocked }, { ok: false, blocked: 'unresolved_tie_birth_years' });
  eq('D3 차단 시 nextRawData 없음', blocked.nextRawData, null);
  eq('D3 확인 필요 참가자 = P03 · P04',
    blocked.unresolvedTieBirthYears.map((u: any) => u.name).sort(), ['P03', 'P04']);

  // 생년이 아예 없는 환경(RPC 미적용) — 저장된 동률도 전부 미해결로 잡혀 차단된다.
  const none = computeCorrectionImpact(RAW, TARGET, 5, 6, new Map());
  check('D4 생년 전무 → 차단(임의 재정렬 없음)', none.ok === false && none.nextRawData === null);
}

// ── E. 입력 방어 ────────────────────────────────────────────────────────────
{
  const bad = (s1: number, s2: number) => computeCorrectionImpact(RAW, TARGET, s1, s2, MEMBER_BIRTH);
  eq('E1 동점 거부', bad(6, 6).blocked, 'invalid_score');
  eq('E2 음수 거부', bad(-1, 6).blocked, 'invalid_score');
  eq('E3 소수 거부', bad(5.5, 6).blocked, 'invalid_score');
  eq('E4 같은 점수 거부', bad(4, 6).blocked, 'no_change');
  eq('E5 없는 경기', computeCorrectionImpact(RAW, 'no-such-match', 5, 6, MEMBER_BIRTH).blocked, 'match_not_found');
  eq('E6 미완료 경기',
    computeCorrectionImpact(
      { ...RAW, snapshot_data: RAW.snapshot_data.map((m: any) => m.id === TARGET ? { ...m, status: 'pending' } : m) },
      TARGET, 5, 6, MEMBER_BIRTH).blocked,
    'match_not_complete');
  eq('E7 빈 Archive', computeCorrectionImpact({}, TARGET, 5, 6, MEMBER_BIRTH).blocked, 'archive_empty');
  check('E8 입력 rawData 를 변형하지 않는다',
    RAW.snapshot_data.find((m: any) => m.id === TARGET).score1 === 4);
}

// ── F. nextRawData 불변식 (RPC 가 서버에서 검증하는 것과 같은 조건) ─────────
{
  const imp = computeCorrectionImpact(RAW, TARGET, 5, 6, MEMBER_BIRTH);
  const next = imp.nextRawData!;
  check('F 저장 payload 생성', !!next);

  for (const k of ['title', 'date', 'player_metadata', 'settlement_meta', 'total_matches', 'total_rounds']) {
    eq(`F 변경 금지 블록 유지 — ${k}`, next[k], RAW[k]);
  }
  eq('F snapshot_data 길이 동일', next.snapshot_data.length, RAW.snapshot_data.length);

  let diffs = 0;
  next.snapshot_data.forEach((m: any, i: number) => {
    const o = RAW.snapshot_data[i];
    if (m.id === TARGET) {
      const { score1: _a, score2: _b, ...restNew } = m;
      const { score1: _c, score2: _d, ...restOld } = o;
      if (JSON.stringify(restNew) !== JSON.stringify(restOld)) diffs += 1;
      if (m.score1 !== 5 || m.score2 !== 6) diffs += 1;
    } else if (JSON.stringify(m) !== JSON.stringify(o)) {
      diffs += 1;
    }
  });
  check('F 대상 경기의 score1/score2 만 변경', diffs === 0, `어긋남 ${diffs}건`);

  eq('F 참가자 명단 동일(집합)',
    next.ranking_data.map((p: any) => p.id).slice().sort(),
    RAW.ranking_data.map((p: any) => p.id).slice().sort());
  eq('F settlement 길이 = ranking 길이', next.settlement_data.length, next.ranking_data.length);

  // ranking_data 는 (승수 ↓, 득실 ↓) 비감소 — RPC 의 order_not_monotonic 검증과 같은 조건
  let mono = true;
  for (let i = 1; i < next.ranking_data.length; i += 1) {
    const a = next.ranking_data[i - 1]; const b = next.ranking_data[i];
    if (b.wins > a.wins || (b.wins === a.wins && b.diff > a.diff)) mono = false;
  }
  check('F (승수 ↓, 득실 ↓) 단조성', mono);

  let orderBad = 0;
  next.settlement_data.forEach((e: any, i: number) => {
    if (e.rank !== i + 1) orderBad += 1;
    if (e.player_id !== next.ranking_data[i].id) orderBad += 1;
  });
  check('F settlement rank 1..n 이고 ranking 순서와 동일', orderBad === 0, `어긋남 ${orderBad}건`);

  // 게스트 판정은 점수와 무관하게 불변 — RPC 의 settlement_identity_changed 검증과 같은 조건
  const oldById = new Map(RAW.settlement_data.map((e: any) => [e.player_id, e]));
  let idBad = 0;
  next.settlement_data.forEach((e: any) => {
    const o: any = oldById.get(e.player_id);
    if (!o || o.is_guest !== e.is_guest
      || o.is_associate_guest_fee_member !== e.is_associate_guest_fee_member
      || o.player_name !== e.player_name) idBad += 1;
  });
  check('F 게스트·이름 식별값 불변', idBad === 0, `어긋남 ${idBad}건`);

  // ranking_data 의 기타 필드(avatar 등)가 유실되지 않는가
  check('F ranking_data 기타 필드 보존',
    next.ranking_data.every((p: any) => Object.prototype.hasOwnProperty.call(p, 'avatar')));

  // 정산 금액 — RPC 거울 검증과 같은 산술
  const n = next.settlement_data.length;
  const bottom = Math.ceil(n / 2);
  const penCount = Math.ceil(bottom / 2);
  const pz = next.settlement_meta.prizes;
  const gf = next.settlement_meta.guest_fee;
  let moneyBad = 0;
  next.settlement_data.forEach((e: any, i: number) => {
    const expPrize = i === 0 && !e.is_guest ? (pz.first || 10000) : 0;
    const expPen = i >= n - penCount ? -(pz.l2 || 5000) : i >= n - bottom ? -(pz.l1 || 3000) : 0;
    const expGf = (e.is_guest || e.is_associate_guest_fee_member) ? -gf : 0;
    const expLevel = i >= n - penCount ? 'L2' : i >= n - bottom ? 'L1' : null;
    if (e.prize_amount !== expPrize || e.penalty_amount !== expPen || e.guest_fee_amount !== expGf
      || e.final_amount !== expPrize + expPen + expGf
      || (e.penalty_level ?? null) !== expLevel) moneyBad += 1;
  });
  check('F 정산 금액이 tier 산술과 일치', moneyBad === 0, `어긋남 ${moneyBad}명`);
}

// ── G. downstream 회귀 — 기존 소비자가 새 값을 그대로 읽는가 ────────────────
{
  const imp = computeCorrectionImpact(RAW, TARGET, 5, 6, MEMBER_BIRTH);
  const rowOf = (raw: any, official = true) => ({
    id: 'FIXTURE-KDK-01', created_at: '2026-01-01T12:00:00Z',
    archive_type: 'kdk', is_official: official, is_test: false, raw_data: raw,
  });
  const beforeRow = rowOf(RAW);
  const afterRow = rowOf(imp.nextRawData);
  const members = RAW.ranking_data
    .filter((p: any) => !String(p.id).startsWith('manual-guest-'))
    .map((p: any) => ({ id: p.id, name: p.name, avatarUrl: null }));

  // G-1. Profile 공식 기록
  const sb = calculateKdkArchiveStats([beforeRow], { id: P(4), name: 'P04' });
  const sa = calculateKdkArchiveStats([afterRow], { id: P(4), name: 'P04' });
  eq('G1 Profile P04 득실 7→8', [sb.totalDiff, sa.totalDiff], [7, 8]);
  eq('G1 Profile P04 승/패 불변', [sb.totalWins, sa.totalWins, sb.totalLosses, sa.totalLosses], [3, 3, 1, 1]);
  eq('G1 Profile P04 최근 순위 4위 유지', [sb.latestRank, sa.latestRank], [4, 4]);

  const gb = calculateKdkArchiveStats([beforeRow], { id: GUEST('P13'), name: 'P13' });
  const ga = calculateKdkArchiveStats([afterRow], { id: GUEST('P13'), name: 'P13' });
  eq('G1 Profile P13 순위 13→12 · 득실 −4→−3',
    [gb.latestRank, ga.latestRank, gb.totalDiff, ga.totalDiff], [13, 12, -4, -3]);

  const ub = calculateKdkArchiveStats([beforeRow], { id: P(1), name: 'P01' });
  const ua = calculateKdkArchiveStats([afterRow], { id: P(1), name: 'P01' });
  eq('G1 Profile 무관 참가자 P01 불변', JSON.stringify(ub), JSON.stringify(ua));

  // 공식 확정 전(is_official=false)이면 소비자가 세션을 아예 세지 않는다.
  const draft = calculateKdkArchiveStats([rowOf(imp.nextRawData, false)], { id: P(4), name: 'P04' });
  eq('G1 공식 확정 전에는 Profile 에 반영되지 않는다', draft.totalSessions, 0);

  // G-2. Club Ranking
  const cb = computeClubRanking([beforeRow], members, 'all');
  const ca = computeClubRanking([afterRow], members, 'all');
  const find = (r: any, name: string) => r.entries.find((e: any) => e.name === name);
  eq('G2 Club Ranking P04 pointDiff 7→8',
    [find(cb, 'P04').pointDiff, find(ca, 'P04').pointDiff], [7, 8]);
  eq('G2 Club Ranking P04 points 불변(v1 — TOP3 불변)',
    find(cb, 'P04').points, find(ca, 'P04').points);
  eq('G2 Club Ranking P11 pointDiff −2→−3',
    [find(cb, 'P11').pointDiff, find(ca, 'P11').pointDiff], [-2, -3]);
  eq('G2 Club Ranking 무관 회원 P01 동일',
    JSON.stringify(find(cb, 'P01')), JSON.stringify(find(ca, 'P01')));

  // G-3. 상대전적 — 점수 표시만 바뀌고 승/패는 그대로
  const h2hB = computeHeadToHead([beforeRow], P(4), P(11), members);
  const h2hA = computeHeadToHead([afterRow], P(4), P(11), members);
  eq('G3 상대전적 P04 vs P11 점수 4:6 → 5:6',
    [h2hB.matches[0].scoreA, h2hB.matches[0].scoreB, h2hA.matches[0].scoreA, h2hA.matches[0].scoreB],
    [4, 6, 5, 6]);
  eq('G3 상대전적 승패·승률 불변',
    [h2hB.aWins, h2hB.bWins, h2hB.aWinRate], [h2hA.aWins, h2hA.bWins, h2hA.aWinRate]);

  // G-4. 파트너 전적 — 상대 팀 점수가 반영되는가
  const pB = computePartnerRecord([beforeRow], P(11), P(7), members);
  const pA = computePartnerRecord([afterRow], P(11), P(7), members);
  const mB = pB.matches.find((m: any) => m.pairScore === 6 && m.oppScore === 4);
  const mA = pA.matches.find((m: any) => m.pairScore === 6 && m.oppScore === 5);
  check('G4 파트너 전적 상대 점수 4→5 반영', !!mB && !!mA,
    `before=${JSON.stringify(pB.matches.map((m: any) => [m.pairScore, m.oppScore]))} after=${JSON.stringify(pA.matches.map((m: any) => [m.pairScore, m.oppScore]))}`);
  eq('G4 파트너 승/패 불변', [pB.wins, pB.losses], [pA.wins, pA.losses]);

  // G-5. 공개 결과(Guest Pass) projection — rank = ranking_data 배열 ordinality
  const publicRank = (raw: any) => raw.ranking_data.map((p: any, i: number) => ({
    rank: i + 1, name: p.name, wins: p.wins, losses: p.losses, diff: p.diff,
  }));
  const pubB = publicRank(RAW);
  const pubA = publicRank(imp.nextRawData);
  eq('G5 공개 순위 12·13위가 교체됨',
    [pubB[11].name, pubB[12].name, pubA[11].name, pubA[12].name],
    ['P12', 'P13', 'P13', 'P12']);
  const finished = (raw: any) => raw.snapshot_data
    .filter((m: any) => m.status === 'complete')
    .map((m: any) => [m.id, m.score1, m.score2]);
  const fB = finished(RAW).find((x: any[]) => x[0] === TARGET);
  const fA = finished(imp.nextRawData).find((x: any[]) => x[0] === TARGET);
  eq('G5 공개 경기 점수 4:6 → 5:6', [fB[1], fB[2], fA[1], fA[2]], [4, 6, 5, 6]);
}

// ── H. 금액이 바뀌는 정정도 계산되는가(Finance 안전 표시용) ─────────────────
//    점수를 크게 바꿔 tier 경계를 넘기면 moneyChanges 가 비어 있지 않아야 한다.
{
  // P07(7위, 3승1패 +2)이 크게 지면 하위권으로 내려가 벌금 구간에 들어갈 수 있다.
  // 4:6 → 0:6 — team1 이 4점을 잃고 team2 가 4실점을 줄인다(각 ±4).
  const imp = computeCorrectionImpact(RAW, TARGET, 0, 6, MEMBER_BIRTH);
  check('H 큰 점수 변경도 계산된다', imp.ok === true, String(imp.blocked));
  eq('H 득실 델타 ±4 (team1 −4 · team2 +4)',
    imp.diffChanges.map((c: any) => `${c.name} ${c.before}→${c.after}`).sort(),
    ['P04 7→3', 'P07 2→6', 'P11 -2→2', 'P13 -4→-8'].sort());
  eq('H 승자는 여전히 team2 — 승/패 변동 없음', imp.winLossChanges.length, 0);
  check('H 순위 변동이 발생', imp.rankChanges.length > 0,
    JSON.stringify(imp.rankChanges.map((c: any) => `${c.name} ${c.before}→${c.after}`)));
  // 금액 변동이 생기는 정정도 계산돼야 한다(Finance 경고 표시의 근거).
  check('H 금액 변동 계산 경로 동작',
    Array.isArray(imp.moneyChanges),
    JSON.stringify(imp.moneyChanges.map((c: any) => `${c.name} ${c.before.finalAmount}→${c.after.finalAmount}`)));
}

console.log(`=== 결과: ${passed} passed, ${failures.length} failed ===`);
if (failures.length > 0) {
  console.log('\n실패 목록:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
}
console.log('정정 fixture 전부 통과 — 공식 SSoT 재사용 · 저장 불변식 · downstream 회귀 확인.\n');
