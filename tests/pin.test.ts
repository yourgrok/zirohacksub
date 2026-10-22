import { describe, expect, it } from "vitest";
import { DEMO_PIN, PIN_ALPHABET, PIN_LENGTH, MIN_PIN_LENGTH, formatPin, generatePin, hashPin, normalisePin, safeEqualHex } from "../src/auth/pin.js";

describe("PIN generation", () => {
  it("uses only the unambiguous alphabet (no 0, O, 1, I) and is at least 8 characters", () => {
    expect(PIN_ALPHABET).toHaveLength(32);
    for (const bad of ["0", "O", "1", "I"]) expect(PIN_ALPHABET).not.toContain(bad);
    for (let i = 0; i < 500; i++) {
      const p = generatePin();
      expect(p).toHaveLength(PIN_LENGTH);
      expect(PIN_LENGTH).toBeGreaterThanOrEqual(MIN_PIN_LENGTH);
      expect([...p].every((c) => PIN_ALPHABET.includes(c))).toBe(true);
    }
  });
  it("refuses short PINs", () => { expect(() => generatePin(7)).toThrow(); });
  it("looks random: 2000 PINs are all different and every alphabet character shows up", () => {
    const seen = new Set<string>(); const chars = new Set<string>();
    for (let i = 0; i < 2000; i++) { const p = generatePin(); seen.add(p); for (const c of p) chars.add(c); }
    expect(seen.size).toBe(2000);
    expect(chars.size).toBe(32);
  });
  it("the demo PIN is itself valid", () => { expect(normalisePin(DEMO_PIN)).toBe(DEMO_PIN); });
});

describe("PIN normalisation", () => {
  it("ignores case, spaces and dashes", () => {
    expect(normalisePin("7kq4x-m9pht")).toBe("7KQ4XM9PHT");
    expect(normalisePin(" 7KQ4X M9PHT ")).toBe("7KQ4XM9PHT");
    expect(formatPin("7KQ4XM9PHT")).toBe("7KQ4X-M9PHT");
  });
  it("rejects anything that cannot be a PIN", () => {
    for (const bad of ["", "SHORT", "7KQ4XM9PH0", "7KQ4XM9PHI", "7KQ4XM9PH!", null, undefined, 12345678, "A".repeat(40)]) expect(normalisePin(bad as any)).toBeNull();
  });
});

describe("PIN hashing (HMAC-SHA256, never plain text)", () => {
  it("is deterministic, keyed by the server secret, and does not contain the PIN", () => {
    const h = hashPin("7KQ4XM9PHT");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPin("7KQ4XM9PHT")).toBe(h);
    expect(h).not.toContain("7KQ4XM9PHT");
    expect(hashPin("7KQ4XM9PHU")).not.toBe(h);
    const old = process.env.PIN_SECRET;
    process.env.PIN_SECRET = "another-secret";
    expect(hashPin("7KQ4XM9PHT")).not.toBe(h); // a different server secret gives a different hash
    if (old === undefined) delete process.env.PIN_SECRET; else process.env.PIN_SECRET = old;
  });
  it("constant-time comparison", () => {
    const h = hashPin("7KQ4XM9PHT");
    expect(safeEqualHex(h, h)).toBe(true);
    expect(safeEqualHex(h, hashPin("AAAAAAAAAA"))).toBe(false);
    expect(safeEqualHex(h, "abcd")).toBe(false);
    expect(safeEqualHex("", "")).toBe(false);
  });
});
