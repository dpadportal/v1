import { describe, it, expect } from "vitest";
import { sha256, randomDigits, randomInt } from "../src/lib/crypto";

describe("sha256", () => {
  it("matches the known SHA-256 vector for 'abc'", async () => {
    expect(await sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("is deterministic", async () => {
    const a = await sha256("hello");
    const b = await sha256("hello");
    expect(a).toBe(b);
  });

  it("differs across inputs", async () => {
    expect(await sha256("a")).not.toBe(await sha256("b"));
  });
});

describe("randomDigits", () => {
  it("produces exactly the requested number of digits", () => {
    for (const n of [1, 6, 12]) {
      expect(randomDigits(n)).toMatch(new RegExp(`^\\d{${n}}$`));
    }
  });

  it("is not constant", () => {
    const seen = new Set(Array.from({ length: 20 }, () => randomDigits(6)));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("randomInt", () => {
  it("respects the exclusive upper bound", () => {
    for (let i = 0; i < 200; i++) {
      const value = randomInt(20);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(20);
    }
  });

  it("rejects non-positive bounds", () => {
    expect(() => randomInt(0)).toThrow();
    expect(() => randomInt(-1)).toThrow();
  });
});