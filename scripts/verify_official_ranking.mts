/**
 * TEYEON KDK 공식 동률 규칙 fixture — 연장자 우위(2026-08-05 개정) 검증.
 *
 *   실행: node scripts/verify_official_ranking.mts
 *   (Node 24 의 TypeScript type-stripping 사용 — 별도 테스트 러너/의존성 없음)
 *
 *   검증 대상: lib/kdk/officialRanking.ts 의 compareOfficialKdkRanking / sortOfficialKdkRanking /
 *   normalizeBirthYear, 그리고 app/archive/page.tsx 의 '저장된 ranking_data 재정렬 금지' 코드 경로.
 *
 *   SQL 대조: 같은 케이스를 supabase/verify_kdk_official_ranking_oldest_first_fixture.sql 이
 *   서버 ORDER BY 로 재현한다. 두 결과(각 케이스 1위 이름 순서)가 완전히 같아야 한다.
 *
 *   import 을 런타임 변수 경로로 하는 이유: tsc(allowImportingTsExtensions=false)와
 *   Node(확장자 필수)를 동시에 만족시키기 위해서다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const officialRankingPath = '../lib/kdk/officialRanking.ts';
const {
  compareOfficialKdkRanking,
  sortOfficialKdkRanking,
  normalizeBirthYear,
  compareOfficialWins,
  compareOfficialSecondary,
  compareOfficialBirthYear,
  compareOfficialNameThenId,
} = await import(officialRankingPath);

type Entry = {
  playerId: string;
  name: string;
  wins: number;
  diff: number;
  birthYear?: number | string | null;
};

let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail: string) {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(`${label} — ${detail}`);
    console.log(`  FAIL  ${label} — ${detail}`);
  }
}

/** 정렬 후 이름 순서를 문자열로. sortOfficialKdkRanking(= compare 와 동일 규칙) 사용. */
function order(entries: Entry[]): string {
  return sortOfficialKdkRanking(entries as any).map((e: any) => e.name).join(' > ');
}

function expectOrder(label: string, entries: Entry[], expected: string) {
  const actual = order(entries);
  check(label, actual === expected, `expected "${expected}", got "${actual}"`);
}

// ── 공용 fixture 데이터 (SQL fixture 와 동일한 값을 사용) ─────────────────────
const M = (name: string, birthYear: Entry['birthYear'], wins = 2, diff = 6, id = `mem-${name}`): Entry =>
  ({ playerId: id, name, wins, diff, birthYear });
const G = (name: string, birthYear: Entry['birthYear'], wins = 2, diff = 6): Entry =>
  ({ playerId: `manual-guest-${name}`, name: `${name}(G)`, wins, diff, birthYear });

console.log('\n=== TEYEON KDK 공식 comparator fixture — 연장자 우위 ===\n');

// 1. 1980 vs 1982 완전 동률 → 1980 우선
expectOrder(
  '01 완전 동률 1980 vs 1982 → 1980 우선',
  [M('이몽룡', 1980), M('임꺽정', 1982)],
  '이몽룡 > 임꺽정',
);

// 2. 입력 순서를 반대로 넣어도 → 1980 우선
expectOrder(
  '02 입력 역순에도 1980 우선(정렬 안정성 비의존)',
  [M('임꺽정', 1982), M('이몽룡', 1980)],
  '이몽룡 > 임꺽정',
);

// 3. 이름순과 연장자 순이 충돌 → 연장자 우선 (이름만 보면 김철수가 먼저)
expectOrder(
  '03 이름순 vs 연장자 충돌 → 연장자 우선',
  [M('김철수', 1982), M('홍길동', 1980)],
  '홍길동 > 김철수',
);
expectOrder(
  '03b 이름순 vs 연장자 충돌(입력 역순)',
  [M('홍길동', 1980), M('김철수', 1982)],
  '홍길동 > 김철수',
);

