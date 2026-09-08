// ⚠ 로컬 운영 스크립트 — members.phone 등 민감 컬럼을 INSERT/UPDATE 한다.
//   P0 column privilege 적용 후 anon/일반 authenticated 권한으로는 실행되지 않는다(의도된 차단).
//   실행이 필요하면 SUPABASE_SERVICE_ROLE_KEY 를 환경변수로 주입해 service role 로만 실행할 것.
//   (아래 하드코딩 anon key 경로는 privilege 적용 후 phone 관련 동작이 거부된다.)
//
// ══════════════════════════════════════════════════════════════════════════
// ⛔ 현재 이 스크립트를 그대로 실행하지 말 것 — 탈회 회원 처리와 정면 충돌한다.
// ══════════════════════════════════════════════════════════════════════════
//
// 1) 탈회 회원을 OFFICIAL_MEMBERS 에서 지우면 → members row 가 **하드 삭제**된다.
//    (아래 "Deleting unlisted" 경로). members.id 는 과거 기록의 stable id 다 —
//    teyeon_archive_v1.raw_data.player_ids / ranking_snapshots / club_schedule_attendances /
//    member_achievements / finance_dues_* 가 전부 이 id 를 참조한다.
//    삭제하면 과거 KDK·상대전적·파트너전적·FINAL snapshot·참석·입상·재무 이력이 끊긴다.
//    → 탈회는 삭제가 아니라 members.role='탈회'(lib/members/membershipStatus) 로 표현한다.
//
// 2) 탈회 회원을 OFFICIAL_MEMBERS 에 남겨두면 → 아래 update 가 role 을 옛 직책으로
//    **되돌려서 탈회를 조용히 무효화**한다(예: role='탈회' → '부회장' 재활성화).
//    아래 목록의 r 값은 탈회 처리 이전 시점의 직책 스냅샷이며, 현재 운영 상태가 아니다.
//
// 즉 이 스크립트는 "명단 = 현재 회원 전체"라는 전제로 쓰여 있고, 탈회 개념이 없다.
// 재사용하려면 먼저 (a) 삭제 경로 제거 또는 화이트리스트화, (b) role 덮어쓰기에서
// 탈회 회원 제외를 반영해야 한다. 그 전까지는 실행 금지.
//
// 3) PII 주의 — OFFICIAL_MEMBERS 에 실명 + 휴대폰 번호가 평문으로 들어 있다.
//    이 파일을 외부에 공유하거나 로그를 붙여넣지 말 것.
//    is_guest 는 운영 members 에 존재하지 않는 컬럼이므로(2026-07-11 probe) 아래
//    update/insert 의 is_guest 는 현재 스키마에서 실패한다 — 스크립트는 이미 stale 하다.
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://wvhwpdgerjngmkhagxom.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2aHdwZGdlcmpuZ21raGFneG9tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNTIzODgsImV4cCI6MjA4OTkyODM4OH0.3F904LE0OM_HhFpqYFheJv34jcuiUD_hBohaz-RUUkc'
);

const OFFICIAL_MEMBERS = [
  { n: '박광현', r: '회장', p: '010-9352-0919' },
  { n: '강정호', r: '부회장', p: '010-3187-2161' },
  { n: '정상윤', r: '총무', p: '010-8526-5237' },
  { n: '곽민섭', r: '재무', p: '010-2696-0356' },
  { n: '김민준', r: '경기', p: '010-7224-3689' },
  { n: '남인우', r: '섭외', p: '010-4685-8384' },
  { n: '가내현', r: '정회원', p: '010-6680-7119' },
  { n: '구봉준', r: '정회원', p: '010-3447-5660' },
  { n: '김병식', r: '정회원', p: '010-5808-1382' },
  { n: '김상준', r: '정회원', p: '010-7272-3941' },
  { n: '김영우', r: '정회원', p: '010-9622-0708' },
  { n: '김재형', r: '정회원', p: '010-2762-1448' },
  { n: '맹동석', r: '정회원', p: '010-4723-4241' },
  { n: '박강진', r: '정회원', p: '010-6859-5411' },
  { n: '박보훈', r: '정회원', p: '010-7745-8902' },
  { n: '박현민', r: '정회원', p: '010-9420-7018' },
  { n: '배수민', r: '정회원', p: '010-9465-5648' },
  { n: '송준원', r: '정회원', p: '010-3682-9336' },
  { n: '신효철', r: '정회원', p: '010-6411-9865' },
  { n: '심헌섭', r: '정회원', p: '010-9998-6619' },
  { n: '전용원', r: '정회원', p: '010-6213-4723' },
  { n: '차형원', r: '준회원', p: '010-4477-9493' },
  { n: '추석', r: '정회원', p: '010-9688-1715' },
  { n: '김영호', r: '정회원', p: '010-8818-3769' },
];

async function syncMembers() {
  console.log('🔄 Starting rigorous member sync...');
  
  // 1. Fetch ALL current members
  const { data: allMembers, error: fetchError } = await supabase.from('members').select('*');
  if (fetchError) { console.error('Fetch error:', fetchError); return; }

  const officialNames = OFFICIAL_MEMBERS.map(m => m.n);

  // 2. Identify duplicates and unlisted members
  const toDelete = [];
  const processedNames = new Set();

  for (const m of allMembers) {
    const name = m.nickname?.trim();
    if (!officialNames.includes(name)) {
      console.log(`❌ Deleting unlisted: ${name} (${m.id})`);
      toDelete.push(m.id);
    } else if (processedNames.has(name)) {
      console.log(`❌ Deleting duplicate: ${name} (${m.id})`);
      toDelete.push(m.id);
    } else {
      processedNames.add(name);
    }
  }

  // 3. Batch delete
  if (toDelete.length > 0) {
    const { error: delError } = await supabase.from('members').delete().in('id', toDelete);
    if (delError) console.error('Delete error:', delError);
  }

  // 4. Update the remaining and Create missing
  const { data: remainingMembers } = await supabase.from('members').select('nickname');
  const remainingNames = remainingMembers.map(m => m.nickname);

  for (const info of OFFICIAL_MEMBERS) {
    if (remainingNames.includes(info.n)) {
      console.log(`✅ Updating ${info.n}...`);
      await supabase.from('members').update({ role: info.r, phone: info.p, is_guest: false }).eq('nickname', info.n);
    } else {
      console.log(`✨ Creating missing: ${info.n}...`);
      await supabase.from('members').insert({ nickname: info.n, role: info.r, phone: info.p, is_guest: false });
    }
  }

  console.log('🎉 Done! Final check...');
  const { data: final } = await supabase.from('members').select('nickname');
  console.log('Total Count:', final.length);
}

syncMembers();
