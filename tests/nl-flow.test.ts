import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetAndSeed } from "../src/core/seed.js";
import { getFieldByKey, listExceptions, listFields } from "../src/core/store.js";
import { approveAllForPlatform, execute, scan } from "../src/agent/service.js";
import { setLlmClient } from "../src/agent/llm.js";
import { confirmIntent, preview, refine } from "../src/nl/index.js";
import { startTestServer } from "./helpers.js";
import { getDb } from "../src/core/db.js";
import { BUSINESS_ID as B } from "../src/core/seed.js";

let s: Awaited<ReturnType<typeof startTestServer>>;
beforeAll(async () => { s = await startTestServer(); });
afterAll(async () => { await s.close(); });
beforeEach(() => resetAndSeed());
afterEach(() => { setLlmClient(null); process.env.LLM_PROVIDER = "none"; delete process.env.GEMINI_API_KEY; });

describe("TC5 plain-language closure end to end", () => {
  it("'we are closed on 26th December' -> exception -> approval -> sites", async () => {
    const n0 = listExceptions(B).length;
    const p = preview(B, "we are closed on 26th December");
    expect(p.status).toBe("ok");
    expect(listExceptions(B).length).toBe(n0); // preview saves nothing
    const ex = confirmIntent(B, p.status === "ok" ? p.intent : null);
    expect(ex).toMatchObject({ start: "2026-12-26", end: "2026-12-26", kind: "closed", source: "natural-language" });
    await scan(B);
    const key = `holiday:${ex.id}`;
    for (const site of ["site_a", "site_b", "site_c", "site_e"]) expect(getFieldByKey(B, site, key)!.state).toBe("PROPOSED");
    expect(getFieldByKey(B, "site_d", key)!.state).toBe("FLAGGED_NOT_OWNER");
    // approval is never skipped: executing without approval sends nothing
    await execute(B);
    expect((getDb().prepare("SELECT COUNT(*) c FROM mock_writes").get() as any).c).toBe(0);
    for (const site of ["site_a", "site_b", "site_c", "site_e"]) approveAllForPlatform(B, site);
    await execute(B);
    for (const site of ["site_a", "site_b", "site_c"]) expect(getFieldByKey(B, site, key)!.state).toBe("VERIFIED");
    expect(getFieldByKey(B, "site_e", key)!.state).toBe("PENDING_MODERATION");
    expect(getFieldByKey(B, "site_d", key)!.state).toBe("FLAGGED_NOT_OWNER");
    const html = await (await fetch(`${s.url}/mock/a/listing/LST-A-1001`)).text();
    expect(html).toContain("26 Dec 2026");
  });

  it("'ignore that, we are open on the 26th' cancels a saved closure before anything is applied", async () => {
    const p = preview(B, "we are closed on 26th December");
    const ex = confirmIntent(B, p.status === "ok" ? p.intent : null);
    await scan(B);
    expect(getFieldByKey(B, "site_a", `holiday:${ex.id}`)!.state).toBe("PROPOSED");
    const r = preview(B, "ignore that, we are open on the 26th");
    expect(r.status === "ok" && r.intent.action).toBe("reopen");
    confirmIntent(B, r.status === "ok" ? r.intent : null);
    await scan(B);
    expect(getFieldByKey(B, "site_a", `holiday:${ex.id}`)!.state).toBe("MATCH"); // no longer actionable
    approveAllForPlatform(B, "site_a");
    await execute(B);
    expect((getDb().prepare("SELECT COUNT(*) c FROM mock_writes WHERE site='site_a'").get() as any).c).toBe(0);
  });

  it("reopen after the closure was applied removes it from sites (through approval)", async () => {
    const p = preview(B, "we are closed on 26th December");
    const ex = confirmIntent(B, p.status === "ok" ? p.intent : null);
    await scan(B); approveAllForPlatform(B, "site_a"); await execute(B);
    const r = preview(B, "we are open on the 26th, ignore that");
    confirmIntent(B, r.status === "ok" ? r.intent : null);
    await scan(B);
    const f = getFieldByKey(B, "site_a", `holiday:${ex.id}`)!;
    expect(f.state).toBe("PROPOSED");
    expect(f.intended_display).toMatch(/remove/);
    approveAllForPlatform(B, "site_a"); await execute(B);
    expect(getFieldByKey(B, "site_a", `holiday:${ex.id}`)!.state).toBe("VERIFIED");
    expect(await (await fetch(`${s.url}/mock/a/listing/LST-A-1001`)).text()).not.toContain("26 Dec 2026");
  });

  it("confirm refuses past dates and invalid intents", () => {
    expect(() => confirmIntent(B, { action: "closed", start: "2026-10-01", end: "2026-10-01", open: null, close: null, reason: null })).toThrow(/already passed/);
    expect(() => confirmIntent(B, { nope: 1 })).toThrow();
    expect(() => confirmIntent(B, { action: "special", start: "2026-12-01", end: "2026-12-01", open: "14:00", close: "10:00", reason: null })).toThrow();
  });

  it("same dates twice update one exception (no duplicates)", () => {
    const a = preview(B, "closed on 26th December"); const b = preview(B, "open 10 to 2 on 26th December");
    confirmIntent(B, a.status === "ok" ? a.intent : null);
    confirmIntent(B, b.status === "ok" ? b.intent : null);
    expect(listExceptions(B).filter((e) => e.start === "2026-12-26")).toHaveLength(1);
  });
});

describe("Gemini cross-check", () => {
  const enable = () => { process.env.LLM_PROVIDER = "gemini"; process.env.GEMINI_API_KEY = "k"; process.env.LLM_BACKOFF_MS = "1"; };
  const ans = (o: object) => ({ generate: async () => JSON.stringify(o) });

  it("skipped without a key", async () => { expect((await refine(B, "closed 26 dec")).verdict).toBe("skipped"); });
  it("agree when Gemini matches", async () => {
    enable();
    setLlmClient(ans({ status: "ok", action: "closed", start: "2026-12-26", end: "2026-12-26", open: null, close: null, reason: null }));
    expect((await refine(B, "we are closed on 26th December")).verdict).toBe("agree");
  });
  it("conflict shows both readings and lets the owner choose", async () => {
    enable();
    setLlmClient(ans({ status: "ok", action: "closed", start: "2026-12-27", end: "2026-12-27", open: null, close: null, reason: null }));
    const r = await refine(B, "we are closed on 26th December");
    expect(r.verdict).toBe("conflict");
    if (r.verdict === "conflict") {
      expect(r.deterministic.start).toBe("2026-12-26");
      expect(r.gemini.start).toBe("2026-12-27");
      expect(r.geminiChips.find((c) => c.label === "Date")!.value).toContain("27 Dec 2026");
    }
  });
  it("Gemini garbage / past dates are ignored, never trusted", async () => {
    enable();
    setLlmClient({ generate: async () => "not json" });
    expect((await refine(B, "we are closed on 26th December")).verdict).toBe("unavailable");
    setLlmClient(ans({ status: "ok", action: "closed", start: "2020-01-01", end: "2020-01-01", open: null, close: null, reason: null }));
    expect((await refine(B, "we are closed on 26th December")).verdict).toBe("unavailable");
  });
  it("listing sanity: preview alone never touches the DB", () => {
    preview(B, "closed tomorrow");
    expect(listFields(B, )).toHaveLength(0);
  });
});
