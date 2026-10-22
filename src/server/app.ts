import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { dbStatus, driverName, getDb } from "../core/db.js";
import { isDemoNow, today, TZ } from "../core/clock.js";
import { resetAndSeed } from "../core/seed.js";
import { getBusiness, getPlatformListing, listExceptions, listLinkedPlatforms } from "../core/store.js";
import { mockRouter } from "../mock/sites.js";
import { anyRunning, getTraceFor, listRuns, makeRoguePlanner } from "../agent/loop.js";
import { ApprovalError, NotFoundError, approveAllForPlatform, approveField, currentPlanner, execute, isBusy, plannerMode, rejectField, scan } from "../agent/service.js";
import { buildMatchRows, buildRows, latestRunSummary, matchesToCsv, templateSummary, toCsv } from "../agent/report.js";
import { CreateListingError, proposeCreateListing } from "../agent/createListing.js";
import { coverageOf } from "../onboarding/coverage.js";
import { buildChangeLog } from "../agent/changelog.js";
import { DetailsError, hoursToText, updateBusinessDetails } from "../core/details.js";
import { removeException } from "../core/store.js";
import { readerMode } from "../agent/reader.js";
import { acceptDraft, clearHoliday, foresight } from "../foresight/index.js";
import { IntentError, confirmDetails, confirmIntent, isDetailIntent, preview, refine } from "../nl/index.js";
import { evidenceDir, writeGuardrail, writeResults } from "../runner/evidence.js";
import { listTests, runAllTcs, runGuardrailDemo, runTc, TC_IDS, TEST_DATE, type TcMode, type TcResult } from "../runner/tc.js";
import { geminiEnabled } from "../agent/llm.js";
import { bizOf, login, logout, me, requireAuth, requireDemo, sameOrigin } from "./auth.js";
import { publicRouteMounts } from "./registry.js";
import "./onboarding.js"; // registers the public onboarding routes

const pkg = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

const lastErrors = new Map<string, string>();
const starting = new Set<string>();
let testRunning = false;
const lastResults = new Map<string, TcResult>();

const wrap = (fn: (req: Request, res: Response) => unknown | Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res)).catch(next);

