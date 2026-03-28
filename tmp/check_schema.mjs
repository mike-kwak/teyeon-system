import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve('.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');

const getEnvValue = (key) => {
  const match = envContent.match(new RegExp(`${key}=(.*)`));
  return match ? match[1].trim() : null;
};

const supabaseUrl = getEnvValue('NEXT_PUBLIC_SUPABASE_URL');
const supabaseAnonKey = getEnvValue('NEXT_PUBLIC_SUPABASE_ANON_KEY');

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkSchema() {
  console.log('🔍 Fetching all data from "members" to check schema...');
  const { data, error } = await supabase
    .from('members')
    .select('*')
    .limit(1);

  if (error) {
    if (error.code === 'PGRST116') {
      console.log('⚠️ Table "members" is empty.');
    } else {
      console.error('❌ Error:', error.message);
    }
    return;
  }

  if (!data || data.length === 0) {
    console.log('⚠️ Table "members" is empty.');
    return;
  }

  console.log('--- Sample Row Schema ---');
  console.log(Object.keys(data[0]));
  console.log('--- Full Data ---');
  console.log(JSON.stringify(data[0], null, 2));
}

checkSchema().catch(err => console.error(err));
