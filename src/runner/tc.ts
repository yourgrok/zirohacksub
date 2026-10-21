import { getDb } from "../core/db.js";
import { setClockOverride, today } from "../core/clock.js";
import { resetAndSeed } from "../core/seed.js";
import { audit, getFieldByKey, history, listExceptions, listFields } from "../core/store.js";
import { baseUrl, fetchPage, playwrightAvailable, readerMode } from "../agent/reader.js";
import { getTrace, type TraceRow } from "../agent/loop.js";
import { approveAllForPlatform, approveField, execute, scan } from "../agent/service.js";
import { geminiEnabled } from "../agent/llm.js";
import { foresight } from "../foresight/index.js";
import { confirmIntent, preview, refine } from "../nl/index.js";
import path from "node:path";
import fs from "node:fs";

/** Tests always run against this fixed date so results never change from day to day. */
export const TEST_DATE = "2026-10-21";
export type TcMode = "deterministic" | "llm";
export const TC_IDS = ["TC1", "TC2", "TC3", "TC4", "TC5", "TC6"] as const;
export type TcId = (typeof TC_IDS)[number];

export interface Check { name: string; pass: boolean; detail: string }
export interface TcResult {
  id: TcId; title: string; mode: TcMode; input: string; expected: string; actual: string; pass: boolean; explanation: string;
  checks: Check[]; startedAt: string; durationMs: number; testDate: string; readerMode: string;
  runs: string[]; trace: TraceRow[]; fallbacks: TraceRow[]; blocked: TraceRow[];
  states: { platform: string; field: string; state: string; original: string | null; current: string | null; intended: string | null; reason: string | null; history: string[] }[];
  extra?: Record<string, unknown>; screenshots: string[];
}

const DEFS: Record<TcId, { title: string; input: string; expected: string }> = {
  TC1: { title: "Holiday hours differ on one site", input: "Record: Diwali 8 Nov 2026 special hours 10:00–14:00. Site B shows Diwali as Closed; other sites match.", expected: "Site B holiday field is proposed, owner approves it, it is APPLIED and then VERIFIED after the public page is reloaded. No other site is written to." },
  TC2: { title: "Phone formatted differently but identical", input: "Record phone +91 90000 00001. Site C shows “090000 00001” (and an abbreviated address).", expected: "FORMAT_ONLY_EQUIVALENT, no proposal created, nothing ever written to site C." },
  TC3: { title: "Listing claimed by someone else", input: "Site D's listing is claimed by another account and has an outdated phone (+91 90000 00099).", expected: "FLAGGED_NOT_OWNER, never edited, zero write attempts logged for site D." },
  TC4: { title: "Edit pending moderation", input: "Site E shows Sunday as closed; every edit on site E goes to a moderation queue.", expected: "PENDING_MODERATION (never reported corrected) until /mock/admin approves it and the page is reloaded, then VERIFIED." },
  TC5: { title: "Plain-language closure flows through approval", input: "Owner types: “we are closed on 26th December”.", expected: "Preview resolves 26 Dec 2026 (closed). Confirm creates a natural-language exception; the pipeline proposes it per site; approved sites are VERIFIED, E is PENDING_MODERATION, D is FLAGGED_NOT_OWNER. Nothing is saved before Confirm and nothing applied before approval." },
  TC6: { title: "Foresight alert for a holiday with no exception", input: "Today is pinned to 21 Oct 2026. Bhai Dooj (11 Nov 2026) has no exception on the record.", expected: "An alert is raised (30-day milestone, chip “Not set”) with a draft suggestion that is NOT applied automatically." },
};

export const listTests = () => TC_IDS.map((id) => ({ id, ...DEFS[id] }));

const writesAt = (site: string) => (getDb().prepare("SELECT COUNT(*) c FROM mock_writes WHERE site=?").get(site) as { c: number }).c;
const totalWrites = () => (getDb().prepare("SELECT COUNT(*) c FROM mock_writes").get() as { c: number }).c;
const histOf = (platform: string, key: string) => {
  const f = getFieldByKey(platform, key);
  return f ? (history(f.id) as { from_state: string | null; to_state: string }[]).map((h) => h.to_state) : [];
};

