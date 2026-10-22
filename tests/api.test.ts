import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, startTestServer } from "./helpers.js";
import { runAllTcs, runGuardrailDemo } from "../src/runner/tc.js";
import { writeGuardrail, writeResults } from "../src/runner/evidence.js";

let s: Awaited<ReturnType<typeof startTestServer>>;
const SECRET = "AIza-SHOULD-NEVER-APPEAR-987";
beforeAll(async () => { process.env.GEMINI_API_KEY = SECRET; process.env.LLM_PROVIDER = "none"; s = await startTestServer(); });
afterAll(async () => { delete process.env.GEMINI_API_KEY; await s.close(); });

let c: Client;
const j = (p: string) => c.get(p);
const post = (p: string, body?: unknown) => c.post(p, body ?? {});
beforeAll(async () => { c = new Client(s.url); expect((await c.login()).status).toBe(200); });

describe("HTTP API", () => {
  it("/health shows version, reader mode, planner mode and db — never the key", async () => {
    const h = await j("/health");
    expect(h.body).toMatchObject({ status: "ok", db: "ok", plannerMode: "deterministic", readerMode: "http" });
    expect(h.body.version).toBeTruthy();
    expect(JSON.stringify(h.body)).not.toContain(SECRET);
  });
  it("scan -> approve -> execute through the API, CSV export has the six report columns", async () => {
    await post("/api/reset");
    await post("/api/runs/scan?wait=1");
    let st = (await j("/api/state")).body;
    expect(st.summary).toMatch(/waiting for your approval/);
    const row = st.rows.find((r: any) => r.platformId === "site_b" && r.fieldKey.startsWith("holiday:"));
    expect(row.state).toBe("PROPOSED");
    expect((await post(`/api/fields/${row.fieldId}/approve`)).status).toBe(200);
    expect((await post(`/api/fields/${row.fieldId}/approve`)).status).toBe(409); // not double-approvable
    await post("/api/runs/execute?wait=1");
    st = (await j("/api/state")).body;
    expect(st.rows.find((r: any) => r.fieldId === row.fieldId).state).toBe("VERIFIED");
    const csv = (await c.get("/api/report.csv")).body as string;
    expect(csv.split("\r\n")[0]).toBe('"Platform","Field","Original value","Intended value","Approval status","Verified status"');
    expect(csv).toContain("VERIFIED");
    expect(JSON.stringify(st)).not.toContain(SECRET);
    const audit = (await j("/api/audit")).body as any[];
    expect(audit.some((a) => a.action === "approve")).toBe(true);
    expect(audit.some((a) => a.action === "apply")).toBe(true);
  });
  it("approving a flagged or matching field is refused", async () => {
    await post("/api/reset"); await post("/api/runs/scan?wait=1");
    const st = (await j("/api/state")).body;
    const flagged = st.rows.find((r: any) => r.state === "FLAGGED_NOT_OWNER");
    expect((await post(`/api/fields/${flagged.fieldId}/approve`)).status).toBe(409);
    const match = st.rows.find((r: any) => r.state === "MATCH");
    expect((await post(`/api/fields/${match.fieldId}/approve`)).status).toBe(409);
  });
  it("NL preview/confirm endpoints", async () => {
    await post("/api/reset");
    const p = await post("/api/nl/preview", { text: "tomorrow the shop is closed" });
    expect(p.body.status).toBe("ok");
    const c = await post("/api/nl/confirm", { intent: p.body.intent });
    expect(c.status).toBe(200);
    expect((await post("/api/nl/confirm", { intent: { action: "closed", start: "2020-01-01", end: "2020-01-01", open: null, close: null, reason: null } })).status).toBe(400);
  });
  it("foresight endpoint", async () => {
    await post("/api/reset");
    const f = (await j("/api/foresight")).body;
    expect(f.alerts.length).toBeGreaterThan(0);
  });
  it("llm test run is refused without a working key mode", async () => {
    const r = await post("/api/tests/run", { id: "TC1", mode: "llm" });
    expect(r.status).toBe(400);
  });
});

describe("official test cases TC1-TC6 (deterministic, fresh reset each)", () => {
  it("all pass and evidence/SUMMARY.md is generated", async () => {
    process.env.EVIDENCE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ev-"));
    const results = await runAllTcs({ mode: "deterministic" });
    for (const r of results) expect(r.checks.filter((c) => !c.pass), `${r.id}: ${r.explanation}`).toEqual([]);
    expect(results.every((r) => r.pass)).toBe(true);
    writeResults(results, "");
    writeGuardrail(await runGuardrailDemo());
    const md = fs.readFileSync(path.join(process.env.EVIDENCE_DIR, "SUMMARY.md"), "utf8");
    expect(md).toContain("6/6 passed");
    expect(md).toContain("Guardrail demonstration");
    expect(md).not.toContain(SECRET);
    expect(JSON.stringify(results)).not.toContain(SECRET);
  }, 120000);
});
