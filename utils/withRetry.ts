export async function withRetry<T>(
  asyncFn: () => Promise<T> | PromiseLike<T>,
  retries = 3,
  delayMs = 1500,
  timeoutMs = 15000
): Promise<T> {
  // Enforces a rigid localized timeout per execution
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Request timed out (10s limit)')), timeoutMs)
  );

  try {
    return await Promise.race([asyncFn(), timeoutPromise]);
  } catch (error: any) {
    if (retries > 0) {
      console.warn(`[Retry Factory] Execution failed: ${error.message}. Recovering in ${delayMs}ms... (${retries} retries left)`);
      // Add a small randomized jitter to prevent thundering herd
      const jitter = Math.floor(Math.random() * 500);
      await new Promise(resolve => setTimeout(resolve, delayMs + jitter));
      
      // Exponential backoff
      return withRetry(asyncFn, retries - 1, delayMs * 1.5, timeoutMs);
    }
    // Hard failure after retries exhausted
    throw error;
  }
}
