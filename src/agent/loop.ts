import { nowTs } from "../core/clock.js";
import { getDb } from "../core/db.js";
import { getBusiness, listLinkedPlatforms, listPlatformsWithWork } from "../core/store.js";
import { guard } from "./guard.js";
import { buildView, deterministicPlanner, rogueDecisions } from "./planners.js";
import { TOOLS } from "./tools.js";
import type { Decider, Decision, Planner, PlannerResult, RunState, Stage, ToolName } from "./types.js";

export interface TraceRow {
  id: number; run_id: string; at: string; tool: string; input: string; output_summary: string;
  duration_ms: number; decider: Decider; note: string | null;
}

let runSeq = 0;
const activeRuns = new Map<string, string>(); // business id -> run id (one run at a time PER business)
export const isRunning = (bizId: string) => activeRuns.has(bizId);

/** Trace rows belong to the business of their run (looked up from the runs table). */
export function recordTrace(runId: string, tool: string, input: unknown, output: string, ms: number, decider: Decider, note?: string) {
  getDb().prepare("INSERT INTO trace (run_id,at,tool,input,output_summary,duration_ms,decider,note,business_id) VALUES (?,?,?,?,?,?,?,?,(SELECT business_id FROM runs WHERE id=?))")
    .run(runId, nowTs(), tool, JSON.stringify(input), output, Math.round(ms), decider, note ?? null, runId);
}

/** Internal: rows of one run, whoever owns it. API code must use getTraceFor. */
export function getTrace(runId?: string): TraceRow[] {
  return (runId
    ? getDb().prepare("SELECT * FROM trace WHERE run_id=? ORDER BY id").all(runId)
    : getDb().prepare("SELECT * FROM trace ORDER BY id").all()) as TraceRow[];
}

/** Trace rows visible to one business only. */
export function getTraceFor(bizId: string, runId?: string): TraceRow[] {
  return (runId
    ? getDb().prepare("SELECT * FROM trace WHERE business_id=? AND run_id=? ORDER BY id").all(bizId, runId)
    : getDb().prepare("SELECT * FROM trace WHERE business_id=? ORDER BY id").all(bizId)) as TraceRow[];
}

export function listRuns(bizId: string) {
  return getDb().prepare("SELECT * FROM runs WHERE business_id=? ORDER BY started_at DESC, rowid DESC").all(bizId);
}

const NEXT_STAGE: Partial<Record<ToolName, Stage>> = {
  read_listing: "read", normalise: "normalised", compare: "compared", propose: "decided", flag_listing: "decided",
  apply_approved: "applied", reload_and_verify: "verified",
};

/** "rogue" planner: scripted bad decisions first, then well-behaved. Used only for the guardrail demo and tests. */
export function makeRoguePlanner(platformIds: string[]): Planner {
  const script = rogueDecisions(platformIds);
  return {
    name: "rogue",
    async next(view, st): Promise<PlannerResult> {
      const d = script.shift();
      if (d) return { decision: d, decider: "Gemini", note: "simulated rogue planner (guardrail demo)" };
      return deterministicPlanner.next(view, st);
    },
  };
}

export interface RunOptions { bizId: string; kind: "scan" | "execute"; planner: Planner; maxSteps?: number }

