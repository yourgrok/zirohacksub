import { randomBytes } from "node:crypto";

let tempSecret: string | null = null;

/**
 * Server-side secret used to HMAC PINs and to sign the mock sites' delegated credentials.
 * Set PIN_SECRET in the environment. If it is missing in production a random per-process secret is used
 * (PINs created before a restart then stop working; the seeded demo PIN is re-hashed on every boot).
 */
export function appSecret(): string {
  if (process.env.PIN_SECRET) return process.env.PIN_SECRET;
  if (!tempSecret) {
    if (process.env.NODE_ENV === "production") {
      tempSecret = randomBytes(32).toString("hex");
      console.warn("PIN_SECRET is not set: using a temporary random secret. PINs issued now will not work after a restart.");
    } else {
      tempSecret = "dev-only-secret-not-for-production";
    }
  }
  return tempSecret;
}
