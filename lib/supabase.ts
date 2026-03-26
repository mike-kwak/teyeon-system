import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase URL or Anon Key is missing in environment variables.');
}

// Force fresh client to bypass schema cache if necessary
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    headers: { 'x-schema-cache-refresh': Date.now().toString() }
  }
});
