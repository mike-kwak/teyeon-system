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
