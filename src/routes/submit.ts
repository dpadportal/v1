import { Hono } from "hono";
import type { Env, NatureOfRequest } from "../types";
import { NATURE_VALUES } from "../types";
import {
  EMAIL_RE,
  OTP_RE,
  PHONE_RE,
  normalizeEmail,
  normalizePhone,
  MAX_LENGTHS,
} from "../lib/validators";
import { sha256 } from "../lib/crypto";
import { generateArtaReference, isUniqueConstraintError } from "../lib/arta";
import { sendConfirmationEmail } from "../lib/email";
import { uploadEvidence } from "../lib/gdrive";
import { createRateLimiter, clientIp } from "../lib/rate-limit";

const OTP_MAX_ATTEMPTS = 5;
const SUBMIT_RATE_LIMIT = 5;
const SUBMIT_RATE_WINDOW = 60;
const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
const EVIDENCE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

const NATURE_LABELS: Record<NatureOfRequest, string> = {
  complaint: "Complaint",
  suggestions: "Suggestions",
  praise: "Praise",
};

const submit = new Hono<{ Bindings: Env }>();

interface SubmitPayload {
  full_name?: unknown;
  cellphone_number?: unknown;
  email_address?: unknown;
  email_otp?: unknown;
  district?: unknown;
  school_name?: unknown;
  nature_of_request?: unknown;
  description?: unknown;
  captcha_session_id?: unknown;
  captcha_answer?: unknown;
  privacy_consent?: unknown;
}

