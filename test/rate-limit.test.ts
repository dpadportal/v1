import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { createRateLimiter } from "../src/lib/rate-limit";
import { clearKv } from "./helpers";

describe("createRateLimiter", () => {
  beforeEach(async () => {
    await clearKv(["rl:"]);
  });

  it("allows requests up to the limit", async () => {
    const limiter = createRateLimiter(env.KV, "rl:test", 3, 60);
    for (let i = 0; i < 3; i++) {
      const result = await limiter.check("client-1");
      expect(result.allowed).toBe(true);
    }
  });

  it("blocks once the limit is exceeded", async () => {
    const limiter = createRateLimiter(env.KV, "rl:test", 3, 60);
    for (let i = 0; i < 3; i++) await limiter.check("client-1");
    const blocked = await limiter.check("client-1");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks clients independently", async () => {
    const limiter = createRateLimiter(env.KV, "rl:test", 2, 60);
    await limiter.check("client-a");
    await limiter.check("client-a");
    expect((await limiter.check("client-a")).allowed).toBe(false);
    expect((await limiter.check("client-b")).allowed).toBe(true);
  });

  it("allows again once the window entry expires", async () => {
    const limiter = createRateLimiter(env.KV, "rl:test", 1, 60);
    expect((await limiter.check("client-1")).allowed).toBe(true);
    expect((await limiter.check("client-1")).allowed).toBe(false);
    await env.KV.delete("rl:test:client-1");
    expect((await limiter.check("client-1")).allowed).toBe(true);
  });
});