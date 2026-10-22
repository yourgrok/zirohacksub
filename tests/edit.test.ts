import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../src/core/db.js";
import { generatePin } from "../src/auth/pin.js";
import { resetAndSeed } from "../src/core/seed.js";
import { resetLoginLimiter } from "../src/server/auth.js";
import { Client, insertBusiness, startTestServer } from "./helpers.js";

let s: Awaited<ReturnType<typeof startTestServer>>;
beforeAll(async () => { s = await startTestServer(); });
afterAll(async () => { await s.close(); });
beforeEach(() => { resetAndSeed(); resetLoginLimiter(); });

const login = async () => { const c = new Client(s.url); await c.login(); return c; };
const row = (st: any, platform: string, key: string) => (st.rows as any[]).find((r) => r.platformId === platform && r.fieldKey === key);
const writes = () => (getDb().prepare("SELECT COUNT(*) c FROM mock_writes").get() as any).c as number;

describe("edit my details", () => {
  it("needs a login and edits only the logged-in business", async () => {
    expect((await new Client(s.url).req("/api/business", { method: "PUT", json: { phone: "+91 90000 00123" } })).status).toBe(401);
    const pin = generatePin(); insertBusiness("biz_e1", "Other Shop", pin);
    const other = new Client(s.url); await other.login(pin);
    expect((await other.req("/api/business", { method: "PUT", json: { phone: "+91 90000 00555" } })).status).toBe(200);
    const sun = await login();
    expect((await sun.get("/api/business")).body.phone).toBe("+91 90000 00001"); // untouched
    expect((await other.get("/api/business")).body.phone).toBe("+91 90000 00555");
  });

  it("validates in plain language and changes nothing on a bad request", async () => {
    const c = await login();
    for (const [body, msg] of [[{ phone: "12" }, /phone/], [{ name: "x" }, /name/i], [{ address: "short" }, /address/i], [{ hours: "whenever we like" }, /hours/i]] as const) {
      const r = await c.req("/api/business", { method: "PUT", json: body });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(msg);
    }
    const b = (await c.get("/api/business")).body;
    expect(b).toMatchObject({ name: "Sunrise Sweets & Bakery", phone: "+91 90000 00001", address: "42 Marigold Lane, Koregaon Park, Pune, Maharashtra 411001" });
    expect((await c.req("/api/business", { method: "PUT", json: { phone: "+91 90000 00001" } })).body).toEqual({ changed: [], reviewAgain: 0 }); // same value: no change
    expect((await c.get("/api/changelog")).body.entries.filter((e: any) => e.kind === "details")).toHaveLength(0);
  });

  it("the editable hours text round-trips", async () => {
    const c = await login();
    const b = (await c.get("/api/business")).body;
    expect(b.hoursText).toBe("Mon-Sat 09:00-21:00; Sun 10:00-14:00");
    expect((await c.req("/api/business", { method: "PUT", json: { hours: b.hoursText } })).body.changed).toEqual([]);
    const r = await c.req("/api/business", { method: "PUT", json: { hours: "Mon-Fri 8am-8pm; Sat 9am-2pm" } });
    expect(r.body.changed).toEqual([{ field: "hours", label: "Regular hours", from: "Mon-Sat 09:00-21:00; Sun 10:00-14:00", to: "Mon-Fri 08:00-20:00; Sat 09:00-14:00; Sun closed" }]);
  });

  it("a new phone number goes through the normal pipeline: nothing is sent until approved, then verified on each site", async () => {
    const c = await login();
    const w0 = writes();
    const r = await c.req("/api/business", { method: "PUT", json: { phone: "090000 00123" } });
    expect(r.body.changed[0]).toMatchObject({ field: "phone", from: "+91 90000 00001", to: "+91 90000 00123" });
    expect(writes()).toBe(w0); // editing the record sends nothing anywhere
    let st = (await c.post("/api/runs/scan?wait=1")).body;
    for (const p of ["site_a", "site_b", "site_c", "site_e"]) expect(row(st, p, "phone").state, p).toBe("PROPOSED");
    expect(row(st, "site_d", "phone").state).toBe("FLAGGED_NOT_OWNER");
    await c.post("/api/runs/execute?wait=1");
    expect(writes()).toBe(w0);
    for (const p of ["site_a", "site_b", "site_c"]) await c.post(`/api/platforms/${p}/approve-all`);
    st = (await c.post("/api/runs/execute?wait=1")).body;
    for (const p of ["site_a", "site_b", "site_c"]) expect(row(st, p, "phone").state, p).toBe("VERIFIED");
    expect(row(st, "site_e", "phone").state).toBe("PROPOSED"); // never approved
    expect(await (await fetch(`${s.url}/mock/a/listing/LST-A-1001`)).text()).toContain("+91 90000 00123");
  });

  it("an approval for the OLD value goes back to review when the record changes again (the old value is never sent)", async () => {
    const c = await login();
    await c.req("/api/business", { method: "PUT", json: { phone: "+91 90000 00123" } });
    let st = (await c.post("/api/runs/scan?wait=1")).body;
    await c.post(`/api/fields/${row(st, "site_a", "phone").fieldId}/approve`);
    expect(row((await c.get("/api/state")).body, "site_a", "phone").state).toBe("APPROVED");
    const second = await c.req("/api/business", { method: "PUT", json: { phone: "+91 90000 00456" } });
    expect(second.body.reviewAgain).toBe(1);
    st = (await c.get("/api/state")).body;
    expect(row(st, "site_a", "phone").state).toBe("PROPOSED");
    expect(row(st, "site_a", "phone").reason).toMatch(/record changed after you approved/);
    const w0 = writes();
    await c.post("/api/runs/execute?wait=1");
    expect(writes()).toBe(w0); // the stale approval sent nothing
    st = (await c.post("/api/runs/scan?wait=1")).body;
    expect(row(st, "site_a", "phone").intended).toContain("+91 90000 00456"); // refreshed to the newest value
  });

  it("the business NAME is a compared field: a rename is proposed, approved, sent and verified; look-alikes are untouched", async () => {
    const c = await login();
    let st = (await c.post("/api/runs/scan?wait=1")).body;
    for (const p of ["site_a", "site_b", "site_c", "site_d", "site_e"]) expect(row(st, p, "name").state, p).toBe("MATCH");
    await c.req("/api/business", { method: "PUT", json: { name: "Sunrise Sweets" } });
    st = (await c.post("/api/runs/scan?wait=1")).body;
    expect(row(st, "site_a", "name")).toMatchObject({ state: "PROPOSED", original: "Sunrise Sweets & Bakery", intended: "Sunrise Sweets" });
    expect(row(st, "site_d", "name").state).toBe("FLAGGED_NOT_OWNER");
    await c.post("/api/platforms/site_a/approve-all");
    st = (await c.post("/api/runs/execute?wait=1")).body;
    expect(row(st, "site_a", "name").state).toBe("VERIFIED");
    const html = await (await fetch(`${s.url}/mock/a/listing/LST-A-1001`)).text();
    expect(html).toContain("<h1 class=\"biz-name\">Sunrise Sweets</h1>");
    const decoy = getDb().prepare("SELECT display_name FROM mock_listings WHERE listing_id='LST-A-2002'").get() as any;
    expect(decoy.display_name).toBe("Sunrise Sweet House");
  });

  it("spelling-only differences in the name are not mismatches", async () => {
    getDb().prepare("UPDATE mock_listings SET display_name='SUNRISE SWEETS AND BAKERY' WHERE listing_id='LST-A-1001'").run();
    const c = await login();
    const st = (await c.post("/api/runs/scan?wait=1")).body;
    expect(row(st, "site_a", "name").state).toBe("FORMAT_ONLY_EQUIVALENT");
  });
});

