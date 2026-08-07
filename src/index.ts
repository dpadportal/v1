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

export default app;
