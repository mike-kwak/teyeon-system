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

async function listTables() {
  console.log('🔍 Listing tables to confirm structure...');
  // Supabase doesn't have a direct "list tables" in JS client easily without RPC or schema queries
  // But we can try to query common tables or use postgrest schema info if allowed
  const { data, error } = await supabase.from('members').select('*').limit(1);
  
  if (error) {
    console.error('❌ Error querying members:', error.message);
  } else {
    console.log('--- members table schema (column names) ---');
    if (data && data.length > 0) {
      console.log(Object.keys(data[0]));
    } else {
      console.log('Table is empty, schema unknown.');
    }
  }
}

listTables().catch(err => console.error(err));
