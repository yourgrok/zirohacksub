import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../src/core/db.js";
import { DEMO_PIN, generatePin, hashPin } from "../src/auth/pin.js";
import { resetAndSeed, seedIfEmpty } from "../src/core/seed.js";
import { resetLoginLimiter } from "../src/server/auth.js";
import { Client, insertBusiness, startTestServer } from "./helpers.js";

let s: Awaited<ReturnType<typeof startTestServer>>;
beforeAll(async () => { s = await startTestServer(); });
afterAll(async () => { await s.close(); });
beforeEach(() => { resetAndSeed(); resetLoginLimiter(); });

describe("every business route needs a login", () => {
  const routes: [string, string][] = [
    ["GET", "/api/state"], ["GET", "/api/report"], ["GET", "/api/report.csv"], ["GET", "/api/trace"], ["GET", "/api/audit"], ["GET", "/api/foresight"],
    ["POST", "/api/runs/scan"], ["POST", "/api/runs/execute"], ["POST", "/api/fields/1/approve"], ["POST", "/api/fields/1/reject"],
    ["POST", "/api/platforms/site_a/approve-all"], ["POST", "/api/nl/preview"], ["POST", "/api/nl/confirm"], ["POST", "/api/reset"],
    ["GET", "/api/tests"], ["POST", "/api/tests/run"], ["POST", "/api/tests/guardrail-demo"], ["GET", "/api/evidence/summary"], ["POST", "/api/foresight/hol_2026_diwali/accept"],
  ];
  it.each(routes)("%s %s -> 401 when anonymous", async (method, path) => {
    const c = new Client(s.url);
    const r = await c.req(path, { method, ...(method === "POST" ? { json: {} } : {}) });
    expect(r.status).toBe(401);
  });
  it("a forged or random session cookie is not accepted", async () => {
    const c = new Client(s.url);
    c.cookie = "sid=" + "A".repeat(43);
    expect((await c.get("/api/state")).status).toBe(401);
  });
});

describe("PIN login", () => {
  it("a valid PIN (any case, with a dash) logs in; the cookie is httpOnly + SameSite", async () => {
    const c = new Client(s.url);
    const r = await c.login("7kq4x-m9pht");
    expect(r.status).toBe(200);
    expect(r.body.business.id).toBe("biz_sunrise_001");
    const cookie = r.setCookie.find((x) => x.startsWith("sid="))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).not.toMatch(/Secure/); // plain http in the test
    expect((await c.get("/api/state")).status).toBe(200);
    expect((await c.get("/api/auth/me")).body).toMatchObject({ authenticated: true, business: { id: "biz_sunrise_001" } });
  });
  it("the cookie is Secure when the request came in over HTTPS (behind a proxy)", async () => {
    const r = await new Client(s.url).post("/api/auth/login", { pin: DEMO_PIN }, { "x-forwarded-proto": "https" });
    expect(r.setCookie.find((x) => x.startsWith("sid="))).toMatch(/Secure/);
  });
  it("wrong, malformed and empty PINs all get the same generic message", async () => {
    const c = new Client(s.url);
    const bodies = [];
    for (const pin of ["WRONGPIN22", "short", "", "7KQ4XM9PH0", undefined, 12345678]) {
      const r = await c.post("/api/auth/login", { pin });
      expect(r.status).toBe(401);
      bodies.push(JSON.stringify(r.body));
      resetLoginLimiter();
    }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toBe('{"error":"Invalid PIN."}');
  });
  it("logout ends the session on the server (the old cookie stops working)", async () => {
    const c = new Client(s.url);
    await c.login();
    const old = c.cookie;
    expect((await c.post("/api/auth/logout")).status).toBe(200);
    const again = new Client(s.url); again.cookie = old;
    expect((await again.get("/api/state")).status).toBe(401);
    expect((await again.get("/api/auth/me")).body).toEqual({ authenticated: false });
  });
  it("only the HMAC of a PIN is stored — the PIN itself is nowhere in the database", async () => {
    const pin = generatePin();
    insertBusiness("biz_x1", "X One", pin);
    const c = new Client(s.url);
    expect((await c.login(pin)).status).toBe(200);
    const dump = JSON.stringify(["business", "sessions", "audit_log", "trace", "runs", "state_history"].map((t) => getDb().prepare(`SELECT * FROM ${t}`).all()));
    expect(dump).not.toContain(pin);
    expect(dump).not.toContain(DEMO_PIN);
    expect(dump).toContain(hashPin(pin));
    const cookieToken = decodeURIComponent(c.cookie.slice(4));
    expect(dump).not.toContain(cookieToken); // sessions are stored hashed too
  });
  it("login events are in the agent trace (Deterministic) and never contain the PIN", async () => {
    const c = new Client(s.url);
    await new Client(s.url).post("/api/auth/login", { pin: "WRONGPIN22" });
    await c.login();
    const t = (await c.get("/api/trace?all=1")).body.rows as any[];
    const ev = t.find((x) => x.tool === "login");
    expect(ev).toMatchObject({ decider: "Deterministic" });
    expect(JSON.stringify(t)).not.toContain(DEMO_PIN);
    const failed = getDb().prepare("SELECT * FROM trace WHERE tool='login_failed'").all() as any[];
    expect(failed.length).toBe(1);
    expect(JSON.stringify(failed)).not.toContain("WRONGPIN22");
  });
  it("the demo PIN survives a changed PIN_SECRET after a restart (re-hashed on boot)", () => {
    const old = process.env.PIN_SECRET;
    process.env.PIN_SECRET = "a-brand-new-secret";
    const before = (getDb().prepare("SELECT pin_hmac FROM business WHERE id='biz_sunrise_001'").get() as any).pin_hmac;
    seedIfEmpty(); // what happens on boot
    const after = (getDb().prepare("SELECT pin_hmac FROM business WHERE id='biz_sunrise_001'").get() as any).pin_hmac;
    expect(after).not.toBe(before);
    expect(after).toBe(hashPin(DEMO_PIN));
    if (old === undefined) delete process.env.PIN_SECRET; else process.env.PIN_SECRET = old;
  });
});

