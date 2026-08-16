import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { generateDpadReference, isUniqueConstraintError } from "../src/lib/reference";
import { applySchema } from "./helpers";

describe("generateDpadReference", () => {
  beforeAll(async () => {
    await applySchema();
  });

  it("starts at 00001 for the current year", async () => {
    const year = new Date().getFullYear();
    expect(await generateDpadReference(env.DB)).toBe(`DPAD-${year}-00001`);
  });

  it("increments after existing tickets", async () => {
    await env.DB.prepare(
      `INSERT INTO tickets (arta_reference_no, email_address, school_name, nature_of_request, description, privacy_consent, status)
       VALUES (?, 'a@b.com', 'School A', 'complaint', 'desc', 1, 'Pending')`
    )
      .bind(`DPAD-${new Date().getFullYear()}-00007`)
      .run();

    const year = new Date().getFullYear();
    expect(await generateDpadReference(env.DB)).toBe(`DPAD-${year}-00008`);
  });
});

describe("isUniqueConstraintError", () => {
  it("detects UNIQUE constraint failures", () => {
    expect(
      isUniqueConstraintError(
        Object.assign(new Error("D1_ERROR"), { cause: { message: "UNIQUE constraint failed" } })
      )
    ).toBe(true);
    expect(isUniqueConstraintError(new Error("something else"))).toBe(false);
    expect(isUniqueConstraintError(null)).toBe(false);
  });
});
