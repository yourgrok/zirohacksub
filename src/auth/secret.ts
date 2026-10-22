import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dbPath } from "../core/db.js";

let cached: string | null = null;

/**
 * Server-side secret used to HMAC PINs and to sign the mock sites' delegated credentials.
 *
 * Order: 1) the PIN_SECRET environment variable (use this on a real host);
 *        2) with a file database, a random secret generated once and kept next to it (data/.pin_secret, git-ignored,
 *           owner-only), so a restart never invalidates PINs that are still in the database;
 *        3) in-memory database in production: a random per-process secret (the data is gone on restart anyway);
 *        4) otherwise a fixed development value (tests use an in-memory database).
 */
export function appSecret(): string {
  if (process.env.PIN_SECRET) return process.env.PIN_SECRET;
  if (cached) return cached;
  const db = dbPath();
  if (db !== ":memory:") {
    const file = path.join(path.dirname(db), ".pin_secret");
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      try {
        fs.writeFileSync(file, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 }); // first run only
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
      const s = fs.readFileSync(file, "utf8").trim();
      if (s.length >= 32) return (cached = s);
    } catch {
      /* read-only or unwritable disk: fall through */
    }
  }
  if (process.env.NODE_ENV === "production") {
    cached = randomBytes(32).toString("hex");
    console.warn("PIN_SECRET is not set and no secret file could be kept: using a temporary random secret. PINs issued now will not work after a restart.");
  } else {
    cached = "dev-only-secret-not-for-production";
  }
  return cached;
}
