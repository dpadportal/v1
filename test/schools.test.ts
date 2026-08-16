import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env, exports } from "cloudflare:workers";
import { sha256 } from "../src/lib/crypto";
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

async function submitForm(form: FormData): Promise<{ status: number; data: { ok: boolean; artaReferenceNo?: string; error?: string } }> {
  const res = await worker.fetch("http://test.local/api/submit", { method: "POST", body: form });
  return { status: res.status, data: (await res.json()) as { ok: boolean; artaReferenceNo?: string; error?: string } };
}

describe("schools reference", () => {
  beforeAll(async () => {
    await applySchema();
    await env.DB.prepare(
      `INSERT INTO schools (district, school_name, school_id, school_email) VALUES
       ('Aliaga', 'Aliaga Central School', '105171', '105171@deped.gov.ph'),
       ('Aliaga', 'Bibiclat Elementary School', '105173', '105173@deped.gov.ph'),
       ('Rizal', 'Rizal National High School', '300841', '300841@deped.gov.ph'),
       ('CID', 'Office of the CID', NULL, NULL)`
    ).run();
  });

  beforeEach(async () => {
    await clearKv(["rl:", "otp:", "otp-attempts:", "otp-cooldown:", "captcha:"]);
  });

  it("lists districts from the reference", async () => {
    const res = await worker.fetch("http://test.local/api/schools");
    const data = (await res.json()) as { ok: boolean; districts: string[] };
    expect(data.ok).toBe(true);
    expect(data.districts).toContain("Aliaga");
    expect(data.districts).toContain("Rizal");
    expect(data.districts).toContain("CID");
  });

  it("filters schools by district (sorted, case-insensitive)", async () => {
    const res = await worker.fetch("http://test.local/api/schools?district=ALIAGA");
    const data = (await res.json()) as { ok: boolean; schools: Array<{ school_name: string; school_id: string | null }> };
    expect(data.ok).toBe(true);
    expect(data.schools.map((s) => s.school_name)).toEqual(["Aliaga Central School", "Bibiclat Elementary School"]);
    expect(data.schools[0].school_id).toBe("105171");
  });

  it("returns 404 for unknown districts", async () => {
    const res = await worker.fetch("http://test.local/api/schools?district=Atlantis");
    expect(res.status).toBe(404);
  });

  it("accepts a submit with a school from the selected district", async () => {
    const email = "school1@example.com";
    await seedOtp(email);
    const { sessionId, answer } = await solveCaptcha();

    const form = new FormData();
    form.set("email_address", email);
    form.set("email_otp", "123456");
    form.set("district", "Aliaga");
    form.set("school_name", "Aliaga Central School");
    form.set("nature_of_request", "complaint");
    form.set("description", "Test complaint with a valid school.");
    form.set("captcha_session_id", sessionId);
    form.set("captcha_answer", answer);
    form.set("privacy_consent", "true");

    const { status, data } = await submitForm(form);
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.artaReferenceNo).toBe(`DPAD-${YEAR}-00001`);
  });

  it("rejects a submit with a school not in the selected district", async () => {
    const email = "school2@example.com";
    await seedOtp(email);
    const { sessionId, answer } = await solveCaptcha();

    const form = new FormData();
    form.set("email_address", email);
    form.set("email_otp", "123456");
    form.set("district", "Aliaga");
    form.set("school_name", "Rizal National High School");
    form.set("nature_of_request", "complaint");
    form.set("description", "Wrong-district school must be rejected.");
    form.set("captcha_session_id", sessionId);
    form.set("captcha_answer", answer);
    form.set("privacy_consent", "true");

    const { status, data } = await submitForm(form);
    expect(status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.error).toBe("School must be from the selected district.");
  });

  it("accepts a submit with school_other=1 free text", async () => {
    const email = "school3@example.com";
    await seedOtp(email);
    const { sessionId, answer } = await solveCaptcha();

    const form = new FormData();
    form.set("email_address", email);
    form.set("email_otp", "123456");
    form.set("district", "Aliaga");
    form.set("school_name", "St. Private Academy of Aliaga");
    form.set("school_other", "1");
    form.set("nature_of_request", "complaint");
    form.set("description", "Private school outside the reference.");
    form.set("captcha_session_id", sessionId);
    form.set("captcha_answer", answer);
    form.set("privacy_consent", "true");

    const { status, data } = await submitForm(form);
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it("accepts a submit without a district (free-text school)", async () => {
    const email = "school4@example.com";
    await seedOtp(email);
    const { sessionId, answer } = await solveCaptcha();

    const form = new FormData();
    form.set("email_address", email);
    form.set("email_otp", "123456");
    form.set("school_name", "Some Office");
    form.set("nature_of_request", "inquiry");
    form.set("description", "No district chosen.");
    form.set("captcha_session_id", sessionId);
    form.set("captcha_answer", answer);
    form.set("privacy_consent", "true");

    const { status, data } = await submitForm(form);
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });
});