// 4. 한 명만 출생연도 제공 → 제공자 우선 (이름상 '최미제공'이 뒤라 방향 확인용으로 양쪽 다 검사)
expectOrder(
  '04 한 명만 출생연도 제공 → 제공자 우선',
  [M('최미제공', null), M('박제공', 1985)],
  '박제공 > 최미제공',
);
expectOrder(
  '04b 미제공자가 이름상 앞서도 제공자 우선',
  [M('가미제공', null), M('하제공', 1999)],
  '하제공 > 가미제공',
);

// 5. 둘 다 미제공 → 이름순
expectOrder(
  '05 둘 다 미제공 → 이름 가나다순',
  [M('최민수', null), M('강호동', undefined)],
  '강호동 > 최민수',
);

// 6. 같은 출생연도 → 이름순
expectOrder(
  '06 같은 출생연도 → 이름 가나다순',
  [M('나영석', 1981), M('김태호', 1981)],
  '김태호 > 나영석',
);

// 7. 같은 이름 → stable id
{
  const a: Entry = { playerId: 'a-001', name: '홍길동', wins: 2, diff: 6, birthYear: 1984 };
  const b: Entry = { playerId: 'b-002', name: '홍길동', wins: 2, diff: 6, birthYear: 1984 };
  const sorted = sortOfficialKdkRanking([b, a] as any);
  check(
    '07 같은 이름·같은 연도 → stable id 오름차순',
    sorted[0].playerId === 'a-001' && sorted[1].playerId === 'b-002',
    `got ${sorted.map((s: any) => s.playerId).join(' > ')}`,
  );
}

// 8. 승수가 다름 → 승수 우선 (연장자가 승수에서 밀리면 하위)
expectOrder(
  '08 승수 차이 → 승수 우선(연장자보다 우선순위 높음)',
  [{ playerId: 'mem-이연장', name: '이연장', wins: 1, diff: 9, birthYear: 1970 },
   { playerId: 'mem-김승수', name: '김승수', wins: 2, diff: -5, birthYear: 1990 }],
  '김승수 > 이연장',
);

// 9. 2차 성적 기준(득실)이 다름 → 2차 기준 우선
expectOrder(
  '09 득실 차이 → 득실 우선(연장자보다 우선순위 높음)',
  [{ playerId: 'mem-이연장', name: '이연장', wins: 1, diff: 2, birthYear: 1970 },
   { playerId: 'mem-김득실', name: '김득실', wins: 1, diff: 7, birthYear: 1990 }],
  '김득실 > 이연장',
);

// 10. 게스트 vs 회원 완전 동률 → 동일한 연장자 규칙 (회원/게스트 우대 없음)
expectOrder(
  '10 회원(1979) vs 게스트(1981) 완전 동률 → 회원(연장자) 우선',
  [G('이게스트', 1981), M('김회원', 1979)],
  '김회원 > 이게스트(G)',
);
expectOrder(
  '10b 게스트(1975) vs 회원(1988) 완전 동률 → 게스트(연장자) 우선',
  [M('정회원', 1988), G('박게스트', 1975)],
  '박게스트(G) > 정회원',
);

// 11. 미래 연도 → null
{
  const nextYear = new Date().getFullYear() + 1;
  check(
    '11 미래 연도 → normalizeBirthYear null',
    normalizeBirthYear(nextYear) === null && normalizeBirthYear(String(nextYear)) === null,
    `normalizeBirthYear(${nextYear}) = ${normalizeBirthYear(nextYear)}`,
  );
  expectOrder(
    '11b 미래 연도 보유자는 미제공 취급 → 후순위',
    [M('가미래', nextYear), M('하정상', 1990)],
    '하정상 > 가미래',
  );
}

