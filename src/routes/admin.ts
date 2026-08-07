import { Hono } from "hono";
import type { Env, TicketStatus } from "../types";
import { TICKET_STATUSES } from "../types";
import { adminGuard, logActivity } from "../lib/auth";
import { clientIp } from "../lib/rate-limit";
import { createRateLimiter } from "../lib/rate-limit";
import { EMAIL_RE, MAX_LENGTHS } from "../lib/validators";
import { hashPassword, verifyPassword } from "../lib/password";
import { sendIntakeFormEmail, sendStatusUpdateEmail } from "../lib/email";

const admin = new Hono<{ Bindings: Env }>();

function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

admin.get("/stats", async (c) => {
  const auth = await adminGuard(c);
  if ("error" in auth) return auth.error;

  const rows = await c.env.DB.prepare(
    `SELECT status, COUNT(*) AS count FROM tickets GROUP BY status`
  ).all();

  const counts: Record<string, number> = {};
  for (const row of rows.results) counts[String(row.status)] = Number(row.count);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const districtRows = await c.env.DB.prepare(
    `SELECT district, COUNT(*) AS count FROM tickets GROUP BY district`
  ).all();
  const districtCounts: Record<string, number> = {};
  for (const row of districtRows.results) {
    districtCounts[String(row.district ?? "None")] = Number(row.count);
  }

  const natureRows = await c.env.DB.prepare(
    `SELECT nature_of_request, COUNT(*) AS count FROM tickets GROUP BY nature_of_request`
  ).all();
  const natureCounts: Record<string, number> = {};
  for (const row of natureRows.results) {
    natureCounts[String(row.nature_of_request)] = Number(row.count);
  }

  const dailyRows = await c.env.DB.prepare(
    `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count
     FROM tickets
     WHERE created_at >= datetime('now', '-13 days')
     GROUP BY day ORDER BY day`
  ).all();
  const daily: Array<{ day: string; count: number }> = dailyRows.results.map((row) => ({
    day: String(row.day),
    count: Number(row.count),
  }));

  return c.json({ ok: true, stats: { total, counts, districtCounts, natureCounts, daily } });
});

admin.get("/tickets", async (c) => {
  const auth = await adminGuard(c);
  if ("error" in auth) return auth.error;

  const status = c.req.query("status");
  const q = (c.req.query("q") ?? "").trim().slice(0, 100);
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 50, 1), 200);
  const offset = Math.max(Number(c.req.query("offset")) || 0, 0);

  const where: string[] = [];
  const params: Array<string | number> = [];
  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(
      "(arta_reference_no LIKE ? ESCAPE '\\' OR full_name LIKE ? ESCAPE '\\' OR email_address LIKE ? ESCAPE '\\' OR school_name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')"
    );
    params.push(like, like, like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM tickets ${whereSql}`
  )
    .bind(...params)
    .first();

  const rows = await c.env.DB.prepare(
    `SELECT id, arta_reference_no, full_name, cellphone_number, email_address,
            district, school_name, nature_of_request, description, status, created_at, updated_at
     FROM tickets ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  )
    .bind(...params, limit, offset)
    .all();

  return c.json({ ok: true, tickets: rows.results, total: Number(countRow?.total ?? 0) });
});

admin.patch("/tickets/:id", async (c) => {
  const auth = await adminGuard(c);
  if ("error" in auth) return auth.error;

  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ ok: false, error: "Invalid ticket id." }, 400);
  }

  let body: { status?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "Invalid request payload." }, 400);
  }

  const status = String(body.status ?? "");
  if (!TICKET_STATUSES.includes(status as TicketStatus)) {
    return c.json({ ok: false, error: "Invalid status." }, 400);
  }

  const row = await c.env.DB.prepare(
    `SELECT arta_reference_no, email_address FROM tickets WHERE id = ?`
  )
    .bind(id)
    .first();
  if (!row) {
    return c.json({ ok: false, error: "Ticket not found." }, 404);
  }

  await c.env.DB.prepare(
    `UPDATE tickets SET status = ?, updated_at = datetime('now') WHERE id = ?`
  )
    .bind(status, id)
    .run();

  await sendStatusUpdateEmail(
    c.env,
    String(row.email_address),
    String(row.arta_reference_no),
    status as TicketStatus
  );

  await logActivity(c.env, auth.user.username, "status_update", `${row.arta_reference_no} -> ${status}`, clientIp(c));

  return c.json({ ok: true, status });
});

