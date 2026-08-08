import type { Env } from "../types";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const TOKEN_URI = "https://oauth2.googleapis.com/token";
const FOLDER_QUERY = "name = 'DPAC Evidence' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";

interface OAuthConfig {
  client_id: string;
  client_secret: string;
  refresh_token: string;
}

async function getOAuthConfig(env: Env): Promise<OAuthConfig> {
  const raw = await env.KV.get("secret:gdrive-oauth");
  if (!raw) throw new Error("Google Drive OAuth is not configured.");
  const cfg = JSON.parse(raw) as OAuthConfig;
  if (!cfg.client_id || !cfg.client_secret || !cfg.refresh_token) throw new Error("Invalid Google Drive OAuth config.");
  return cfg;
}

async function exchangeToken(env: Env): Promise<string> {
  const cached = await env.KV.get("gdrive:token");
  if (cached) return cached;

  const cfg = await getOAuthConfig(env);
  const res = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.client_id,
      client_secret: cfg.client_secret,
      refresh_token: cfg.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token exchange failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Google token exchange returned no token.");

  const ttl = Math.max(60, (data.expires_in ?? 3600) - 60);
  await env.KV.put("gdrive:token", data.access_token, { expirationTtl: ttl });
  return data.access_token;
}

export interface EvidenceUpload {
  fileId: string;
  name: string;
  mimeType: string;
  webViewLink: string;
}

export async function uploadEvidence(
  env: Env,
  fileName: string,
  mimeType: string,
  bytes: ArrayBuffer,
  referenceNo: string
): Promise<EvidenceUpload> {
  const token = await exchangeToken(env);

  let folderId: string | null = await env.KV.get("gdrive:folder-id");
  if (!folderId) {
    const search = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(FOLDER_QUERY)}&fields=files(id,name)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (search.ok) {
      const data = (await search.json()) as { files?: Array<{ id: string; name: string }> };
      folderId = data.files?.[0]?.id ?? null;
    }
    if (folderId) await env.KV.put("gdrive:folder-id", folderId, { expirationTtl: 3600 * 24 });
  }

  const safeName = fileName.replace(/[^\w.\- ]/g, "_").slice(-80);
  const driveName = `${referenceNo}_${safeName}`;

  const boundary = `dpac-${Math.random().toString(36).slice(2)}`;
  const encoder = new TextEncoder();

  const doUpload = async (parentId: string | null): Promise<EvidenceUpload> => {
    const metadata = parentId ? { name: driveName, parents: [parentId] } : { name: driveName };
    const payload: Uint8Array[] = [];
    const push = (s: string) => payload.push(encoder.encode(s));
    push(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`);
    push(JSON.stringify(metadata));
    push(`\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`);
    payload.push(new Uint8Array(bytes));
    push(`\r\n--${boundary}--\r\n`);

    const upload = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body: new Blob(payload, { type: "multipart/related" }),
      }
    );
    if (!upload.ok) {
      const text = await upload.text();
      throw new Error(`Google Drive upload failed (${upload.status}): ${text.slice(0, 300)}`);
    }
    return (await upload.json()) as EvidenceUpload;
  };

  let data: EvidenceUpload;
  try {
    data = await doUpload(folderId);
  } catch (err) {
    if (folderId && err instanceof Error && err.message.includes("(403)")) {
      data = await doUpload(null);
    } else {
      throw err;
    }
  }

  const permRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${data.fileId}/permissions?fields=id`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    }
  );
  if (!permRes.ok) console.error(`Evidence permission failed (${permRes.status}): ${(await permRes.text()).slice(0, 300)}`);

  return { fileId: data.fileId, name: driveName, mimeType: data.mimeType, webViewLink: data.webViewLink };
}
