import { Hono } from "hono";
import type { Env, TicketStatus } from "../types";
import { TICKET_STATUSES } from "../types";
import { adminGuard } from "../lib/auth";
import { sendStatusUpdateEmail } from "../lib/email";

const admin = new Hono<{ Bindings: Env }>();

function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

admin.get("/stats", async (c) => {
  const denied = adminGuard(c);
  if (denied) return denied;

  const rows = await c.env.DB.prepare(
    `SELECT status, COUNT(*) AS count FROM tickets GROUP BY status`
  ).all();

  const counts: Record<string, number> = {};
  for (const row of rows.results) counts[String(row.status)] = Number(row.count);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return c.json({ ok: true, stats: { total, counts } });
});

admin.get("/tickets", async (c) => {
  const denied = adminGuard(c);
  if (denied) return denied;

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
  const denied = adminGuard(c);
  if (denied) return denied;

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

  return c.json({ ok: true, status });
});

export default admin;