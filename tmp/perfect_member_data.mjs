import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// 1. Load Env
const envPath = path.resolve('.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const getEnvValue = (key) => {
  const match = envContent.match(new RegExp(`${key}=(.*)`));
  return match ? match[1].trim() : null;
};

const supabaseUrl = getEnvValue('NEXT_PUBLIC_SUPABASE_URL');
const supabaseAnonKey = getEnvValue('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// 2. Parse CSV
function parseCSV(content) {
  const lines = content.split('\n').filter(l => l.trim());
  const results = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const row = [];
    let cur = '';
    let inQuotes = false;
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"' && line[j+1] === '"') {
        cur += '"'; j++;
      } else if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        row.push(cur.trim());
        cur = '';
      } else {
        cur += char;
      }
    }
    row.push(cur.trim());
    
    if (row.length < 5) continue;
    
    const obj = {};
    obj.nickname = row[1];
    obj.summary = row[7];
    obj.detailed = row[8];
    results.push(obj);
  }
  return results;
}

async function perfectData() {
  console.log('🚀 Perfecting member data...');
  
  const csvContent = fs.readFileSync('테연 명단.csv', 'utf8');
  const membersData = parseCSV(csvContent);
  console.log(`📊 Parsed ${membersData.length} records from CSV.`);

  for (const m of membersData) {
    if (!m.nickname) continue;

    const achievements = [m.summary, m.detailed].filter(Boolean).join(' | ');
    
    // Update basic achievements for everyone
    let updateData = { achievements };

    // Special case for 곽민섭
    if (m.nickname === '곽민섭') {
      console.log('👑 Updating 곽민섭 as CEO & Finance...');
      updateData.role = 'CEO';
      updateData.position = '재무';
      // Extra detailed award for CEO
      updateData.achievements = '2025 테연 오픈 단체전 우승 | 클럽 창립 멤버';
    }

    const { error } = await supabase
      .from('members')
      .update(updateData)
      .eq('nickname', m.nickname);

    if (error) {
       console.error(`❌ Error updating ${m.nickname}:`, error.message);
    } else {
       if (m.nickname === '곽민섭') console.log('✅ 곽민섭 profile perfected.');
    }
  }

  console.log('🎉 All member data updated successfully.');
}

perfectData().catch(err => console.error(err));
