import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { getPrefs, getPref, setPrefs, PREF_DEFAULTS } from "../src/lib/prefs";
import { applySchema } from "./helpers";

describe("preferences", () => {
  beforeAll(async () => {
    await applySchema();
  });

  it("returns defaults when nothing is stored", async () => {
    const prefs = await getPrefs(env);
    expect(prefs).toEqual(PREF_DEFAULTS);
    expect(await getPref(env, "portal_title")).toBe("DPAD Portal");
  });

  it("persists and merges updates", async () => {
    await setPrefs(env, { anonymous_allowed: "0", portal_title: "My Portal" });
    const prefs = await getPrefs(env);
    expect(prefs.anonymous_allowed).toBe("0");
    expect(prefs.portal_title).toBe("My Portal");
    expect(prefs.email_notifications).toBe(PREF_DEFAULTS.email_notifications);
  });
});