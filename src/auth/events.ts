import { getDb } from "../core/db.js";
import { nowTs } from "../core/clock.js";
import { recordTrace } from "../agent/loop.js";
import type { Decider } from "../agent/types.js";

/**
 * Login and onboarding events are written to the same agent trace as tool calls (always labelled Deterministic).
 * They hang off a pseudo-run so they can be shown next to the agent's work. NEVER pass a PIN here.
 */
export function eventRun(bizId: string | null, kind: "auth" | "onboarding", id?: string): string {
  const runId = id ?? (kind === "auth" ? `auth_${bizId ?? "anon"}` : `onb_${Date.now().toString(36)}`);
  getDb().prepare("INSERT OR IGNORE INTO runs (id,kind,status,planner_mode,started_at,finished_at,business_id) VALUES (?,?,?,?,?,?,?)")
    .run(runId, kind, "done", "deterministic", nowTs(), nowTs(), bizId);
  return runId;
}

export function logEvent(runId: string, tool: string, input: unknown, output: string, ms = 0, decider: Decider = "Deterministic", note?: string) {
  recordTrace(runId, tool, input, output, ms, decider, note);
}
