import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../src/lib/password";

describe("hashPassword / verifyPassword", () => {
  it("verifies a correctly hashed password", async () => {
    const { salt, hash } = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", salt, hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const { salt, hash } = await hashPassword("right-password");
    expect(await verifyPassword("wrong-password", salt, hash)).toBe(false);
  });

  it("produces a unique salt per call", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it("fails cleanly on malformed input", async () => {
    expect(await verifyPassword("x", "not-base64!!", "also-not-base64!!")).toBe(false);
    expect(await verifyPassword("x", "", "")).toBe(false);
  });
});