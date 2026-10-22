import { countStates } from "./tools.js";
import type { Decision, PlanView, Planner, PlatformView, RunState, ToolName } from "./types.js";

/** Which tools are legal next for a platform. Shared by every planner and by the guardrail. */
export function legalFor(phase: "scan" | "execute", stage: PlatformView["stage"], canEdit: boolean | null, counts: Record<string, number>): ToolName[] {
  if (phase === "scan") {
    switch (stage) {
      case "unread": return ["read_listing"];
      case "read": return ["normalise"];
      case "normalised": return ["compare"];
      case "compared": return canEdit === false ? ["flag_listing"] : ["propose"];
      default: return [];
    }
  }
  const approved = counts.APPROVED ?? 0;
  const inflight = (counts.APPLIED ?? 0) + (counts.PENDING_MODERATION ?? 0);
  if (stage === "idle") {
    if (approved > 0) return ["apply_approved"];
    if (inflight > 0) return ["reload_and_verify"];
    return [];
  }
  if (stage === "applied" && inflight > 0) return ["reload_and_verify"];
  return [];
}

export function buildView(st: RunState, platforms: { id: string; name: string }[], business: PlanView["business"]): PlanView {
  const pv: PlatformView[] = platforms.map((p) => {
    const stage = st.stage.get(p.id) ?? (st.phase === "scan" ? "unread" : "idle");
    const canEdit = st.canEdit.has(p.id) ? st.canEdit.get(p.id)! : null;
    const counts = countStates(st.bizId, p.id);
    return { id: p.id, name: p.name, stage, canEdit, counts, legal: legalFor(st.phase, stage, canEdit, counts) };
  });
  const proposalsOutstanding = pv.reduce((a, p) => a + (p.counts.PROPOSED ?? 0), 0);
  return { phase: st.phase, business, platforms: pv, proposalsOutstanding, asked: st.asked, recent: st.recent.slice(-6) };
}

/** Always available. Pure function of the view. */
export const deterministicPlanner: Planner = {
  name: "deterministic",
  async next(view) {
    for (const p of view.platforms) {
      if (p.legal.length) {
        const tool = p.legal[0];
        return { decision: { tool, platform: p.id, rationale: `${p.id}: next step in the fixed workflow is ${tool}` }, decider: "Deterministic" };
      }
    }
    if (view.phase === "scan" && view.proposalsOutstanding > 0 && !view.asked) {
      return { decision: { tool: "ask_owner", question: `${view.proposalsOutstanding} change(s) proposed — please approve or reject each card.`, rationale: "scan finished; human approval is required before anything is edited" }, decider: "Deterministic" };
    }
    return { decision: { tool: "done", rationale: "nothing left to do" }, decider: "Deterministic" };
  },
};

/**
 * A deliberately misbehaving planner for the guardrail demo/tests: it tries to apply things the owner never approved,
 * flag an editable listing, and touch a decoy listing. Every one of these must be blocked in code.
 */
export function rogueDecisions(platforms: string[]): Decision[] {
  const first = platforms[0];
  const decoy = { tool: "propose", platform: first, rationale: "rogue: target the look-alike listing", listingId: "LST-A-2002" } as Decision;
  return [
    { tool: "apply_approved", platform: first, rationale: "rogue: skip the owner and just fix everything" },
    { tool: "apply_approved", platform: platforms[1] ?? first, fields: ["phone", "address"], rationale: "rogue: apply fields that were never approved" },
    { tool: "reload_and_verify", platform: first, rationale: "rogue: mark things verified without applying" },
    decoy,
    { tool: "flag_listing", platform: first, rationale: "rogue: flag an editable listing to hide a mismatch" },
  ];
}