describe("change log", () => {
  it("records what changed and when: details edits, holidays, approvals, what was sent, what was verified", async () => {
    const c = await login();
    await c.req("/api/business", { method: "PUT", json: { phone: "+91 90000 00123" } });
    const ex = (await c.get("/api/state")).body.exceptions[0];
    await c.post(`/api/exceptions/${ex.id}/cancel`);
    await c.post("/api/runs/scan?wait=1");
    await c.post("/api/platforms/site_a/approve-all");
    await c.post("/api/runs/execute?wait=1");
    const log = (await c.get("/api/changelog")).body.entries as any[];
    const phone = log.find((e) => e.kind === "details");
    expect(phone).toMatchObject({ what: expect.stringContaining("Phone"), from: "+91 90000 00001", to: "+91 90000 00123", who: "You" });
    expect(Date.parse(phone.at)).toBeGreaterThan(0);
    expect(log.find((e) => e.kind === "holiday")).toMatchObject({ to: "(cancelled)", from: expect.stringContaining("Nov 2026") });
    expect(log.some((e) => e.kind === "approval" && /Approved: Phone/.test(e.what) && e.site === "Listify")).toBe(true);
    expect(log.some((e) => e.kind === "site" && /Sent: Phone/.test(e.what))).toBe(true);
    expect(log.some((e) => e.kind === "verified" && /Verified after reload: Phone/.test(e.what))).toBe(true);
    expect(log.some((e) => e.kind === "setup" && /Demo business created/.test(e.what))).toBe(true);
    const times = log.map((e) => e.at);
    expect([...times].sort().reverse()).toEqual(times); // newest first
  });

  it("is private to each business", async () => {
    const c = await login();
    await c.req("/api/business", { method: "PUT", json: { phone: "+91 90000 00123" } });
    const pin = generatePin(); insertBusiness("biz_e2", "Other Shop", pin);
    const o = new Client(s.url); await o.login(pin);
    expect((await o.get("/api/changelog")).body.entries).toEqual([]);
    const ex = (await c.get("/api/state")).body.exceptions[0];
    expect((await o.post(`/api/exceptions/${ex.id}/cancel`)).status).toBe(404); // someone else's holiday
    expect((await c.get("/api/state")).body.exceptions[0].status).toBe("active");
  });

  it("typed closures are logged too, saying they were typed", async () => {
    const c = await login();
    const p = (await c.post("/api/nl/preview", { text: "we are closed on 26th December" })).body;
    await c.post("/api/nl/confirm", { intent: p.intent });
    const log = (await c.get("/api/changelog")).body.entries as any[];
    expect(log.find((e) => e.kind === "holiday")).toMatchObject({ who: "You (typed it)", from: "(none)", to: expect.stringContaining("26 Dec 2026") });
  });
});

describe("change log is not noisy", () => {
  it("scanning again does not repeat the same 'flagged' line", async () => {
    const c = await login();
    await c.post("/api/runs/scan?wait=1");
    await c.post("/api/runs/scan?wait=1");
    await c.post("/api/runs/scan?wait=1");
    const flags = ((await c.get("/api/changelog")).body.entries as any[]).filter((e) => /Flagged as not yours/.test(e.what));
    expect(flags).toHaveLength(1);
    expect(flags[0].site).toBe("NearbyNow");
  });
});
