/**
 * TEYEON KDK 집계 SSoT 추출 회귀 fixture.
 *
 *   실행: node scripts/verify_kdk_aggregate.mts
 *   (Node 24 의 TypeScript type-stripping 사용 — 별도 테스트 러너/의존성 없음)
 *
 *   목적: lib/kdk/aggregate.ts 로 추출한 집계가 **추출 이전 hooks/useRanking.ts 의
 *   인라인 구현과 완전히 동일한 결과**를 내는지 고정한다. 이 파일의 referenceAggregate 는
 *   추출 직전 커밋의 코드를 **그대로 복사**한 것이며 고치면 안 된다(기준선 역할).
 *
 *   회귀 범위: LIVE KDK · Special Match · Archive 정정이 모두 같은 helper 를 쓰므로,
 *   여기서 통과하면 세 경로의 승/패·득점·실점·득실이 과거와 같다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const aggregatePath = '../lib/kdk/aggregate.ts';
const { aggregateKdkPlayerStats } = await import(aggregatePath);

let passed = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, info = '') => {
  if (cond) passed += 1;
  else failures.push(`${name}${info ? ` — ${info}` : ''}`);
};

// ── 기준선: 추출 직전 hooks/useRanking.ts 의 인라인 구현(그대로 복사) ──────────
//    ⚠ 이 함수는 수정하지 않는다. 새 helper 가 여기에 맞춰야 한다.
interface RefStats { wins: number; losses: number; diff: number; games: number; pf: number; pa: number }
function referenceAggregate(matches: any[]): { stats: Record<string, RefStats>; nameLookup: Record<string, string> } {
  const res: Record<string, RefStats> = {};
  const nameMap: Record<string, string> = {};

  matches?.forEach(m => {
    if (m?.playerIds && m?.player_names) {
      m.playerIds.forEach((pid: string, idx: number) => {
        const pName = m.player_names?.[idx];
        if (pName && !pName.startsWith('g-')) {
          nameMap[pid] = pName;
        }
      });
    }

    if (m?.status !== 'complete') return;
    if (Number(m?.score1 || 0) === Number(m?.score2 || 0)) return;

    m?.playerIds?.forEach((pid: string, idx: number) => {
      if (!res[pid]) res[pid] = { wins: 0, losses: 0, diff: 0, games: 0, pf: 0, pa: 0 };
      const isTeam1 = idx < 2;
      const score1 = Number(m?.score1 || 0);
      const score2 = Number(m?.score2 || 0);
      const win = isTeam1 ? (score1 > score2) : (score2 > score1);
      const d = isTeam1 ? (score1 - score2) : (score2 - score1);

      res[pid].games += 1;
      res[pid].pf += isTeam1 ? score1 : score2;
      res[pid].pa += isTeam1 ? score2 : score1;
      if (win) res[pid].wins += 1;
      else res[pid].losses += 1;
      res[pid].diff += d;
    });
  });
  return { stats: res, nameLookup: nameMap };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function compare(label: string, matches: any[]) {
  const ref = referenceAggregate(matches);
  const got = aggregateKdkPlayerStats(matches);
  check(`${label} — stats 동일`, same(ref.stats, got.stats),
    `ref=${JSON.stringify(ref.stats)} got=${JSON.stringify(got.stats)}`);
  check(`${label} — nameLookup 동일`, same(ref.nameLookup, got.nameLookup),
    `ref=${JSON.stringify(ref.nameLookup)} got=${JSON.stringify(got.nameLookup)}`);
}

const M = (o: Partial<{
  status: string; score1: number | string; score2: number | string;
  playerIds: string[]; player_names: string[];
}>) => ({
  status: 'complete', score1: 6, score2: 3,
  playerIds: ['a', 'b', 'c', 'd'],
  player_names: ['A', 'B', 'C', 'D'],
  ...o,
});

console.log('=== KDK aggregate 추출 회귀 fixture ===\n');

// A. 실제 세션과 같은 구조(익명화 fixture, 18경기 18명)
{
  const raw = JSON.parse(readFileSync(join(here, 'fixtures/kdk-correction-session.json'), 'utf8'));
  // LIVE 모양(playerIds) 과 Archive 모양(player_ids) 둘 다 들어 있는 데이터다.
  compare('A 실세션 구조 18경기', raw.snapshot_data);

  // 참가자 18명 전원이 집계에 나타나는가
  const got = aggregateKdkPlayerStats(raw.snapshot_data);
  check('A 집계 대상 18명', Object.keys(got.stats).length === 18, String(Object.keys(got.stats).length));

  // 저장된 ranking_data 와 승/패·득실이 일치하는가(= 추출이 값을 바꾸지 않았다)
  let bad = 0;
  for (const p of raw.ranking_data) {
    const s = got.stats[p.id];
    if (!s || s.wins !== p.wins || s.losses !== p.losses || s.diff !== p.diff) bad += 1;
  }
  check('A 저장된 ranking_data 와 완전 일치', bad === 0, `불일치 ${bad}명`);

  // 저장된 settlement_data 의 득점/실점과도 일치하는가
  let badSet = 0;
  for (const e of raw.settlement_data) {
    const s = got.stats[e.player_id];
    if (!s || s.pf !== e.points_for || s.pa !== e.points_against || s.diff !== e.diff) badSet += 1;
  }
  check('A 저장된 settlement_data 득점·실점 일치', badSet === 0, `불일치 ${badSet}명`);
}

// B. 경계 — 미완료 / 동점 / 빈 입력
compare('B1 빈 배열', []);
compare('B2 pending 경기만', [M({ status: 'pending' })]);
compare('B3 동점 경기(집계 제외)', [M({ score1: 6, score2: 6 })]);
compare('B4 0:0 (동점 — 제외)', [M({ score1: 0, score2: 0 })]);
compare('B5 완료+pending 혼합', [M({}), M({ status: 'pending', score1: 6, score2: 0 })]);
compare('B6 팀2 승리', [M({ score1: 2, score2: 6 })]);
compare('B7 점수 문자열', [M({ score1: '6' as any, score2: '4' as any })]);
compare('B8 점수 null', [M({ score1: null as any, score2: 6 as any })]);

// C. 이름 복구 map — 'g-' 접두 제외 규칙
compare('C1 g- 접두 이름 제외', [M({ player_names: ['A', 'g-xxx', 'C', 'D'] })]);
compare('C2 player_names 없음', [{ status: 'complete', score1: 6, score2: 1, playerIds: ['a', 'b', 'c', 'd'] }]);
compare('C3 pending 에서도 이름은 모은다', [M({ status: 'pending', player_names: ['A', 'B', 'C', 'D'] })]);

// D. 같은 선수가 여러 경기 — 누적
compare('D 누적 4경기', [
  M({ playerIds: ['a', 'b', 'c', 'd'], score1: 6, score2: 3 }),
  M({ playerIds: ['a', 'c', 'b', 'd'], score1: 2, score2: 6 }),
  M({ playerIds: ['d', 'a', 'b', 'c'], score1: 6, score2: 5 }),
  M({ playerIds: ['b', 'c', 'a', 'd'], score1: 1, score2: 6 }),
]);

// E. Archive 전용 모양(player_ids 만) — 기준 구현은 playerIds 만 보므로 집계가 0이다.
//    새 helper 는 Archive 정정을 위해 player_ids 를 폴백으로 읽는다(의도된 **확장**).
//    ⚠ LIVE/Special 경로는 항상 playerIds 를 채우므로 기존 동작에 영향이 없다.
{
  const archiveOnly = [{
    status: 'complete', score1: 6, score2: 2,
    player_ids: ['a', 'b', 'c', 'd'],
    player_names: ['A', 'B', 'C', 'D'],
  }];
  const ref = referenceAggregate(archiveOnly as any);
  const got = aggregateKdkPlayerStats(archiveOnly as any);
  check('E 기준 구현은 player_ids 를 읽지 않는다(0명)', Object.keys(ref.stats).length === 0);
  check('E 새 helper 는 Archive 모양도 읽는다(4명)', Object.keys(got.stats).length === 4,
    String(Object.keys(got.stats).length));
  check('E 이 확장은 playerIds 가 있을 때 결과를 바꾸지 않는다',
    same(
      referenceAggregate([{ ...archiveOnly[0], playerIds: ['a', 'b', 'c', 'd'] }] as any).stats,
      aggregateKdkPlayerStats([{ ...archiveOnly[0], playerIds: ['a', 'b', 'c', 'd'] }] as any).stats,
    ));
}

console.log(`=== 결과: ${passed} passed, ${failures.length} failed ===`);
if (failures.length > 0) {
  console.log('\n실패 목록:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
}
console.log('집계 추출 회귀 fixture 전부 통과 — LIVE KDK 계산 결과 불변.\n');