describe("login rate limiting", () => {
  it("5 failures lock the client: even the right PIN is refused (429) with a retry time", async () => {
    const c = new Client(s.url);
    for (let i = 0; i < 5; i++) expect((await c.post("/api/auth/login", { pin: "WRONGPIN22" })).status).toBe(401);
    const locked = await c.post("/api/auth/login", { pin: DEMO_PIN });
    expect(locked.status).toBe(429);
    expect(locked.body.retryAfterSec).toBeGreaterThan(0);
    expect(locked.headers.get("retry-after")).toBeTruthy();
    expect((await c.get("/api/state")).status).toBe(401); // and no session was created
  });
  it("a successful login clears the failure count", async () => {
    const c = new Client(s.url);
    for (let i = 0; i < 4; i++) await c.post("/api/auth/login", { pin: "WRONGPIN22" });
    expect((await c.login()).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await new Client(s.url).post("/api/auth/login", { pin: "WRONGPIN22" })).status).toBe(401);
  });
});

describe("one business can never see or change another's data", () => {
  it("business B cannot read, approve, reject or see the trace of business A", async () => {
    const a = new Client(s.url); await a.login();
    await a.post("/api/runs/scan?wait=1");
    const stA = (await a.get("/api/state")).body;
    const row = stA.rows.find((r: any) => r.state === "PROPOSED");
    expect(row).toBeTruthy();

    insertBusiness("biz_b", "Business B", generatePin());
    const pinB = generatePin();
    getDb().prepare("UPDATE business SET pin_hmac=? WHERE id='biz_b'").run(hashPin(pinB));
    const b = new Client(s.url); expect((await b.login(pinB)).status).toBe(200);

    const stB = (await b.get("/api/state")).body;
    expect(stB.business.id).toBe("biz_b");
    expect(stB.rows).toEqual([]);
    expect(stB.platforms).toEqual([]);
    expect(stB.exceptions).toEqual([]);
    expect(JSON.stringify(stB)).not.toContain("Sunrise");
    // IDOR attempts with A's real ids all look like "not found"
    expect((await b.post(`/api/fields/${row.fieldId}/approve`)).status).toBe(404);
    expect((await b.post(`/api/fields/${row.fieldId}/reject`)).status).toBe(404);
    expect((await b.post(`/api/platforms/site_b/approve-all`)).body).toEqual([]);
    const trace = (await b.get(`/api/trace?runId=${(await a.get("/api/trace")).body.runId}`)).body;
    expect(trace.rows).toEqual([]);
    expect((await b.get("/api/trace?all=1")).body.rows.every((r: any) => r.tool === "login")).toBe(true);
    expect((await b.get("/api/audit")).body).toEqual([]);
    expect((await b.get("/api/report")).body.rows).toEqual([]);
    expect((await b.get("/api/report.csv")).body.split("\r\n")).toHaveLength(1); // header only
    // and A's field is untouched
    expect((await a.get("/api/state")).body.rows.find((r: any) => r.fieldId === row.fieldId).state).toBe("PROPOSED");
    // B running the agent only works on B's (empty) set of listings
    await b.post("/api/runs/scan?wait=1");
    expect((await a.get("/api/state")).body.rows.length).toBe(stA.rows.length);
  });
  it("only the demo business may reset data or run the test page", async () => {
    const pin = generatePin(); insertBusiness("biz_c", "Business C", pin);
    const c = new Client(s.url); await c.login(pin);
    for (const [m, p] of [["POST", "/api/reset"], ["GET", "/api/tests"], ["POST", "/api/tests/run"], ["POST", "/api/tests/guardrail-demo"], ["GET", "/api/evidence/summary"]] as const) {
      expect((await c.req(p, { method: m, ...(m === "POST" ? { json: {} } : {}) })).status, `${m} ${p}`).toBe(403);
    }
    expect((await c.post("/api/runs/scan?planner=rogue")).status).toBe(403);
    // Sunrise data still there
    expect((await new Client(s.url).login()).status).toBe(200);
    expect((getDb().prepare("SELECT COUNT(*) c FROM business").get() as any).c).toBe(2);
  });
});

describe("request hygiene", () => {
  it("a state-changing request from another origin is refused", async () => {
    const c = new Client(s.url); await c.login();
    const r = await c.post("/api/runs/scan", {}, { origin: "https://evil.example" });
    expect(r.status).toBe(403);
    const ok = await c.post("/api/auth/logout", {}, { origin: s.url });
    expect(ok.status).toBe(200);
  });
  it("security headers are present and X-Powered-By is gone", async () => {
    const r = await new Client(s.url).get("/health");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("x-powered-by")).toBeNull();
  });
});
