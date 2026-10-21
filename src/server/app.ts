import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { dbStatus, driverName, getDb } from "../core/db.js";
import { isDemoNow, today, TZ } from "../core/clock.js";
import { resetAndSeed } from "../core/seed.js";
import { getBusiness, getPlatformListing, listExceptions, listFields, listPlatforms } from "../core/store.js";
import { mockRouter } from "../mock/sites.js";
import { getTrace, listRuns, makeRoguePlanner } from "../agent/loop.js";
import { ApprovalError, approveAllForPlatform, approveField, currentPlanner, execute, isBusy, plannerMode, rejectField, scan } from "../agent/service.js";
import { buildRows, latestRunSummary, templateSummary, toCsv } from "../agent/report.js";
import { readerMode } from "../agent/reader.js";
import { acceptDraft, foresight } from "../foresight/index.js";
import { IntentError, confirmIntent, preview, refine } from "../nl/index.js";
import { evidenceDir, writeGuardrail, writeResults } from "../runner/evidence.js";
import { listTests, runAllTcs, runGuardrailDemo, runTc, TC_IDS, TEST_DATE, type TcMode, type TcResult } from "../runner/tc.js";
import { geminiEnabled } from "../agent/llm.js";

const pkg = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

let lastError: string | null = null;
let starting = false;
let testRunning = false;
const lastResults = new Map<string, TcResult>();

