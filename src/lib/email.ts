import type { Env } from "../types";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendOtpEmail(
  env: Env,
  to: string,
  code: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!env.RESEND_API_KEY) {
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

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [to],
        subject: "Your verification code / Ang iyong verification code",
        html,
      }),
    });
    if (!res.ok) throw new Error(`Resend returned ${res.status}`);
    return { ok: true };
  } catch (err) {
    console.error("Email send failed:", err);
    return { ok: false, error: "Could not send the code. Please try again." };
  }
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
      <p style="margin: 0 0 8px; color: #374151;">Your ARTA reference number / Ang iyong ARTA reference number:</p>
      <p style="font-size: 24px; font-weight: 700; letter-spacing: 2px; margin: 0 0 16px; color: #111827;">${safeReference}</p>
      <p style="margin: 0 0 4px; color: #374151;"><strong>Nature / Uri:</strong> ${safeNature}</p>
      <p style="margin: 0 0 16px; color: #374151;"><strong>Summary / Buod:</strong> ${safePreview}</p>
      <p style="margin: 0 0 4px; color: #374151;">Status: <strong>Pending</strong></p>
      <p style="margin: 0; font-size: 12px; color: #6b7280;">You can track your ticket using this reference number on our website.</p>
    </div>
  `;

  if (!env.RESEND_API_KEY) {
    console.log(`[dev] Confirmation email for ${to}: reference ${referenceNo}`);
    return { ok: true };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [to],
        subject: `Your ARTA reference number / Ang iyong ARTA reference number: ${referenceNo}`,
        html,
      }),
    });
    return { ok: res.ok };
  } catch (err) {
    console.error("Confirmation email send failed:", err);
    return { ok: false };
  }
}
