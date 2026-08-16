import type { Env } from "../types";

const STORAGE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024;
const STATUS_CACHE = "storage:status-cache";

export interface StoredFile {
  key: string;
  name: string;
  mimeType: string;
  fileUrl: string;
  size: number;
}

function safeName(name: string): string {
  return (name || "file").replace(/[^\w.\- ]/g, "_").slice(0, 120);
}

async function putObject(
  env: Env,
  key: string,
  bytes: ArrayBuffer,
  mimeType: string,
  name: string
): Promise<StoredFile> {
  const clean = safeName(name);
  await env.R2.put(key, bytes, {
    httpMetadata: { contentType: mimeType },
    customMetadata: { name: clean, mime: mimeType },
  });
  return { key, name: clean, mimeType, fileUrl: `/files/${key}`, size: bytes.byteLength };
}

export async function uploadEvidence(
  env: Env,
  fileName: string,
  mimeType: string,
  bytes: ArrayBuffer,
  referenceNo: string
): Promise<StoredFile> {
  const token = crypto.randomUUID().replace(/-/g, "");
  return putObject(env, `tickets/${referenceNo}/evidence-${token}-${safeName(fileName)}`, bytes, mimeType, `${referenceNo}_${fileName}`);
}

export async function uploadIntakePdf(
  env: Env,
  referenceNo: string,
  pdfBytes: ArrayBuffer
): Promise<StoredFile> {
  const token = crypto.randomUUID().replace(/-/g, "");
  return putObject(env, `tickets/${referenceNo}/intake-${token}.pdf`, pdfBytes, "application/pdf", `Intake-Form-${referenceNo}.pdf`);
}

export interface BackupUpload {
  name: string;
  key: string;
}

async function compressJson(jsonString: string): Promise<ArrayBuffer> {
  const stream = new Blob([jsonString]).stream().pipeThrough(new CompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
}

export async function uploadBackup(env: Env, id: string, jsonString: string): Promise<BackupUpload> {
  const name = `backup-${id}.json.gz`;
  const bytes = await compressJson(jsonString);
  await env.R2.put(`backups/${name}`, bytes, { httpMetadata: { contentType: "application/gzip" } });
  return { name, key: `backups/${name}` };
}

export async function uploadExportCsv(env: Env, date: string, csv: string): Promise<BackupUpload | null> {
  try {
    const name = `tickets-${date}.csv`;
    await env.R2.put(`exports/${name}`, await new Blob([csv]).arrayBuffer(), {
      httpMetadata: { contentType: "text/csv" },
    });
    return { name, key: `exports/${name}` };
  } catch (err) {
    console.error("Export copy to storage failed:", err);
    return null;
  }
}

export interface StorageFolderInfo {
  name: string;
  count: number;
  bytes: number;
}

export interface StorageStatus {
  connected: boolean;
  quotaUsedBytes?: number;
  quotaLimitBytes?: number;
  folders: StorageFolderInfo[];
  error?: string;
}

export async function getStorageStatus(env: Env): Promise<StorageStatus> {
  const cached = await env.KV.get(STATUS_CACHE);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed.ts === "number" && Date.now() - parsed.ts < 3600_000) {
        return parsed.data as StorageStatus;
      }
    } catch {
      /* fall through */
    }
  }

  try {
    const groups = [
      { prefix: "tickets/", name: "Tickets (evidence & intake)" },
      { prefix: "backups/", name: "Backups" },
      { prefix: "exports/", name: "Exports" },
    ];
    const folders: StorageFolderInfo[] = [];
    let totalBytes = 0;
    for (const group of groups) {
      let count = 0;
      let bytes = 0;
      let cursor: string | undefined;
      do {
        const listed = await env.R2.list({ prefix: group.prefix, cursor, limit: 1000 });
        for (const obj of listed.objects) {
          count++;
          bytes += obj.size;
        }
        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);
      totalBytes += bytes;
      folders.push({ name: group.name, count, bytes });
    }

    const status: StorageStatus = {
      connected: true,
      quotaUsedBytes: totalBytes,
      quotaLimitBytes: STORAGE_LIMIT_BYTES,
      folders,
    };
    await env.KV.put(STATUS_CACHE, JSON.stringify({ ts: Date.now(), data: status }), { expirationTtl: 3600 });
    return status;
  } catch (err) {
    console.error("Storage status check failed:", err);
    return { connected: false, folders: [], error: String((err as Error)?.message ?? err) };
  }
}