const wrap = (fn: (req: Request, res: Response) => unknown | Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res)).catch(next);

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/mock", mockRouter());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", version: pkg.version, readerMode: readerMode(), plannerMode: plannerMode(), db: dbStatus(), dbDriver: driverName, today: today() });
  });

  const state = () => {
    const platforms = listPlatforms().map((p) => ({ ...p, listing: getPlatformListing(p.id) }));
    const rows = buildRows();
    return {
      today: today(), demoNow: isDemoNow(), tz: TZ, plannerMode: plannerMode(), readerMode: readerMode(),
      busy: isBusy() || starting, lastError, business: getBusiness(), exceptions: listExceptions(), platforms, rows,
      summary: latestRunSummary() ?? (rows.length ? templateSummary() : null), llmAvailable: geminiEnabled(),
    };
  };
  app.get("/api/state", (_req, res) => res.json(state()));

  app.post("/api/reset", wrap((_req, res) => {
    if (isBusy() || testRunning) return res.status(409).json({ error: "A run is in progress." });
    resetAndSeed();
    lastError = null;
    res.json({ ok: true });
  }));

  /* ── agent runs (background; poll /api/state.busy) ── */
  const startRun = (kind: "scan" | "execute") => wrap(async (req, res) => {
    if (isBusy() || starting || testRunning) return res.status(409).json({ error: "Another run is in progress." });
    starting = true;
    const planner = req.query.planner === "rogue" ? makeRoguePlanner(listPlatforms().map((p) => p.id)) : currentPlanner();
    const p = (kind === "scan" ? scan(planner) : execute(planner)).then(() => { lastError = null; }).catch((e) => { lastError = String(e?.message ?? e); }).finally(() => { starting = false; });
    if (req.query.wait) { await p; return res.json({ ok: true, ...state() }); }
    res.status(202).json({ started: true });
  });
  app.post("/api/runs/scan", startRun("scan"));
  app.post("/api/runs/execute", startRun("execute"));
  app.get("/api/runs", (_req, res) => res.json(listRuns()));
  app.get("/api/trace", (req, res) => {
    const runs = listRuns() as { id: string }[];
    const id = req.query.runId ? String(req.query.runId) : req.query.all ? undefined : runs[0]?.id;
    res.json({ runId: id ?? null, rows: id || req.query.all ? getTrace(id) : [] });
  });

  /* ── approvals ── */
  app.post("/api/fields/:id/approve", wrap((req, res) => res.json(approveField(Number(req.params.id)))));
  app.post("/api/fields/:id/reject", wrap((req, res) => res.json(rejectField(Number(req.params.id)))));
  app.post("/api/platforms/:id/approve-all", wrap((req, res) => res.json(approveAllForPlatform(String(req.params.id)))));

  /* ── reports ── */
  app.get("/api/report", (_req, res) => res.json({ summary: latestRunSummary() ?? templateSummary(), rows: buildRows() }));
  app.get("/api/report.csv", (_req, res) => {
    res.type("text/csv").set("Content-Disposition", 'attachment; filename="consistency-report.csv"').send(toCsv(buildRows()));
  });
  app.get("/api/audit", (_req, res) => res.json(getDb().prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT 200").all()));

  /* ── foresight ── */
  app.get("/api/foresight", wrap(async (_req, res) => res.json(await foresight())));
  app.post("/api/foresight/:id/accept", wrap((req, res) => res.json(acceptDraft(String(req.params.id), req.body ?? undefined))));

  /* ── plain-language changes ── */
  app.post("/api/nl/preview", (req, res) => res.json(preview(String(req.body?.text ?? ""))));
  app.post("/api/nl/refine", wrap(async (req, res) => res.json(await refine(String(req.body?.text ?? "")))));
  app.post("/api/nl/confirm", wrap((req, res) => res.json(confirmIntent(req.body?.intent))));

  /* ── tests page ── */
  app.get("/api/tests", (_req, res) => res.json({ tests: listTests(), results: Object.fromEntries(lastResults), testDate: TEST_DATE, llmAvailable: geminiEnabled(), busy: testRunning }));
  const persist = (rs: TcResult[], mode: TcMode) => { try { writeResults(rs, mode === "llm" ? "llm" : ""); } catch { /* read-only host */ } };
  app.post("/api/tests/run", wrap(async (req, res) => {
    if (isBusy() || starting || testRunning) return res.status(409).json({ error: "Another run is in progress." });
    const mode: TcMode = req.body?.mode === "llm" ? "llm" : "deterministic";
    if (mode === "llm" && !geminiEnabled()) return res.status(400).json({ error: "No GEMINI_API_KEY configured on the server." });
    const ids: string[] = req.body?.id === "all" ? [...TC_IDS] : [String(req.body?.id)];
    if (!ids.every((i) => (TC_IDS as readonly string[]).includes(i))) return res.status(400).json({ error: "Unknown test id" });
    testRunning = true;
    try {
      const results: TcResult[] = [];
      for (const id of ids) results.push(await runTc(id as (typeof TC_IDS)[number], { mode, screenshotDir: path.join(evidenceDir(), mode === "llm" ? "llm" : "", "screenshots") }));
      for (const r of results) lastResults.set(`${r.mode}:${r.id}`, r);
      persist(results, mode);
      res.json({ results });
    } finally { testRunning = false; }
  }));
  app.post("/api/tests/guardrail-demo", wrap(async (_req, res) => {
    if (isBusy() || starting || testRunning) return res.status(409).json({ error: "Another run is in progress." });
    testRunning = true;
    try { const g = await runGuardrailDemo(); try { writeGuardrail(g); } catch { /* ignore */ } res.json(g); } finally { testRunning = false; }
  }));
  app.get("/api/evidence/summary", (_req, res) => {
    const f = path.join(evidenceDir(), "SUMMARY.md");
    if (!fs.existsSync(f)) return res.status(404).type("text/plain").send("No evidence yet — run the tests.");
    res.type("text/markdown").send(fs.readFileSync(f, "utf8"));
  });

  /* ── console (built React app) ── */
  const dist = path.resolve(process.cwd(), "dist/web");
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api|mock|health).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof ApprovalError || err instanceof IntentError ? (err as any).status : (err as any).status ?? 500;
    const msg = String(err.message ?? err).replaceAll(process.env.GEMINI_API_KEY ?? "\u0000", "[redacted]");
    res.status(status).json({ error: msg });
  });
  return app;
}
