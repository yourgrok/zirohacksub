import { getDb } from "../core/db.js";
import { audit, getOwnedField, listFields, transition } from "../core/store.js";
import { isRunning, recordTrace, runAgent } from "./loop.js";
import { geminiPlanner, summariseReport } from "./geminiPlanner.js";
import { geminiEnabled } from "./llm.js";
import { deterministicPlanner } from "./planners.js";
import { templateSummary } from "./report.js";
import type { Planner } from "./types.js";

export class ApprovalError extends Error {
  status = 409;
}
/** Also used for "this field belongs to another business": answered exactly like a missing one. */
export class NotFoundError extends Error {
  status = 404;
}

export type PlannerProvider = () => Planner;
/**
 * The agent loop is rules-driven by default: the deterministic planner picks every tool, so a scan never waits on (or burns the
 * quota of) a model. Gemini is used only in Edit & Ask. The Gemini planner is an opt-in experiment: AGENT_PLANNER=gemini plus a key.
 */
export const plannerMode = (): "gemini" | "deterministic" => (process.env.AGENT_PLANNER === "gemini" && geminiEnabled() ? "gemini" : "deterministic");
let provider: PlannerProvider = () => (plannerMode() === "gemini" ? geminiPlanner : deterministicPlanner);
export function setPlannerProvider(p: PlannerProvider) { provider = p; }
export const currentPlanner = () => provider();

async function finish(bizId: string, runId: string) {
  let summary: string;
  const t0 = performance.now();
  try {
    if (plannerMode() !== "gemini") { // rules-driven: the headline is a template over the field states, no model call
      summary = templateSummary(bizId);
      getDb().prepare("UPDATE runs SET summary=? WHERE id=?").run(summary, runId);
      return summary;
    }
    const r = await summariseReport(bizId);
    summary = r.text;
    recordTrace(runId, "summarise_report", {}, summary, performance.now() - t0, r.decider, r.note);
  } catch { summary = templateSummary(bizId); }
  getDb().prepare("UPDATE runs SET summary=? WHERE id=?").run(summary, runId);
  return summary;
}

export async function scan(bizId: string, planner: Planner = provider()) {
  const r = await runAgent({ bizId, kind: "scan", planner });
  const summary = await finish(bizId, r.runId);
  return { ...r, summary };
}

export async function execute(bizId: string, planner: Planner = provider()) {
  const r = await runAgent({ bizId, kind: "execute", planner });
  const summary = await finish(bizId, r.runId);
  return { ...r, summary };
}

export const isBusy = (bizId: string) => isRunning(bizId);

/* ───────────── owner approvals (the ONLY way a field becomes APPROVED) ───────────── */

export function approveField(bizId: string, id: number, who = "owner") {
  const f = getOwnedField(bizId, id);
  if (!f) throw new NotFoundError("No such field");
  if (f.state === "REJECTED") transition(id, "PROPOSED", "owner", `re-opened by ${who}`); // owner changed their mind
  else if (f.state !== "PROPOSED") throw new ApprovalError(`Only a proposed change can be approved (this one is ${f.state}).`);
  transition(id, "APPROVED", "owner", `approved by ${who}`);
  audit(bizId, who, "approve", f.platform_id, f.field_key, { intended: f.intended, from: f.original_raw });
  return getOwnedField(bizId, id)!;
}

export function rejectField(bizId: string, id: number, who = "owner") {
  const f = getOwnedField(bizId, id);
  if (!f) throw new NotFoundError("No such field");
  if (f.state !== "PROPOSED" && f.state !== "APPROVED") throw new ApprovalError(`Only a proposed or approved-but-unsent change can be rejected (this one is ${f.state}).`);
  transition(id, "REJECTED", "owner", `rejected by ${who}`);
  audit(bizId, who, "reject", f.platform_id, f.field_key, {});
  return getOwnedField(bizId, id)!;
}

export function approveAllForPlatform(bizId: string, platformId: string, who = "owner") {
  const rows = listFields(bizId, platformId).filter((f) => f.state === "PROPOSED");
  return rows.map((f) => approveField(bizId, f.id, who));
}
