import { getDb } from "../core/db.js";
import { audit, getField, listFields, transition } from "../core/store.js";
import { activeRun, recordTrace, runAgent } from "./loop.js";
import { geminiPlanner, summariseReport } from "./geminiPlanner.js";
import { geminiEnabled } from "./llm.js";
import { deterministicPlanner } from "./planners.js";
import { templateSummary } from "./report.js";
import type { Planner } from "./types.js";

export class ApprovalError extends Error {
  status = 409;
}

export type PlannerProvider = () => Planner;
let provider: PlannerProvider = () => (geminiEnabled() ? geminiPlanner : deterministicPlanner);
export const plannerMode = (): "gemini" | "deterministic" => (geminiEnabled() ? "gemini" : "deterministic");
export function setPlannerProvider(p: PlannerProvider) { provider = p; }
export const currentPlanner = () => provider();

async function finish(runId: string) {
  let summary: string;
  const t0 = performance.now();
  try {
    const r = await summariseReport();
    summary = r.text;
    recordTrace(runId, "summarise_report", {}, summary, performance.now() - t0, r.decider, r.note);
  } catch { summary = templateSummary(); }
  getDb().prepare("UPDATE runs SET summary=? WHERE id=?").run(summary, runId);
  return summary;
}

export async function scan(planner: Planner = provider()) {
  const r = await runAgent({ kind: "scan", planner });
  const summary = await finish(r.runId);
  return { ...r, summary };
}

export async function execute(planner: Planner = provider()) {
  const r = await runAgent({ kind: "execute", planner });
  const summary = await finish(r.runId);
  return { ...r, summary };
}

export const isBusy = () => activeRun() !== null;

/* ───────────── owner approvals (the ONLY way a field becomes APPROVED) ───────────── */

export function approveField(id: number, who = "owner") {
  const f = getField(id);
  if (!f) throw new ApprovalError("No such field");
  if (f.state === "REJECTED") transition(id, "PROPOSED", "owner", `re-opened by ${who}`); // owner changed their mind
  else if (f.state !== "PROPOSED") throw new ApprovalError(`Only a proposed change can be approved (this one is ${f.state}).`);
  transition(id, "APPROVED", "owner", `approved by ${who}`);
  audit(who, "approve", f.platform_id, f.field_key, { intended: f.intended, from: f.original_raw });
  return getField(id)!;
}

export function rejectField(id: number, who = "owner") {
  const f = getField(id);
  if (!f) throw new ApprovalError("No such field");
  if (f.state !== "PROPOSED" && f.state !== "APPROVED") throw new ApprovalError(`Only a proposed or approved-but-unsent change can be rejected (this one is ${f.state}).`);
  transition(id, "REJECTED", "owner", `rejected by ${who}`);
  audit(who, "reject", f.platform_id, f.field_key, {});
  return getField(id)!;
}

export function approveAllForPlatform(platformId: string, who = "owner") {
  const rows = listFields(platformId).filter((f) => f.state === "PROPOSED");
  return rows.map((f) => approveField(f.id, who));
}
