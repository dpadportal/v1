export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  check(key: string): Promise<RateLimitResult>;
}

export function createRateLimiter(
  kv: KVNamespace,
  prefix: string,
  limit: number,
  windowSeconds: number
): RateLimiter {
  const windowMs = windowSeconds * 1000;
  return {
    async check(key: string): Promise<RateLimitResult> {
      const k = `${prefix}:${key}`;
      const now = Date.now();
      const entry = await kv.get<{ count: number; start: number }>(k, "json");

      if (!entry || now - entry.start >= windowMs) {
        await kv.put(k, JSON.stringify({ count: 1, start: now }), {
          expirationTtl: windowSeconds,
        });
        return { allowed: true, retryAfterSeconds: 0 };
      }

      if (entry.count >= limit) {
        const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - entry.start)) / 1000));
        return { allowed: false, retryAfterSeconds };
      }

      await kv.put(k, JSON.stringify({ count: entry.count + 1, start: entry.start }), {
        expirationTtl: windowSeconds,
      });
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

export function clientIp(c: { req: { header(name: string): string | undefined } }): string {
  return c.req.header("CF-Connecting-IP") || "local";
}
