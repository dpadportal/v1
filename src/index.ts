import { Hono } from "hono";
import type { Env } from "./types";
import otp from "./routes/otp";
import captcha from "./routes/captcha";
import submit from "./routes/submit";
import track from "./routes/track";
import schools from "./routes/schools";
import admin from "./routes/admin";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", async (c, next) => {
  const method = c.req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return next();
  }
  const origin = c.req.header("Origin") ?? c.req.header("Referer");
  if (origin) {
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      return c.json({ ok: false, error: "Requests from this origin are blocked." }, 403);
    }
    const requestHost = new URL(c.req.url).host;
    if (originHost !== requestHost) {
      return c.json({ ok: false, error: "Cross-origin requests are blocked." }, 403);
    }
  }
  return next();
});

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/api/send-otp", otp);
app.route("/api/captcha", captcha);
app.route("/api/submit", submit);
app.route("/api/track", track);
app.route("/api/schools", schools);
app.route("/api/admin", admin);

app.get("/admin", (c) => c.env.ASSETS.fetch(new Request(new URL("/admin.html", c.req.url), c.req.raw)));
app.get("/accounts", (c) => c.env.ASSETS.fetch(new Request(new URL("/accounts.html", c.req.url), c.req.raw)));
app.get("/logs", (c) => c.env.ASSETS.fetch(new Request(new URL("/logs.html", c.req.url), c.req.raw)));
app.get("/intake", (c) => c.env.ASSETS.fetch(new Request(new URL("/intake.html", c.req.url), c.req.raw)));

app.get("/files/*", async (c) => {
  const key = c.req.path.replace(/^\/files\//, "");
  if (!key) return c.json({ error: "File not found." }, 404);
  const obj = await c.env.R2.get(key);
  if (!obj) return c.json({ error: "File not found." }, 404);
  const name = obj.customMetadata?.name ?? key.split("/").pop() ?? key;
  const headers: Record<string, string> = {
    "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
    "Cache-Control": "public, max-age=86400",
  };
  if (c.req.query("dl") === "1") headers["Content-Disposition"] = `attachment; filename="${name}"`;
  return new Response(obj.body, { headers });
});

app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export { app };

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
        if ((await getPref(env, "archive_to_storage")) === "1") {
          const { uploadBackup } = await import("./lib/storage");
          const data = await dumpDatabase(env);
          const uploaded = await uploadBackup(env, meta.id, JSON.stringify(data));
          await logActivity(env, "system", "backup_storage", `Pushed ${uploaded.name} to portal storage`, "cron");
        }
      } catch (err) {
        console.error("Storage backup push failed:", err);
        await logActivity(env, "system", "backup_storage_failed", String((err as Error)?.message ?? err), "cron");
      }
    } catch (err) {
      console.error("Scheduled backup failed:", err);
    }
  },
};
