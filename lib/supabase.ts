import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase URL or Anon Key is missing in environment variables.');
}

// Global fetch override for Real-time Stabilization (v3.9)
// This forces all Supabase requests to bypass Vercel/Next.js caching by adding cache: 'no-store'.
const customFetch = (url: RequestInfo | URL, options?: RequestInit) => {
  return fetch(url, {
    ...options,
    cache: 'no-store',
  });
};

// Standard client for public access with global cache bypass
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: customFetch
  }
});
