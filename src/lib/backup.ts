import type { Env } from "../types";

export interface SnapshotMeta {
  id: string;
  createdAt: string;
  by: string;
  reason: string;
  rows: { tickets: number; admin_users: number; activity_log: number };
}

interface SnapshotData {
  tickets: unknown[];
  admin_users: unknown[];
  activity_log: unknown[];
}

export const MAX_SNAPSHOTS = 12;

function snapshotKey(id: string): string {
  return `backup:${id}`;
}

export async function dumpDatabase(env: Env): Promise<SnapshotData> {
  const tickets = (await env.DB.prepare(`SELECT * FROM tickets ORDER BY id`).all()).results;
  const adminUsers = (await env.DB.prepare(`SELECT * FROM admin_users ORDER BY id`).all()).results;
  const activityLog = (await env.DB.prepare(`SELECT * FROM activity_log ORDER BY id`).all()).results;
  return { tickets, admin_users: adminUsers, activity_log: activityLog };
}

export async function listSnapshots(env: Env): Promise<SnapshotMeta[]> {
  const raw = await env.KV.get("backup:index");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as SnapshotMeta[];
  } catch {
    return [];
  }
}

export async function createSnapshot(env: Env, by: string, reason: string): Promise<SnapshotMeta> {
  const data = await dumpDatabase(env);
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const meta: SnapshotMeta = {
    id,
    createdAt: new Date().toISOString(),
    by,
    reason,
    rows: {
      tickets: data.tickets.length,
      admin_users: data.admin_users.length,
      activity_log: data.activity_log.length,
    },
  };

  await env.KV.put(snapshotKey(id), JSON.stringify({ meta, data }));

  const index = await listSnapshots(env);
  index.push(meta);
  while (index.length > MAX_SNAPSHOTS) {
    const old = index.shift();
    if (old) await env.KV.delete(snapshotKey(old.id));
  }
  await env.KV.put("backup:index", JSON.stringify(index));

  return meta;
}

export async function getSnapshot(env: Env, id: string): Promise<{ meta: SnapshotMeta; data: SnapshotData } | null> {
  if (!/^[\w-]+$/.test(id)) return null;
  const raw = await env.KV.get(snapshotKey(id));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.meta || !parsed.data) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function restoreSnapshot(env: Env, id: string): Promise<{ restored: SnapshotData; safety: SnapshotMeta }> {
  const snapshot = await getSnapshot(env, id);
  if (!snapshot) throw new Error("Snapshot not found.");

  const safety = await createSnapshot(env, "system", "pre-restore safety snapshot");

  const tables = ["tickets", "admin_users", "activity_log"] as const;
  const stmts: D1PreparedStatement[] = [];
  for (const table of tables) {
    stmts.push(env.DB.prepare(`DELETE FROM ${table}`));
  }
  const insert = (table: string, rows: unknown[]): D1PreparedStatement[] =>
    rows.map((row) => {
      const keys = Object.keys(row as Record<string, unknown>);
      const placeholders = keys.map(() => "?").join(", ");
      return env.DB.prepare(
        `INSERT INTO ${table} (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${placeholders})`
      ).bind(...keys.map((k) => (row as Record<string, unknown>)[k]));
    });

  for (const table of tables) {
    stmts.push(...insert(table, snapshot.data[table]));
  }
  for (let i = 0; i < stmts.length; i += 90) {
    await env.DB.batch(stmts.slice(i, i + 90));
  }

  return { restored: snapshot.data, safety };
}
