import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase URL or Anon Key is missing in environment variables.');
}

/**
 * Advanced Fetch Wrapper with Exponential Backoff (v4.0 Stability)
 * Designed to handle "Request timeout" and network instability in remote locations.
 */
const fetchWithRetry = async (
  url: RequestInfo | URL,
  options: RequestInit = {},
  retries = 3,
  backoff = 500
): Promise<Response> => {
  try {
    const res = await fetch(url, {
      ...options,
      cache: 'no-store', // Always bypass cache for real-time accuracy
      // Add a custom timeout signal if needed (default is browser managed)
    });

    // If we get a server error (5xx) or a timeout-like status, consider retrying
    if (!res.ok && res.status >= 500 && retries > 0) {
      console.warn(`[Supabase] Server Error (${res.status}). Retrying in ${backoff}ms... (${retries} left)`);
      await new Promise(resolve => setTimeout(resolve, backoff));
      return fetchWithRetry(url, options, retries - 1, backoff * 2);
    }

    return res;
  } catch (err: any) {
    // Catch network errors (like timeout or DNS failure)
    if (retries > 0) {
      console.warn(`[Supabase] Network Error: ${err.message}. Retrying in ${backoff}ms... (${retries} left)`);
      await new Promise(resolve => setTimeout(resolve, backoff));
      return fetchWithRetry(url, options, retries - 1, backoff * 2);
    }
    throw err;
  }
};

// Optimized Client for Browser (Next.js App Router compatible)
export const supabase = createBrowserClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    global: {
      fetch: fetchWithRetry
    },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'teyeon_auth_session',
      flowType: 'pkce',
    },
    cookieOptions: {
      maxAge: 60 * 60 * 24 * 30, // 30 Days (Standard Persistence)
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production'
    }
  }
);
