import type { Env } from "../types";
import { connect } from "cloudflare:sockets";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

interface SmtpReply {
  code: number;
  message: string;
}

async function smtpSend(
  env: Env,
  to: string,
  subject: string,
  html: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { SMTP_USER, SMTP_PASSWORD } = env;
  if (!SMTP_USER || !SMTP_PASSWORD) {
    return { ok: false, error: "SMTP is not configured." };
  }

  const socket = connect(
    { hostname: "smtp.gmail.com", port: 465 },
    { secureTransport: "on", allowHalfOpen: true }
  );

  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let buffer = "";

  async function readLine(): Promise<string> {
    while (true) {
      const idx = buffer.indexOf("\r\n");
      if (idx !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        return line;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("SMTP connection closed by server.");
      buffer += decoder.decode(value, { stream: true });
    }
  }

  async function readReply(): Promise<SmtpReply> {
    let code = 0;
    const lines: string[] = [];
    while (true) {
      const line = await readLine();
      code = Number(line.slice(0, 3));
      const sep = line[3];
      lines.push(line.slice(4));
      if (sep === " ") break;
    }
    return { code, message: lines.join(" ") };
  }

  async function writeLine(text: string): Promise<void> {
    await writer.write(encoder.encode(text + "\r\n"));
  }

  async function expect(code: number, what: string): Promise<void> {
    const reply = await readReply();
    if (reply.code !== code) {
      throw new Error(`${what}: SMTP responded ${reply.code} ${reply.message}`);
    }
  }

  try {
    await expect(220, "greeting");
    await writeLine("EHLO dpacportal.gmail.com");
    await expect(250, "EHLO");
    await writeLine(`AUTH PLAIN ${base64(`\0${SMTP_USER}\0${SMTP_PASSWORD}`)}`);
    await expect(235, "authentication");
    await writeLine(`MAIL FROM:<${SMTP_USER}>`);
    await expect(250, "MAIL FROM");
    await writeLine(`RCPT TO:<${to}>`);
    await expect(250, "RCPT TO");
    await writeLine("DATA");
    await expect(354, "DATA");

    const body = html.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
    await writeLine(`From: ${env.EMAIL_FROM}`);
    await writeLine(`To: ${to}`);
    await writeLine(`Subject: ${subject}`);
    await writeLine("MIME-Version: 1.0");
    await writeLine("Content-Type: text/html; charset=UTF-8");
    await writeLine("Content-Transfer-Encoding: 8bit");
    await writeLine("");
    await writeLine(body);
    await writeLine(".");
    await expect(250, "message accepted");

    await writeLine("QUIT");
    await reader.read().catch(() => undefined);

    return { ok: true };
  } catch (err) {
    console.error("SMTP send failed:", err);
    return { ok: false, error: "Could not send the email. Please try again." };
  } finally {
    try {
      await writer.close();
    } catch {
      /* already closed */
    }
    socket.close();
  }
}

export async function sendOtpEmail(
  env: Env,
  to: string,
  code: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!env.SMTP_USER || !env.SMTP_PASSWORD) {
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

  return smtpSend(env, to, "Your verification code / Ang iyong verification code", html);
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

  if (!env.SMTP_USER || !env.SMTP_PASSWORD) {
    console.log(`[dev] Confirmation email for ${to}: reference ${referenceNo}`);
    return { ok: true };
  }

  const result = await smtpSend(env, to, `Your ARTA reference number / Ang iyong ARTA reference number: ${referenceNo}`, html);
  return result;
}
