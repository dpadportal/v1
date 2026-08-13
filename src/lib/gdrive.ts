import type { Env } from "../types";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const TOKEN_URI = "https://oauth2.googleapis.com/token";
const FOLDER_MIME = "application/vnd.google-apps.folder";
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

async function getToken(env: Env): Promise<string> {
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

function driveApi(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(`https://www.googleapis.com${path}`, { ...init, headers });
}

export async function findOrCreateFolder(
  env: Env,
  token: string,
  name: string,
  parentId?: string
): Promise<string> {
  const parents = parentId ? ` and '${parentId}' in parents` : "";
  const q = `name = '${name.replace(/'/g, "\\'")}' and mimeType = '${FOLDER_MIME}' and trashed = false${parents}`;

  const search = await driveApi(
    token,
    `/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=10`
  );
  if (search.ok) {
    const data = (await search.json()) as { files?: Array<{ id: string; name: string }> };
    if (data.files?.length) return data.files[0].id;
  }

  const create = await driveApi(
    token,
    "/drive/v3/files?fields=id,name",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: FOLDER_MIME,
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    }
  );
  if (!create.ok) {
    const text = await create.text();
    throw new Error(`Google Drive folder create failed (${create.status}): ${text.slice(0, 300)}`);
  }
  const data = (await create.json()) as { id: string };
  return data.id;
}

async function cachedFolder(
  env: Env,
  token: string,
  kvKey: string,
  name: string,
  parentId?: string,
  ttl?: number
): Promise<string> {
  const cached = await env.KV.get(kvKey);
  if (cached) return cached;
  const id = await findOrCreateFolder(env, token, name, parentId);
  if (ttl) await env.KV.put(kvKey, id, { expirationTtl: ttl });
  else await env.KV.put(kvKey, id);
  return id;
}

export interface UploadedFile {
  id: string;
  fileId: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  thumbnailLink: string | null;
}