export function createApp() {
  const app = express();
  app.set("trust proxy", 1); // behind Render's proxy: correct client IP for rate limiting, req.secure for the cookie
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    if (!req.path.startsWith("/mock")) {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Referrer-Policy", "same-origin");
    }
    next();
  });
  app.use(express.json({ limit: "100kb" }));
  app.use("/mock", mockRouter());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", version: pkg.version, readerMode: readerMode(), plannerMode: plannerMode(), db: dbStatus(), dbDriver: driverName, today: today() });
  });

  /* ── public auth routes ── */
  app.use("/api", sameOrigin);
  app.post("/api/auth/login", wrap(login));
  app.post("/api/auth/logout", logout);
  app.get("/api/auth/me", me);

  /* ── public onboarding routes are mounted by mountOnboarding() ── */
  for (const m of publicRouteMounts) m(app);

  /* ── everything below needs a logged-in business; every query is scoped to it ── */
  const api = express.Router();
  api.use(requireAuth);

  const state = (bizId: string) => {
    const platforms = listLinkedPlatforms(bizId).map((p) => ({ ...p, listing: getPlatformListing(bizId, p.id) }));
    const rows = buildRows(bizId);
    const b = getBusiness(bizId);
    return {
      today: today(), demoNow: isDemoNow(), tz: TZ, plannerMode: plannerMode(), readerMode: readerMode(),
      busy: isBusy(bizId) || starting.has(bizId), lastError: lastErrors.get(bizId) ?? null,
      business: { id: b.id, name: b.name, address: b.address, phone: b.phone, hours: b.hours, isDemo: b.isDemo },
      exceptions: listExceptions(bizId), platforms, rows, coverage: coverageOf(bizId), matches: buildMatchRows(bizId),
      summary: latestRunSummary(bizId) ?? (rows.length ? templateSummary(bizId) : null), llmAvailable: geminiEnabled(),
    };
  };
  api.get("/state", (req, res) => res.json(state(bizOf(req))));

  /* ── edit the owner-approved record (nothing is sent to any site; a scan then offers approval cards) ── */
  api.get("/business", (req, res) => { const b = getBusiness(bizOf(req)); res.json({ id: b.id, name: b.name, address: b.address, phone: b.phone, hoursText: hoursToText(b.hours), hours: b.hours }); });
  api.put("/business", wrap((req, res) => {
    const bizId = bizOf(req);
    if (isBusy(bizId) || starting.has(bizId)) return res.status(409).json({ error: "The agent is working right now. Please try again in a moment." });
    res.json(updateBusinessDetails(bizId, req.body));
  }));
  api.post("/exceptions/:id/cancel", wrap((req, res) => {
    const bizId = bizOf(req);
    if (isBusy(bizId) || starting.has(bizId)) return res.status(409).json({ error: "The agent is working right now. Please try again in a moment." });
    const e = listExceptions(bizId).find((x) => x.id === String(req.params.id) && x.status === "active");
    if (!e) return res.status(404).json({ error: "No such saved holiday or special day." });
    removeException(bizId, e.id);
    res.json({ ok: true });
  }));
  api.get("/changelog", (req, res) => res.json({ entries: buildChangeLog(bizOf(req)) }));

  api.post("/reset", requireDemo, wrap((_req, res) => {
    if (anyRunning() || testRunning) return res.status(409).json({ error: "A run is in progress." });
    resetAndSeed();
    lastErrors.clear();
    res.json({ ok: true });
  }));

  /* ── agent runs (background; poll /api/state.busy) ── */
  const startRun = (kind: "scan" | "execute") => wrap(async (req, res) => {
    const bizId = bizOf(req);
    if (isBusy(bizId) || starting.has(bizId) || testRunning) return res.status(409).json({ error: "Another run is in progress." });
    if (req.query.planner === "rogue" && !req.biz!.isDemo) return res.status(403).json({ error: "Only the demo business can do this." });
    starting.add(bizId);
    const planner = req.query.planner === "rogue" ? makeRoguePlanner(listLinkedPlatforms(bizId).map((p) => p.id)) : currentPlanner();
    const p = (kind === "scan" ? scan(bizId, planner) : execute(bizId, planner))
      .then(() => { lastErrors.delete(bizId); })
      .catch((e) => { lastErrors.set(bizId, String(e?.message ?? e)); })
      .finally(() => { starting.delete(bizId); });
    if (req.query.wait) { await p; return res.json({ ok: true, ...state(bizId) }); }
    res.status(202).json({ started: true });
  });
  api.post("/runs/scan", startRun("scan"));
  api.post("/runs/execute", startRun("execute"));
  api.get("/runs", (req, res) => res.json(listRuns(bizOf(req))));
  api.get("/trace", (req, res) => {
    const bizId = bizOf(req);
    if (req.query.all) return res.json({ runId: null, rows: getTraceFor(bizId) });
    const runs = (listRuns(bizId) as { id: string; kind: string }[]).filter((r) => r.kind !== "auth");
    const wanted = req.query.runId ? String(req.query.runId) : runs[0]?.id;
    // a run id that belongs to another business simply returns nothing
    res.json({ runId: wanted ?? null, rows: wanted ? getTraceFor(bizId, wanted) : [] });
  });

  /* ── approvals ── */
  api.post("/fields/:id/approve", wrap((req, res) => res.json(approveField(bizOf(req), Number(req.params.id)))));
  api.post("/fields/:id/reject", wrap((req, res) => res.json(rejectField(bizOf(req), Number(req.params.id)))));
  api.post("/platforms/:id/approve-all", wrap((req, res) => res.json(approveAllForPlatform(bizOf(req), String(req.params.id)))));

  /* ── reports ── */
  api.get("/report", (req, res) => res.json({ summary: latestRunSummary(bizOf(req)) ?? templateSummary(bizOf(req)), rows: buildRows(bizOf(req)) }));
  api.get("/report.csv", (req, res) => {
    res.type("text/csv").set("Content-Disposition", 'attachment; filename="consistency-report.csv"').send(toCsv(buildRows(bizOf(req))));
  });
  api.get("/report-matches.csv", (req, res) => {
    res.type("text/csv").set("Content-Disposition", 'attachment; filename="listing-matches.csv"').send(matchesToCsv(buildMatchRows(bizOf(req))));
  });
  api.get("/audit", (req, res) => res.json(getDb().prepare("SELECT * FROM audit_log WHERE business_id=? ORDER BY id DESC LIMIT 200").all(bizOf(req))));

  /* ── add my business to a site where it is not listed (a card the owner must approve) ── */
  api.post("/listings/:platformId/propose", wrap(async (req, res) => res.json(await proposeCreateListing(bizOf(req), String(req.params.platformId)))));

  /* ── foresight ── */
  api.get("/foresight", wrap(async (req, res) => res.json(await foresight(bizOf(req)))));
  api.post("/foresight/:id/accept", wrap((req, res) => {
    const bizId = bizOf(req);
    if (isBusy(bizId) || starting.has(bizId)) return res.status(409).json({ error: "The agent is working right now. Please try again in a moment." });
    res.json(acceptDraft(bizId, String(req.params.id), req.body ?? undefined));
  }));
  api.post("/foresight/:id/clear", wrap((req, res) => {
    const bizId = bizOf(req);
    if (isBusy(bizId) || starting.has(bizId)) return res.status(409).json({ error: "The agent is working right now. Please try again in a moment." });
    res.json(clearHoliday(bizId, String(req.params.id)));
  }));

  /* ── plain-language changes ── */
  api.post("/nl/preview", (req, res) => res.json(preview(bizOf(req), String(req.body?.text ?? ""))));
  api.post("/nl/refine", wrap(async (req, res) => res.json(await refine(bizOf(req), String(req.body?.text ?? "")))));
  api.post("/nl/confirm", wrap((req, res) => {
    const bizId = bizOf(req);
    if (isDetailIntent(req.body?.intent)) {
      if (isBusy(bizId) || starting.has(bizId)) return res.status(409).json({ error: "The agent is working right now. Please try again in a moment." });
      return res.json(confirmDetails(bizId, req.body.intent));
    }
    res.json(confirmIntent(bizId, req.body?.intent));
  }));

  /* ── tests page (demo business only: it resets everything) ── */
  api.get("/tests", requireDemo, (_req, res) => res.json({ tests: listTests(), results: Object.fromEntries(lastResults), testDate: TEST_DATE, llmAvailable: geminiEnabled(), busy: testRunning }));
  const persist = (rs: TcResult[], mode: TcMode) => { try { writeResults(rs, mode === "llm" ? "llm" : ""); } catch { /* read-only host */ } };
  api.post("/tests/run", requireDemo, wrap(async (req, res) => {
    if (anyRunning() || starting.size || testRunning) return res.status(409).json({ error: "Another run is in progress." });
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
  api.post("/tests/guardrail-demo", requireDemo, wrap(async (_req, res) => {
    if (anyRunning() || starting.size || testRunning) return res.status(409).json({ error: "Another run is in progress." });
    testRunning = true;
    try { const g = await runGuardrailDemo(); try { writeGuardrail(g); } catch { /* ignore */ } res.json(g); } finally { testRunning = false; }
  }));
  api.get("/evidence/summary", requireDemo, (_req, res) => {
    const f = path.join(evidenceDir(), "SUMMARY.md");
    if (!fs.existsSync(f)) return res.status(404).type("text/plain").send("No evidence yet — run the tests.");
    res.type("text/markdown").send(fs.readFileSync(f, "utf8"));
  });
  app.use("/api", api);
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

  /* ── console (built React app) ── */
  const dist = path.resolve(process.cwd(), "dist/web");
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api|mock|health).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof ApprovalError || err instanceof NotFoundError || err instanceof IntentError || err instanceof CreateListingError || err instanceof DetailsError ? (err as any).status : (err as any).status ?? 500;
    const msg = String(err.message ?? err).replaceAll(process.env.GEMINI_API_KEY ?? "\u0000", "[redacted]");
    res.status(status).json({ error: msg });
  });
  return app;
}