export interface RunnerOptions { mode: TcMode; screenshotDir?: string }

async function shot(opts: RunnerOptions, name: string, urlPath: string, list: string[]) {
  if (!opts.screenshotDir || readerMode() === "http") return;
  try {
    if (!(await playwrightAvailable())) return;
    fs.mkdirSync(opts.screenshotDir, { recursive: true });
    const file = path.join(opts.screenshotDir, `${name}.png`);
    await fetchPage(urlPath, { screenshotPath: file });
    if (fs.existsSync(file)) list.push(path.relative(process.cwd(), file).replaceAll("\\", "/"));
  } catch { /* screenshots are best-effort */ }
}

type Body = (c: (name: string, pass: boolean, detail?: string) => void, runs: string[], extra: Record<string, unknown>, shots: (n: string, p: string) => Promise<void>) => Promise<string>;

const BODIES: Record<TcId, Body> = {
  async TC1(c, runs, extra, shots) {
    await shots("TC1-siteB-before", "/mock/b/listing/LST-B-1001");
    runs.push((await scan()).runId);
    const key = "holiday:ex_seed_diwali";
    const f = getFieldByKey("site_b", key)!;
    c("Site B holiday detected as a mismatch and proposed", f.state === "PROPOSED", `state=${f.state}; original="${f.original_raw}"; intended="${f.intended_display}"`);
    c("Sites A, C, D, E holiday already match (no proposal)", ["site_a", "site_c", "site_d", "site_e"].every((s) => getFieldByKey(s, key)!.state === "MATCH"), "all MATCH");
    runs.push((await execute()).runId);
    c("Nothing is written before the owner approves", writesAt("site_b") === 0 && getFieldByKey("site_b", key)!.state === "PROPOSED", `writes at B = ${writesAt("site_b")}`);
    approveField(f.id);
    runs.push((await execute()).runId);
    const h = histOf("site_b", key);
    c("State went APPLIED then VERIFIED", h.includes("APPLIED") && h.indexOf("APPLIED") < h.indexOf("VERIFIED"), h.join(" → "));
    c("Public page reloaded shows the approved value", (await (await fetch(baseUrl() + "/mock/b/listing/LST-B-1001")).text()).includes("10:00–14:00"), "page shows 10:00–14:00 for 2026-11-08");
    c("Exactly one write, only to site B", writesAt("site_b") === 1 && totalWrites() === 1, `total writes = ${totalWrites()}`);
    runs.push((await execute()).runId);
    c("Re-running never double-applies (idempotent)", totalWrites() === 1, `total writes after re-run = ${totalWrites()}`);
    await shots("TC1-siteB-after", "/mock/b/listing/LST-B-1001");
    return `B holiday: ${h.join(" → ")}; ${totalWrites()} write(s).`;
  },
  async TC2(c, runs, extra, shots) {
    await shots("TC2-siteC", "/mock/c/listing/LST-C-1001");
    runs.push((await scan()).runId);
    const p = getFieldByKey("site_c", "phone")!;
    c("Phone classified FORMAT_ONLY_EQUIVALENT", p.state === "FORMAT_ONLY_EQUIVALENT", `raw="${p.original_raw}" normalised=${p.current_norm}`);
    c("Raw and normalised values are kept side by side", p.original_raw === "090000 00001" && p.current_norm === "+919000000001", `${p.original_raw} | ${p.current_norm}`);
    c("No proposal was created for site C", listFields("site_c").every((f) => f.state !== "PROPOSED") && p.intended === null, "no PROPOSED fields");
    approveAllForPlatform("site_c");
    runs.push((await execute()).runId);
    c("Nothing was written to site C", writesAt("site_c") === 0, `writes at C = ${writesAt("site_c")}`);
    return `phone ${p.state}, 0 proposals, 0 writes`;
  },
  async TC3(c, runs, extra, shots) {
    await shots("TC3-siteD", "/mock/d/listing/LST-D-1001");
    runs.push((await scan()).runId);
    const p = getFieldByKey("site_d", "phone")!;
    c("Phone mismatch flagged as FLAGGED_NOT_OWNER", p.state === "FLAGGED_NOT_OWNER", `state=${p.state}; reason="${p.reason}"`);
    c("No proposal card exists for site D", listFields("site_d").every((f) => f.state !== "PROPOSED"), "none PROPOSED");
    let refused = false;
    try { approveField(p.id); } catch { refused = true; }
    c("The owner cannot approve a flagged field", refused, "approve → 409");
    runs.push((await execute()).runId);
    const applyAudit = (getDb().prepare("SELECT COUNT(*) c FROM audit_log WHERE platform_id='site_d' AND action='apply'").get() as { c: number }).c;
    c("Zero write attempts logged for site D", writesAt("site_d") === 0 && applyAudit === 0, `mock write log = ${writesAt("site_d")}, apply audit entries = ${applyAudit}`);
    c("Still flagged, never reported as corrected", getFieldByKey("site_d", "phone")!.state === "FLAGGED_NOT_OWNER", "FLAGGED_NOT_OWNER");
    return `phone FLAGGED_NOT_OWNER; ${writesAt("site_d")} write attempts`;
  },
  async TC4(c, runs, extra, shots) {
    runs.push((await scan()).runId);
    const f = getFieldByKey("site_e", "hours")!;
    c("Site E Sunday hours mismatch proposed", f.state === "PROPOSED", `original="${f.original_raw}"`);
    approveField(f.id);
    runs.push((await execute()).runId);
    c("After applying, status is PENDING_MODERATION (not corrected)", getFieldByKey("site_e", "hours")!.state === "PENDING_MODERATION", getFieldByKey("site_e", "hours")!.reason ?? "");
    const unchanged = (await (await fetch(baseUrl() + "/mock/e/listing/LST-E-1001")).text()).includes("Sun: Closed");
    c("Public page unchanged while pending", unchanged, "still shows Sun: Closed");
    await shots("TC4-siteE-pending", "/mock/e/listing/LST-E-1001");
    runs.push((await execute()).runId);
    c("Re-checking while still pending keeps PENDING_MODERATION", getFieldByKey("site_e", "hours")!.state === "PENDING_MODERATION", "unchanged");
    const q = getDb().prepare("SELECT id FROM mock_queue WHERE status='pending'").get() as { id: number };
    const r = await fetch(`${baseUrl()}/mock/admin/queue/${q.id}/approve`, { method: "POST", headers: { "content-type": "application/json" } });
    c("Moderator approves in /mock/admin", r.status === 200, `HTTP ${r.status}`);
    runs.push((await execute()).runId);
    const h = histOf("site_e", "hours");
    c("After admin approval and a reload it becomes VERIFIED", getFieldByKey("site_e", "hours")!.state === "VERIFIED", h.join(" → "));
    await shots("TC4-siteE-approved", "/mock/e/listing/LST-E-1001");
    return `site E hours: ${h.join(" → ")}`;
  },
  async TC5(c, runs, extra, shots) {
    const text = "we are closed on 26th December";
    const n0 = listExceptions().length;
    const p = preview(text);
    c("Preview resolves the date explicitly (26 Dec 2026, closed)", p.status === "ok" && p.intent.action === "closed" && p.intent.start === "2026-12-26", p.status === "ok" ? p.chips.map((x) => `${x.label}: ${x.value}`).join(" | ") : JSON.stringify(p));
    c("Nothing is saved before Confirm", listExceptions().length === n0, `exceptions: ${n0}`);
    if (geminiEnabled()) { const r = await refine(text); extra.geminiCrossCheck = r; c("Gemini cross-check did not contradict the parser", r.verdict !== "conflict", `${r.verdict}: ${r.note}`); }
    if (p.status !== "ok") return "preview failed";
    const ex = confirmIntent(p.intent);
    c("Confirm created a natural-language exception", ex.source === "natural-language" && ex.start === "2026-12-26", `${ex.id} source=${ex.source}`);
    runs.push((await scan()).runId);
    const key = `holiday:${ex.id}`;
    c("Proposed on A, B, C and E; flagged on D", ["site_a", "site_b", "site_c", "site_e"].every((s) => getFieldByKey(s, key)?.state === "PROPOSED") && getFieldByKey("site_d", key)?.state === "FLAGGED_NOT_OWNER", ["a", "b", "c", "d", "e"].map((x) => `${x}:${getFieldByKey("site_" + x, key)?.state}`).join(" "));
    runs.push((await execute()).runId);
    c("Approval is never skipped: no write without an approval click", totalWrites() === 0, `writes = ${totalWrites()}`);
    for (const s of ["site_a", "site_b", "site_c", "site_e"]) approveAllForPlatform(s);
    runs.push((await execute()).runId);
    const st = (s: string) => getFieldByKey(s, key)!.state;
    c("A, B, C verified after reload; E pending; D flagged", ["site_a", "site_b", "site_c"].every((s) => st(s) === "VERIFIED") && st("site_e") === "PENDING_MODERATION" && st("site_d") === "FLAGGED_NOT_OWNER", ["a", "b", "c", "d", "e"].map((x) => `${x}:${st("site_" + x)}`).join(" "));
    c("Public page A now lists 26 Dec 2026 as closed", (await (await fetch(baseUrl() + "/mock/a/listing/LST-A-1001")).text()).includes("26 Dec 2026"), "visible on reload");
    await shots("TC5-siteA-after", "/mock/a/listing/LST-A-1001");
    return ["a", "b", "c", "d", "e"].map((x) => `${x}:${st("site_" + x)}`).join(" ");
  },
  async TC6(c, runs, extra) {
    const exBefore = listExceptions().length;
    const f = await foresight();
    const a = f.alerts.find((x) => x.holidayId === "hol_2026_bhaidooj");
    c("Foresight raises an alert for Bhai Dooj (no exception set)", !!a && a.chip === "NOT_SET", a ? a.message : "no alert");
    c("Alert milestone is the 30-day one (21 days away)", a?.milestone === 30, `milestone=${a?.milestone}, daysAway=${a?.daysAway}`);
    const h = f.holidays.find((x) => x.holiday.id === "hol_2026_bhaidooj")!;
    c("Holiday is flagged for the owner to verify its date", h.holiday.verified === false, "verified=false → UI shows “verify date”");
    c("A draft is suggested but nothing is applied automatically", !!h.suggestion && listExceptions().length === exBefore && totalWrites() === 0, `draft: ${h.suggestion.label}; exceptions unchanged (${exBefore}); writes=${totalWrites()}`);
    c("Readiness score for the next holiday (Diwali) is shown with its formula", f.next?.readiness === 92 && f.formula.length > 20, `readiness=${f.next?.readiness}`);
    extra.alert = a; extra.next = f.next && { name: f.next.holiday.name, readiness: f.next.readiness };
    return a ? a.message : "no alert";
  },
};

