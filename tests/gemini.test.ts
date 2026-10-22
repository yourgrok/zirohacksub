import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../src/core/db.js";
import { resetAndSeed } from "../src/core/seed.js";
import { getFieldByKey, listFields } from "../src/core/store.js";
import { getTrace, makeRoguePlanner } from "../src/agent/loop.js";
import { approveField, execute, scan } from "../src/agent/service.js";
import { LlmError, llmCallCount, setLlmClient, type LlmClient, type LlmRequest } from "../src/agent/llm.js";
import { startTestServer } from "./helpers.js";
import { BUSINESS_ID as B } from "../src/core/seed.js";

let s: Awaited<ReturnType<typeof startTestServer>>;
beforeAll(async () => { s = await startTestServer(); });
afterAll(async () => { await s.close(); });

const SECRET = "AIza-FAKE-SECRET-KEY-123";
beforeEach(() => {
  resetAndSeed();
  process.env.LLM_PROVIDER = "gemini";
  process.env.GEMINI_API_KEY = SECRET;
  process.env.LLM_BACKOFF_MS = "5";
  process.env.LLM_TIMEOUT_MS = "300";
});
afterEach(() => {
  setLlmClient(null);
  process.env.LLM_PROVIDER = "none";
  delete process.env.GEMINI_API_KEY;
});

const viewOf = (req: LlmRequest) => JSON.parse(req.prompt.split("STATE: ")[1]);
/** A well-behaved fake Gemini: picks the first legal tool, like a sensible model would. */
const sensible: LlmClient = {
  async generate(req) {
    if (req.system.includes("status for a shop owner")) return JSON.stringify({ summary: "2 sites fixed, 1 pending moderation, 1 needs you to reclaim the listing." });
    const v = viewOf(req);
    for (const p of v.platforms) if (p.legal.length) return JSON.stringify({ tool: p.legal[0], platform: p.id, rationale: "next legal step" });
    return JSON.stringify({ tool: "done", platform: null, rationale: "all done" });
  },
};

const writes = () => (getDb().prepare("SELECT COUNT(*) c FROM mock_writes").get() as { c: number }).c;
const deciders = (runId: string) => getTrace(runId).map((t) => t.decider);