export async function runAgent(opts: RunOptions): Promise<{ runId: string; steps: number; blocked: number }> {
  if (activeRuns.has(opts.bizId)) throw new Error("A run is already in progress");
  const runId = `run_${Date.now().toString(36)}_${++runSeq}`;
  activeRuns.set(opts.bizId, runId);
  const db = getDb();
  db.prepare("INSERT INTO runs (id,kind,status,planner_mode,started_at,business_id) VALUES (?,?,?,?,?,?)").run(runId, opts.kind, "running", opts.planner.name, nowTs(), opts.bizId);
  const st: RunState = {
    runId, bizId: opts.bizId, phase: opts.kind, reads: new Map(), norms: new Map(), comps: new Map(), stage: new Map(), canEdit: new Map(),
    asked: false, geminiCalls: 0, recent: [],
  };
  const biz = getBusiness(opts.bizId);
  const business = { name: biz.name, address: biz.address, phone: biz.phone };
  let steps = 0, blocked = 0;
  try {
    const max = opts.maxSteps ?? 80;
    while (steps < max) {
      steps++;
      // scan reads linked listings only; execute also visits platforms with approved/in-flight work (e.g. a listing being created)
      const platforms = opts.kind === "scan" ? listLinkedPlatforms(opts.bizId) : listPlatformsWithWork(opts.bizId);
      const view = buildView(st, platforms, business);
      let res: PlannerResult;
      try { res = await opts.planner.next(view, st); }
      catch (e) { res = { ...(await deterministicPlanner.next(view, st)), decider: "Fallback", note: `planner error: ${(e as Error).message}` }; }
      let { decision } = res;
      let decider = res.decider;
      let note = res.note;
      if (decision.tool === "done") { recordTrace(runId, "done", {}, decision.rationale || "finished", 0, decider, note); break; }

      const verdict = guard(decision, view, st);
      if (verdict.kind === "block") {
        blocked++;
        recordTrace(runId, decision.tool, { platform: decision.platform, fields: decision.fields }, `BLOCKED BY GUARDRAIL: ${verdict.reason}`, 0, "Blocked", `proposed by ${res.decider}${res.note ? ` (${res.note})` : ""}`);
        const alt = await deterministicPlanner.next(view, st);
        decision = alt.decision; decider = "Deterministic"; note = "next step chosen by deterministic planner after a guardrail block";
        if (decision.tool === "done") { recordTrace(runId, "done", {}, decision.rationale, 0, decider, note); break; }
      } else if (verdict.kind === "force") {
        blocked++;
        recordTrace(runId, decision.tool, { platform: decision.platform }, `BLOCKED BY GUARDRAIL: ${verdict.reason} → forced ${verdict.replacement.tool}`, 0, "Blocked", `proposed by ${res.decider}`);
        decision = verdict.replacement; decider = "Deterministic"; note = "forced by guardrail";
      }

      const tool = TOOLS[decision.tool as ToolName];
      const input = tool.schema.safeParse(toolInput(decision));
      const t0 = performance.now();
      if (!input.success) {
        recordTrace(runId, decision.tool, decision, `invalid tool input: ${input.error.issues[0]?.message}`, performance.now() - t0, "Blocked", note);
        blocked++;
        continue;
      }
      try {
        const out = await tool.run(st, input.data);
        const ms = performance.now() - t0;
        recordTrace(runId, decision.tool, input.data, out.summary, ms, decider, [decision.rationale, note].filter(Boolean).join(" | "));
        st.recent.push(`${decision.tool}(${decision.platform ?? ""}): ${out.summary}`);
        if (decision.platform) st.stage.set(decision.platform, out.forced ? "skipped" : (NEXT_STAGE[decision.tool as ToolName] ?? "skipped"));
      } catch (e) {
        recordTrace(runId, decision.tool, input.data, `ERROR: ${(e as Error).message}`, performance.now() - t0, decider, note);
        st.recent.push(`${decision.tool}(${decision.platform ?? ""}): ERROR ${(e as Error).message}`);
        if (decision.platform) st.stage.set(decision.platform, "skipped");
      }
    }
    db.prepare("UPDATE runs SET status='done', finished_at=? WHERE id=?").run(nowTs(), runId);
  } catch (e) {
    db.prepare("UPDATE runs SET status='error', finished_at=?, summary=? WHERE id=?").run(nowTs(), (e as Error).message, runId);
    throw e;
  } finally {
    activeRuns.delete(opts.bizId);
  }
  return { runId, steps, blocked };
}

function toolInput(d: Decision): Record<string, unknown> {
  switch (d.tool) {
    case "ask_owner": return { question: d.question ?? d.rationale ?? "Please review." };
    case "flag_listing": return { platform: d.platform, reason: d.reason ?? undefined };
    case "apply_approved": return { platform: d.platform, fields: d.fields ?? undefined };
    default: return { platform: d.platform };
  }
}

export const anyRunning = () => activeRuns.size > 0;