export async function runTc(id: TcId, opts: RunnerOptions): Promise<TcResult> {
  const prevProvider = process.env.LLM_PROVIDER;
  process.env.LLM_PROVIDER = opts.mode === "deterministic" ? "none" : "gemini";
  setClockOverride(TEST_DATE);
  const t0 = performance.now();
  const startedAt = new Date().toISOString();
  const checks: Check[] = [];
  const runs: string[] = [];
  const extra: Record<string, unknown> = {};
  const screenshots: string[] = [];
  let actual = "";
  let error: string | null = null;
  try {
    resetAndSeed(); // every run starts from a fresh reset
    audit("test-runner", "run-tc", null, null, { id, mode: opts.mode });
    const c = (name: string, pass: boolean, detail = "") => { checks.push({ name, pass, detail }); };
    actual = await BODIES[id](c, runs, extra, async (n, p) => shot(opts, n, p, screenshots));
  } catch (e) {
    error = (e as Error).message;
    checks.push({ name: "Test ran without an unexpected error", pass: false, detail: error });
  } finally {
    setClockOverride(null);
    if (prevProvider === undefined) delete process.env.LLM_PROVIDER; else process.env.LLM_PROVIDER = prevProvider;
  }
  const trace = runs.flatMap((r) => getTrace(r));
  const pass = checks.length > 0 && checks.every((x) => x.pass);
  const failed = checks.filter((x) => !x.pass);
  const interesting = id === "TC1" ? [["site_b", "holiday:ex_seed_diwali"]] : id === "TC2" ? [["site_c", "phone"], ["site_c", "address"]] : id === "TC3" ? [["site_d", "phone"]] : id === "TC4" ? [["site_e", "hours"]] : [];
  const rows = listFields().filter((f) => (interesting.length ? interesting.some(([p, k]) => p === f.platform_id && k === f.field_key) : id === "TC5" ? f.field_key.startsWith("holiday:ex_") && !f.field_key.includes("seed") : false));
  return {
    id, title: DEFS[id].title, mode: opts.mode, input: DEFS[id].input, expected: DEFS[id].expected,
    actual: error ? `ERROR: ${error}` : actual, pass,
    explanation: pass ? "Actual result matches the expected result." : `Difference: ${failed.map((f) => `${f.name} — ${f.detail}`).join("; ")}`,
    checks, startedAt, durationMs: Math.round(performance.now() - t0), testDate: TEST_DATE, readerMode: readerMode(), runs, trace,
    fallbacks: trace.filter((t) => t.decider === "Fallback"), blocked: trace.filter((t) => t.decider === "Blocked"),
    states: rows.map((f) => ({ platform: f.platform_id, field: f.label, state: f.state, original: f.original_raw, current: f.current_raw, intended: f.intended_display, reason: f.reason, history: histOf(f.platform_id, f.field_key) })),
    extra, screenshots,
  };
}

