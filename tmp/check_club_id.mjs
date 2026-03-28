import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Manual env loading for .env.local
const envPath = path.resolve('.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');

const getEnvValue = (key) => {
  const match = envContent.match(new RegExp(`${key}=(.*)`));
  return match ? match[1].trim() : null;
};

const supabaseUrl = getEnvValue('NEXT_PUBLIC_SUPABASE_URL');
const supabaseAnonKey = getEnvValue('NEXT_PUBLIC_SUPABASE_ANON_KEY');

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkClubIds() {
  console.log('🔍 Fetching club_id from "members" table...');
  const { data, error } = await supabase
    .from('members')
    .select('nickname, club_id');

  if (error) {
    console.error('❌ Error:', error.message);
    return;
  }

  if (!data || data.length === 0) {
    console.log('⚠️ No members found in the database.');
    return;
  }

  console.log('--- Current Members and Club IDs ---');
  data.forEach(m => {
    console.log(`- ${m.nickname}: ${m.club_id || 'NULL'}`);
  });

  const uniqueClubIds = [...new Set(data.map(m => m.club_id))];
  console.log('--- Unique Club IDs ---');
  uniqueClubIds.forEach(id => console.log(id || 'NULL'));
}

checkClubIds().catch(err => console.error(err));