admin.get("/tickets/export", async (c) => {
  const auth = await adminGuard(c);
  if ("error" in auth) return auth.error;

  const status = c.req.query("status");
  const q = (c.req.query("q") ?? "").trim().slice(0, 100);

  const where: string[] = [];
  const params: Array<string | number> = [];
  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(
      "(arta_reference_no LIKE ? ESCAPE '\\' OR full_name LIKE ? ESCAPE '\\' OR email_address LIKE ? ESCAPE '\\' OR school_name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')"
    );
    params.push(like, like, like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = await c.env.DB.prepare(
    `SELECT arta_reference_no, full_name, cellphone_number, email_address,
            district, school_name, nature_of_request, description, status, created_at, updated_at
     FROM tickets ${whereSql} ORDER BY created_at DESC LIMIT 10000`
  )
    .bind(...params)
    .all();

  const csvEscape = (value: unknown): string => {
    const s = String(value ?? "");
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const header = [
    "arta_reference_no",
    "full_name",
    "cellphone_number",
    "email_address",
    "district",
    "school_name",
    "nature_of_request",
    "description",
    "status",
    "created_at",
    "updated_at",
  ].join(",");

  const lines = rows.results.map((row) =>
    [
      csvEscape(row.arta_reference_no),
      csvEscape(row.full_name),
      csvEscape(row.cellphone_number),
      csvEscape(row.email_address),
      csvEscape(row.district),
      csvEscape(row.school_name),
      csvEscape(row.nature_of_request),
      csvEscape(row.description),
      csvEscape(row.status),
      csvEscape(row.created_at),
      csvEscape(row.updated_at),
    ].join(",")
  );

  const csv = `\uFEFF${[header, ...lines].join("\r\n")}\r\n`;
  const filename = `tickets-${new Date().toISOString().slice(0, 10)}.csv`;

  await logActivity(c.env, auth.user.username, "export_tickets", `status=${status || "all"}${q ? ` q=${q}` : ""}`, clientIp(c));

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});

admin.get("/tickets/:id", async (c) => {
  const auth = await adminGuard(c);
  if ("error" in auth) return auth.error;

  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ ok: false, error: "Invalid ticket id." }, 400);
  }

  const row = await c.env.DB.prepare(
    `SELECT id, arta_reference_no, full_name, cellphone_number, email_address,
            district, school_name, nature_of_request, description, status, created_at, updated_at
     FROM tickets WHERE id = ?`
  )
    .bind(id)
    .first();
  if (!row) {
    return c.json({ ok: false, error: "Ticket not found." }, 404);
  }

  return c.json({ ok: true, ticket: row });
});

admin.post("/tickets/:id/email", async (c) => {
  const auth = await adminGuard(c);
  if ("error" in auth) return auth.error;

  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ ok: false, error: "Invalid ticket id." }, 400);
  }

  let body: { to?: unknown; pdfBase64?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "Invalid request payload." }, 400);
  }

  const to = String(body.to ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(to)) return c.json({ ok: false, error: "Enter a valid email address." }, 400);
  if (to.length > MAX_LENGTHS.email) return c.json({ ok: false, error: "Email address is too long." }, 400);

  const pdfBase64 = String(body.pdfBase64 ?? "").trim();
  if (!pdfBase64 || pdfBase64.length > 5_000_000) {
    return c.json({ ok: false, error: "Missing or invalid PDF attachment." }, 400);
  }
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(pdfBase64)) {
    return c.json({ ok: false, error: "Invalid PDF attachment." }, 400);
  }

  const row = await c.env.DB.prepare(
    `SELECT arta_reference_no FROM tickets WHERE id = ?`
  )
    .bind(id)
    .first();
  if (!row) {
    return c.json({ ok: false, error: "Ticket not found." }, 404);
  }

  const sent = await sendIntakeFormEmail(c.env, to, String(row.arta_reference_no), pdfBase64);
  if (!sent.ok) {
    return c.json({ ok: false, error: sent.error }, 500);
  }

  await logActivity(c.env, auth.user.username, "email_intake_form", `${row.arta_reference_no} -> ${to}`, clientIp(c));

  return c.json({ ok: true, message: `Intake form sent to ${to}.` });
});

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,30}$/;