describe("Gemini planner (mocked client)", () => {
  it("makes the decisions and the trace says Gemini; summary comes from Gemini", async () => {
    setLlmClient(sensible);
    const r = await scan(B);
    const d = deciders(r.runId);
    expect(d.filter((x) => x === "Gemini").length).toBeGreaterThan(15);
    expect(d).not.toContain("Fallback");
    expect(r.summary).toContain("2 sites fixed");
    expect(getFieldByKey(B, "site_b", "holiday:ex_seed_diwali")!.state).toBe("PROPOSED");
  });

  it("uses the Interactions-style request: model, system, strict JSON schema, and never the key", async () => {
    const seen: LlmRequest[] = [];
    setLlmClient({ generate: async (req) => { seen.push(req); return sensible.generate(req); } });
    const r = await scan(B);
    expect(seen[0].model).toBe("gemini-3.8-flash");
    expect(seen[0].jsonSchema).toHaveProperty("properties.tool");
    for (const q of seen) expect(JSON.stringify(q)).not.toContain(SECRET);
    expect(JSON.stringify(getTrace(r.runId))).not.toContain(SECRET);
  });

  it("GUARDRAIL: Gemini tells us to apply with no owner approval -> blocked, nothing written", async () => {
    setLlmClient({
      async generate(req) {
        if (req.system.includes("status for a shop owner")) return JSON.stringify({ summary: "ok ok ok" });
        const v = viewOf(req);
        if (v.phase === "execute") return JSON.stringify({ tool: "apply_approved", platform: "site_b", fields: ["holiday:ex_seed_diwali"], rationale: "just fix it" });
        return sensible.generate(req);
      },
    });
    await scan(B);
    const w0 = writes();
    const r = await execute(B);
    expect(writes()).toBe(w0);
    expect(getFieldByKey(B, "site_b", "holiday:ex_seed_diwali")!.state).toBe("PROPOSED");
    const blocked = getTrace(r.runId).filter((t) => t.decider === "Blocked");
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked[0].output_summary).toMatch(/BLOCKED BY GUARDRAIL/);
  });

  it("GUARDRAIL: asking to apply a field the owner did not approve (others approved) is blocked", async () => {
    setLlmClient({
      async generate(req) {
        if (req.system.includes("status for a shop owner")) return JSON.stringify({ summary: "ok ok ok" });
        const v = viewOf(req);
        if (v.phase === "execute") return JSON.stringify({ tool: "apply_approved", platform: "site_e", fields: ["hours", "phone"], rationale: "also do phone" });
        return sensible.generate(req);
      },
    });
    await scan(B);
    approveField(B, getFieldByKey(B, "site_e", "hours")!.id);
    const r = await execute(B);
    expect(getTrace(r.runId).some((t) => t.decider === "Blocked" && /not owner-approved/.test(t.output_summary))).toBe(true);
  });

  it("GUARDRAIL: propose on a permission-denied listing is forced to flag_listing", async () => {
    setLlmClient({
      async generate(req) {
        if (req.system.includes("status for a shop owner")) return JSON.stringify({ summary: "ok ok ok" });
        const v = viewOf(req);
        const d = v.platforms.find((p: any) => p.id === "site_d");
        if (d && d.stage === "compared") return JSON.stringify({ tool: "propose", platform: "site_d", rationale: "propose it anyway" });
        return sensible.generate(req);
      },
    });
    const r = await scan(B);
    expect(getFieldByKey(B, "site_d", "phone")!.state).toBe("FLAGGED_NOT_OWNER");
    expect(getTrace(r.runId).some((t) => t.decider === "Blocked" && /forced flag_listing/.test(t.output_summary))).toBe(true);
    expect(writes()).toBe(0);
  });

  it("GUARDRAIL: unknown tools and decoy listing ids are blocked", async () => {
    setLlmClient({
      async generate(req) {
        if (req.system.includes("status for a shop owner")) return JSON.stringify({ summary: "ok ok ok" });
        return JSON.stringify({ tool: "mark_verified", platform: "site_a", rationale: "trust me" });
      },
    });
    // schema rejects an unknown tool -> counted as Fallback (Zod), never executed
    const r = await scan(B);
    expect(deciders(r.runId)).toContain("Fallback");
    expect(listFields(B, ).some((f) => f.state === "VERIFIED")).toBe(false);
  });

  it("simulated rogue planner: every bad action is blocked, run still completes correctly", async () => {
    const r = await scan(B, makeRoguePlanner(["site_a", "site_b", "site_c", "site_d", "site_e"]));
    const blocked = getTrace(r.runId).filter((t) => t.decider === "Blocked");
    expect(blocked.length).toBeGreaterThanOrEqual(5);
    expect(writes()).toBe(0);
    expect(getFieldByKey(B, "site_b", "holiday:ex_seed_diwali")!.state).toBe("PROPOSED");
    expect(listFields(B, "site_a").some((f) => f.state === "FLAGGED_NOT_OWNER")).toBe(false);
  });

  it("falls back on invalid JSON", async () => {
    setLlmClient({ generate: async (req) => (req.system.includes("status for") ? "nope" : "this is not json") });
    const r = await scan(B);
    const d = deciders(r.runId);
    expect(d).toContain("Fallback");
    expect(d).not.toContain("Gemini");
    expect(getFieldByKey(B, "site_b", "holiday:ex_seed_diwali")!.state).toBe("PROPOSED"); // work still completes
    expect(r.summary).toMatch(/waiting for your approval/); // template summary
  });

  it("retries once on 429 then falls back", async () => {
    let n = 0;
    setLlmClient({ generate: async () => { n++; throw Object.assign(new Error("429 RESOURCE_EXHAUSTED"), { status: 429 }); } });
    process.env.GEMINI_MAX_CALLS_PER_RUN = "1";
    const r = await scan(B);
    delete process.env.GEMINI_MAX_CALLS_PER_RUN;
    expect(n).toBe(4); // planner step: 1 try + exactly 1 retry; summary call: 1 try + 1 retry
    expect(deciders(r.runId)).toContain("Fallback");
  });

  it("falls back on timeout", async () => {
    setLlmClient({ generate: () => new Promise(() => undefined) });
    process.env.GEMINI_MAX_CALLS_PER_RUN = "1";
    const r = await scan(B);
    delete process.env.GEMINI_MAX_CALLS_PER_RUN;
    expect(getTrace(r.runId).find((t) => t.decider === "Fallback")!.note).toMatch(/timeout/);
  });

  it("tries the other model when the first is unavailable (404)", async () => {
    const used: string[] = [];
    setLlmClient({
      async generate(req) {
        used.push(req.model);
        if (req.model === "gemini-3.8-flash") throw Object.assign(new Error("404 model not found"), { status: 404 });
        return sensible.generate(req);
      },
    });
    const r = await scan(B);
    expect(used).toContain("gemini-3.5-flash-lite");
    expect(deciders(r.runId)).toContain("Gemini");
  });

  it("caches identical calls and serialises requests", async () => {
    let inflight = 0, maxInflight = 0;
    setLlmClient({
      async generate(req) {
        inflight++; maxInflight = Math.max(maxInflight, inflight);
        await new Promise((r) => setTimeout(r, 2));
        inflight--;
        return sensible.generate(req);
      },
    });
    await scan(B);
    const first = llmCallCount();
    expect(maxInflight).toBe(1);
    resetAndSeed();
    await scan(B); // identical prompts -> served from cache for planner steps
    expect(llmCallCount() - first).toBeLessThan(first);
  });

  it("LlmError kinds are exported", () => { expect(new LlmError("timeout", "x").kind).toBe("timeout"); });
});
