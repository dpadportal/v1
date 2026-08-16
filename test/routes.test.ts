import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env, exports } from "cloudflare:workers";
import { sha256 } from "../src/lib/crypto";
import { hashPassword } from "../src/lib/password";
import { applySchema, clearKv } from "./helpers";

const YEAR = new Date().getFullYear();
const worker = exports.default;

async function solveCaptcha(): Promise<{ sessionId: string; answer: string }> {
  const res = await worker.fetch("http://test.local/api/captcha", { method: "POST" });
  const data = (await res.json()) as { ok: boolean; sessionId: string; problem: string };
  expect(data.ok).toBe(true);
  const [a, op, b] = data.problem.split(" ");
  const answer = op === "+" ? Number(a) + Number(b) : Number(a) - Number(b);
  return { sessionId: data.sessionId, answer: String(answer) };
}

async function seedOtp(email: string, code = "123456"): Promise<void> {
  await env.KV.put(`otp:${email}`, await sha256(`${email}:${code}`), { expirationTtl: 300 });
}

function basicAuth(username: string, password: string): string {
  return "Basic " + btoa(`${username}:${password}`);
}

describe("public API", () => {
  beforeAll(async () => {
    await applySchema();
    await env.DB.prepare(
      `INSERT INTO schools (district, school_name, school_id, school_email) VALUES
       ('Cabanatuan City', 'Nueva Ecija High School', '300826', '300826@deped.gov.ph')`
    ).run();
  });

  beforeEach(async () => {
    await clearKv(["rl:", "otp:", "otp-attempts:", "otp-cooldown:", "captcha:", "backup:"]);
  });

  it("GET /api/health returns ok", async () => {
    const res = await worker.fetch("http://test.local/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("serves the landing page from assets", async () => {
    const res = await worker.fetch("http://test.local/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("TUGON");
  });

  it("rejects cross-origin state-changing requests (CSRF)", async () => {
    const res = await worker.fetch("https://example.com/api/submit", {
      method: "POST",
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  it("allows same-origin state-changing requests through to validation", async () => {
    const res = await worker.fetch("https://example.com/api/submit", {
      method: "POST",
      headers: { Origin: "https://example.com", "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).not.toBe(403);
  });

  it("rate-limits OTP requests per IP", async () => {
    for (let i = 1; i <= 5; i++) {
      const res = await worker.fetch("http://test.local/api/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: `user${i}@example.com` }),
      });
      expect(res.status).toBe(200);
    }
    const blocked = await worker.fetch("http://test.local/api/send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "blocked@example.com" }),
    });
    expect(blocked.status).toBe(429);
  });

  it("submits a named ticket end-to-end and tracks it", async () => {
    const email = "juan@example.com";
    await seedOtp(email);
    const { sessionId, answer } = await solveCaptcha();

    const form = new FormData();
    form.set("full_name", "Juan Dela Cruz");
    form.set("cellphone_number", "09171234567");
    form.set("email_address", email);
    form.set("email_otp", "123456");
    form.set("district", "Cabanatuan City");
    form.set("school_name", "Nueva Ecija High School");
    form.set("person_name", "Maria Santos");
    form.set("person_position", "Teacher");
    form.set("nature_of_request", "complaint");
    form.set("description", "This is a test complaint about a broken classroom ceiling.");
    form.set("captcha_session_id", sessionId);
    form.set("captcha_answer", answer);
    form.set("privacy_consent", "true");

    const res = await worker.fetch("http://test.local/api/submit", { method: "POST", body: form });
    const data = (await res.json()) as { ok: boolean; artaReferenceNo: string };
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.artaReferenceNo).toBe(`DPAD-${YEAR}-00001`);

    const track = await worker.fetch(`http://test.local/api/track/${data.artaReferenceNo}`);
    const trackData = (await track.json()) as {
      found: boolean;
      ticket: { status: string; full_name: string; email_address: string };
    };
    expect(trackData.found).toBe(true);
    expect(trackData.ticket.status).toBe("Pending");
    expect(trackData.ticket.full_name).toContain("***");
    expect(trackData.ticket.email_address).toContain("***");

    const row = await env.DB.prepare(
      `SELECT * FROM tickets WHERE arta_reference_no = ?`
    )
      .bind(data.artaReferenceNo)
      .first();
    expect(row?.full_name).toBe("Juan Dela Cruz");
    expect(row?.is_anonymous).toBe(0);
  });

  it("submits an anonymous ticket without an email", async () => {
    const { sessionId, answer } = await solveCaptcha();
    const form = new FormData();
    form.set("anonymous", "true");
    form.set("school_name", "Sto. Niño Elementary School");
    form.set("nature_of_request", "suggestions");
    form.set("description", "Anonymous suggestion about the guidance office.");
    form.set("captcha_session_id", sessionId);
    form.set("captcha_answer", answer);
    form.set("privacy_consent", "true");

    const res = await worker.fetch("http://test.local/api/submit", { method: "POST", body: form });
    const data = (await res.json()) as { ok: boolean; artaReferenceNo: string };
    expect(data.ok).toBe(true);
    expect(data.artaReferenceNo).toBe(`DPAD-${YEAR}-00002`);

    const row = await env.DB.prepare(
      `SELECT is_anonymous, email_address FROM tickets WHERE arta_reference_no = ?`
    )
      .bind(data.artaReferenceNo)
      .first();
    expect(row?.is_anonymous).toBe(1);
    expect(row?.email_address).toBe("");
  });

  it("rejects a wrong OTP", async () => {
    await seedOtp("wrong@example.com");
    const { sessionId, answer } = await solveCaptcha();
    const form = new FormData();
    form.set("email_address", "wrong@example.com");
    form.set("email_otp", "999999");
    form.set("school_name", "Test School");
    form.set("nature_of_request", "inquiry");
    form.set("description", "Inquiry about enrollment.");
    form.set("captcha_session_id", sessionId);
    form.set("captcha_answer", answer);
    form.set("privacy_consent", "true");

    const res = await worker.fetch("http://test.local/api/submit", { method: "POST", body: form });
    const data = (await res.json()) as { ok: boolean; error: string };
    expect(res.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.error.toLowerCase()).toContain("code");
  });

  it("rejects anonymous submissions when disabled", async () => {
    await env.DB.prepare(
      `INSERT INTO preferences (key, value) VALUES ('anonymous_allowed', '0')
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`
    ).run();
    const { sessionId, answer } = await solveCaptcha();
    const form = new FormData();
    form.set("anonymous", "true");
    form.set("school_name", "Test School");
    form.set("nature_of_request", "praise");
    form.set("description", "Praise message.");
    form.set("captcha_session_id", sessionId);
    form.set("captcha_answer", answer);
    form.set("privacy_consent", "true");

    const res = await worker.fetch("http://test.local/api/submit", { method: "POST", body: form });
    const data = (await res.json()) as { ok: boolean; error: string };
    expect(res.status).toBe(400);
    expect(data.error.toLowerCase()).toContain("anonymous");
  });

  it("stores evidence in R2 and serves it from /files", async () => {
    const email = "evidence@example.com";
    await seedOtp(email);
    const { sessionId, answer } = await solveCaptcha();

    const form = new FormData();
    form.set("email_address", email);
    form.set("email_otp", "123456");
    form.set("school_name", "Test School");
    form.set("nature_of_request", "request");
    form.set("description", "Request with photo evidence.");
    form.set("captcha_session_id", sessionId);
    form.set("captcha_answer", answer);
    form.set("privacy_consent", "true");
    form.set("evidence", new File([new Uint8Array([137, 80, 78, 71])], "proof.png", { type: "image/png" }));

    const res = await worker.fetch("http://test.local/api/submit", { method: "POST", body: form });
    const data = (await res.json()) as { ok: boolean; artaReferenceNo: string };
    expect(data.ok).toBe(true);

    const row = await env.DB.prepare(
      `SELECT evidence_file_url, evidence_mime FROM tickets WHERE arta_reference_no = ?`
    )
      .bind(data.artaReferenceNo)
      .first<{ evidence_file_url: string; evidence_mime: string }>();
    expect(row?.evidence_file_url).toMatch(/^\/files\/tickets\//);
    expect(row?.evidence_mime).toBe("image/png");

    const fileRes = await worker.fetch("http://test.local" + row!.evidence_file_url);
    expect(fileRes.status).toBe(200);
    expect(await fileRes.arrayBuffer()).toEqual(new Uint8Array([137, 80, 78, 71]).buffer);
  });
});

describe("admin API", () => {
  beforeAll(async () => {
    await applySchema();
    await env.DB.prepare(
      `INSERT INTO schools (district, school_name, school_id, school_email) VALUES
       ('Cabanatuan City', 'Nueva Ecija High School', '300826', '300826@deped.gov.ph'),
       ('SGOD - Central Office', 'Division Office', '000000', 'sdo@deped.gov.ph')
       ON CONFLICT (district, school_name) DO NOTHING`
    ).run();
    for (const [username, password, role, scope] of [
      ["admin", "secret123", "division", null],
      ["super", "super123", "superadmin", null],
      ["district1", "dist123", "district", "Cabanatuan City"],
    ] as const) {
      const { salt, hash } = await hashPassword(password);
      await env.DB.prepare(
        `INSERT INTO admin_users (username, password_salt, password_hash, role, district_scope) VALUES (?, ?, ?, ?, ?)`
      )
        .bind(username, salt, hash, role, scope)
        .run();
    }
  });

  beforeEach(async () => {
    await clearKv(["rl:", "otp:", "otp-attempts:", "otp-cooldown:", "captcha:", "backup:"]);
  });

  async function insertTicket(ref: string, status = "Pending", forwardedTo: string | null = null) {
    const r = await env.DB.prepare(
      `INSERT INTO tickets (arta_reference_no, email_address, school_name, nature_of_request, description, privacy_consent, status, forwarded_to)
       VALUES (?, 'client@example.com', 'Nueva Ecija High School', 'complaint', 'Description.', 1, ?, ?)`
    )
      .bind(ref, status, forwardedTo)
      .run();
    return Number(r.meta.last_row_id);
  }

  const divAuth = { Authorization: basicAuth("admin", "secret123") };
  const supAuth = { Authorization: basicAuth("super", "super123") };
  const distAuth = { Authorization: basicAuth("district1", "dist123") };
  const json = { "Content-Type": "application/json" };

  it("requires authentication", async () => {
    const res = await worker.fetch("http://test.local/api/admin/tickets");
    expect(res.status).toBe(401);
  });

  it("rejects cross-origin admin mutations", async () => {
    const res = await worker.fetch("https://example.com/api/admin/login", {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        Authorization: basicAuth("admin", "secret123"),
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  it("division validates, then resolves a ticket with activity logging", async () => {
    const id = await insertTicket("DPAD-2026-00050");

    const listRes = await worker.fetch("http://test.local/api/admin/tickets", { headers: divAuth });
    const listData = (await listRes.json()) as { ok: boolean; tickets: Array<{ id: number; status: string }> };
    expect(listData.ok).toBe(true);
    expect(listData.tickets).toHaveLength(1);

    const valRes = await worker.fetch(`http://test.local/api/admin/tickets/${id}/validate`, {
      method: "POST",
      headers: { ...divAuth, ...json },
      body: JSON.stringify({ forward_to: "Cabanatuan City", password: "secret123" }),
    });
    expect(valRes.status).toBe(200);

    const row = await env.DB.prepare(`SELECT status, forwarded_to, validated_by FROM tickets WHERE id = ?`).bind(id).first();
    expect(row?.status).toBe("Validated");
    expect(row?.forwarded_to).toBe("Cabanatuan City");
    expect(row?.validated_by).toBe("admin");

    const patchRes = await worker.fetch(`http://test.local/api/admin/tickets/${id}`, {
      method: "PATCH",
      headers: { ...divAuth, ...json },
      body: JSON.stringify({ status: "Resolved", password: "secret123" }),
    });
    expect(patchRes.status).toBe(200);

    const log = await env.DB.prepare(
      `SELECT action FROM activity_log WHERE username = 'admin' ORDER BY id DESC LIMIT 2`
    ).all();
    const actions = log.results.map((r) => r.action);
    expect(actions).toContain("ticket_validate");
    expect(actions).toContain("status_update");

    const track = await worker.fetch("http://test.local/api/track/DPAD-2026-00050");
    const trackData = (await track.json()) as { ticket: { status: string } };
    expect(trackData.ticket.status).toBe("Resolved");
  });

  it("rejects status changes with the wrong password", async () => {
    const id = await insertTicket("DPAD-2026-00051", "Validated", "Cabanatuan City");
    const res = await worker.fetch(`http://test.local/api/admin/tickets/${id}`, {
      method: "PATCH",
      headers: { ...divAuth, ...json },
      body: JSON.stringify({ status: "Resolved", password: "wrong-password" }),
    });
    expect(res.status).toBe(403);
  });

  it("division cannot change a Pending ticket directly (must validate first)", async () => {
    const id = await insertTicket("DPAD-2026-00052");
    const res = await worker.fetch(`http://test.local/api/admin/tickets/${id}`, {
      method: "PATCH",
      headers: { ...divAuth, ...json },
      body: JSON.stringify({ status: "Under Review", password: "secret123" }),
    });
    expect(res.status).toBe(400);
  });

  it("superadmin can set Validated on a Pending ticket", async () => {
    const id = await insertTicket("DPAD-2026-00053");
    const res = await worker.fetch(`http://test.local/api/admin/tickets/${id}`, {
      method: "PATCH",
      headers: { ...supAuth, ...json },
      body: JSON.stringify({ status: "Validated", password: "super123" }),
    });
    expect(res.status).toBe(200);
  });

  it("district only sees tickets forwarded to its district, never Pending", async () => {
    await insertTicket("DPAD-2026-00054", "Pending");
    await insertTicket("DPAD-2026-00055", "Validated", "Cabanatuan City");
    await insertTicket("DPAD-2026-00056", "Validated", "SGOD - Central Office");

    const distList = await worker.fetch("http://test.local/api/admin/tickets", { headers: distAuth });
    const distData = (await distList.json()) as { tickets: Array<{ arta_reference_no: string }> };
    const distRefs = distData.tickets.map((t) => t.arta_reference_no);
    expect(distRefs).toContain("DPAD-2026-00055");
    expect(distRefs).not.toContain("DPAD-2026-00054");
    expect(distRefs).not.toContain("DPAD-2026-00056");

    const divList = await worker.fetch("http://test.local/api/admin/tickets", { headers: divAuth });
    const divData = (await divList.json()) as { tickets: Array<{ arta_reference_no: string }> };
    const divRefs = divData.tickets.map((t) => t.arta_reference_no);
    for (const ref of ["DPAD-2026-00054", "DPAD-2026-00055", "DPAD-2026-00056"]) {
      expect(divRefs).toContain(ref);
    }
  });

  it("district can mark Under Review but cannot Resolve", async () => {
    const id = await insertTicket("DPAD-2026-00057", "Validated", "Cabanatuan City");

    const urRes = await worker.fetch(`http://test.local/api/admin/tickets/${id}`, {
      method: "PATCH",
      headers: { ...distAuth, ...json },
      body: JSON.stringify({ status: "Under Review", password: "dist123" }),
    });
    expect(urRes.status).toBe(200);

    const resRes = await worker.fetch(`http://test.local/api/admin/tickets/${id}`, {
      method: "PATCH",
      headers: { ...distAuth, ...json },
      body: JSON.stringify({ status: "Resolved", password: "dist123" }),
    });
    expect(resRes.status).toBe(403);

    const divRes = await worker.fetch(`http://test.local/api/admin/tickets/${id}`, {
      method: "PATCH",
      headers: { ...divAuth, ...json },
      body: JSON.stringify({ status: "Resolved", password: "secret123" }),
    });
    expect(divRes.status).toBe(200);
  });

  it("district cannot touch tickets forwarded to another district", async () => {
    const id = await insertTicket("DPAD-2026-00058", "Validated", "SGOD - Central Office");
    const res = await worker.fetch(`http://test.local/api/admin/tickets/${id}`, {
      method: "PATCH",
      headers: { ...distAuth, ...json },
      body: JSON.stringify({ status: "Under Review", password: "dist123" }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects invalid validation attempts", async () => {
    const id = await insertTicket("DPAD-2026-00059");

    const asDistrict = await worker.fetch(`http://test.local/api/admin/tickets/${id}/validate`, {
      method: "POST",
      headers: { ...distAuth, ...json },
      body: JSON.stringify({ forward_to: "Cabanatuan City", password: "dist123" }),
    });
    expect(asDistrict.status).toBe(403);

    const wrongPass = await worker.fetch(`http://test.local/api/admin/tickets/${id}/validate`, {
      method: "POST",
      headers: { ...divAuth, ...json },
      body: JSON.stringify({ forward_to: "Cabanatuan City", password: "nope" }),
    });
    expect(wrongPass.status).toBe(403);

    const badTarget = await worker.fetch(`http://test.local/api/admin/tickets/${id}/validate`, {
      method: "POST",
      headers: { ...divAuth, ...json },
      body: JSON.stringify({ forward_to: "Nowhere Land", password: "secret123" }),
    });
    expect(badTarget.status).toBe(400);
  });

  it("account management requires superadmin", async () => {
    const getRes = await worker.fetch("http://test.local/api/admin/accounts", { headers: divAuth });
    expect(getRes.status).toBe(403);

    const postRes = await worker.fetch("http://test.local/api/admin/accounts", {
      method: "POST",
      headers: { ...divAuth, ...json },
      body: JSON.stringify({ username: "evil", password: "password123", role: "division" }),
    });
    expect(postRes.status).toBe(403);
  });

  it("enforces a single superadmin and requires a scope for district accounts", async () => {
    const secondSuper = await worker.fetch("http://test.local/api/admin/accounts", {
      method: "POST",
      headers: { ...supAuth, ...json },
      body: JSON.stringify({ username: "super2", password: "password123", role: "superadmin" }),
    });
    expect(secondSuper.status).toBe(400);

    const noScope = await worker.fetch("http://test.local/api/admin/accounts", {
      method: "POST",
      headers: { ...supAuth, ...json },
      body: JSON.stringify({ username: "dist2", password: "password123", role: "district" }),
    });
    expect(noScope.status).toBe(400);

    const ok = await worker.fetch("http://test.local/api/admin/accounts", {
      method: "POST",
      headers: { ...supAuth, ...json },
      body: JSON.stringify({ username: "dist2", password: "password123", role: "district", district_scope: "SGOD - Central Office" }),
    });
    expect(ok.status).toBe(200);
  });

  it("disabled accounts cannot sign in", async () => {
    const created = await worker.fetch("http://test.local/api/admin/accounts", {
      method: "POST",
      headers: { ...supAuth, ...json },
      body: JSON.stringify({ username: "disabled1", password: "password123", role: "division" }),
    });
    expect(created.status).toBe(200);
    const listed = await worker.fetch("http://test.local/api/admin/accounts", { headers: supAuth });
    const listData = (await listed.json()) as { accounts: Array<{ id: number; username: string }> };
    const account = listData.accounts.find((a) => a.username === "disabled1")!;
    const disableRes = await worker.fetch(`http://test.local/api/admin/accounts/${account.id}`, {
      method: "PATCH",
      headers: { ...supAuth, ...json },
      body: JSON.stringify({ is_active: 0 }),
    });
    expect(disableRes.status).toBe(200);

    const res = await worker.fetch("http://test.local/api/admin/login", {
      method: "POST",
      headers: { Authorization: basicAuth("disabled1", "password123") },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  it("preferences are superadmin-only", async () => {
    const getRes = await worker.fetch("http://test.local/api/admin/preferences", { headers: divAuth });
    expect(getRes.status).toBe(403);
    const putRes = await worker.fetch("http://test.local/api/admin/preferences", {
      method: "PUT",
      headers: { ...divAuth, ...json },
      body: JSON.stringify({ preferences: { email_notifications: "1" } }),
    });
    expect(putRes.status).toBe(403);
  });
});