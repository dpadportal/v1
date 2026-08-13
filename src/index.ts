import { Hono } from "hono";
import type { Env } from "./types";
import otp from "./routes/otp";
import captcha from "./routes/captcha";
import submit from "./routes/submit";
import track from "./routes/track";
import admin from "./routes/admin";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/api/send-otp", otp);
app.route("/api/captcha", captcha);
app.route("/api/submit", submit);
app.route("/api/track", track);
app.route("/api/admin", admin);

app.get("/admin", (c) => c.env.ASSETS.fetch(new Request(new URL("/admin.html", c.req.url), c.req.raw)));
app.get("/accounts", (c) => c.env.ASSETS.fetch(new Request(new URL("/accounts.html", c.req.url), c.req.raw)));
app.get("/logs", (c) => c.env.ASSETS.fetch(new Request(new URL("/logs.html", c.req.url), c.req.raw)));
app.get("/intake", (c) => c.env.ASSETS.fetch(new Request(new URL("/intake.html", c.req.url), c.req.raw)));

app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  scheduled: async (_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> => {
    const { createSnapshot, dumpDatabase } = await import("./lib/backup");
    const { logActivity } = await import("./lib/auth");
    try {
      const meta = await createSnapshot(env, "auto", "scheduled weekly backup");
      await logActivity(env, "system", "backup_auto", `Snapshot ${meta.id} (tickets=${meta.rows.tickets})`, "cron");

      try {
        const { getPref } = await import("./lib/prefs");
        if (await getPref(env, "archive_to_drive") === "1") {
          const { uploadBackup } = await import("./lib/gdrive");
          const data = await dumpDatabase(env);
          const uploaded = await uploadBackup(env, meta.id, JSON.stringify(data));
          await logActivity(env, "system", "backup_drive", `Pushed ${uploaded.name} to Google Drive`, "cron");
        }
      } catch (err) {
        console.error("Drive backup push failed:", err);
        await logActivity(env, "system", "backup_drive_failed", String((err as Error)?.message ?? err), "cron");
      }
    } catch (err) {
      console.error("Scheduled backup failed:", err);
    }
  },
};
