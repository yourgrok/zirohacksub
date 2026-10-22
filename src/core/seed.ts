import { getDb, wipeAll } from "./db.js";
import { nowTs } from "./clock.js";
import { DEMO_PIN, hashPin } from "../auth/pin.js";
import type { Business, Platform, PlatformListing, WeeklyHours } from "./types.js";

export const BUSINESS_ID = "biz_sunrise_001";
export const OWNER_ACCOUNT = "acct_sunrise_owner";
export const OTHER_ACCOUNT = "acct_someone_else";
export const DECOY_ACCOUNT = "acct_decoy_owner";

export const RECORD_HOURS: WeeklyHours = {
  mon: { open: "09:00", close: "21:00" }, tue: { open: "09:00", close: "21:00" }, wed: { open: "09:00", close: "21:00" },
  thu: { open: "09:00", close: "21:00" }, fri: { open: "09:00", close: "21:00" }, sat: { open: "09:00", close: "21:00" },
  sun: { open: "10:00", close: "14:00" },
};

export const BUSINESS: Business = {
  id: BUSINESS_ID,
  name: "Sunrise Sweets & Bakery",
  address: "42 Marigold Lane, Koregaon Park, Pune, Maharashtra 411001",
  phone: "+91 90000 00001",
  hours: RECORD_HOURS,
};

export const PLATFORMS: Platform[] = [
  { id: "site_a", name: "Listify (Site A)", slug: "a" },
  { id: "site_b", name: "CityPages (Site B)", slug: "b" },
  { id: "site_c", name: "LocalLoop (Site C)", slug: "c" },
  { id: "site_d", name: "NearbyNow (Site D)", slug: "d" },
  { id: "site_e", name: "ShopFront (Site E)", slug: "e" },
];

export const OURS_LISTING: Record<string, string> = {
  site_a: "LST-A-1001", site_b: "LST-B-1001", site_c: "LST-C-1001", site_d: "LST-D-1001", site_e: "LST-E-1001",
};
export const DECOY_LISTING: Record<string, string> = {
  site_a: "LST-A-2002", site_b: "LST-B-2002", site_c: "LST-C-2002", site_d: "LST-D-2002", site_e: "LST-E-2002",
};

export const DECOY = {
  name: "Sunrise Sweet House",
  address: "17 Maple Road, Camp, Pune, Maharashtra 411001",
  phone: "+91 90000 00077",
  hours: {
    mon: { open: "08:00", close: "20:00" }, tue: { open: "08:00", close: "20:00" }, wed: { open: "08:00", close: "20:00" },
    thu: { open: "08:00", close: "20:00" }, fri: { open: "08:00", close: "20:00" }, sat: { open: "08:00", close: "20:00" },
    sun: null,
  } as WeeklyHours,
};

export const DIWALI = { id: "ex_seed_diwali", start: "2026-11-08", end: "2026-11-08", kind: "special", open: "10:00", close: "14:00", reason: "Diwali" } as const;
const diwaliShown = { start: DIWALI.start, end: DIWALI.end, kind: "special", open: "10:00", close: "14:00", reason: "Diwali" };

/** Wipe everything and restore the seeded conditions. */
export function resetAndSeed() {
  wipeAll();
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("INSERT INTO business (id,name,address,phone,hours_json,pin_hmac,mock_account,status,is_demo,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(BUSINESS.id, BUSINESS.name, BUSINESS.address, BUSINESS.phone, JSON.stringify(BUSINESS.hours), hashPin(DEMO_PIN), OWNER_ACCOUNT, "active", 1, nowTs());
    db.prepare("INSERT INTO exceptions (id,business_id,start_date,end_date,kind,open,close,reason,source,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(DIWALI.id, BUSINESS_ID, DIWALI.start, DIWALI.end, DIWALI.kind, DIWALI.open, DIWALI.close, DIWALI.reason, "seed", "active", nowTs());

    const insP = db.prepare("INSERT INTO platforms VALUES (?,?,?)");
    const insPL = db.prepare("INSERT INTO platform_listings (platform_id,business_id,listing_id,public_path,dashboard_path,source,linked_at) VALUES (?,?,?,?,?,?,?)");
    const insML = db.prepare("INSERT INTO mock_listings VALUES (?,?,?,?,?,?,?,?,?)");
    for (const p of PLATFORMS) {
      insP.run(p.id, p.name, p.slug);
      const l: PlatformListing = {
        platformId: p.id, businessId: BUSINESS_ID, listingId: OURS_LISTING[p.id],
        publicPath: `/mock/${p.slug}/listing/${OURS_LISTING[p.id]}`, dashboardPath: `/mock/${p.slug}/dashboard/${OURS_LISTING[p.id]}`,
      };
      insPL.run(l.platformId, l.businessId, l.listingId, l.publicPath, l.dashboardPath, "seed", nowTs());

      // our listing, per-site conditions
      let address = BUSINESS.address, phone = BUSINESS.phone, hours: WeeklyHours = RECORD_HOURS;
      let holidays: unknown[] = [diwaliShown];
      let owner = OWNER_ACCOUNT;
      if (p.id === "site_b") holidays = [{ ...diwaliShown, kind: "closed", open: null, close: null }]; // TC1
      if (p.id === "site_c") { phone = "090000 00001"; address = "42 Marigold Ln., Koregaon Park, Pune, MH - 411001"; } // TC2 (formatting only)
      if (p.id === "site_d") { owner = OTHER_ACCOUNT; phone = "+91 90000 00099"; } // TC3 (claimed by someone else, stale phone)
      if (p.id === "site_e") hours = { ...RECORD_HOURS, sun: null }; // TC4 (moderation site, Sunday wrong)
      insML.run(p.id, OURS_LISTING[p.id], BUSINESS.name, address, phone, JSON.stringify(hours), JSON.stringify(holidays), owner, 0);
      // look-alike decoy
      insML.run(p.id, DECOY_LISTING[p.id], DECOY.name, DECOY.address, DECOY.phone, JSON.stringify(DECOY.hours),
        JSON.stringify([{ ...diwaliShown, kind: "closed", open: null, close: null }]), DECOY_ACCOUNT, 1);
    }
  });
  tx();
  // keep the browser session of whoever pressed "reset" (the demo owner), drop sessions of businesses that no longer exist
  db.exec("DELETE FROM sessions WHERE business_id NOT IN (SELECT id FROM business)");
}

/** The seeded demo PIN is re-hashed on every boot so a changed PIN_SECRET never locks the demo account out. */
export function refreshDemoPin() {
  getDb().prepare("UPDATE business SET pin_hmac=? WHERE id=?").run(hashPin(DEMO_PIN), BUSINESS_ID);
}

export function seedIfEmpty() {
  const n = (getDb().prepare("SELECT COUNT(*) c FROM business").get() as { c: number }).c;
  if (n === 0) resetAndSeed();
  else if ((getDb().prepare("SELECT COUNT(*) c FROM business WHERE id=?").get(BUSINESS_ID) as { c: number }).c) refreshDemoPin();
}
