import { getDb } from "../core/db.js";
import { audit, getField, listFields, transition } from "../core/store.js";
import { activeRun, runAgent } from "./loop.js";
import { deterministicPlanner } from "./planners.js";
import { templateSummary } from "./report.js";
import type { Planner } from "./types.js";

export class ApprovalError extends Error {
  status = 409;
}

export type PlannerProvider = () => Planner;
let provider: PlannerProvider = () => deterministicPlanner;
export function setPlannerProvider(p: PlannerProvider) { provider = p; }
export const currentPlanner = () => provider();

/** Hook so the Gemini layer can write the plain-English summary. Falls back to the template. */
export type Summariser = () => Promise<string>;
let summariser: Summariser = async () => templateSummary();
export function setSummariser(s: Summariser) { summariser = s; }

async function finish(runId: string) {
  let summary: string;
  try { summary = await summariser(); } catch { summary = templateSummary(); }
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
  if (f.state !== "PROPOSED") throw new ApprovalError(`Only a proposed change can be approved (this one is ${f.state}).`);
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
