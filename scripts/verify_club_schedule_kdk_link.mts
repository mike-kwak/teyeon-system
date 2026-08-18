/**
 * TEYEON Club Schedule ↔ KDK 연결(unlink/relink) 규칙 fixture.
 *
 *   실행: node scripts/verify_club_schedule_kdk_link.mts
 *   (Node 24 의 TypeScript type-stripping 사용 — 별도 테스트 러너/의존성 없음)
 *
 *   검증 대상:
 *     · lib/kdk/sessionScheduleLinkCore.ts (순수 로직 — 병합/정렬/해제 정책/1:1 사전점검)
 *     · lib/kdk/sessionScheduleLinkService.ts (정적 코드 보증 — 단일 UPDATE·컬럼 범위·삭제 금지)
 *     · app/club-schedule/[id]/page.tsx (정적 코드 보증 — 권한 게이트·확인 모달·refetch)
 *
 *   핵심 불변식: 연결 해제는 kdk_session_meta.club_schedule_id 만 NULL 로 바꾸는 unlink 이며,
 *   KDK 세션/경기/점수/순위/Archive/Finance/attendee_meta 를 절대 삭제하거나 변경하지 않는다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const corePath = '../lib/kdk/sessionScheduleLinkCore.ts';
const {
  mergeKdkSessionLinkInfo,
  canUnlinkKdkSession,
  resolveUnlinkOutcome,
  precheckLink,
  kdkSessionStatusLabel,
} = await import(corePath);

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

/**
 * 주석 제거 — '어떤 테이블을 건드리는가' 검사는 실제 코드만 봐야 한다.
 * (설명 주석에 테이블 이름이 등장하는 것은 위반이 아니다.)
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map(line => line.replace(/(^|\s)\/\/.*$/, '$1'))
    .join('\n');
}

console.log('\n=== TEYEON Club Schedule ↔ KDK 연결 fixture ===\n');

// ── 1. 병합/정렬 ────────────────────────────────────────────────────────────
{
  const meta = [
    { session_id: '260811_KDK_01', updated_at: '2026-08-11T10:00:00Z' },
    { session_id: '260805_KDK_01', updated_at: '2026-08-05T10:00:00Z' },
    { session_id: '260818_KDK_01', updated_at: '2026-08-18T10:00:00Z' },
  ];
  const archive = [
    { id: '260811_KDK_01', is_official: true },
    { id: '260805_KDK_01', is_official: false },
  ];
  const merged = mergeKdkSessionLinkInfo(meta, archive);

  check(
    '01 updated_at 내림차순 정렬(최근 세션이 위)',
    merged.map((m: any) => m.sessionId).join(' > ') === '260818_KDK_01 > 260811_KDK_01 > 260805_KDK_01',
    `got ${merged.map((m: any) => m.sessionId).join(' > ')}`,
  );
  check(
    '02 공식 확정 세션 플래그',
    merged[1].isOfficial === true && merged[1].isArchived === true,
    `got ${JSON.stringify(merged[1])}`,
  );
  check(
    '03 Archive 는 있으나 미확정 → isArchived만 true',
    merged[2].isArchived === true && merged[2].isOfficial === false,
    `got ${JSON.stringify(merged[2])}`,
  );
  check(
    '04 Archive row 없음 → 둘 다 false(진행/미확정)',
    merged[0].isArchived === false && merged[0].isOfficial === false,
    `got ${JSON.stringify(merged[0])}`,
  );
  check(
    '05 Archive 조회 실패(빈 배열)여도 목록은 살아남음',
    mergeKdkSessionLinkInfo(meta, []).length === 3,
    'archive 실패 시 목록이 사라졌다 — 연결 관리가 막히면 안 된다',
  );
  check(
    '06 입력이 null/undefined 여도 안전',
    mergeKdkSessionLinkInfo(null, null).length === 0 && mergeKdkSessionLinkInfo(undefined, undefined).length === 0,
    '빈 입력에서 예외/비배열 반환',
  );
  // 같은 session_id 중복 방지 + updated_at 동률 시 결정적 순서
  {
    const dup = mergeKdkSessionLinkInfo(
      [
        { session_id: 'A', updated_at: '2026-08-11T10:00:00Z' },
        { session_id: 'A', updated_at: '2026-08-11T10:00:00Z' },
        { session_id: 'B', updated_at: '2026-08-11T10:00:00Z' },
      ],
      [],
    );
    check('07 중복 session_id 제거 + 동률 시 결정적 순서',
      dup.length === 2 && dup.map((d: any) => d.sessionId).join(',') === 'B,A',
      `got ${dup.map((d: any) => d.sessionId).join(',')}`);
  }
}

// ── 2. 해제 정책: 완료/공식 확정 세션도 반드시 해제 가능 ─────────────────────
{
  const official = { sessionId: 'S', isArchived: true, isOfficial: true, updatedAt: null };
  const archived = { sessionId: 'S', isArchived: true, isOfficial: false, updatedAt: null };
  const live = { sessionId: 'S', isArchived: false, isOfficial: false, updatedAt: null };
  check(
    '08 공식 확정 KDK도 연결 해제 허용(운영 막힘 방지 — 회귀 금지)',
    canUnlinkKdkSession(official) === true,
    '공식 확정 세션의 해제가 막혔다',
  );
  check(
    '09 Archive 저장/진행 중 세션도 해제 허용',
    canUnlinkKdkSession(archived) === true && canUnlinkKdkSession(live) === true,
    '일부 상태에서 해제가 막혔다',
  );
  check(
    '10 상태 배지 문구',
    kdkSessionStatusLabel(official) === '공식 확정'
    && kdkSessionStatusLabel(archived) === '기록 저장됨'
    && kdkSessionStatusLabel(live) === '진행/미확정',
    `got ${[official, archived, live].map(kdkSessionStatusLabel).join(' / ')}`,
  );
}

// ── 3. UPDATE 결과 해석 / 1:1 사전 점검 ─────────────────────────────────────
{
  check('11 영향 row 1건 → unlinked', resolveUnlinkOutcome(1) === 'unlinked', `got ${resolveUnlinkOutcome(1)}`);
  check(
    '12 영향 row 0건 → already_changed(다른 기기가 먼저 바꿈 — 덮어쓰지 않음)',
    resolveUnlinkOutcome(0) === 'already_changed',
    `got ${resolveUnlinkOutcome(0)}`,
  );
  check('13 빈 정모 → 연결 가능', precheckLink('S1', 'SCH', null) === 'ok', `got ${precheckLink('S1', 'SCH', null)}`);
  check(
    '14 다른 세션이 점유한 정모 → 거부(1:1 unique index 위반 회피)',
    precheckLink('S1', 'SCH', 'S2') === 'schedule_occupied',
    `got ${precheckLink('S1', 'SCH', 'S2')}`,
  );
  check(
    '15 같은 세션이 이미 연결됨 → 변경 없음',
    precheckLink('S1', 'SCH', 'S1') === 'already_linked',
    `got ${precheckLink('S1', 'SCH', 'S1')}`,
  );
}

// ── 4. 서비스 정적 보증 — unlink 는 컬럼 1개만 바꾸는 단일 UPDATE 여야 한다 ──
{
  const svc = stripComments(readFileSync(join(here, '..', 'lib', 'kdk', 'sessionScheduleLinkService.ts'), 'utf8'));

  check(
    '16 서비스는 어떤 테이블도 delete 하지 않음(unlink 는 삭제가 아니다)',
    !/\.delete\(/.test(svc),
    'sessionScheduleLinkService 에 delete 호출이 생겼다',
  );
  check(
    '17 보호 대상 테이블 미접근(matches / attendee_meta / guest_profiles / finance_* / club_schedules)',
    !/from\(['"]matches['"]\)/.test(svc)
    && !/kdk_session_attendee_meta/.test(svc)
    && !/kdk_guest_profiles/.test(svc)
    && !/finance_/.test(svc)
    && !/club_schedules/.test(svc),
    '연결 서비스가 보호 대상 테이블을 건드린다',
  );
  check(
    '18 teyeon_archive_v1 은 읽기(select)만',
    /ARCHIVE_TBL[\s\S]{0,200}?\.select\(/.test(svc)
    && !/from\(ARCHIVE_TBL\)[\s\S]{0,120}?\.(update|upsert|insert|delete)\(/.test(svc),
    'Archive 에 쓰기 경로가 생겼다',
  );
  {
    const unlinkFn = svc.slice(
      svc.indexOf('export async function unlinkKdkSessionFromSchedule'),
      svc.indexOf('export async function linkKdkSessionToSchedule'),
    );
    check(
      '19 unlink 는 club_schedule_id/updated_at 만 바꾸는 단일 UPDATE',
      /\.update\(\{ club_schedule_id: null, updated_at: new Date\(\)\.toISOString\(\) \}\)/.test(unlinkFn)
      && (unlinkFn.match(/\.update\(/g) || []).length === 1
      && !/upsert\(/.test(unlinkFn),
      'unlink 가 단일 UPDATE 가 아니거나 다른 컬럼을 함께 쓴다',
    );
    check(
      '20 unlink 는 화면에서 본 그 연결만 해제(session_id + club_schedule_id 조건)',
      /\.eq\('session_id', sessionId\)/.test(unlinkFn) && /\.eq\('club_schedule_id', scheduleId\)/.test(unlinkFn),
      '동시성 조건(WHERE club_schedule_id)이 빠졌다 — 다른 정모의 연결을 지울 수 있다',
    );
  }
}

// ── 5. 화면 정적 보증 — 권한·확인 모달·서버 재조회 ──────────────────────────
{
  const page = readFileSync(join(here, '..', 'app', 'club-schedule', '[id]', 'page.tsx'), 'utf8');

  check(
    '21 KDK 연결 카드/모달이 운영진(isAdmin) 게이트 안에만 존재',
    /\{isAdmin && unlinkTarget && \(/.test(page)
    && /\{isAdmin && linkPickerOpen && \(/.test(page)
    && /if \(!isAdmin\) return; \/\/ 일반 회원에게는 연결 관리 자체를 노출하지 않는다\./.test(page),
    '일반 회원에게 연결 해제가 노출될 수 있다',
  );
  check(
    '22 해제는 확인 모달을 거친다(버튼이 바로 실행하지 않음)',
    /onClick=\{\(\) => setUnlinkTarget\(info\)\}/.test(page)
    && /onClick=\{confirmUnlinkKdk\}/.test(page),
    '연결 해제 버튼이 확인 없이 바로 실행된다',
  );
  {
    const fn = page.slice(page.indexOf('const confirmUnlinkKdk'), page.indexOf('const openLinkPicker'));
    check(
      '23 해제 성공 후 서버 재조회(optimistic 금지) + 중복 클릭 방지 + 촬영 보호 가드',
      /await loadKdkLink\(\)/.test(fn)
      && /await loadSchedule\(\)/.test(fn)
      && /if \(!unlinkTarget \|\| kdkLinkBusy\) return;/.test(fn)
      && /guardWriteAction\('KDK 연결 해제'\)/.test(fn)
      && !/setLinkedKdkSessions\(\[\]\)/.test(fn),
      'refetch/중복클릭/가드 중 빠진 것이 있거나 화면만 먼저 비운다',
    );
  }
  check(
    '24 확인 모달 문구 — 삭제되지 않음을 명시',
    page.includes('이 정모와 KDK의 연결만 해제됩니다.')
    && page.includes('경기 기록, 점수, 순위, 공식 기록 및 정산 데이터는 삭제되지 않습니다.')
    && page.includes('연결을 해제하면 이 정모를 수정하거나 삭제할 수 있습니다.'),
    '확인 모달 안내 문구가 바뀌었다',
  );
  check(
    '25 모달이 안정화된 뷰포트/스크롤 패턴을 사용(하단 버튼 잘림·배경 스크롤 방지)',
    /useBodyScrollLock\(!!unlinkTarget \|\| linkPickerOpen\)/.test(page)
    && /height: '100dvh', zIndex: 1000/.test(page)
    && /calc\(24px \+ env\(safe-area-inset-bottom\)\)/.test(page)
    && /overscrollBehavior: 'none', touchAction: 'none'/.test(page),
    'BottomNav(500) 위 z-index / 100dvh / safe-area / scroll-lock 중 빠진 것이 있다',
  );
  check(
    '26 재연결 경로 존재(새 KDK 생성 없이 기존 세션 연결)',
    /fetchUnlinkedKdkSessions/.test(page) && /linkKdkSessionToSchedule/.test(page)
    && page.includes('기존 세션을 그대로 연결하며 새 KDK를 만들지 않습니다.'),
    '재연결 UI 가 사라졌다',
  );
}

// ── 6. 삭제 차단 안내가 실제 존재하는 화면을 가리키는지 ─────────────────────
{
  const svc = readFileSync(join(here, '..', 'lib', 'clubScheduleService.ts'), 'utf8');
  check(
    '27 삭제 차단 안내가 정모 상세의 KDK 연결을 가리킴(도달 불가 화면 안내 제거)',
    svc.includes('정모 상세의 KDK 연결에서 연결을 해제한 후 다시 시도해주세요')
    && !/KDK 설정에서 정모 연결을 해제한 후/.test(svc),
    '차단 안내가 여전히 도달 불가능한 화면을 가리킨다',
  );
  check(
    '28 공식 확정 차단 문구도 해제 경로를 안내',
    /case 'official_kdk':[\s\S]{0,220}?정모 상세의 KDK 연결에서 연결을 해제/.test(svc),
    '공식 확정 케이스에 해제 경로 안내가 없다',
  );
  check(
    '29 삭제 안전판정 로직 자체는 그대로(연결 있으면 삭제 차단)',
    /if \(rows\.length === 0\) return \{ canDelete: true, reason: 'safe', linkedSessionCount: 0 \};/.test(svc)
    && /reason: official \? 'official_kdk' : 'kdk_linked'/.test(svc),
    '삭제 차단 판정이 바뀌었다',
  );
}

console.log(`\n=== 결과: ${passed} passed, ${failures.length} failed ===`);
if (failures.length > 0) {
  console.log('\n실패 목록:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
}
console.log('모든 fixture 통과.\n');
