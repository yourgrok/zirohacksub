import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../src/core/db.js";
import { BUSINESS_ID as B, resetAndSeed } from "../src/core/seed.js";
import { listExceptions } from "../src/core/store.js";
import { setLlmClient } from "../src/agent/llm.js";
import { confirmDetails, preview, refine } from "../src/nl/index.js";
import { HELP_QUESTION } from "../src/nl/intent.js";
import { Client, startTestServer } from "./helpers.js";

let s: Awaited<ReturnType<typeof startTestServer>>;
beforeAll(async () => { s = await startTestServer(); });
afterAll(async () => { await s.close(); });
beforeEach(() => resetAndSeed());
afterEach(() => { setLlmClient(null); process.env.LLM_PROVIDER = "none"; delete process.env.GEMINI_API_KEY; });

const p = (text: string) => preview(B, text) as any;
const bizRow = () => getDb().prepare("SELECT name,address,phone,hours_json FROM business WHERE id=?").get(B) as any;

describe("text box: changing business details", () => {
  it.each([
    ["change my phone to 98765 43210", "+91 98765 43210"],
    ["update the phone number: +91 90000 00123", "+91 90000 00123"],
    ["our new mobile is 090000 00456", "+91 90000 00456"],
    ["Can you please set my contact number to (90000) 00789", "+91 90000 00789"],
  ])("phone: %s", (text, to) => {
    const r = p(text);
    expect(r.status).toBe("detail");
    expect(r.intent).toEqual({ kind: "details", changes: { phone: to } });
    expect(r.changes[0]).toMatchObject({ field: "phone", from: "+91 90000 00001", to });
    expect(r.chips.map((c: any) => c.label)).toEqual(["Action", "Phone now", "Phone new"]);
  });
  it("address", () => {
    const a = p("change my address to 12 MG Road, Camp, Pune, Maharashtra 411001");
    expect(a.status).toBe("detail");
    expect(a.intent.changes.address).toBe("12 MG Road, Camp, Pune, Maharashtra 411001");
    expect(p("we have moved to 5 Lake View Road, Baner, Pune 411045.").intent.changes.address).toBe("5 Lake View Road, Baner, Pune 411045");
    expect(p("our address is: 9 Park Street, Pune 411001").status).toBe("detail");
  });
  it("name", () => {
    expect(p("rename the shop to Sunrise Sweets").intent.changes.name).toBe("Sunrise Sweets");
    expect(p("our business name is “Sunrise Bakery”").intent.changes.name).toBe("Sunrise Bakery");
    expect(p("we are now called Sunrise Sweet Mart").intent.changes.name).toBe("Sunrise Sweet Mart");
  });
  it("weekly opening hours (not a date)", () => {
    expect(p("open 9 to 8 Monday to Saturday").intent.changes.hours).toBe("Mon-Sat 09:00-20:00; Sun 10:00-14:00");
    expect(p("we are closed on Sundays").intent.changes.hours).toBe("Mon-Sat 09:00-21:00; Sun closed");
    expect(p("closed every Sunday").intent.changes.hours).toBe("Mon-Sat 09:00-21:00; Sun closed");
    expect(p("weekdays 8am to 6pm").intent.changes.hours).toBe("Mon-Fri 08:00-18:00; Sat 09:00-21:00; Sun 10:00-14:00");
    expect(p("we close at 8pm on weekdays").intent.changes.hours).toBe("Mon-Fri 09:00-20:00; Sat 09:00-21:00; Sun 10:00-14:00");
    expect(p("set the hours for weekends to 10am-4pm").intent.changes.hours).toBe("Mon-Fri 09:00-21:00; Sat-Sun 10:00-16:00");
  });
  it("no change needed -> says so instead of creating an edit", () => {
    expect(p("my phone number is +91 90000 00001").status).toBe("answer");
    expect(p("my phone number is +91 90000 00001").title).toBe("Nothing to change");
    expect(p("hours Mon-Sat 9am-9pm; Sun 10am-2pm").title).toBe("Nothing to change");
  });
  it("bad values and missing hours get exactly one plain question", () => {
    expect(p("my address is Pune").status).toBe("ask");
    expect(p("open on Sundays").question).toMatch(/What opening hours do you want on Sundays/);
    expect(p("rename the shop to X").question).toMatch(/business name/i);
    const closedSun = p("closing early at 1pm every Sunday"); // Sunday is open 10-14 so this edits close only
    expect(closedSun.intent.changes.hours).toBe("Mon-Sat 09:00-21:00; Sun 10:00-13:00");
  });
  it("preview never changes anything", () => {
    const before = JSON.stringify(bizRow()) + listExceptions(B).length;
    for (const t of ["change my phone to 98765 43210", "rename the shop to Foo Bar", "we are closed on Sundays", "closed on 26th December", "what are my hours?"]) p(t);
    expect(JSON.stringify(bizRow()) + listExceptions(B).length).toBe(before);
  });
});

describe("text box: dates still work exactly as before", () => {
  it.each([
    ["we are closed on 26th December", "closed", "2026-12-26"],
    ["tomorrow the shop is closed", "closed", "2026-10-22"],
    ["closed from 24 to 26 Dec", "closed", "2026-12-24"],
    ["closing early at 3pm this Friday", "special", "2026-10-23"],
    ["open 10 to 2 on Diwali", "special", "2026-11-08"],
    ["closed next Monday for a wedding", "closed", "2026-10-26"],
    ["we are closed this Sunday", "closed", "2026-10-25"],
  ])("%s", (text, action, start) => {
    const r = p(text);
    expect(r.status, JSON.stringify(r)).toBe("ok");
    expect(r.intent).toMatchObject({ action, start });
  });
  it("past / unclear still get the one clarifying question; nonsense gets the help text", () => {
    expect(p("closed yesterday").question).toMatch(/already passed/);
    expect(p("the shop is closed").question).toBe("Which date (or dates) is this for?");
    expect(p("asdf qwerty").question).toBe(HELP_QUESTION);
    expect(p("").status).toBe("empty");
  });
});

