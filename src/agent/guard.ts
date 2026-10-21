import { listFields } from "../core/store.js";
import { TOOL_NAMES, type Decision, type PlanView, type RunState, type ToolName } from "./types.js";
import { getPlatformListing, listPlatforms } from "../core/store.js";

export type GuardVerdict =
  | { kind: "allow" }
  | { kind: "block"; reason: string }
  | { kind: "force"; reason: string; replacement: Decision };

/**
 * Hard guardrails. These run in code on EVERY decision, whoever made it (Gemini, deterministic, a rogue planner).
 * The prompt is not relied on for any of these.
 */
export function guard(d: Decision, view: PlanView, st: RunState): GuardVerdict {
  if (d.tool === "done") return { kind: "allow" };
  if (!(TOOL_NAMES as readonly string[]).includes(d.tool)) return { kind: "block", reason: `unknown tool "${d.tool}" is not in the registry` };
  if (d.tool === "ask_owner") return { kind: "allow" };

  if (!d.platform) return { kind: "block", reason: `${d.tool} needs a platform` };
  const platform = listPlatforms().find((p) => p.id === d.platform);
  if (!platform) return { kind: "block", reason: `unknown platform "${d.platform}"` };
  // look-alike / decoy protection: a planner may not target any listing but the registered one
  const reg = getPlatformListing(platform.id);
  const extra = d as Decision & { listingId?: string };
  if (extra.listingId && extra.listingId !== reg.listingId) {
    return { kind: "block", reason: `listing ${extra.listingId} is not our registered listing (${reg.listingId}) — look-alike/decoy` };
  }

  const pv = view.platforms.find((p) => p.id === d.platform)!;
  const rows = listFields(platform.id);
  const tool = d.tool as ToolName;

  if (st.phase === "scan" && (tool === "apply_approved" || tool === "reload_and_verify")) {
    return { kind: "block", reason: `${tool} is not allowed during the scan phase — it needs an explicit owner approval first` };
  }
  if (st.phase === "execute" && ["read_listing", "normalise", "compare", "propose"].includes(tool)) {
    return { kind: "block", reason: `${tool} is a scan-phase tool; this run only applies approved changes and verifies` };
  }

  if (tool === "apply_approved") {
    const approved = rows.filter((r) => r.state === "APPROVED");
    if (!approved.length) return { kind: "block", reason: "apply_approved blocked: no field on this platform is APPROVED by the owner in the database" };
    const bad = (d.fields ?? []).filter((k) => !approved.some((r) => r.field_key === k));
    if (bad.length) return { kind: "block", reason: `apply_approved blocked: field(s) ${bad.join(", ")} are not owner-approved in the database` };
    if (pv.canEdit === false) {
      return { kind: "force", reason: "permission denied on this listing — editing is forbidden, flag instead", replacement: { tool: "flag_listing", platform: platform.id, rationale: "forced by guardrail: permission denied" } };
    }
  }
  if (tool === "propose" && pv.canEdit === false) {
    return { kind: "force", reason: "permission denied on this listing — proposals would be unusable, flag instead", replacement: { tool: "flag_listing", platform: platform.id, rationale: "forced by guardrail: permission denied" } };
  }
  if (tool === "flag_listing" && pv.canEdit !== false) {
    return { kind: "block", reason: "flag_listing is only allowed when the platform denied permission" };
  }
  if (tool === "reload_and_verify" && !rows.some((r) => r.state === "APPLIED" || r.state === "PENDING_MODERATION")) {
    return { kind: "block", reason: "reload_and_verify blocked: nothing has been applied on this platform" };
  }
  if (!pv.legal.includes(tool)) {
    return { kind: "block", reason: `${tool} is out of order for ${platform.id} (stage "${pv.stage}"); legal next steps: ${pv.legal.join(", ") || "none"}` };
  }
  return { kind: "allow" };
}