admin.get("/accounts", async (c) => {
  const auth = await adminGuard(c);
  if ("error" in auth) return auth.error;

  const rows = await c.env.DB.prepare(
    `SELECT id, username, role, recovery_question, created_at FROM admin_users ORDER BY id`
  ).all();

  return c.json({ ok: true, accounts: rows.results });
});

admin.post("/accounts", async (c) => {
  const auth = await adminGuard(c);
  if ("error" in auth) return auth.error;
  if (auth.user.role !== "superadmin") {
    return c.json({ ok: false, error: "Only the superadmin can create accounts." }, 403);
  }

  let body: { username?: unknown; password?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "Invalid request payload." }, 400);
  }

  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  if (!USERNAME_RE.test(username)) {
    return c.json({ ok: false, error: "Username must be 3-30 characters (letters, numbers, . _ -)." }, 400);
  }
  if (password.length < 8 || password.length > 100) {
    return c.json({ ok: false, error: "Password must be 8-100 characters." }, 400);
  }

  const existing = await c.env.DB.prepare(
    `SELECT id FROM admin_users WHERE username = ?`
  )
    .bind(username)
    .first();
  if (existing) {
    return c.json({ ok: false, error: "That username is already taken." }, 409);
  }

  const { salt, hash } = await hashPassword(password);
  await c.env.DB.prepare(
    `INSERT INTO admin_users (username, password_salt, password_hash, role) VALUES (?, ?, ?, 'admin')`
  )
    .bind(username, salt, hash)
    .run();

  await logActivity(c.env, auth.user.username, "account_create", username, clientIp(c));

  return c.json({ ok: true, message: `Account ${username} created.` });
});

