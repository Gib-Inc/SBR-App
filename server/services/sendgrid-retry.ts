// Shared SendGrid retry helper with exponential backoff.
// Used by Roger PO notifications and reorder-alert emails to absorb
// transient SendGrid 5xx / network blips during 4 days of unattended
// operation. Three attempts at 1s / 5s / 15s. On final failure the
// caller is responsible for fallback logging + notification.

const DEFAULT_DELAYS_MS = [1000, 5000, 15000];

export interface RetryResult<T> {
  ok: boolean;
  result?: T;
  error?: Error;
  attempts: number;
}

export async function sendWithRetry<T>(
  fn: () => Promise<T>,
  context: string,
  options: { delaysMs?: number[] } = {},
): Promise<RetryResult<T>> {
  const delays = options.delaysMs ?? DEFAULT_DELAYS_MS;
  const maxAttempts = delays.length;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await fn();
      if (attempt > 0) {
        console.log(`[${context}] Succeeded on attempt ${attempt + 1}/${maxAttempts}`);
      }
      return { ok: true, result, attempts: attempt + 1 };
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err?.message ?? err));
      const isFinal = attempt === maxAttempts - 1;
      const delay = delays[attempt];
      if (isFinal) {
        console.error(
          `[${context}] All ${maxAttempts} attempts failed: ${lastError.message}`,
        );
      } else {
        console.warn(
          `[${context}] Attempt ${attempt + 1}/${maxAttempts} failed (retry in ${delay}ms): ${lastError.message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  return {
    ok: false,
    error: lastError ?? new Error("send failed"),
    attempts: maxAttempts,
  };
}
