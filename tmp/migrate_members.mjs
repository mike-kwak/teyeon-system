import { createClient } from '@supabase/supabase-js';

// --- CONFIGURATION ---
// Please provide the credentials for the OLD and NEW projects.
const OLD_SUPABASE_URL = process.env.OLD_SUPABASE_URL || '';
const OLD_SUPABASE_SERVICE_ROLE_KEY = process.env.OLD_SUPABASE_SERVICE_ROLE_KEY || '';

const NEW_SUPABASE_URL = process.env.NEW_SUPABASE_URL || 'https://wvhwpdgerjngmkhagxom.supabase.co';
const NEW_SUPABASE_SERVICE_ROLE_KEY = process.env.NEW_SUPABASE_SERVICE_ROLE_KEY || '';

if (!OLD_SUPABASE_URL || !OLD_SUPABASE_SERVICE_ROLE_KEY || !NEW_SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Error: Missing credentials. Please set the following environment variables:');
  console.error('OLD_SUPABASE_URL, OLD_SUPABASE_SERVICE_ROLE_KEY, NEW_SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const oldSupabase = createClient(OLD_SUPABASE_URL, OLD_SUPABASE_SERVICE_ROLE_KEY);
const newSupabase = createClient(NEW_SUPABASE_URL, NEW_SUPABASE_SERVICE_ROLE_KEY);

async function migrate() {
  console.log('🚀 Starting migration of "members" table...');

  // 1. Fetch data from OLD Supabase
  console.log('📥 Fetching data from the old project...');
  const { data: members, error: fetchError } = await oldSupabase
    .from('members')
    .select('*');

  if (fetchError) {
    console.error('❌ Error fetching from old project:', fetchError.message);
    return;
  }

  console.log(`✅ Fetched ${members.length} members.`);

  if (members.length === 0) {
    console.log('⚠️ No members found to migrate.');
    return;
  }

  // 2. Insert data into NEW Supabase
  console.log('📤 Inserting data into the new project...');
  
  // We use upsert to avoid duplicate errors if some data was already there
  const { error: insertError } = await newSupabase
    .from('members')
    .upsert(members, { onConflict: 'id' });

  if (insertError) {
    console.error('❌ Error inserting into new project:', insertError.message);
    return;
  }

  console.log('🎉 Migration completed successfully!');
}

migrate().catch(err => {
  console.error('🔥 Unexpected error:', err);
});
