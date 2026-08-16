import { describe, it, expect } from "vitest";
import {
  EMAIL_RE,
  DPAD_RE,
  OTP_RE,
  PHONE_RE,
  MAX_LENGTHS,
  normalizeEmail,
  normalizePhone,
} from "../src/lib/validators";

describe("EMAIL_RE", () => {
  it("accepts valid addresses", () => {
    for (const good of [
      "user@example.com",
      "juan.dela.cruz@deped.gov.ph",
      "a+b@sub.example.co",
    ]) {
      expect(EMAIL_RE.test(good)).toBe(true);
    }
  });

  it("rejects invalid addresses", () => {
    for (const bad of ["", "nope", "a@b", "@example.com", "a@", "a b@example.com"]) {
      expect(EMAIL_RE.test(bad)).toBe(false);
    }
  });
});

describe("DPAD_RE", () => {
  it("accepts the canonical format", () => {
    expect(DPAD_RE.test("DPAD-2026-00001")).toBe(true);
  });

  it("rejects malformed references", () => {
    for (const bad of ["DPAD-26-00001", "DPAD-2026-1", "dpad-2026-00001", "DPAD-2026-00001x", "ARTA-2026-00001", ""]) {
      expect(DPAD_RE.test(bad)).toBe(false);
    }
  });
});

describe("OTP_RE", () => {
  it("accepts six digits", () => {
    expect(OTP_RE.test("123456")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const bad of ["12345", "1234567", "abcdef", "", "12345a"]) {
      expect(OTP_RE.test(bad)).toBe(false);
    }
  });
});

describe("PHONE_RE", () => {
  it("accepts PH mobile numbers", () => {
    expect(PHONE_RE.test("09171234567")).toBe(true);
  });

  it("rejects invalid numbers", () => {
    for (const bad of ["12345", "0917123456", "091712345678", "19171234567", ""]) {
      expect(PHONE_RE.test(bad)).toBe(false);
    }
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  User@Example.COM ")).toBe("user@example.com");
  });
});

describe("normalizePhone", () => {
  it("strips non-digits and converts 63-prefixed numbers", () => {
    expect(normalizePhone("+63 917 123 4567")).toBe("09171234567");
  });

  it("converts 63-prefixed to 0-prefixed", () => {
    expect(normalizePhone("639171234567")).toBe("09171234567");
  });

  it("keeps local format", () => {
    expect(normalizePhone("09171234567")).toBe("09171234567");
  });
});

describe("MAX_LENGTHS", () => {
  it("defines all expected limits", () => {
    expect(MAX_LENGTHS.description).toBe(4000);
    expect(MAX_LENGTHS.email).toBe(200);
    expect(MAX_LENGTHS.fullName).toBe(100);
  });
});