import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetAndSeed } from "../src/core/seed.js";
import { getFieldByKey, listExceptions, listFields } from "../src/core/store.js";
import { approveAllForPlatform, execute, scan } from "../src/agent/service.js";
import { setLlmClient } from "../src/agent/llm.js";
import { confirmIntent, preview, refine } from "../src/nl/index.js";
import { startTestServer } from "./helpers.js";
import { getDb } from "../src/core/db.js";

let s: Awaited<ReturnType<typeof startTestServer>>;
beforeAll(async () => { s = await startTestServer(); });
afterAll(async () => { await s.close(); });
beforeEach(() => resetAndSeed());
afterEach(() => { setLlmClient(null); process.env.LLM_PROVIDER = "none"; delete process.env.GEMINI_API_KEY; });

describe("TC5 plain-language closure end to end", () => {
  it("'we are closed on 26th December' -> exception -> approval -> sites", async () => {
    const n0 = listExceptions().length;
    const p = preview("we are closed on 26th December");
    expect(p.status).toBe("ok");
    expect(listExceptions().length).toBe(n0); // preview saves nothing
    const ex = confirmIntent(p.status === "ok" ? p.intent : null);
    expect(ex).toMatchObject({ start: "2026-12-26", end: "2026-12-26", kind: "closed", source: "natural-language" });
    await scan();
    const key = `holiday:${ex.id}`;
    for (const site of ["site_a", "site_b", "site_c", "site_e"]) expect(getFieldByKey(site, key)!.state).toBe("PROPOSED");
    expect(getFieldByKey("site_d", key)!.state).toBe("FLAGGED_NOT_OWNER");
    // approval is never skipped: executing without approval sends nothing
    await execute();
    expect((getDb().prepare("SELECT COUNT(*) c FROM mock_writes").get() as any).c).toBe(0);
    for (const site of ["site_a", "site_b", "site_c", "site_e"]) approveAllForPlatform(site);
    await execute();
    for (const site of ["site_a", "site_b", "site_c"]) expect(getFieldByKey(site, key)!.state).toBe("VERIFIED");
    expect(getFieldByKey("site_e", key)!.state).toBe("PENDING_MODERATION");
    expect(getFieldByKey("site_d", key)!.state).toBe("FLAGGED_NOT_OWNER");
    const html = await (await fetch(`${s.url}/mock/a/listing/LST-A-1001`)).text();
    expect(html).toContain("26 Dec 2026");
  });

  it("'ignore that, we are open on the 26th' cancels a saved closure before anything is applied", async () => {
    const p = preview("we are closed on 26th December");
    const ex = confirmIntent(p.status === "ok" ? p.intent : null);
    await scan();
    expect(getFieldByKey("site_a", `holiday:${ex.id}`)!.state).toBe("PROPOSED");
    const r = preview("ignore that, we are open on the 26th");
    expect(r.status === "ok" && r.intent.action).toBe("reopen");
    confirmIntent(r.status === "ok" ? r.intent : null);
    await scan();
    expect(getFieldByKey("site_a", `holiday:${ex.id}`)!.state).toBe("MATCH"); // no longer actionable
    approveAllForPlatform("site_a");
    await execute();
    expect((getDb().prepare("SELECT COUNT(*) c FROM mock_writes WHERE site='site_a'").get() as any).c).toBe(0);
  });

  it("reopen after the closure was applied removes it from sites (through approval)", async () => {
    const p = preview("we are closed on 26th December");
    const ex = confirmIntent(p.status === "ok" ? p.intent : null);
    await scan(); approveAllForPlatform("site_a"); await execute();
    const r = preview("we are open on the 26th, ignore that");
    confirmIntent(r.status === "ok" ? r.intent : null);
    await scan();
    const f = getFieldByKey("site_a", `holiday:${ex.id}`)!;
    expect(f.state).toBe("PROPOSED");
    expect(f.intended_display).toMatch(/remove/);
    approveAllForPlatform("site_a"); await execute();
    expect(getFieldByKey("site_a", `holiday:${ex.id}`)!.state).toBe("VERIFIED");
    expect(await (await fetch(`${s.url}/mock/a/listing/LST-A-1001`)).text()).not.toContain("26 Dec 2026");
  });

  it("confirm refuses past dates and invalid intents", () => {
    expect(() => confirmIntent({ action: "closed", start: "2026-10-01", end: "2026-10-01", open: null, close: null, reason: null })).toThrow(/already passed/);
    expect(() => confirmIntent({ nope: 1 })).toThrow();
    expect(() => confirmIntent({ action: "special", start: "2026-12-01", end: "2026-12-01", open: "14:00", close: "10:00", reason: null })).toThrow();
  });

  it("same dates twice update one exception (no duplicates)", () => {
    const a = preview("closed on 26th December"); const b = preview("open 10 to 2 on 26th December");
    confirmIntent(a.status === "ok" ? a.intent : null);
    confirmIntent(b.status === "ok" ? b.intent : null);
    expect(listExceptions().filter((e) => e.start === "2026-12-26")).toHaveLength(1);
  });
});

describe("Gemini cross-check", () => {
  const enable = () => { process.env.LLM_PROVIDER = "gemini"; process.env.GEMINI_API_KEY = "k"; process.env.LLM_BACKOFF_MS = "1"; };
  const ans = (o: object) => ({ generate: async () => JSON.stringify(o) });

  it("skipped without a key", async () => { expect((await refine("closed 26 dec")).verdict).toBe("skipped"); });
  it("agree when Gemini matches", async () => {
    enable();
    setLlmClient(ans({ status: "ok", action: "closed", start: "2026-12-26", end: "2026-12-26", open: null, close: null, reason: null }));
    expect((await refine("we are closed on 26th December")).verdict).toBe("agree");
  });
  it("conflict shows both readings and lets the owner choose", async () => {
    enable();
    setLlmClient(ans({ status: "ok", action: "closed", start: "2026-12-27", end: "2026-12-27", open: null, close: null, reason: null }));
    const r = await refine("we are closed on 26th December");
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
    expect((await refine("we are closed on 26th December")).verdict).toBe("unavailable");
    setLlmClient(ans({ status: "ok", action: "closed", start: "2020-01-01", end: "2020-01-01", open: null, close: null, reason: null }));
    expect((await refine("we are closed on 26th December")).verdict).toBe("unavailable");
  });
  it("listing sanity: preview alone never touches the DB", () => {
    preview("closed tomorrow");
    expect(listFields()).toHaveLength(0);
  });
});
