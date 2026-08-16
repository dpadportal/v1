import { Hono } from "hono";
import type { Env } from "../types";
import { createRateLimiter, clientIp } from "../lib/rate-limit";
import { listDistricts, listSchoolsByDistrict } from "../lib/schools";

const SCHOOLS_RATE_LIMIT = 60;
const SCHOOLS_RATE_WINDOW = 60;

const schools = new Hono<{ Bindings: Env }>();

schools.get("/", async (c) => {
  const limiter = createRateLimiter(c.env.KV, "rl:schools", SCHOOLS_RATE_LIMIT, SCHOOLS_RATE_WINDOW);
  const { allowed } = await limiter.check(clientIp(c));
  if (!allowed) {
    return c.json({ ok: false, error: "Too many requests. Please try again shortly." }, 429);
  }

  const district = (c.req.query("district") ?? "").trim();
  if (!district) {
    const districts = await listDistricts(c.env.DB);
    return c.json({ ok: true, districts });
  }

  const schools = await listSchoolsByDistrict(c.env.DB, district);
  if (schools.length === 0) {
    return c.json({ ok: false, error: "District not found." }, 404);
  }
  return c.json({ ok: true, schools });
});

export default schools;