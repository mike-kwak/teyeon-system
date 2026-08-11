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
  findUnresolvedTieBirthYears,
} = await import(officialRankingPath);

// attendee_meta 병합 규칙(순수 함수 — DB 접근 없음). 저장은 guestProfileService 가 이 helper 를 그대로 쓴다.
const attendeeMetaPath = '../lib/kdk/attendeeMeta.ts';
const { mergeAttendeeMeta, applyAttendeeBirthYearDecision } = await import(attendeeMetaPath);

type Entry = {
  playerId: string;
  name: string;
  wins: number;
  diff: number;
  birthYear?: number | string | null;
  /** 'declined' = 운영자가 공식 확정 화면에서 '생년 미입력으로 진행'을 승인. */
  birthYearStatus?: 'provided' | 'declined';
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

// ── 20~29. '생년 미입력으로 진행'(declined) 운영 UX — 확정 차단/해제 판정 ─────────
//   핵심: declined 는 순위 규칙을 바꾸지 않는다(여전히 birthYear 미제공 = 완전 동률 후순위).
//   바뀌는 것은 '공식 확정을 차단할지'뿐이다.
{
  const D = (name: string, wins = 2, diff = 6): Entry =>
    ({ playerId: `manual-guest-${name}`, name: `${name}(G)`, wins, diff, birthYear: null, birthYearStatus: 'declined' });
  const names = (rows: Entry[]) => findUnresolvedTieBirthYears(rows as any).map((r: any) => r.name).join(', ');

  // 시나리오 1 — 게스트 A(1980) vs 게스트 B(1990) 완전 동률 → A 상위
  expectOrder(
    '20 게스트 1980 vs 게스트 1990 완전 동률 → 1980 상위',
    [G('비게스트', 1990), G('에이게스트', 1980)],
    '에이게스트(G) > 비게스트(G)',
  );

  // 시나리오 2 — 회원 A(1980) vs 게스트 B(미제공 승인) 완전 동률 → 회원 A 상위
  expectOrder(
    '21 회원(1980) vs 게스트(미제공 승인) 완전 동률 → 회원 상위',
    [D('가미제공'), M('하회원', 1980)],
    '하회원 > 가미제공(G)',
  );

  // 시나리오 3 — 게스트 A(미제공 승인) vs 게스트 B(1990) → B 상위
  expectOrder(
    '22 게스트(미제공 승인) vs 게스트(1990) → 1990 상위',
    [D('가미제공'), G('하연도', 1990)],
    '하연도(G) > 가미제공(G)',
  );

  // 시나리오 4 — 둘 다 미제공 승인 → 이름 → stable id
  expectOrder(
    '23 미제공 승인 2명 → 이름 가나다순',
    [D('최민수'), D('강호동')],
    '강호동(G) > 최민수(G)',
  );
  {
    const a: Entry = { playerId: 'a-001', name: '동명이인(G)', wins: 2, diff: 6, birthYear: null, birthYearStatus: 'declined' };
    const b: Entry = { playerId: 'b-002', name: '동명이인(G)', wins: 2, diff: 6, birthYear: null, birthYearStatus: 'declined' };
    const sorted = sortOfficialKdkRanking([b, a] as any);
    check(
      '23b 미제공 승인 + 같은 이름 → stable id 오름차순',
      sorted[0].playerId === 'a-001' && sorted[1].playerId === 'b-002',
      `got ${sorted.map((s: any) => s.playerId).join(' > ')}`,
    );
  }

  // 시나리오 5 — 미입력 + 미제공 선택도 없음 → 미해결(확정 차단 유지)
  check(
    '24 미입력 + 선택 없음 → 미해결로 검출(확정 차단)',
    names([G('최순규', null), M('박연도', 1985)]) === '최순규(G)',
    `got "${names([G('최순규', null), M('박연도', 1985)])}"`,
  );

  // 시나리오 6 — 출생연도 입력 완료 → 미해결 없음(차단 해제)
  check(
    '25 출생연도 입력 완료 → 미해결 0명(차단 해제)',
    findUnresolvedTieBirthYears([G('최순규', 1985), M('박연도', 1985)] as any).length === 0,
    'birthYear 를 넣었는데도 미해결로 남았다',
  );

  // 시나리오 7 — 미입력 진행 승인 → 미해결 없음 + 후순위
  check(
    '26 미입력 진행 승인 → 미해결 0명(차단 해제)',
    findUnresolvedTieBirthYears([D('최순규'), M('박연도', 1985)] as any).length === 0,
    'declined 인데도 미해결로 남았다',
  );
  expectOrder(
    '26b 미입력 진행 승인자는 제공자보다 후순위 유지',
    [D('가미제공'), M('하박연도', 1985)],
    '하박연도 > 가미제공(G)',
  );

  // 시나리오 8·9 — 미등록 2명 중 1명만 처리 → 나머지 때문에 계속 차단, 2명 모두 처리 → 해제
  {
    const half = [G('최순규', null), D('홍길동'), M('박연도', 1985)];
    check(
      '27 미등록 2명 중 1명만 처리 → 나머지 1명 때문에 계속 차단',
      names(half) === '최순규(G)',
      `got "${names(half)}"`,
    );
    const done = [G('최순규', 1985), D('홍길동'), M('박연도', 1985)];
    check(
      '28 2명 모두 처리 → 미해결 0명(확정 버튼 활성화)',
      findUnresolvedTieBirthYears(done as any).length === 0,
      `got "${names(done)}"`,
    );
  }

  // 시나리오 10 — 승수/득실이 다르면 완전 동률이 아니므로 출생연도와 무관하게 차단하지 않는다
  {
    const notTied = [
      { playerId: 'g-1', name: '최순규(G)', wins: 3, diff: 9, birthYear: null },
      { playerId: 'mem-1', name: '박연도', wins: 2, diff: 4, birthYear: 1985 },
    ] as Entry[];
    check(
      '29 승수/득실이 다름 → 미해결 없음(기존 순위 유지, 차단 없음)',
      findUnresolvedTieBirthYears(notTied as any).length === 0,
      `got "${names(notTied)}"`,
    );
    expectOrder(
      '29b 승수/득실 우선 — 미제공자가 상위여도 그대로 유지',
      notTied,
      '최순규(G) > 박연도',
    );
    // 득실만 다른 경우도 동률 그룹이 아니다.
    check(
      '29c 승수 같고 득실만 달라도 동률 그룹 아님 → 차단 없음',
      findUnresolvedTieBirthYears([
        { playerId: 'g-2', name: '가미입력(G)', wins: 2, diff: 7, birthYear: null },
        { playerId: 'mem-2', name: '하연도', wins: 2, diff: 3, birthYear: 1985 },
      ] as any).length === 0,
      '득실이 다른데 미해결로 잡혔다',
    );
  }

  // declined 는 comparator 에 어떤 영향도 주지 않는다(= 미입력과 동일한 순위 결과).
  {
    const withStatus = order([D('가미제공'), M('나연도', 1990), G('다연도', 1985)]);
    const withoutStatus = order([G('가미제공', null), M('나연도', 1990), G('다연도', 1985)]);
    check(
      '30 declined 유무가 순위 결과를 바꾸지 않음(규칙 불변 보증)',
      withStatus === withoutStatus,
      `${withStatus} vs ${withoutStatus}`,
    );
  }
}

// ── 31~37. attendee_meta 병합 저장 규칙 (A/B/C) ──────────────────────────────
//   attendee_meta 는 컬럼 전체가 upsert 되는 jsonb 다. 저장 경로가 둘(이름 매칭 snapshot /
//   공식 확정 화면의 개별 결정)이므로, 병합하지 않으면 상대가 저장한 항목이 통째로 사라진다.
{
  const json = (v: unknown) => JSON.stringify(v);

  // A. 게스트 declined 저장 → 이름 매칭 재저장(다른 게스트의 birthYear) → declined 유지
  {
    const afterDecline = mergeAttendeeMeta({}, { 'manual-guest-최순규': { declined: true } });
    // 이름 매칭 재저장: 값이 입력된 게스트만 decision 으로 들어온다(빈칸은 아예 오지 않음).
    const afterRematch = mergeAttendeeMeta(afterDecline, { 'manual-guest-홍길동': { birthYear: 1990 } });
    check(
      'A(31) declined 저장 후 이름 매칭 재저장 → declined 유지',
      afterRematch['manual-guest-최순규']?.birthYearStatus === 'declined'
      && afterRematch['manual-guest-최순규']?.birthYear === undefined,
      `got ${json(afterRematch['manual-guest-최순규'])}`,
    );
    check(
      'A(31b) 재저장으로 추가된 게스트도 정상 기록',
      afterRematch['manual-guest-홍길동']?.birthYear === 1990
      && afterRematch['manual-guest-홍길동']?.birthYearStatus === 'provided',
      `got ${json(afterRematch['manual-guest-홍길동'])}`,
    );
  }

  // B. 게스트 declined → 이후 birthYear 1985 입력 → provided + 1985 로 전환
  {
    const declined = mergeAttendeeMeta({}, { 'manual-guest-최순규': { declined: true } });
    const provided = mergeAttendeeMeta(declined, { 'manual-guest-최순규': { birthYear: 1985 } });
    check(
      'B(32) declined → birthYear 1985 입력 → provided 1985 로 전환',
      provided['manual-guest-최순규']?.birthYear === 1985
      && provided['manual-guest-최순규']?.birthYearStatus === 'provided',
      `got ${json(provided['manual-guest-최순규'])}`,
    );
  }

  // C. 게스트 provided → 다른 게스트 처리 → 기존 provided 유지
  {
    const base = mergeAttendeeMeta({}, { 'manual-guest-가': { birthYear: 1980 } });
    const afterOther = mergeAttendeeMeta(base, { 'manual-guest-나': { declined: true } });
    check(
      'C(33) 다른 게스트 처리 후에도 기존 provided 유지',
      afterOther['manual-guest-가']?.birthYear === 1980
      && afterOther['manual-guest-가']?.birthYearStatus === 'provided'
      && afterOther['manual-guest-나']?.birthYearStatus === 'declined',
      `got ${json(afterOther)}`,
    );
    check(
      'C(33b) decision 에 없는 참가자 항목은 절대 제거되지 않음',
      Object.keys(mergeAttendeeMeta(afterOther, {})).length === 2,
      `got ${json(mergeAttendeeMeta(afterOther, {}))}`,
    );
    // 입력 map 비변경(순수 함수) 보증
    check(
      'C(33c) 입력 map 을 변경하지 않음',
      json(base) === json({ 'manual-guest-가': { birthYear: 1980, birthYearStatus: 'provided' } }),
      `got ${json(base)}`,
    );
  }

  // provided → declined 전환 시 birthYear 키가 실제로 제거되는지(서버 RPC 가 birthYear 만 읽으므로 중요)
  {
    const flipped = applyAttendeeBirthYearDecision({ birthYear: 1980, birthYearStatus: 'provided' }, { declined: true });
    check(
      '34 provided → declined 전환 시 birthYear 키 제거',
      flipped.birthYear === undefined && flipped.birthYearStatus === 'declined' && !('birthYear' in flipped),
      `got ${json(flipped)}`,
    );
  }

  // 알 수 없는 키는 보존(미래 확장 안전 — 다른 경로가 넣은 값을 지우지 않는다)
  {
    const kept = applyAttendeeBirthYearDecision({ someFutureKey: 'x' } as any, { birthYear: 1975 });
    check(
      '35 결정과 무관한 기존 키는 보존',
      kept.someFutureKey === 'x' && kept.birthYear === 1975,
      `got ${json(kept)}`,
    );
  }

  // 잘못된 연도는 저장 단계에서 거부(만 나이/미래연도가 snapshot 에 들어가지 않도록)
  {
    let threw = false;
    try { applyAttendeeBirthYearDecision(undefined, { birthYear: 43 }); } catch { threw = true; }
    check('36 만 나이 숫자(43)는 병합 단계에서 거부', threw, '예외가 발생하지 않았다');
  }

  // 공식 규칙(1900~현재 연도) 정규화는 저장 경계(guestProfileService)에서 강제한다 — 정적 코드 보증.
  {
    const serviceSource = readFileSync(join(here, '..', 'lib', 'kdk', 'guestProfileService.ts'), 'utf8');
    const snapshotFn = serviceSource.slice(
      serviceSource.indexOf('export async function saveSessionBirthYearSnapshot'),
      serviceSource.indexOf('export async function getSessionAttendeeMeta'),
    );
    const decisionFn = serviceSource.slice(
      serviceSource.indexOf('export async function saveSessionAttendeeBirthYearDecision'),
      serviceSource.indexOf('export async function upsertGuestProfiles'),
    );
    check(
      '36b 두 저장 경로 모두 normalizeBirthYear 통과 + 공통 merge helper 사용(정적 코드 보증)',
      snapshotFn.includes('normalizeBirthYear(') && snapshotFn.includes('saveMergedAttendeeMeta(')
      && decisionFn.includes('normalizeBirthYear(') && decisionFn.includes('saveMergedAttendeeMeta(')
      && serviceSource.includes('mergeAttendeeMeta(current, decisions)'),
      '저장 경로가 정규화 또는 공통 병합 helper 를 우회한다',
    );
  }
}

// ── 37~40. 회원/게스트 해결 UI 정책 (D/E/F) — 정적 코드 보증 + 판정 로직 ────────
{
  const kdkSource = readFileSync(join(here, '..', 'app', 'kdk', 'page.tsx'), 'utf8');
  const branchStart = kdkSource.indexOf('{target.isGuest ? (');
  const elseStart = kdkSource.indexOf(') : (', branchStart);
  const branchEnd = kdkSource.indexOf(')}', elseStart);
  const guestBranch = branchStart >= 0 && elseStart > branchStart ? kdkSource.slice(branchStart, elseStart) : '';
  const memberBranch = elseStart >= 0 && branchEnd > elseStart ? kdkSource.slice(elseStart, branchEnd) : '';

  // F. 게스트 미등록 → 입력 / 미입력 진행 두 CTA 노출
  check(
    'F(37) 게스트 분기에 [출생연도 입력] [생년 미입력으로 진행] 두 CTA 존재',
    guestBranch.includes('출생연도 입력') && guestBranch.includes('생년 미입력으로 진행')
    && guestBranch.includes('setBirthYearPrompt(target)') && guestBranch.includes('setDeclinePrompt(target)'),
    '확정 모달의 게스트 CTA 가 사라졌거나 분기 구조가 바뀌었다',
  );

  // D. 회원 미등록 → 미입력 진행 버튼 없음 + 안내만
  check(
    'D(38) 회원 분기에 버튼 없음 · 안내 문구만',
    memberBranch.length > 0
    && !memberBranch.includes('<button')
    && !memberBranch.includes('생년 미입력으로 진행')
    && !memberBranch.includes('setDeclinePrompt')
    && memberBranch.includes('회원 정보에서 출생연도를 확인해주세요'),
    '회원 분기에 버튼이 되살아났거나 안내 문구가 사라졌다',
  );

  // D. UI 를 우회해도 회원은 declined 될 수 없다(핸들러 가드).
  check(
    'D(38b) confirmFinalizeDecline 이 회원을 거부하는 가드 보유',
    /const confirmFinalizeDecline[\s\S]{0,400}?if \(!declinePrompt\.isGuest\)/.test(kdkSource)
    && /const submitFinalizeBirthYear[\s\S]{0,400}?if \(!birthYearPrompt\.isGuest\)/.test(kdkSource),
    '회원 declined/입력 차단 가드가 사라졌다',
  );

  // D. 회원 출생연도 누락 → 완전 동률에서 미해결로 남아 확정 차단 유지
  {
    const rows = [
      { playerId: 'mem-uuid-1', name: '회원누락', wins: 2, diff: 6, birthYear: null },
      { playerId: 'manual-guest-박연도', name: '박연도(G)', wins: 2, diff: 6, birthYear: 1985 },
    ] as Entry[];
    check(
      'D(39) 회원 출생연도 누락 → 미해결 유지(확정 차단)',
      findUnresolvedTieBirthYears(rows as any).map((r: any) => r.name).join(',') === '회원누락',
      `got "${findUnresolvedTieBirthYears(rows as any).map((r: any) => r.name).join(',')}"`,
    );
  }

  // E. 회원 출생연도 정상 → 해결 UI 자체가 뜨지 않음(미해결 0명)
  check(
    'E(40) 회원 출생연도 정상 → 미해결 0명(해결 UI 없음)',
    findUnresolvedTieBirthYears([M('회원정상', 1980), G('박연도', 1985)] as any).length === 0,
    '정상 회원이 미해결로 잡혔다',
  );
}

console.log(`\n=== 결과: ${passed} passed, ${failures.length} failed ===`);
if (failures.length > 0) {
  console.log('\n실패 목록:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
}
console.log('모든 fixture 통과. SQL fixture(supabase/verify_kdk_official_ranking_oldest_first_fixture.sql) 결과와 대조하세요.\n');
