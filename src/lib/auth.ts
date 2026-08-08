import type { Context } from "hono";
import type { Env } from "../types";
import { createRateLimiter, clientIp } from "./rate-limit";
import { hashPassword, verifyPassword } from "./password";

export interface AdminUser {
  id: number;
  username: string;
  role: string;
}

export type AuthResult = { user: AdminUser } | { error: Response };

function safeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  return crypto.subtle.timingSafeEqual(aBytes, bBytes);
}

function unauthorized(c: Context<{ Bindings: Env }>): Response {
  c.status(401);
  return c.json({ ok: false, error: "Unauthorized." });
}

function rateLimited(c: Context<{ Bindings: Env }>): Response {
  c.status(429);
  return c.json({ ok: false, error: "Too many failed sign-in attempts. Try again later." });
}

export async function logActivity(
  env: Env,
  username: string,
  action: string,
  detail: string | null,
  ip: string
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO activity_log (username, action, detail, ip) VALUES (?, ?, ?, ?)`
  )
    .bind(username, action, detail, ip)
    .run();
}

export async function seedAdminUser(env: Env, username: string, password: string): Promise<void> {
  const { salt, hash } = await hashPassword(password);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO admin_users (username, password_salt, password_hash, role)
     VALUES (?, ?, ?, 'superadmin')`
  )
    .bind(username, salt, hash)
    .run();
}

export async function ensureSuperadmin(env: Env, username: string): Promise<void> {
  const superRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM admin_users WHERE role = 'superadmin'`
  ).first<{ n: number }>();
  if (Number(superRow?.n ?? 0) > 0) return;
  const { ADMIN_USER } = env;
  if (ADMIN_USER && safeEqual(username, ADMIN_USER)) {
    await env.DB.prepare(
      `UPDATE admin_users SET role = 'superadmin' WHERE username = ?`
    )
      .bind(username)
      .run();
  }
}

export async function adminGuard(c: Context<{ Bindings: Env }>): Promise<AuthResult> {
  const header = c.req.header("Authorization") ?? "";
  if (!header.startsWith("Basic ")) return { error: unauthorized(c) };

  let decoded = "";
  try {
    decoded = atob(header.slice(6));
  } catch {
    return { error: unauthorized(c) };
  }
  const colon = decoded.indexOf(":");
  if (colon <= 0) return { error: unauthorized(c) };
  const username = decoded.slice(0, colon);
  const password = decoded.slice(colon + 1);
  if (!username || !password) return { error: unauthorized(c) };

  const row = await c.env.DB.prepare(
    `SELECT id, username, role, password_salt, password_hash FROM admin_users WHERE username = ?`
  )
    .bind(username)
    .first<{
      id: number;
      username: string;
      role: string;
      password_salt: string;
      password_hash: string;
    }>();

  if (row) {
    const ok = await verifyPassword(password, row.password_salt, row.password_hash);
    if (!ok) {
      const limiter = createRateLimiter(c.env.KV, "rl:admin-auth", 10, 300);
      const { allowed } = await limiter.check(clientIp(c));
      if (!allowed) return { error: rateLimited(c) };
      return { error: unauthorized(c) };
    }
    await ensureSuperadmin(c.env, username);
    return { user: { id: row.id, username: row.username, role: row.role } };
  }

  const { ADMIN_USER, ADMIN_PASSWORD } = c.env;
  if (
    ADMIN_USER &&
    ADMIN_PASSWORD &&
    safeEqual(username, ADMIN_USER) &&
    safeEqual(password, ADMIN_PASSWORD)
  ) {
    await seedAdminUser(c.env, username, password);
    const seeded = await c.env.DB.prepare(
      `SELECT id, username, role FROM admin_users WHERE username = ?`
    )
      .bind(username)
      .first<{ id: number; username: string; role: string }>();
    return seeded
      ? { user: { id: seeded.id, username: seeded.username, role: seeded.role } }
      : { error: unauthorized(c) };
  }

  const limiter = createRateLimiter(c.env.KV, "rl:admin-auth", 10, 300);
  const { allowed } = await limiter.check(clientIp(c));
  if (!allowed) return { error: rateLimited(c) };

  return { error: unauthorized(c) };
}