admin.delete("/accounts/:id", async (c) => {
  const auth = await adminGuard(c);
  if ("error" in auth) return auth.error;
  if (auth.user.role !== "superadmin") {
    return c.json({ ok: false, error: "Only the superadmin can delete accounts." }, 403);
  }

  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ ok: false, error: "Invalid account id." }, 400);
  }

  const row = await c.env.DB.prepare(
    `SELECT id, username, role FROM admin_users WHERE id = ?`
  )
    .bind(id)
    .first<{ id: number; username: string; role: string }>();
  if (!row) {
    return c.json({ ok: false, error: "Account not found." }, 404);
  }

  const username = String(row.username);
  if (String(row.role) === "superadmin") {
    return c.json({ ok: false, error: "Superadmin accounts cannot be deleted." }, 400);
  }
  if (auth.user.username === username) {
    return c.json({ ok: false, error: "You cannot delete your own account." }, 400);
  }

  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM admin_users`
  ).first<{ count: number }>();
  if (Number(countRow?.count ?? 0) <= 1) {
    return c.json({ ok: false, error: "Cannot delete the last remaining account." }, 400);
  }

  await c.env.DB.prepare(`DELETE FROM admin_users WHERE id = ?`).bind(id).run();

  await logActivity(c.env, auth.user.username, "account_delete", username, clientIp(c));

  return c.json({ ok: true, message: `Account ${username} deleted.` });
});

admin.patch("/accounts/:id", async (c) => {
  const auth = await adminGuard(c);
  if ("error" in auth) return auth.error;

  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ ok: false, error: "Invalid account id." }, 400);
  }

  let body: { password?: unknown; recovery_question?: unknown; recovery_answer?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "Invalid request payload." }, 400);
  }

  const row = await c.env.DB.prepare(
    `SELECT id, username, role FROM admin_users WHERE id = ?`
  )
    .bind(id)
    .first<{ id: number; username: string; role: string }>();
  if (!row) {
    return c.json({ ok: false, error: "Account not found." }, 404);
  }

  const hasPassword = body.password !== undefined;
  const hasRecovery = body.recovery_question !== undefined || body.recovery_answer !== undefined;

  if (!hasPassword && !hasRecovery) {
    return c.json({ ok: false, error: "Nothing to update." }, 400);
  }

  if (hasPassword) {
    const password = String(body.password ?? "");
    if (password.length < 8 || password.length > 100) {
      return c.json({ ok: false, error: "Password must be 8-100 characters." }, 400);
    }
    if (auth.user.role !== "superadmin" && auth.user.username !== row.username) {
      return c.json({ ok: false, error: "You can only change your own password." }, 403);
    }
    const { salt, hash } = await hashPassword(password);
    await c.env.DB.prepare(
      `UPDATE admin_users SET password_salt = ?, password_hash = ? WHERE id = ?`
    )
      .bind(salt, hash, id)
      .run();
    await logActivity(c.env, auth.user.username, "password_change", row.username, clientIp(c));
  }

  if (hasRecovery) {
    if (
      auth.user.role !== "superadmin" ||
      row.role !== "superadmin" ||
      auth.user.username !== row.username
    ) {
      return c.json({ ok: false, error: "Only the superadmin can set their own recovery question." }, 403);
    }
    const question = String(body.recovery_question ?? "").trim();
    const answer = String(body.recovery_answer ?? "").trim();
    if (!question || question.length > 200) {
      return c.json({ ok: false, error: "Enter a recovery question." }, 400);
    }
    if (answer.length < 8) {
      return c.json({ ok: false, error: "Recovery answer must be at least 8 characters." }, 400);
    }
    const { salt, hash } = await hashPassword(answer);
    await c.env.DB.prepare(
      `UPDATE admin_users SET recovery_question = ?, recovery_answer_salt = ?, recovery_answer_hash = ? WHERE id = ?`
    )
      .bind(question, salt, hash, id)
      .run();
    await logActivity(c.env, auth.user.username, "recovery_set", "Recovery question configured", clientIp(c));
  }

  return c.json({ ok: true, message: "Account updated." });
});

admin.post("/login", async (c) => {
  const auth = await adminGuard(c);
  if ("error" in auth) return auth.error;

  await logActivity(c.env, auth.user.username, "sign_in", null, clientIp(c));

  return c.json({ ok: true, user: auth.user });
});

admin.get("/me", async (c) => {
  const auth = await adminGuard(c);
  if ("error" in auth) return auth.error;

  const row = await c.env.DB.prepare(
    `SELECT recovery_question FROM admin_users WHERE id = ?`
  )
    .bind(auth.user.id)
    .first<{ recovery_question: string | null }>();

  return c.json({
    ok: true,
    user: {
      username: auth.user.username,
      role: auth.user.role,
      recovery_question_set: Boolean(row?.recovery_question),
    },
  });
});

admin.post("/activity", async (c) => {
  const auth = await adminGuard(c);
  if ("error" in auth) return auth.error;

  let body: { action?: unknown; detail?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "Invalid request payload." }, 400);
  }

  const action = String(body.action ?? "").trim().slice(0, 50);
  const detail = String(body.detail ?? "").trim().slice(0, 500);
  if (!action) return c.json({ ok: false, error: "Missing action." }, 400);

  await logActivity(c.env, auth.user.username, action, detail || null, clientIp(c));
  return c.json({ ok: true });
});

admin.get("/activity-log", async (c) => {
  const auth = await adminGuard(c);
  if ("error" in auth) return auth.error;

  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 50, 1), 200);
  const offset = Math.max(Number(c.req.query("offset")) || 0, 0);

  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM activity_log`
  ).first();

  const rows = await c.env.DB.prepare(
    `SELECT id, username, action, detail, ip, created_at FROM activity_log ORDER BY id DESC LIMIT ? OFFSET ?`
  )
    .bind(limit, offset)
    .all();

  return c.json({ ok: true, logs: rows.results, total: Number(countRow?.total ?? 0) });
});