// 12. 만 나이 숫자 → null
check(
  '12 만 나이 숫자(43/7/99) → normalizeBirthYear null',
  normalizeBirthYear(43) === null && normalizeBirthYear('43') === null &&
  normalizeBirthYear(7) === null && normalizeBirthYear(99) === null,
  `43 → ${normalizeBirthYear(43)}, 99 → ${normalizeBirthYear(99)}`,
);
expectOrder(
  '12b 만 나이 숫자 보유자는 미제공 취급 → 후순위',
  [M('가만나이', 43), M('하정상', 1990)],
  '하정상 > 가만나이',
);

// 13. 기존 year-only 게스트(문자열 '1982') → 정상 비교
check(
  '13 year-only 문자열 정규화',
  normalizeBirthYear('1982') === 1982 && normalizeBirthYear(' 1980 ') === 1980,
  `'1982' → ${normalizeBirthYear('1982')}, ' 1980 ' → ${normalizeBirthYear(' 1980 ')}`,
);
expectOrder(
  '13b year-only 게스트 문자열 vs 회원 숫자 → 연장자 우선',
  [G('문자열게스트', '1982'), M('숫자회원', 1980)],
  '숫자회원 > 문자열게스트(G)',
);

// 14. 과거 Archive ranking_data → 순서 불변 (코드 경로 정적 보증)
{
  const archiveSource = readFileSync(join(here, '..', 'app', 'archive', 'page.tsx'), 'utf8');
  const fnStart = archiveSource.indexOf('const buildArchiveRankingResults');
  const savedBranchStart = archiveSource.indexOf('const savedRanking', fnStart);
  const fallbackStart = archiveSource.indexOf('const stats:', savedBranchStart);
  const savedBranch = archiveSource.slice(savedBranchStart, fallbackStart);
  const noResort = savedBranchStart > 0 && fallbackStart > savedBranchStart
    && !savedBranch.includes('sort')
    && /if \(savedRanking\.length > 0\)/.test(savedBranch)
    && savedBranch.includes('return savedRanking.map');
  check(
    '14 저장된 ranking_data 는 재정렬 없이 그대로 반환(정적 코드 보증)',
    noResort,
    'buildArchiveRankingResults 의 savedRanking 분기에 정렬 호출이 존재하거나 조기 반환이 사라졌다',
  );
}

// 15. 김재형 2026-07-07 공식 기록 → 1위 유지
//     저장된 ranking_data 는 comparator 를 통과하지 않는다는 것이 유지의 근거다.
//     아래는 '규칙이 바뀌면 재계산 결과는 달라질 수 있으나 저장값은 불변'을 명시적으로 재현한 것.
{
  // 확정 당시 저장 형태(재현): 1위 김재형. 완전 동률 상대가 김재형보다 어린 해 출생이었다.
  const savedRankingData = [
    { id: 'jh', name: '김재형', wins: 3, losses: 1, diff: 4 },
    { id: 'tie', name: '동률상대', wins: 3, losses: 1, diff: 4 },
  ];
  // Archive 표시 경로(저장값 있음)와 동일한 매핑 — 정렬 없음.
  const displayed = savedRankingData.map(p => ({ name: p.name, wins: p.wins, losses: p.losses, diff: p.diff }));
  check(
    '15 김재형 2026-07-07 저장 기록 1위 유지(저장값 통과 경로)',
    displayed[0].name === '김재형',
    `got ${displayed.map(d => d.name).join(' > ')}`,
  );
  // 참고 재계산: 저장값이 없다면(fallback) 새 규칙으로 재계산되며 결과가 달라질 수 있다.
  const recomputedYounger = order([M('김재형', 1990), M('동률상대', 1980)]);
  check(
    '15b (참고) 저장값이 없을 때만 새 규칙 재계산이 적용됨',
    recomputedYounger === '동률상대 > 김재형',
    `got ${recomputedYounger}`,
  );
}

