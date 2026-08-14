import type { Env } from "../types";

export const PREF_DEFAULTS: Record<string, string> = {
  email_notifications: "1",
  confirmation_email: "1",
  anonymous_allowed: "1",
  evidence_required: "0",
  archive_to_storage: "1",
  portal_title: "DPAD Portal",
};

export async function getPrefs(env: Env): Promise<Record<string, string>> {
  const rows = await env.DB.prepare(`SELECT key, value FROM preferences`).all<{ key: string; value: string }>();
  const out = { ...PREF_DEFAULTS };
  for (const row of rows.results) out[row.key] = row.value;
  return out;
}

export async function getPref(env: Env, key: string): Promise<string> {
  const row = await env.DB.prepare(`SELECT value FROM preferences WHERE key = ?`)
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? PREF_DEFAULTS[key] ?? "";
}

export async function setPrefs(env: Env, values: Record<string, string>): Promise<void> {
  const stmts = Object.entries(values).map(([key, value]) =>
    env.DB.prepare(
      `INSERT INTO preferences (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`
    ).bind(key, value)
  );
  if (stmts.length) await env.DB.batch(stmts);
}