admin.get("/activity-log/export", async (c) => {
  const auth = await adminGuard(c);
  if ("error" in auth) return auth.error;

  const rows = await c.env.DB.prepare(
    `SELECT created_at, username, action, detail, ip FROM activity_log ORDER BY id DESC LIMIT 10000`
  ).all();

  await logActivity(c.env, auth.user.username, "export_logs", null, clientIp(c));

  const csvEscape = (value: unknown): string => {
    const s = String(value ?? "");
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const header = ["created_at", "username", "action", "detail", "ip"].join(",");
  const lines = rows.results.map((row) =>
    [row.created_at, row.username, row.action, row.detail, row.ip].map(csvEscape).join(",")
  );
  const csv = `\uFEFF${[header, ...lines].join("\r\n")}\r\n`;
  const filename = `activity-log-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});

admin.get("/accounts/recovery", async (c) => {
  const limiter = createRateLimiter(c.env.KV, "rl:admin-recover", 10, 300);
  const { allowed } = await limiter.check(clientIp(c));
  if (!allowed) {
    return c.json({ ok: false, error: "Too many attempts. Try again later." }, 429);
  }

  const username = (c.req.query("username") ?? "").trim();
  if (!username) return c.json({ ok: false, error: "Enter a username." }, 400);

  const row = await c.env.DB.prepare(
    `SELECT username, role, recovery_question FROM admin_users WHERE username = ?`
  )
    .bind(username)
    .first<{ username: string; role: string; recovery_question: string | null }>();

  if (!row || row.role !== "superadmin" || !row.recovery_question) {
    return c.json({ ok: false, error: "No recoverable account with that username." }, 404);
  }

  return c.json({ ok: true, username: row.username, question: row.recovery_question });
});

admin.post("/accounts/recovery", async (c) => {
  const limiter = createRateLimiter(c.env.KV, "rl:admin-recover", 5, 300);
  const { allowed } = await limiter.check(clientIp(c));
  if (!allowed) {
    return c.json({ ok: false, error: "Too many attempts. Try again later." }, 429);
  }

  let body: { username?: unknown; answer?: unknown; newPassword?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "Invalid request payload." }, 400);
  }

  const username = String(body.username ?? "").trim();
  const answer = String(body.answer ?? "").trim();
  const newPassword = String(body.newPassword ?? "");
  if (!username || !answer) {
    return c.json({ ok: false, error: "Missing username or recovery answer." }, 400);
  }
  if (newPassword.length < 8 || newPassword.length > 100) {
    return c.json({ ok: false, error: "Password must be 8-100 characters." }, 400);
  }

  const row = await c.env.DB.prepare(
    `SELECT id, username, role, recovery_answer_salt, recovery_answer_hash FROM admin_users WHERE username = ?`
  )
    .bind(username)
    .first<{
      id: number;
      username: string;
      role: string;
      recovery_answer_salt: string;
      recovery_answer_hash: string;
    }>();

  if (!row || row.role !== "superadmin" || !row.recovery_answer_salt || !row.recovery_answer_hash) {
    return c.json({ ok: false, error: "No recoverable account with that username." }, 404);
  }

  const verified = await verifyPassword(answer, row.recovery_answer_salt, row.recovery_answer_hash);
  if (!verified) {
    return c.json({ ok: false, error: "Incorrect answer to the recovery question." }, 401);
  }

  const { salt, hash } = await hashPassword(newPassword);
  await c.env.DB.prepare(
    `UPDATE admin_users SET password_salt = ?, password_hash = ? WHERE id = ?`
  )
    .bind(salt, hash, row.id)
    .run();

  await logActivity(c.env, row.username, "account_recover", "Password reset via recovery question", clientIp(c));

  return c.json({ ok: true, message: "Password updated. You can now sign in." });
});

export default admin;