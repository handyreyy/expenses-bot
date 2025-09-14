export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  baseDelayMs = 400
): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const status = e?.response?.status;
      const retriable = [429, 500, 502, 503, 504].includes(status);
      if (!retriable || i === attempts - 1) break;
      const delay = baseDelayMs * Math.pow(2, i); // 400, 800, 1600
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