export async function runAllTcs(opts: RunnerOptions): Promise<TcResult[]> {
  const out: TcResult[] = [];
  for (const id of TC_IDS) out.push(await runTc(id, opts));
  return out;
}

export { today };

export interface GuardrailDemo { note: string; attempts: number; blocked: TraceRow[]; writesAfter: number; unapprovedStillProposed: boolean; verifiedCount: number }

/** Simulated rogue planner (NOT Gemini): proves the approval rule cannot be bypassed by any planner. */
export async function runGuardrailDemo(): Promise<GuardrailDemo> {
  const { makeRoguePlanner } = await import("../agent/loop.js");
  const prev = process.env.LLM_PROVIDER;
  process.env.LLM_PROVIDER = "none";
  setClockOverride(TEST_DATE);
  try {
    resetAndSeed();
    const ids = ["site_a", "site_b", "site_c", "site_d", "site_e"];
    const r1 = await scan(makeRoguePlanner(ids));
    const r2 = await execute(makeRoguePlanner(ids));
    const trace = [...getTrace(r1.runId), ...getTrace(r2.runId)];
    const blocked = trace.filter((t) => t.decider === "Blocked");
    return {
      note: "Simulated rogue planner (scripted, not an LLM) tries: apply with no approval, apply unapproved fields, verify without applying, edit the look-alike decoy, flag an editable listing.",
      attempts: blocked.length, blocked, writesAfter: totalWrites(),
      unapprovedStillProposed: getFieldByKey("site_b", "holiday:ex_seed_diwali")?.state === "PROPOSED",
      verifiedCount: listFields().filter((f) => f.state === "VERIFIED").length,
    };
  } finally {
    setClockOverride(null);
    if (prev === undefined) delete process.env.LLM_PROVIDER; else process.env.LLM_PROVIDER = prev;
  }
}
