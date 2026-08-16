import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import {
  createSnapshot,
  listSnapshots,
  getSnapshot,
  restoreSnapshot,
  dumpDatabase,
  MAX_SNAPSHOTS,
} from "../src/lib/backup";
import { applySchema, clearKv } from "./helpers";

describe("backup snapshots", () => {
  beforeAll(async () => {
    await applySchema();
  });

  beforeEach(async () => {
    await clearKv(["backup:"]);
  });

  it("creates a snapshot and lists it", async () => {
    const meta = await createSnapshot(env, "admin", "test backup");
    expect(meta.rows.tickets).toBe(0);

    const snapshots = await listSnapshots(env);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].id).toBe(meta.id);

    const stored = await getSnapshot(env, meta.id);
    expect(stored?.meta.reason).toBe("test backup");
    expect(stored?.data.tickets).toEqual([]);
  });

  it("rotates old snapshots beyond MAX_SNAPSHOTS", async () => {
    const ids: string[] = [];
    for (let i = 0; i < MAX_SNAPSHOTS + 2; i++) {
      const meta = await createSnapshot(env, "admin", `backup ${i}`);
      ids.push(meta.id);
    }
    const snapshots = await listSnapshots(env);
    expect(snapshots).toHaveLength(MAX_SNAPSHOTS);
    expect(await getSnapshot(env, ids[0])).toBeNull();
    expect(await getSnapshot(env, ids[ids.length - 1])).not.toBeNull();
  });

  it("restores a snapshot and creates a safety snapshot first", async () => {
    await env.DB.prepare(
      `INSERT INTO tickets (arta_reference_no, email_address, school_name, nature_of_request, description, privacy_consent, status)
       VALUES ('DPAD-2026-00001', 'a@b.com', 'School A', 'complaint', 'desc', 1, 'Pending')`
    ).run();

    const before = await createSnapshot(env, "admin", "before delete");

    await env.DB.prepare(`DELETE FROM tickets`).run();
    expect((await dumpDatabase(env)).tickets).toHaveLength(0);

    const { restored, safety } = await restoreSnapshot(env, before.id);
    expect(restored.tickets).toHaveLength(1);
    expect(safety.id).toBeTruthy();

    const rows = await env.DB.prepare(`SELECT COUNT(*) AS n FROM tickets`).first<{ n: number }>();
    expect(Number(rows?.n)).toBe(1);
    expect(await listSnapshots(env)).toHaveLength(2);
  });
});