async function uploadBytes(
  env: Env,
  token: string,
  name: string,
  mimeType: string,
  bytes: ArrayBuffer,
  parentId: string | null
): Promise<UploadedFile> {
  const safeName = name.replace(/[^\w.\- ]/g, "_").slice(-80);
  const boundary = `dpac-${Math.random().toString(36).slice(2)}`;
  const encoder = new TextEncoder();

  const metadata = parentId ? { name: safeName, parents: [parentId] } : { name: safeName };
  const payload: Uint8Array[] = [];
  const push = (s: string) => payload.push(encoder.encode(s));
  push(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`);
  push(JSON.stringify(metadata));
  push(`\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`);
  payload.push(new Uint8Array(bytes));
  push(`\r\n--${boundary}--\r\n`);

  const upload = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,thumbnailLink",
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
  const data = (await upload.json()) as UploadedFile & { thumbnailLink?: string | null };
  return { ...data, fileId: data.id, thumbnailLink: data.thumbnailLink ?? null };
}

async function setPublicReader(token: string, fileId: string): Promise<void> {
  const permRes = await driveApi(
    token,
    `/drive/v3/files/${fileId}/permissions?fields=id`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    }
  );
  if (!permRes.ok) console.error(`Evidence permission failed (${permRes.status}): ${(await permRes.text()).slice(0, 300)}`);
}

// ---------------------------------------------------------------- evidence

export interface EvidenceUpload extends UploadedFile {}

export async function uploadEvidence(
  env: Env,
  fileName: string,
  mimeType: string,
  bytes: ArrayBuffer,
  referenceNo: string
): Promise<EvidenceUpload> {
  const token = await getToken(env);
  const rootId = await cachedFolder(env, token, "gdrive:folder-id", "DPAC Evidence", undefined, 3600 * 24);
  const folderId = await cachedFolder(env, token, `gdrive:folder:${referenceNo}`, referenceNo, rootId);
  const data = await uploadBytes(env, token, `${referenceNo}_${fileName}`, mimeType, bytes, folderId);
  await setPublicReader(token, data.id);
  return data;
}

// ---------------------------------------------------------------- archive

export async function uploadIntakePdf(
  env: Env,
  referenceNo: string,
  pdfBytes: ArrayBuffer
): Promise<UploadedFile> {
  const token = await getToken(env);
  const rootId = await cachedFolder(env, token, "gdrive:folder-id", "DPAC Evidence", undefined, 3600 * 24);
  const folderId = await cachedFolder(env, token, `gdrive:folder:${referenceNo}`, referenceNo, rootId);
  const pdf = await uploadBytes(env, token, `Intake-Form-${referenceNo}.pdf`, "application/pdf", pdfBytes, folderId);
  await setPublicReader(token, pdf.id);
  return pdf;
}

export interface ArchiveUpload {
  folderUrl: string;
  pdf: UploadedFile;
  json: UploadedFile;
}

export async function uploadArchiveFiles(
  env: Env,
  referenceNo: string,
  pdfBytes: ArrayBuffer,
  jsonString: string
): Promise<ArchiveUpload> {
  const token = await getToken(env);
  const rootId = await cachedFolder(env, token, "gdrive:folder-archive", "DPAC Archive", undefined, 3600 * 24);
  const folderId = await cachedFolder(env, token, `gdrive:arch-folder:${referenceNo}`, referenceNo, rootId);
  const pdf = await uploadBytes(env, token, `Intake-Form-${referenceNo}.pdf`, "application/pdf", pdfBytes, folderId);
  const json = await uploadBytes(env, token, `${referenceNo}.json`, "application/json", await new Blob([jsonString]).arrayBuffer(), folderId);
  await setPublicReader(token, pdf.id);
  await setPublicReader(token, json.id);
  return { folderUrl: pdf.webViewLink, pdf, json };
}

// ---------------------------------------------------------------- backups / exports

export interface DriveBackupUpload {
  name: string;
  fileId: string;
}

export async function uploadBackup(env: Env, id: string, jsonString: string): Promise<DriveBackupUpload> {
  const token = await getToken(env);
  const folderId = await cachedFolder(env, token, "gdrive:folder-backups", "DPAC Backups", undefined, 3600 * 24);
  const compressed = await compressJson(jsonString);
  const data = await uploadBytes(env, token, `backup-${id}.json.gz`, "application/gzip", compressed, folderId);
  return { name: data.name, fileId: data.id };
}

export async function uploadExportCsv(env: Env, date: string, csv: string): Promise<DriveBackupUpload | null> {
  try {
    const token = await getToken(env);
    const folderId = await cachedFolder(env, token, "gdrive:folder-exports", "DPAC Exports", undefined, 3600 * 24);
    const name = `tickets-${date}.csv`;
    const existing = await driveApi(
      token,
      `/drive/v3/files?q=${encodeURIComponent(`'${folderId}' in parents and name = '${name}' and trashed = false`)}&fields=files(id)`
    );
    if (existing.ok) {
      const list = (await existing.json()) as { files?: Array<{ id: string }> };
      for (const file of list.files ?? []) {
        await driveApi(token, `/drive/v3/files/${file.id}`, { method: "DELETE" }).catch(() => undefined);
      }
    }
    const data = await uploadBytes(env, token, name, "text/csv", await new Blob([csv]).arrayBuffer(), folderId);
    return { name: data.name, fileId: data.id };
  } catch (err) {
    console.error("Export archive to Drive failed:", err);
    return null;
  }
}

async function compressJson(jsonString: string): Promise<ArrayBuffer> {
  const stream = new Blob([jsonString]).stream().pipeThrough(new CompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
}

// ---------------------------------------------------------------- status

export interface DriveFolderInfo {
  name: string;
  count: number;
  bytes: number;
}

export interface DriveStatus {
  connected: boolean;
  accountEmail?: string;
  quotaUsedBytes?: number;
  quotaLimitBytes?: number;
  folders: DriveFolderInfo[];
}

const DRIVE_STATUS_CACHE = "gdrive:status-cache";

export async function getDriveStatus(env: Env): Promise<DriveStatus> {
  const cached = await env.KV.get(DRIVE_STATUS_CACHE);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed.ts === "number" && Date.now() - parsed.ts < 3600_000) {
        return parsed.data as DriveStatus;
      }
    } catch {
      /* fall through */
    }
  }

  try {
    const token = await getToken(env);
    const about = await driveApi(token, "/drive/v3/about?fields=user(emailAddress),storageQuota(limit,usage,usageInDrive,usageInDriveTrash)");
    let accountEmail: string | undefined;
    let quotaUsedBytes: number | undefined;
    let quotaLimitBytes: number | undefined;
    if (about.ok) {
      const d = (await about.json()) as {
        user?: { emailAddress?: string };
        storageQuota?: { limit?: string; usage?: string; usageInDrive?: string; usageInDriveTrash?: string };
      };
      accountEmail = d.user?.emailAddress;
      quotaUsedBytes = Number(d.storageQuota?.usage ?? 0);
      quotaLimitBytes = Number(d.storageQuota?.limit ?? 0);
    }

    const folders: DriveFolderInfo[] = [];
    for (const name of ["DPAC Evidence", "DPAC Archive", "DPAC Backups", "DPAC Exports"]) {
      try {
        const folderId = await cachedFolder(env, token, `gdrive:status-folder:${name}`, name, undefined, 3600 * 24);
        const list = await driveApi(
          token,
          `/drive/v3/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed = false`)}&fields=files(id,size)&pageSize=1000`
        );
        if (list.ok) {
          const d = (await list.json()) as { files?: Array<{ id: string; size?: string }> };
          folders.push({
            name,
            count: d.files?.length ?? 0,
            bytes: (d.files ?? []).reduce((sum, f) => sum + Number(f.size ?? 0), 0),
          });
        } else {
          folders.push({ name, count: -1, bytes: 0 });
        }
      } catch {
        folders.push({ name, count: -1, bytes: 0 });
      }
    }

    const status: DriveStatus = { connected: true, accountEmail, quotaUsedBytes, quotaLimitBytes, folders };
    await env.KV.put(DRIVE_STATUS_CACHE, JSON.stringify({ ts: Date.now(), data: status }), { expirationTtl: 3600 });
    return status;
  } catch (err) {
    console.error("Drive status check failed:", err);
    return { connected: false, folders: [] };
  }
}