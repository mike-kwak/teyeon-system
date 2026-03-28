import { supabase } from './supabase';

/**
 * Log a user action or navigation to the 'app_logs' table for security and statistics.
 * This is designed to run in the background (no await) to ensure zero performance impact.
 */
export const logAction = async (
  path: string, 
  action: string, 
  metadata: Record<string, any> = {}
) => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;

    const { error } = await supabase
      .from('app_logs')
      .insert({
        user_id: user?.id || null,
        user_email: user?.email || 'guest',
        path,
        action,
        metadata,
      });

    if (error) {
      // We don't throw here as logging should never break the main app flow
      console.warn('[Logging] Silent failure:', error.message);
    }
  } catch (err) {
    console.warn('[Logging] Unexpected error:', err);
  }
};