submit.post("/", async (c) => {
  const contentType = c.req.header("Content-Type") ?? "";
  const isMultipart = contentType.includes("multipart/form-data");

  let form: FormData | null = null;
  let body: SubmitPayload = {};
  if (isMultipart) {
    form = await c.req.formData();
  } else {
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "Invalid request payload." }, 400);
    }
  }

  const field = (name: string): string => {
    if (form) return String(form.get(name) ?? "").trim();
    return String((body as Record<string, unknown>)[name] ?? "").trim();
  };

  const fullName = field("full_name");
  const rawPhone = field("cellphone_number");
  const email = normalizeEmail(field("email_address"));
  const otpCode = field("email_otp");
  const district = field("district");
  const schoolName = field("school_name");
  const rawNature = field("nature_of_request");
  const description = field("description");
  const captchaSessionId = field("captcha_session_id");
  const captchaAnswer = field("captcha_answer");
  const consent = form ? form.get("privacy_consent") === "true" : body.privacy_consent === true;

  const evidenceFile: File | null = form ? (form.get("evidence") as File | null) : null;
  let evidence: { name: string; mime: string; size: number; bytes: ArrayBuffer } | null = null;
  if (evidenceFile && evidenceFile.size > 0) {
    if (evidenceFile.size > EVIDENCE_MAX_BYTES) {
      return c.json({ ok: false, error: "The attachment must be 10 MB or smaller." }, 400);
    }
    if (!EVIDENCE_TYPES.has(evidenceFile.type)) {
      return c.json({ ok: false, error: "The attachment must be a photo (PNG/JPG/GIF/WebP) or PDF." }, 400);
    }
    evidence = {
      name: String(evidenceFile.name ?? "attachment").trim() || "attachment",
      mime: evidenceFile.type,
      size: evidenceFile.size,
      bytes: await evidenceFile.arrayBuffer(),
    };
  }

  if (!EMAIL_RE.test(email)) return c.json({ ok: false, error: "Enter a valid email address." }, 400);
  if (email.length > MAX_LENGTHS.email) return c.json({ ok: false, error: "Email address is too long." }, 400);
  if (!OTP_RE.test(otpCode)) return c.json({ ok: false, error: "Enter the 6-digit code sent to your email." }, 400);
  if (!schoolName) return c.json({ ok: false, error: "School / Paaralan is required." }, 400);
  if (schoolName.length > MAX_LENGTHS.schoolName) return c.json({ ok: false, error: "School name is too long." }, 400);

  const nature: NatureOfRequest | undefined = NATURE_VALUES.find((n) => n === rawNature);
  if (!nature) return c.json({ ok: false, error: "Select a Nature of Request." }, 400);

  if (!description) return c.json({ ok: false, error: "Description is required." }, 400);
  if (description.length > MAX_LENGTHS.description) return c.json({ ok: false, error: "Description must be 4000 characters or fewer." }, 400);
  if (fullName.length > MAX_LENGTHS.fullName) return c.json({ ok: false, error: "Full name must be 100 characters or fewer." }, 400);
  if (rawPhone.length > MAX_LENGTHS.cellphone) {
    return c.json({ ok: false, error: "Cellphone number is too long." }, 400);
  }

  let phone: string | null = null;
  if (rawPhone) {
    phone = normalizePhone(rawPhone);
    if (!PHONE_RE.test(phone)) {
      return c.json({ ok: false, error: "Enter a valid cellphone number (e.g. 09171234567)." }, 400);
    }
  }
  if (district.length > MAX_LENGTHS.district) return c.json({ ok: false, error: "District is too long." }, 400);

  if (!captchaSessionId || !captchaAnswer) {
    return c.json({ ok: false, error: "Please answer the verification question." }, 400);
  }
  if (!consent) return c.json({ ok: false, error: "You must agree to the Data Privacy Notice." }, 400);

  const { DB, KV } = c.env;

  const submitLimiter = createRateLimiter(KV, "rl:submit", SUBMIT_RATE_LIMIT, SUBMIT_RATE_WINDOW);
  const submitCheck = await submitLimiter.check(clientIp(c));
  if (!submitCheck.allowed) {
    return c.json({ ok: false, error: "Too many submissions. Please try again shortly." }, 429);
  }

  const otpKey = `otp:${email}`;
  const attemptsKey = `otp-attempts:${email}`;
  const storedHash = await KV.get(otpKey);
  if (!storedHash) {
    return c.json({ ok: false, error: "No code was requested for this email, or it has expired. Request a new code." }, 400);
  }
  const otpHash = await sha256(`${email}:${otpCode}`);
  if (storedHash !== otpHash) {
    const attempts = Number((await KV.get(attemptsKey)) ?? "0") + 1;
    if (attempts >= OTP_MAX_ATTEMPTS) {
      await KV.delete(otpKey);
      await KV.delete(attemptsKey);
      return c.json({ ok: false, error: "Too many incorrect attempts. Request a new code." }, 400);
    }
    await KV.put(attemptsKey, String(attempts), { expirationTtl: 300 });
    return c.json({ ok: false, error: "Incorrect code. Please try again." }, 400);
  }
  await KV.delete(otpKey);
  await KV.delete(attemptsKey);

  const captchaKey = `captcha:${captchaSessionId}`;
  const captchaStored = await KV.get(captchaKey);
  if (!captchaStored) {
    return c.json({ ok: false, error: "The verification question has expired. Refresh it and try again." }, 400);
  }
  const captchaHash = await sha256(String(Number(captchaAnswer) || "").trim());
  if (captchaStored !== captchaHash) {
    return c.json({ ok: false, error: "Incorrect answer to the verification question." }, 400);
  }
  await KV.delete(captchaKey);

  let referenceNo: string | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const ref = await generateArtaReference(DB);
    try {
      const result = await DB.prepare(
        `INSERT INTO tickets
          (arta_reference_no, full_name, cellphone_number, email_address, district, school_name, nature_of_request, description, privacy_consent, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'Pending')`
      )
        .bind(
          ref,
          fullName || null,
          phone,
          email,
          district || null,
          schoolName,
          nature,
          description
        )
        .run();
      if (!result.success) throw new Error("D1 insert failed.");
      referenceNo = ref;
      break;
    } catch (err) {
      if (isUniqueConstraintError(err)) continue;
      console.error("Ticket insert failed:", err);
      return c.json({ ok: false, error: "Could not save your submission. Please try again." }, 500);
    }
  }

  if (!referenceNo) {
    return c.json({ ok: false, error: "Could not save your submission. Please try again." }, 500);
  }

  let evidenceUrl: string | null = null;
  if (evidence) {
    try {
      const uploaded = await uploadEvidence(c.env, evidence.name, evidence.mime, evidence.bytes, referenceNo);
      evidenceUrl = uploaded.webViewLink;
      await c.env.DB.prepare(
        `UPDATE tickets SET evidence_file_name = ?, evidence_file_url = ?, evidence_mime = ?, evidence_size = ?
         WHERE arta_reference_no = ?`
      )
        .bind(uploaded.name, evidenceUrl, uploaded.mimeType, evidence.size, referenceNo)
        .run();
    } catch (err) {
      console.error("Evidence upload failed:", err);
      await c.env.DB.prepare(`DELETE FROM tickets WHERE arta_reference_no = ?`).bind(referenceNo).run();
      return c.json({ ok: false, error: "The attachment could not be stored. Please try again." }, 502);
    }
  }

  await sendConfirmationEmail(c.env, email, referenceNo, NATURE_LABELS[nature], description);

  return c.json({
    ok: true,
    artaReferenceNo: referenceNo,
    status: "Pending",
    message: "Submission received.",
  });
});

export default submit;
