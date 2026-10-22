import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../src/core/db.js";
import { mockAuthHeaders } from "../src/auth/mockCreds.js";
import { GREEN_LEAF, resetAndSeed } from "../src/core/seed.js";
import { resetLoginLimiter } from "../src/server/auth.js";
import { resetStartLimiter } from "../src/server/onboarding.js";
import { Client, startTestServer } from "./helpers.js";

let s: Awaited<ReturnType<typeof startTestServer>>;
beforeAll(async () => { s = await startTestServer(); });
afterAll(async () => { await s.close(); });
beforeEach(() => { resetAndSeed(); resetLoginLimiter(); resetStartLimiter(); });

const gl = { name: GREEN_LEAF.name, address: GREEN_LEAF.address, phone: GREEN_LEAF.phone, hours: "Mon-Sun 8am-10pm" };
const count = (sql: string, ...a: unknown[]) => (getDb().prepare(sql).get(...a) as any).c as number;
const creates = (site?: string) => count(`SELECT COUNT(*) c FROM mock_writes WHERE action='create_listing' AND result_code IN (200,202)${site ? " AND site=?" : ""}`, ...(site ? [site] : []));

async function newOwner() {
  const c = new Client(s.url);
  const d = (await c.post("/api/onboarding/start", gl)).body;
  const r = await c.post(`/api/onboarding/${d.draftId}/confirm`, { decisions: { site_a: { action: "confirm", listingId: "LST-A-4001" }, site_c: { action: "confirm", listingId: "LST-C-4001" } } });
  expect((await c.login(r.body.pin)).status).toBe(200);
  const bizId = (await c.get("/api/auth/me")).body.business.id as string;
  return { c, bizId };
}
const field = async (c: Client, platformId: string) => ((await c.get("/api/state")).body.rows as any[]).find((r) => r.platformId === platformId && r.fieldKey === "listing:create");

describe("coverage: listed on / not listed on", () => {
  it("shows listed, missing (can add), and flagged (cannot add) sites", async () => {
    const { c } = await newOwner();
    const cov = Object.fromEntries(((await c.get("/api/state")).body.coverage as any[]).map((x) => [x.platformId, x]));
    expect(cov.site_a).toMatchObject({ status: "listed", listingId: "LST-A-4001", canAdd: false });
    expect(cov.site_c).toMatchObject({ status: "listed", canAdd: false });
    expect(cov.site_b).toMatchObject({ status: "missing", canAdd: true });
    expect(cov.site_e).toMatchObject({ status: "missing", canAdd: true });
    expect(cov.site_d).toMatchObject({ status: "flagged", canAdd: false });
    expect(cov.site_d.note).toMatch(/claimed by another account/);
  });
  it("the seeded demo business has every site listed", async () => {
    const c = new Client(s.url); await c.login();
    expect(((await c.get("/api/state")).body.coverage as any[]).every((x) => x.status === "listed" && !x.canAdd)).toBe(true);
  });
});

describe("proposing 'add my business to <site>'", () => {
  it("refuses sites that are listed, flagged, unknown, or not part of this owner's matching", async () => {
    const { c } = await newOwner();
    expect((await c.post("/api/listings/site_a/propose")).status).toBe(409); // already listed
    const flagged = await c.post("/api/listings/site_d/propose");
    expect(flagged.status).toBe(409);
    expect(flagged.body.error).toMatch(/belongs to another account/);
    expect((await c.post("/api/listings/site_zz/propose")).status).toBe(404);
    const sun = new Client(s.url); await sun.login();
    expect((await sun.post("/api/listings/site_b/propose")).status).toBe(409); // Sunrise was never onboarded through matching
    expect(creates()).toBe(0);
  });

  it("creates a card showing the exact fields and destination; nothing is sent", async () => {
    const { c } = await newOwner();
    const r = await c.post("/api/listings/site_b/propose");
    expect(r.status).toBe(200);
    const f = await field(c, "site_b");
    expect(f.state).toBe("PROPOSED");
    expect(f.intended).toContain("Create a new listing on CityPages (Site B)");
    for (const bit of ["Green Leaf Cafe", "8 Lotus Street", "+91 90000 00031", "Mon-Sun 08:00-22:00"]) expect(f.intended).toContain(bit);
    expect(f.original).toBe("(not listed on this site)");
    expect((await c.post("/api/listings/site_b/propose")).status).toBe(409); // already proposed
    expect(creates()).toBe(0);
    expect(count("SELECT COUNT(*) c FROM mock_listings WHERE site='site_b'")).toBe(3); // Sunrise, decoy, look-alike: unchanged
  });

  it("executing without an approval creates nothing", async () => {
    const { c } = await newOwner();
    await c.post("/api/listings/site_b/propose");
    await c.post("/api/runs/execute?wait=1");
    expect(creates()).toBe(0);
    expect((await field(c, "site_b")).state).toBe("PROPOSED");
  });
});