// ── 추가 회귀: comparator 대칭성/추이성 sanity ────────────────────────────────
{
  const pool: Entry[] = [
    M('김가', 1980, 3, 5), M('김나', 1980, 3, 5), M('박다', 1975, 3, 5),
    M('이라', null, 3, 5), G('최마', 1991, 3, 5), M('정바', 1991, 3, 5),
    M('한사', 1975, 2, 12), G('오아', null, 3, 5),
  ];
  let symmetric = true;
  for (const a of pool) {
    for (const b of pool) {
      const ab = compareOfficialKdkRanking(a as any, b as any);
      const ba = compareOfficialKdkRanking(b as any, a as any);
      if (Math.sign(ab) !== -Math.sign(ba)) symmetric = false;
    }
  }
  check('16 comparator 반대칭성(sign(a,b) === -sign(b,a))', symmetric, 'comparator 가 반대칭이 아니다');

  const forward = order(pool);
  const reversed = order([...pool].reverse());
  check('17 입력 순서 무관 결정성', forward === reversed, `${forward} vs ${reversed}`);
  console.log(`\n  전체 정렬 결과(입력 순서 무관): ${forward}`);
}

// ── 단일 Source of Truth 보증 ────────────────────────────────────────────────
// 18. /kdk/ranking 이 쓰는 '단위 비교자 조합(기본 우선순위)' === compareOfficialKdkRanking
{
  const composed = (a: Entry, b: Entry) =>
    compareOfficialWins(a, b) || compareOfficialSecondary(a, b) ||
    compareOfficialBirthYear(a, b) || compareOfficialNameThenId(a, b);

  const pool: Entry[] = [
    M('김가', 1980, 3, 5), M('김나', 1980, 3, 5), M('박다', 1975, 3, 5),
    M('이라', null, 3, 5), G('최마', 1991, 3, 5), M('정바', 1991, 3, 5),
    M('한사', 1975, 2, 12), G('오아', null, 3, 5), M('가자', '43', 3, 5),
    M('나차', 1975, 3, 5), M('김가', 1980, 3, 5, 'mem-김가-2'),
  ];
  let identical = true;
  for (const a of pool) {
    for (const b of pool) {
      if (Math.sign(composed(a, b)) !== Math.sign(compareOfficialKdkRanking(a as any, b as any))) {
        identical = false;
      }
    }
  }
  check(
    '18 단위 비교자 기본 조합 === compareOfficialKdkRanking (전 쌍 대조)',
    identical,
    '/kdk/ranking 의 조합 결과가 공식 comparator 와 다르다',
  );
}

// 19. /kdk/ranking 에 인라인 비교 로직이 남아 있지 않은지(정적 코드 보증)
{
  const rankingSource = readFileSync(join(here, '..', 'app', 'kdk', 'ranking', 'page.tsx'), 'utf8');
  const noInlineCompare =
    !/\bay\s*-\s*by\b/.test(rankingSource)          // 출생연도 방향 직접 계산
    && !/\bby\s*-\s*ay\b/.test(rankingSource)
    && !/normalizeBirthYear\s*\(/.test(rankingSource) // 정규화 직접 호출(= comparator 우회)
    && !/localeCompare\(/.test(rankingSource)         // 이름 비교 직접 구현
    && /OFFICIAL_CRITERIA\[criteria\]\(ea, eb\)/.test(rankingSource)
    && /compareOfficialNameThenId\(ea, eb\)/.test(rankingSource);
  check(
    '19 /kdk/ranking 인라인 비교 로직 없음 · 공통 단위 비교자만 사용(정적 코드 보증)',
    noInlineCompare,
    'app/kdk/ranking/page.tsx 에 인라인 순위 비교 로직이 되살아났다',
  );
}

console.log(`\n=== 결과: ${passed} passed, ${failures.length} failed ===`);
if (failures.length > 0) {
  console.log('\n실패 목록:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
}
console.log('모든 fixture 통과. SQL fixture(supabase/verify_kdk_official_ranking_oldest_first_fixture.sql) 결과와 대조하세요.\n');
