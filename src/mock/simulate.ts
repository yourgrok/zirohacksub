import { getDb } from "../core/db.js";
import type { HolidayEntry } from "./changes.js";

/**
 * "The real world changes" switches for the DEMO business only. They act on the mock sites (never on our own record) so the agent has
 * to notice and cope: someone edits a listing behind our back, a site is briefly down, or a site says OK but drops our edit.
 */
const outage = new Map<string, number>();   // site slug -> number of upcoming requests that will fail with HTTP 503
const lostWrites = new Map<string, number>(); // site slug -> number of upcoming edits that return 200 but are silently dropped

export function resetSimulation() { outage.clear(); lostWrites.clear(); }

/** Called by the mock site on every read. true = answer 503 this time. */
export function consumeOutage(slug: string): boolean {
  const n = outage.get(slug) ?? 0;
  if (n <= 0) return false;
  outage.set(slug, n - 1);
  return true;
}
/** Called by the mock dashboard on every accepted edit. true = pretend it worked but do not store it. */
export function consumeLostWrite(slug: string): boolean {
  const n = lostWrites.get(slug) ?? 0;
  if (n <= 0) return false;
  lostWrites.set(slug, n - 1);
  return true;
}

export type SimKind = "drift_phone" | "drift_diwali" | "outage" | "lost_write";
export const SIM_KINDS: SimKind[] = ["drift_phone", "drift_diwali", "outage", "lost_write"];

/** Returns a plain sentence describing what was changed. */
export function simulate(kind: SimKind, site = "b"): string {
  const platform = `site_${site}`;
  const row = getDb().prepare("SELECT * FROM mock_listings WHERE site=? AND is_decoy=0 AND owner_account=(SELECT mock_account FROM business WHERE is_demo=1 LIMIT 1)").get(platform) as any;
  switch (kind) {
    case "drift_phone": {
      if (!row) throw new Error("listing not found");
      getDb().prepare("UPDATE mock_listings SET phone=? WHERE site=? AND listing_id=?").run("+91 90000 00123", platform, row.listing_id);
      return `Someone changed the phone number on ${platform.replace("site_", "site ").toUpperCase()} to +91 90000 00123.`;
    }
    case "drift_diwali": {
      if (!row) throw new Error("listing not found");
      const h: HolidayEntry[] = [{ start: "2026-11-08", end: "2026-11-08", kind: "special", open: "09:00", close: "12:00", reason: "Diwali" }];
      getDb().prepare("UPDATE mock_listings SET holidays_json=? WHERE site=? AND listing_id=?").run(JSON.stringify(h), platform, row.listing_id);
      return `Someone changed the Diwali hours on ${platform.replace("site_", "site ").toUpperCase()} to 9:00 AM to 12:00 PM.`;
    }
    case "outage": outage.set(site, 2); return `Site ${site.toUpperCase()} will fail its next 2 page loads (temporary outage).`;
    case "lost_write": lostWrites.set(site, 1); return `Site ${site.toUpperCase()} will say OK to the next edit but drop it.`;
  }
}
