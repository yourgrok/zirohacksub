import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, insertBusiness, startTestServer } from "./helpers.js";
import { autopilotRun, setAutopilot, listEvents } from "../src/agent/autopilot.js";
import { scan, approveField } from "../src/agent/service.js";
import { buildClaimDrafts } from "../src/agent/claimDraft.js";
import { whyOf } from "../src/agent/why.js";
import { BUSINESS_ID as B } from "../src/core/seed.js";
import { getFieldByKey } from "../src/core/store.js";
import { resetAndSeed } from "../src/core/seed.js";

let s: Awaited<ReturnType<typeof startTestServer>>;
let c: Client;
beforeAll(async () => { process.env.AGENT_RETRY_MS = "0"; s = await startTestServer(); c = new Client(s.url); await c.login(); });
afterAll(async () => { await s.close(); });

describe("the agent explains itself", () => {
  it("every row carries a plain-language reason, and the run has a briefing", async () => {
    await c.post("/api/reset");
    await c.post("/api/runs/scan?wait=1");
    const st = (await c.get("/api/state")).body;
    expect(st.rows.every((r: any) => typeof r.why === "string" && r.why.length > 10)).toBe(true);
    const diwali = st.rows.find((r: any) => r.platformId === "site_b" && r.fieldKey.startsWith("holiday:"));
    expect(diwali.why).toMatch(/Closed/);
    expect(st.briefing).toMatch(/I checked 5 listings/);
    expect(st.briefing).toMatch(/NearbyNow belongs to another account/);
    expect(st.briefing).toMatch(/LocalLoop/);
  });
  it("a claimed listing gets a claim request and manual steps, never an automated claim", async () => {
    const d = (await c.get("/api/state")).body.claimDrafts;
    expect(d).toHaveLength(1);
    expect(d[0].platform).toMatch(/NearbyNow/);
    expect(d[0].body).toMatch(/LST-D-1001/);
    expect(d[0].steps.join(" ")).toMatch(/never does this step/);
    expect(d[0].steps.join(" ")).toMatch(/yourself/);
  });
  it("why-lines never promise a write the owner has not approved", () => {
    const w = whyOf({ platform: "CityPages (Site B)", field: "Phone", fieldKey: "phone", state: "PROPOSED", original: "1", intended: "2", reason: "" });
    expect(w).toMatch(/Nothing is sent until you approve/);
  });
});

describe("autopilot", () => {
  it("is off by default, toggles per business, and never approves", async () => {
    resetAndSeed();
    expect((await c.get("/api/state")).body.autopilot.on).toBe(false);
    expect((await c.post("/api/autopilot", { on: true })).body.on).toBe(true);
    await autopilotRun(B);
    const rows = (await c.get("/api/state")).body.rows;
    expect(rows.some((r: any) => r.state === "PROPOSED")).toBe(true);
    expect(rows.some((r: any) => ["APPROVED", "APPLIED", "VERIFIED"].includes(r.state))).toBe(false);
    expect((await c.post("/api/autopilot", { on: false })).body.on).toBe(false);
  });
  it("another business's autopilot setting and events are separate", async () => {
    insertBusiness("biz_other_ap", "Other Shop", "GHKMNPQRST", { demo: false });
    setAutopilot("biz_other_ap", true);
    const other = new Client(s.url); expect((await other.login("GHKMNPQRST")).status).toBe(200);
    expect((await other.get("/api/state")).body.autopilot.on).toBe(true);
    expect((await c.get("/api/state")).body.autopilot.on).toBe(false);
    expect(listEvents("biz_other_ap").every((e) => /Autopilot is on/.test(e.message))).toBe(true);
  });
  it("only the demo business can use the simulate switches", async () => {
    const other = new Client(s.url); await other.login("GHKMNPQRST");
    expect((await other.post("/api/demo/simulate", { kind: "drift_phone" })).status).toBe(403);
    expect((await c.post("/api/demo/simulate", { kind: "nonsense" })).status).toBe(400);
    expect((await c.post("/api/demo/simulate", { kind: "drift_phone", site: "a" })).status).toBe(200);
  });
});

describe("recovery", () => {
  it("a page that changes after approval is never written to on stale information", async () => {
    resetAndSeed();
    await scan(B);
    const f = getFieldByKey(B, "site_b", "holiday:ex_seed_diwali")!;
    approveField(B, f.id);
    await c.post("/api/demo/simulate", { kind: "drift_diwali", site: "b" });
    await c.post("/api/runs/execute?wait=1");
    expect(getFieldByKey(B, "site_b", "holiday:ex_seed_diwali")!.state).toBe("PROPOSED");
  });
});
