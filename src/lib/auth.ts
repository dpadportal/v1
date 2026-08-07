import type { Context } from "hono";
import type { Env } from "../types";

function safeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  return crypto.subtle.timingSafeEqual(aBytes, bBytes);
}

export function adminGuard(
  c: Context<{ Bindings: Env }>
): Response | null {
  const { ADMIN_USER, ADMIN_PASSWORD } = c.env;
  if (!ADMIN_USER || !ADMIN_PASSWORD) {
    c.status(503);
    return c.json({ ok: false, error: "Admin panel is not configured." });
  }

  const header = c.req.header("Authorization") ?? "";
  const expected = `Basic ${btoa(`${ADMIN_USER}:${ADMIN_PASSWORD}`)}`;
  if (!safeEqual(header, expected)) {
    c.status(401);
    return c.json({ ok: false, error: "Unauthorized." });
  }

  return null;
}
