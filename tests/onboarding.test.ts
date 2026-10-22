import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../src/core/db.js";
import { PIN_ALPHABET, normalisePin } from "../src/auth/pin.js";
import { BUSINESS, GREEN_LEAF, resetAndSeed } from "../src/core/seed.js";
import { PENDING_BUSINESS_TTL_MS } from "../src/onboarding/config.js";
import { expirePending } from "../src/onboarding/service.js";
import { resetLoginLimiter } from "../src/server/auth.js";
import { resetStartLimiter } from "../src/server/onboarding.js";
import { Client, startTestServer } from "./helpers.js";

let s: Awaited<ReturnType<typeof startTestServer>>;
beforeAll(async () => { s = await startTestServer(); });
afterAll(async () => { await s.close(); });
beforeEach(() => { resetAndSeed(); resetLoginLimiter(); resetStartLimiter(); });

const gl = { name: GREEN_LEAF.name, address: GREEN_LEAF.address, phone: GREEN_LEAF.phone, hours: "Mon-Sun 8am-10pm" };
const owner = (listingId: string) => (getDb().prepare("SELECT owner_account o FROM mock_listings WHERE listing_id=?").get(listingId) as any).o as string | null;

async function start(c: Client, details: object = gl) {
  const r = await c.post("/api/onboarding/start", details);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}
async function confirmAC(c: Client, draft: any) {
  return c.post(`/api/onboarding/${draft.draftId}/confirm`, { decisions: { site_a: { action: "confirm", listingId: "LST-A-4001" }, site_c: { action: "confirm", listingId: "LST-C-4001" } } });
}

describe("onboarding: match, confirm, view-once PIN", () => {
  it("start reads all sites and returns a score breakdown per site (no login needed)", async () => {
    const d = await start(new Client(s.url));
    const by = Object.fromEntries(d.sites.map((x: any) => [x.platformId, x]));
    expect(d.sites).toHaveLength(5);
    expect(by.site_a.status).toBe("auto");
    expect(by.site_a.pick.breakdown.phone.points).toBe(40);
    expect(by.site_a.pick.score).toBe(100);
    expect(by.site_c.status).toBe("auto");
    expect(by.site_b.status).toBe("none");
    expect(by.site_d.status).toBe("claimed");
    expect(by.site_e.status).toBe("none");
    expect(d.needsDecision.sort()).toEqual(["site_a", "site_c"]);
    expect(d.thresholds).toEqual({ high: 75, low: 45, margin: 15 });
  });

  it("rejects bad details with a plain message", async () => {
    const c = new Client(s.url);
    for (const bad of [{ ...gl, phone: "12" }, { ...gl, name: "x" }, { ...gl, address: "short" }, { ...gl, hours: "whenever we feel like it" }, {}]) {
      const r = await c.post("/api/onboarding/start", bad);
      expect(r.status).toBe(400);
      expect(typeof r.body.error).toBe("string");
    }
  });

  it("nothing is linked, claimed or created before the owner confirms", async () => {
    await start(new Client(s.url));
    expect(owner("LST-A-4001")).toBeNull();
    expect((getDb().prepare("SELECT COUNT(*) c FROM business").get() as any).c).toBe(1);
  });

  it("confirm validates against the server's matches, never the browser's", async () => {
    const c = new Client(s.url);
    const d = await start(c);
    const post = (decisions: any) => c.post(`/api/onboarding/${d.draftId}/confirm`, { decisions });
    expect((await post({})).status).toBe(400); // every auto/ask site needs an answer
    expect((await post({ site_a: { action: "confirm", listingId: "LST-A-4001" } })).status).toBe(400); // site C unanswered
    const ok = { site_a: { action: "confirm", listingId: "LST-A-4001" }, site_c: { action: "confirm", listingId: "LST-C-4001" } };
    expect((await post({ ...ok, site_d: { action: "confirm", listingId: "LST-D-4001" } })).status).toBe(400); // claimed by someone else: cannot be linked
    expect((await post({ ...ok, site_a: { action: "confirm", listingId: "LST-A-1001" } })).status).toBe(400); // Sunrise's real listing was not offered
    expect((await post({ ...ok, site_a: { action: "confirm", listingId: "LST-A-2002" } })).status).toBe(400); // look-alike
    expect((await post({ ...ok, site_b: { action: "confirm", listingId: "LST-B-4002" } })).status).toBe(400); // nothing to confirm on B
    expect((getDb().prepare("SELECT COUNT(*) c FROM business").get() as any).c).toBe(1); // nothing was created by the failed attempts
    expect((await post(ok)).status).toBe(200);
  });

  it("the PIN is returned once, well-formed, never stored, and cannot be fetched again", async () => {
    const c = new Client(s.url);
    const d = await start(c);
    const r = await confirmAC(c, d);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const pin = normalisePin(r.body.pin)!;
    expect(pin).toHaveLength(10);
    expect([...pin].every((ch) => PIN_ALPHABET.includes(ch))).toBe(true);
    expect(r.body).toMatchObject({ businessName: "Green Leaf Cafe", confirmed: 2, hoursAssumed: false });
    // the draft is spent: a second confirm (or a GET of it) shows nothing
    expect((await confirmAC(c, d)).status).toBe(404);
    expect((await c.get(`/api/onboarding/${d.draftId}`)).status).toBe(404);
    // nowhere in the database
    const dump = JSON.stringify(["business", "site_matches", "audit_log", "trace", "runs", "onboarding_drafts", "sessions"].map((t) => getDb().prepare(`SELECT * FROM ${t}`).all()));
    expect(dump).not.toContain(pin);
    expect(dump).not.toContain(r.body.pin);
    // not logged in yet, not claimed yet
    expect((await c.get("/api/state")).status).toBe(401);
    expect(owner("LST-A-4001")).toBeNull();
    expect((getDb().prepare("SELECT status FROM business WHERE name='Green Leaf Cafe'").get() as any).status).toBe("pending");
  });

  it("two people finishing the same draft at once: exactly one PIN is issued", async () => {
    const c = new Client(s.url);
    const d = await start(c);
    const [x, y] = await Promise.all([confirmAC(new Client(s.url), d), confirmAC(new Client(s.url), d)]);
    expect([x.status, y.status].filter((st) => st === 200)).toHaveLength(1);
    expect((getDb().prepare("SELECT COUNT(*) c FROM business WHERE name='Green Leaf Cafe'").get() as any).c).toBe(1);
  });

  it("start is throttled per client", async () => {
    const c = new Client(s.url);
    for (let i = 0; i < 10; i++) expect((await c.post("/api/onboarding/start", gl)).status).toBe(200);
    expect((await c.post("/api/onboarding/start", gl)).status).toBe(429);
  });
});

