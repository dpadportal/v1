import type { Env, TicketStatus } from "../types";

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

const STATUS_LABELS: Record<TicketStatus, string> = {
  Pending: "Pending",
  "Under Review": "Under Review",
  Resolved: "Resolved",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface EmailAttachment {
  filename: string;
  contentType: string;
  base64: string;
}

function senderInfo(env: Env): { name: string; email: string } {
  const raw = env.EMAIL_FROM ?? "DPAD Portal <noreply@localhost>";
  const match = /^\s*(.*?)\s*<([^>]+)>/.exec(raw);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  return { name: "DPAD Portal", email: raw.trim() };
}

async function brevoSend(
  env: Env,
  to: string,
  subject: string,
  html: string,
  attachments: EmailAttachment[] = []
): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = env.BREVO_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "Email service is not configured." };
  }

  const sender = senderInfo(env);
  const payload: Record<string, unknown> = {
    sender: { name: sender.name, email: sender.email },
    to: [{ email: to }],
    subject,
    htmlContent: html,
  };
  if (attachments.length > 0) {
    payload.attachment = attachments.map((a) => ({
      name: a.filename,
      content: a.base64.replace(/\s+/g, ""),
      type: a.contentType,
    }));
  }

  try {
    const res = await fetch(BREVO_URL, {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("Brevo send failed:", res.status, text.slice(0, 300));
      return { ok: false, error: "Could not send the email. Please try again." };
    }
  } catch (err) {
    console.error("Brevo send failed:", err);
    return { ok: false, error: "Could not send the email. Please try again." };
  }

  await env.KV.put("meta:last_email", new Date().toISOString()).catch(() => undefined);
  return { ok: true };
}

export async function sendOtpEmail(
  env: Env,
  to: string,
  code: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!env.BREVO_API_KEY) {
    console.log(`[dev] OTP for ${to}: ${code}`);
    return { ok: true };
  }

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
      <h2 style="margin: 0 0 12px; color: #111827;">Your verification code / Ang iyong verification code</h2>
      <p style="margin: 0 0 16px; color: #374151;">Use this code to verify your email and submit your concern, complaint, or request. It expires in 5 minutes.</p>
      <p style="font-size: 32px; font-weight: 700; letter-spacing: 8px; margin: 0 0 16px; color: #111827;">${code}</p>
      <p style="margin: 0; font-size: 12px; color: #6b7280;">If you did not request this code, you can safely ignore this email.</p>
    </div>
  `;

  return brevoSend(env, to, "Your verification code / Ang iyong verification code", html);
}

export async function sendConfirmationEmail(
  env: Env,
  to: string,
  referenceNo: string,
  nature: string,
  description: string
): Promise<{ ok: boolean }> {
  const safeReference = escapeHtml(referenceNo);
  const safeNature = escapeHtml(nature);
  const preview = `${description.slice(0, 120)}${description.length > 120 ? "…" : ""}`;
  const safePreview = escapeHtml(preview);
  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
      <h2 style="margin: 0 0 12px; color: #2e6b27;">Submission received / Natanggap ang isinumite</h2>
      <p style="margin: 0 0 8px; color: #374151;">Your DPAD reference number / Ang iyong DPAD reference number:</p>
      <p style="font-size: 24px; font-weight: 700; letter-spacing: 2px; margin: 0 0 16px; color: #111827;">${safeReference}</p>
      <p style="margin: 0 0 4px; color: #374151;"><strong>Nature / Uri:</strong> ${safeNature}</p>
      <p style="margin: 0 0 16px; color: #374151;"><strong>Summary / Buod:</strong> ${safePreview}</p>
      <p style="margin: 0 0 4px; color: #374151;">Status: <strong>Pending</strong></p>
      <p style="margin: 0; font-size: 12px; color: #6b7280;">You can track your ticket using this reference number on our website.</p>
    </div>
  `;

  if (!env.BREVO_API_KEY) {
    console.log(`[dev] Confirmation email for ${to}: reference ${referenceNo}`);
    return { ok: true };
  }

  return brevoSend(env, to, `Your DPAD reference number / Ang iyong DPAD reference number: ${referenceNo}`, html);
}

export async function sendStatusUpdateEmail(
  env: Env,
  to: string,
  referenceNo: string,
  status: TicketStatus
): Promise<{ ok: boolean }> {
  const safeReference = escapeHtml(referenceNo);
  const label = STATUS_LABELS[status];
  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
      <h2 style="margin: 0 0 12px; color: #2e6b27;">Status update / Pag-update ng katayuan</h2>
      <p style="margin: 0 0 8px; color: #374151;">Your ticket / Ang iyong ticket: <strong>${safeReference}</strong></p>
      <p style="margin: 0 0 4px; color: #374151;">New status / Bagong katayuan:</p>
      <p style="font-size: 22px; font-weight: 700; margin: 0 0 16px; color: #111827;">${label}</p>
      <p style="margin: 0; font-size: 12px; color: #6b7280;">You can track your ticket using this reference number on our website.</p>
    </div>
  `;

  if (!env.BREVO_API_KEY) {
    console.log(`[dev] Status update email for ${to}: ${referenceNo} -> ${label}`);
    return { ok: true };
  }

  return brevoSend(env, to, `Status update for ${safeReference}`, html);
}

export async function sendIntakeFormEmail(
  env: Env,
  to: string,
  referenceNo: string,
  pdfBase64: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const safeReference = escapeHtml(referenceNo);
  const filename = `Intake-Form-${referenceNo}.pdf`;
  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
      <h2 style="margin: 0 0 12px; color: #2e6b27;">Intake form / Intake form</h2>
      <p style="margin: 0 0 8px; color: #374151;">Attached is the Clients' Feedback Intake Sheet for ticket <strong>${safeReference}</strong>.</p>
      <p style="margin: 0; font-size: 12px; color: #6b7280;">Kalakip ang Clients' Feedback Intake Sheet para sa ticket <strong>${safeReference}</strong>.</p>
    </div>
  `;

  if (!env.BREVO_API_KEY) {
    console.log(`[dev] Intake form email for ${to}: ${referenceNo}`);
    return { ok: true };
  }

  return brevoSend(env, to, `Clients' Feedback Intake Sheet - ${referenceNo}`, html, [
    { filename, contentType: "application/pdf", base64: pdfBase64 },
  ]);
}

export async function sendIntakeFormLinkEmail(
  env: Env,
  to: string,
  referenceNo: string,
  fileUrl: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const safeReference = escapeHtml(referenceNo);
  const safeUrl = escapeHtml(fileUrl);
  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
      <h2 style="margin: 0 0 12px; color: #2e6b27;">Intake form / Intake form</h2>
      <p style="margin: 0 0 8px; color: #374151;">The Clients' Feedback Intake Sheet for ticket <strong>${safeReference}</strong> is ready. Open it here:</p>
      <p style="margin: 0 0 8px;"><a href="${safeUrl}" style="color: #2e6b27; font-weight: 700;">Open Intake Form / Buksan ang Intake Form</a></p>
      <p style="margin: 0; font-size: 12px; color: #6b7280;">Kalakip ang link sa Clients' Feedback Intake Sheet para sa ticket <strong>${safeReference}</strong>.</p>
    </div>
  `;

  if (!env.BREVO_API_KEY) {
    console.log(`[dev] Intake form link email for ${to}: ${referenceNo} -> ${fileUrl}`);
    return { ok: true };
  }

  return brevoSend(env, to, `Clients' Feedback Intake Sheet - ${referenceNo}`, html);
}