describe("approve -> create -> reload -> verify", () => {
  it("a normal site creates the listing; after reload it is VERIFIED, linked and in scope of later scans", async () => {
    const { c, bizId } = await newOwner();
    await c.post("/api/listings/site_b/propose");
    const f = await field(c, "site_b");
    expect((await c.post(`/api/fields/${f.fieldId}/approve`)).status).toBe(200);
    const st = (await c.post("/api/runs/execute?wait=1")).body;
    const row = st.rows.find((r: any) => r.fieldKey === "listing:create");
    expect(row.state).toBe("VERIFIED");
    expect(creates("site_b")).toBe(1);
    const page = await (await fetch(`${s.url}/mock/b/listing/LST-B-5001`)).text();
    for (const bit of ["Green Leaf Cafe", "LST-B-5001", "+91 90000 00031", "08:00–22:00"]) expect(page).toContain(bit);
    expect((getDb().prepare("SELECT owner_account o FROM mock_listings WHERE listing_id='LST-B-5001'").get() as any).o).toBe(`acct_${bizId}`);
    expect(st.coverage.find((x: any) => x.platformId === "site_b")).toMatchObject({ status: "listed", listingId: "LST-B-5001" });
    expect((getDb().prepare("SELECT status FROM site_matches WHERE business_id=? AND platform_id='site_b'").get(bizId) as any).status).toBe("created");
    // the look-alike next door was never touched
    expect((getDb().prepare("SELECT phone, owner_account FROM mock_listings WHERE listing_id='LST-B-4002'").get() as any)).toMatchObject({ phone: "+91 90000 00032", owner_account: "acct_other_biz" });
    // re-running never creates a second listing
    await c.post("/api/runs/execute?wait=1"); await c.post("/api/runs/scan?wait=1"); await c.post("/api/runs/execute?wait=1");
    expect(creates("site_b")).toBe(1);
    expect(count("SELECT COUNT(*) c FROM mock_listings WHERE display_name='Green Leaf Cafe' AND site='site_b'")).toBe(1);
    // the new listing is now a normal listing: a scan reads it and finds it consistent
    const scanned = ((await c.post("/api/runs/scan?wait=1")).body.rows as any[]).filter((r) => r.platformId === "site_b" && r.fieldKey !== "listing:create");
    expect(scanned.length).toBeGreaterThanOrEqual(3);
    expect(scanned.every((r) => r.state === "MATCH")).toBe(true);
  });

  it("a moderated site is PENDING_MODERATION (never 'verified') until its admin approves and the page is reloaded", async () => {
    const { c } = await newOwner();
    await c.post("/api/listings/site_e/propose");
    const f = await field(c, "site_e");
    await c.post(`/api/fields/${f.fieldId}/approve`);
    await c.post("/api/runs/execute?wait=1");
    expect((await field(c, "site_e")).state).toBe("PENDING_MODERATION");
    expect((await fetch(`${s.url}/mock/e/listing/LST-E-5001`)).status).toBe(404); // nothing public yet
    expect(((await c.get("/api/state")).body.coverage as any[]).find((x) => x.platformId === "site_e").status).toBe("pending");
    await c.post("/api/runs/execute?wait=1");
    expect((await field(c, "site_e")).state).toBe("PENDING_MODERATION"); // re-checking does not change the answer
    expect(creates("site_e")).toBe(1);
    const q = getDb().prepare("SELECT id FROM mock_queue WHERE status='pending'").get() as { id: number };
    expect((await fetch(`${s.url}/mock/admin/queue/${q.id}/approve`, { method: "POST", headers: { "content-type": "application/json" } })).status).toBe(200);
    await c.post("/api/runs/execute?wait=1");
    expect((await field(c, "site_e")).state).toBe("VERIFIED");
    expect((await fetch(`${s.url}/mock/e/listing/LST-E-5001`)).status).toBe(200);
    expect(creates("site_e")).toBe(1);
  });

  it("a moderator who rejects it leaves the card in a failed state, never 'verified'", async () => {
    const { c } = await newOwner();
    await c.post("/api/listings/site_e/propose");
    await c.post(`/api/fields/${(await field(c, "site_e")).fieldId}/approve`);
    await c.post("/api/runs/execute?wait=1");
    const q = getDb().prepare("SELECT id FROM mock_queue WHERE status='pending'").get() as { id: number };
    await fetch(`${s.url}/mock/admin/queue/${q.id}/reject`, { method: "POST", headers: { "content-type": "application/json" } });
    await c.post("/api/runs/execute?wait=1");
    expect((await field(c, "site_e")).state).toBe("MISMATCH");
    expect(((await c.get("/api/state")).body.coverage as any[]).find((x) => x.platformId === "site_e")).toMatchObject({ status: "missing", canAdd: true }); // may ask again
  });

  it("DUPLICATE GUARD: if a matching listing appears before the create is sent, nothing is created", async () => {
    const { c } = await newOwner();
    await c.post("/api/listings/site_e/propose");
    await c.post(`/api/fields/${(await field(c, "site_e")).fieldId}/approve`);
    // someone else lists the same business on site E in the meantime
    getDb().prepare("INSERT INTO mock_listings VALUES (?,?,?,?,?,?,?,?,?)").run("site_e", "LST-E-7001", "Green Leaf Cafe", GREEN_LEAF.address, GREEN_LEAF.phone, "{}", "[]", "acct_someone", 0);
    await c.post("/api/runs/execute?wait=1");
    expect(creates("site_e")).toBe(0);
    const f = await field(c, "site_e");
    expect(f.state).toBe("PROPOSED");
    expect(f.reason).toMatch(/blocked.*resolve that match first/);
    // and a fresh proposal is refused too
    await c.post(`/api/fields/${f.fieldId}/reject`);
    expect((await c.post("/api/listings/site_e/propose")).status).toBe(409);
  });

  it("the owner can reject the proposal; it is never sent and can be proposed again later", async () => {
    const { c } = await newOwner();
    await c.post("/api/listings/site_b/propose");
    await c.post(`/api/fields/${(await field(c, "site_b")).fieldId}/reject`);
    await c.post("/api/runs/execute?wait=1");
    expect(creates()).toBe(0);
    expect((await c.post("/api/listings/site_b/propose")).status).toBe(200);
    expect((await field(c, "site_b")).state).toBe("PROPOSED");
  });

  it("trace and report cover the whole flow", async () => {
    const { c } = await newOwner();
    await c.post("/api/listings/site_b/propose");
    await c.post(`/api/fields/${(await field(c, "site_b")).fieldId}/approve`);
    await c.post("/api/runs/execute?wait=1");
    const trace = (await c.get("/api/trace?all=1")).body.rows as any[];
    for (const t of ["match_site", "claim_listing", "apply_approved", "reload_and_verify"]) expect(trace.map((r) => r.tool)).toContain(t);
    const rep = (await c.get("/api/state")).body;
    const matchRows = Object.fromEntries((rep.matches as any[]).map((m) => [m.platformId, m]));
    expect(matchRows.site_a).toMatchObject({ listingId: "LST-A-4001", score: 100, confirmation: "Confirmed by owner" });
    expect(matchRows.site_d).toMatchObject({ listingId: "LST-D-4001", confirmation: "Flagged: claimed by another account (not linked)" });
    expect(matchRows.site_b).toMatchObject({ listingId: "LST-B-5001", score: null, confirmation: "Created by the agent after owner approval" }); // no match score: nothing matched
    expect(matchRows.site_e).toMatchObject({ listingId: "—", score: null, confirmation: "No listing found" }); // the look-alike is not reported as a match
    expect(matchRows.site_b.created).toMatchObject({ approval: "Approved", state: "VERIFIED" });
    expect(matchRows.site_b.created.intended).toContain("Create a new listing");
    const csv = (await c.get("/api/report-matches.csv")).body as string;
    expect(csv.split("\r\n")[0]).toBe('"Site","Matched listing ID","Match score","Why","Owner confirmation","Created listing: intended","Approval status","Verified status"');
    expect(csv).toContain("LST-B-5001");
    // the main before/after table has the create row with the brief's columns
    const main = (rep.rows as any[]).find((r) => r.fieldKey === "listing:create");
    expect(main).toMatchObject({ field: "New listing", original: "(not listed on this site)", approval: "Approved", state: "VERIFIED" });
  });
});

describe("the mock site's own rules", () => {
  it("creating needs a signed login, refuses duplicates by phone, and queues on moderated sites", async () => {
    const body = JSON.stringify({ action: "create_listing", listing: { name: "Test Shop", address: "5 Test Road, Pune 411001", phone: "+91 90000 09876", hours: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } } });
    const post = (site: string, headers: Record<string, string>) => fetch(`${s.url}/mock/${site}/listings`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
    expect((await post("a", {})).status).toBe(401);
    expect((await post("a", { "x-mock-account": "acct_x", "x-mock-token": "00".repeat(32) })).status).toBe(401);
    const ok = await post("a", mockAuthHeaders("acct_x"));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).listingId).toBe("LST-A-5001");
    expect((await post("a", mockAuthHeaders("acct_x"))).status).toBe(409); // same phone again
    const q = await post("e", mockAuthHeaders("acct_x"));
    expect(q.status).toBe(202);
    expect((await fetch(`${s.url}/mock/e/listing/LST-E-5001`)).status).toBe(404);
  });
});