describe("activation on first login", () => {
  it("the first login claims the confirmed listings, links them, and everything is scoped to the new uid", async () => {
    const c = new Client(s.url);
    const created = (await confirmAC(c, await start(c))).body;
    const login = await c.login(created.pin);
    expect(login.status).toBe(200);
    const bizId = login.body.business.id as string;
    expect(bizId).toMatch(/^biz_[0-9a-f]{12}$/);
    expect(owner("LST-A-4001")).toBe(`acct_${bizId}`);
    expect(owner("LST-C-4001")).toBe(`acct_${bizId}`);
    expect(owner("LST-D-4001")).toBe("acct_other_biz"); // the listing claimed by someone else was never touched
    expect(owner("LST-B-4002")).toBe("acct_other_biz");

    const st = (await c.get("/api/state")).body;
    expect(st.business).toMatchObject({ id: bizId, name: "Green Leaf Cafe", isDemo: false });
    expect(st.platforms.map((p: any) => p.listing.listingId).sort()).toEqual(["LST-A-4001", "LST-C-4001"]);
    expect((getDb().prepare("SELECT status FROM site_matches WHERE business_id=? ORDER BY platform_id").all(bizId) as any[]).map((r) => r.status))
      .toEqual(["linked", "none", "linked", "flagged", "none"]);

    // Sunrise's world is untouched and invisible
    const sun = new Client(s.url); await sun.login();
    expect((await sun.get("/api/state")).body.platforms).toHaveLength(5);
    expect(JSON.stringify((await sun.get("/api/trace?all=1")).body)).not.toContain("Green Leaf");
  });

  it("the agent trace shows matching, confirmation, creation, claiming and login — all Deterministic, no PIN", async () => {
    const c = new Client(s.url);
    const created = (await confirmAC(c, await start(c))).body;
    await c.login(created.pin);
    const rows = (await c.get("/api/trace?all=1")).body.rows as any[];
    const tools = rows.map((r) => r.tool);
    for (const t of ["match_site", "owner_confirm", "create_business", "claim_listing", "login"]) expect(tools).toContain(t);
    expect(rows.every((r) => r.decider === "Deterministic")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(normalisePin(created.pin)!);
    expect(JSON.stringify(rows)).not.toContain(created.pin);
    const latest = (await c.get("/api/trace")).body;
    expect(latest.rows.some((r: any) => r.tool === "match_site")).toBe(true); // the onboarding run is the latest run shown
  });

  it("the new business can run the agent: formatting-only on C, everything matches on A", async () => {
    const c = new Client(s.url);
    const created = (await confirmAC(c, await start(c))).body;
    await c.login(created.pin);
    const st = (await c.post("/api/runs/scan?wait=1")).body;
    const rows = st.rows as any[];
    expect(rows.filter((r) => r.platformId === "site_a").every((r) => r.state === "MATCH")).toBe(true);
    const cRows = Object.fromEntries(rows.filter((r) => r.platformId === "site_c").map((r) => [r.fieldKey, r.state]));
    expect(cRows).toMatchObject({ phone: "FORMAT_ONLY_EQUIVALENT", address: "FORMAT_ONLY_EQUIVALENT", hours: "MATCH" });
    expect(rows.some((r) => ["site_b", "site_d", "site_e"].includes(r.platformId))).toBe(false); // no listing there, nothing read
  });

  it("entering Sunrise's own details cannot take over its listings: all flagged, nothing linked, nothing claimed", async () => {
    const c = new Client(s.url);
    const d = await start(c, { name: BUSINESS.name, address: BUSINESS.address, phone: BUSINESS.phone });
    expect(d.sites.every((x: any) => x.status === "claimed")).toBe(true);
    const created = (await c.post(`/api/onboarding/${d.draftId}/confirm`, { decisions: {} })).body;
    await c.login(created.pin);
    expect((await c.get("/api/state")).body.platforms).toEqual([]);
    for (const x of ["A", "B", "C", "D", "E"]) expect(owner(`LST-${x}-1001`)).toBe(x === "D" ? "acct_someone_else" : "acct_sunrise_owner");
    expect((getDb().prepare("SELECT COUNT(*) c FROM mock_writes WHERE action='claim'").get() as any).c).toBe(0);
  });

  it("a rejected match is never claimed", async () => {
    const c = new Client(s.url);
    const d = await start(c);
    const r = await c.post(`/api/onboarding/${d.draftId}/confirm`, { decisions: { site_a: { action: "confirm", listingId: "LST-A-4001" }, site_c: { action: "reject" } } });
    await c.login(r.body.pin);
    expect(owner("LST-A-4001")).toMatch(/^acct_biz_/);
    expect(owner("LST-C-4001")).toBeNull();
    expect((await c.get("/api/state")).body.platforms).toHaveLength(1);
  });

  it("if someone else claims a listing before the first login, it is flagged and not linked", async () => {
    const c1 = new Client(s.url), c2 = new Client(s.url);
    const r1 = (await confirmAC(c1, await start(c1))).body;
    const r2 = (await confirmAC(c2, await start(c2))).body; // both confirmed the same listings
    expect((await c1.login(r1.pin)).status).toBe(200);
    expect((await c2.login(r2.pin)).status).toBe(200); // the second still gets in…
    expect((await c2.get("/api/state")).body.platforms).toEqual([]); // …but the listings were already taken
    const flagged = getDb().prepare("SELECT status, note FROM site_matches WHERE status='flagged' AND platform_id='site_a'").all() as any[];
    expect(flagged.some((f) => /someone else claimed/.test(f.note))).toBe(true);
    expect((await c1.get("/api/state")).body.platforms).toHaveLength(2);
  });

  it("a PIN that is never used expires: the business is discarded and the owner can simply start again", async () => {
    const c = new Client(s.url);
    const created = (await confirmAC(c, await start(c))).body;
    expect((getDb().prepare("SELECT COUNT(*) c FROM business").get() as any).c).toBe(2);
    expirePending(Date.now() + PENDING_BUSINESS_TTL_MS + 60_000);
    expect((getDb().prepare("SELECT COUNT(*) c FROM business").get() as any).c).toBe(1);
    expect((await new Client(s.url).login(created.pin)).status).toBe(401); // the lost/never-used PIN is dead
    expect(owner("LST-A-4001")).toBeNull(); // nothing had been claimed, so redoing onboarding works
    const again = await start(new Client(s.url));
    expect(again.sites.find((x: any) => x.platformId === "site_a").status).toBe("auto");
  });
});

describe("reset really wipes everything", () => {
  it("resetAndSeed leaves no rows of deleted businesses behind (matches, drafts, change log)", async () => {
    const c = new Client(s.url);
    const d = await start(c);
    await confirmAC(c, d);
    await start(new Client(s.url)); // an open draft
    expect(count("SELECT COUNT(*) c FROM site_matches")).toBeGreaterThan(0);
    expect(count("SELECT COUNT(*) c FROM onboarding_drafts")).toBeGreaterThan(0);
    resetAndSeed();
    for (const t of ["site_matches", "onboarding_drafts"]) expect(count(`SELECT COUNT(*) c FROM ${t}`), t).toBe(0);
    expect(count("SELECT COUNT(*) c FROM change_log WHERE business_id <> 'biz_sunrise_001'")).toBe(0); // only the re-created demo business has a log
    expect(count("SELECT COUNT(*) c FROM business")).toBe(1);
  });
});
const count = (sql: string) => (getDb().prepare(sql).get() as any).c as number;
