import { Hono } from "hono";
import type { Env } from "../types";
import { sha256, randomInt } from "../lib/crypto";
import { createRateLimiter, clientIp } from "../lib/rate-limit";

const CAPTCHA_TTL_SECONDS = 300;
const CAPTCHA_RATE_LIMIT = 10;
const CAPTCHA_RATE_WINDOW = 60;

const captcha = new Hono<{ Bindings: Env }>();

captcha.post("/", async (c) => {
  const limiter = createRateLimiter(c.env.KV, "rl:captcha", CAPTCHA_RATE_LIMIT, CAPTCHA_RATE_WINDOW);
  const { allowed, retryAfterSeconds } = await limiter.check(clientIp(c));
  if (!allowed) {
    return c.json({ ok: false, error: "Too many attempts. Please try again shortly." }, 429);
  }

  const a = randomInt(20) + 1;
  const b = randomInt(a) + 1;
  const ops = ["+", "-"] as const;
  const op = ops[randomInt(ops.length)];
  const answer = op === "+" ? a + b : a - b;

  const sessionId = crypto.randomUUID();
  await c.env.KV.put(`captcha:${sessionId}`, await sha256(String(answer)), {
    expirationTtl: CAPTCHA_TTL_SECONDS,
  });

  return c.json({ ok: true, sessionId, problem: `${a} ${op} ${b}` });
});

export default captcha;
