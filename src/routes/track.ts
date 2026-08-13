import { Hono } from "hono";
import type { Env } from "../types";
import { ARTA_RE } from "../lib/validators";
import { createRateLimiter, clientIp } from "../lib/rate-limit";

const TRACK_RATE_LIMIT = 20;
const TRACK_RATE_WINDOW = 60;

const track = new Hono<{ Bindings: Env }>();

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.charAt(0);
  return `${head}***@${domain}`;
}

function maskName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  return `${first.charAt(0)}***${last ? ` ${last.charAt(0)}***` : ""}`;
}

track.get("/:ref", async (c) => {
  const limiter = createRateLimiter(c.env.KV, "rl:track", TRACK_RATE_LIMIT, TRACK_RATE_WINDOW);
  const { allowed } = await limiter.check(clientIp(c));
  if (!allowed) {
    return c.json({ found: false, error: "Too many lookups. Please try again shortly." }, 429);
  }

  const ref = c.req.param("ref").trim().toUpperCase();
  if (!ARTA_RE.test(ref)) {
    return c.json({ found: false, error: "Invalid reference number. Use the format ARTA-YYYY-XXXXX." }, 400);
  }

  const row = await c.env.DB.prepare(
    `SELECT arta_reference_no, full_name, email_address, nature_of_request, description, status, created_at, updated_at
     FROM tickets WHERE arta_reference_no = ?`
  )
    .bind(ref)
    .first();

  if (!row) {
    return c.json({ found: false, error: "No ticket found with that reference number." }, 404);
  }

  return c.json({
    found: true,
    ticket: {
      arta_reference_no: row.arta_reference_no,
      full_name: row.full_name ? maskName(String(row.full_name)) : null,
      email_address: row.email_address ? maskEmail(String(row.email_address)) : null,
      nature_of_request: row.nature_of_request,
      description: row.description,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
  });
});

export default track;
