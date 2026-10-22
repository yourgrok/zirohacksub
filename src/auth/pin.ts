import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { appSecret } from "./secret.js";

/** 32 unambiguous characters: A-Z without I and O, digits 2-9 (no 0/O/1/I). 32 = 2^5, so no modulo bias. */
export const PIN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const PIN_LENGTH = 10; // 10 x 5 bits = 50 bits of entropy
export const MIN_PIN_LENGTH = 8;

/** Synthetic PIN of the seeded demo business (documented in the README). */
export const DEMO_PIN = "7KQ4XM9PHT";

/** Cryptographically random PIN from the unambiguous alphabet. */
export function generatePin(length = PIN_LENGTH): string {
  if (length < MIN_PIN_LENGTH) throw new Error(`PIN must be at least ${MIN_PIN_LENGTH} characters`);
  let out = "";
  for (let i = 0; i < length; i++) out += PIN_ALPHABET[randomInt(PIN_ALPHABET.length)];
  return out;
}

/** "7kq4x-m9pht" / " 7KQ4X M9PHT " -> "7KQ4XM9PHT". Returns null if it cannot be a valid PIN. */
export function normalisePin(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = input.toUpperCase().replace(/[\s\-_]/g, "");
  if (s.length < MIN_PIN_LENGTH || s.length > 32) return null;
  for (const ch of s) if (!PIN_ALPHABET.includes(ch)) return null;
  return s;
}

/** Display form: XXXXX-XXXXX */
export function formatPin(pin: string): string {
  return pin.length === 10 ? `${pin.slice(0, 5)}-${pin.slice(5)}` : pin;
}

/** HMAC-SHA256(secret, PIN). This is the only thing stored; it doubles as the lookup key (there is no username). */
export function hashPin(pin: string): string {
  return createHmac("sha256", appSecret()).update(`pin:v1:${pin}`).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}