describe("text box: answering questions (read-only)", () => {
  it("details", () => {
    expect(p("what is my phone number?").lines[0]).toBe("On your record: +91 90000 00001");
    expect(p("What's my address").lines[0]).toContain("42 Marigold Lane");
    expect(p("what are my opening hours?").lines[0]).toBe("On your record: Mon-Sat 09:00-21:00; Sun 10:00-14:00");
    expect(p("what is my business name").lines[0]).toBe("On your record: Sunrise Sweets & Bakery");
    expect(p("what is my business id?").lines).toEqual(["biz_sunrise_001"]);
  });
  it("never reveals or invents a PIN", () => {
    const r = p("what is my PIN?");
    expect(r.title).toBe("About your PIN");
    expect(r.lines.join(" ")).not.toMatch(/7KQ4X/);
  });
  it("holidays and special days", () => {
    const r = p("what holidays are coming up?");
    expect(r.title).toBe("Holidays and special days");
    expect(r.lines.join("\n")).toMatch(/Diwali/);
    expect(r.lines.join("\n")).toMatch(/special hours are set/);
    expect(r.lines.join("\n")).toMatch(/Bhai Dooj.*nothing set yet/);
  });
  it("sites and coverage", () => {
    const r = p("which sites am I listed on?");
    expect(r.title).toBe("Listed on 5 of 5 sites");
    expect(r.lines).toHaveLength(5);
  });
  it("history of changes and pending approvals use live data", async () => {
    const c = new Client(s.url); await c.login();
    await c.req("/api/business", { method: "PUT", json: { phone: "+91 90000 00123" } });
    const h = p("show my recent changes");
    expect(h.lines[0]).toMatch(/Phone: \+91 90000 00001 → \+91 90000 00123/);
    expect(p("what is waiting for my approval?").title).toBe("0 item(s) need attention"); // nothing scanned yet
    await c.post("/api/runs/scan?wait=1");
    const a = p("what's pending approval?");
    expect(a.title).toMatch(/^[1-9]\d* item\(s\) need attention/);
    expect(a.lines.join("\n")).toMatch(/Phone/);
    const ph = p("what's my phone number?");
    expect(ph.lines.join("\n")).toMatch(/Listify: \+91 90000 00001 — differs — waiting for your approval/);
    expect(p("how am I doing?").title).toBe("Where things stand");
  });
  it("answers carry links that open the right tab", () => {
    expect(p("which sites am I on").links[0].tab).toBe("sites");
    expect(p("what is pending").links[0].tab).toBe("approvals");
    expect(p("what changed").links[0].tab).toBe("changelog");
  });
});

describe("confirming a typed edit", () => {
  it("applies the same validated update as the edit form, and logs it as typed", async () => {
    const c = new Client(s.url); await c.login();
    const r = p("change my phone to 98765 43210");
    const done = await c.post("/api/nl/confirm", { intent: r.intent });
    expect(done.status).toBe(200);
    expect(done.body.changed[0]).toMatchObject({ field: "phone", to: "+91 98765 43210" });
    expect(bizRow().phone).toBe("+91 98765 43210");
    const log = (await c.get("/api/changelog")).body.entries.find((e: any) => e.kind === "details");
    expect(log).toMatchObject({ who: "You (typed it)", from: "+91 90000 00001", to: "+91 98765 43210" });
  });
  it("rejects a tampered or invalid intent and needs a login", async () => {
    const c = new Client(s.url); await c.login();
    expect((await c.post("/api/nl/confirm", { intent: { kind: "details", changes: { phone: "12" } } })).status).toBe(400);
    expect((await c.post("/api/nl/confirm", { intent: { kind: "details", changes: { hours: "never" } } })).status).toBe(400);
    expect((await c.post("/api/nl/confirm", { intent: { kind: "details", changes: { id: "biz_other", phone: "+91 90000 00123" } } })).status).toBe(200); // unknown keys are ignored
    expect((getDb().prepare("SELECT COUNT(*) c FROM business").get() as any).c).toBe(1);
    expect((await new Client(s.url).post("/api/nl/confirm", { intent: { kind: "details", changes: { phone: "+91 90000 00123" } } })).status).toBe(401);
    expect(() => confirmDetails(B, { kind: "details", changes: { name: "" } })).toThrow();
  });
  it("edits and questions are never sent to Gemini; dates still are", async () => {
    process.env.LLM_PROVIDER = "gemini"; process.env.GEMINI_API_KEY = "k";
    let calls = 0;
    setLlmClient({ generate: async () => { calls++; return JSON.stringify({ status: "ok", action: "closed", start: "2026-12-26", end: "2026-12-26", open: null, close: null, reason: null }); } });
    expect((await refine(B, "change my phone to 98765 43210")).verdict).toBe("skipped");
    expect((await refine(B, "what are my hours?")).verdict).toBe("skipped");
    expect(calls).toBe(0);
    expect((await refine(B, "we are closed on 26th December")).verdict).toBe("agree");
    expect(calls).toBe(1);
  });
});
