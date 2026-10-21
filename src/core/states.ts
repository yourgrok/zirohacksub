import type { FieldState } from "./types.js";

export type Actor = "system" | "comparator" | "planner" | "owner" | "applier" | "verifier";

/** Allowed per-field state transitions. Anything else throws. */
export const TRANSITIONS: Record<FieldState, FieldState[]> = {
  MATCH: ["MATCH", "FORMAT_ONLY_EQUIVALENT", "MISMATCH"],
  FORMAT_ONLY_EQUIVALENT: ["FORMAT_ONLY_EQUIVALENT", "MATCH", "MISMATCH"],
  MISMATCH: ["MISMATCH", "PROPOSED", "FLAGGED_NOT_OWNER", "MATCH", "FORMAT_ONLY_EQUIVALENT"],
  PROPOSED: ["PROPOSED", "APPROVED", "REJECTED", "MISMATCH", "FLAGGED_NOT_OWNER", "MATCH", "FORMAT_ONLY_EQUIVALENT"],
  APPROVED: ["APPLIED", "REJECTED", "PROPOSED", "FLAGGED_NOT_OWNER"],
  REJECTED: ["REJECTED", "PROPOSED", "MATCH", "FORMAT_ONLY_EQUIVALENT", "MISMATCH"],
  APPLIED: ["VERIFIED", "PENDING_MODERATION", "MISMATCH"],
  PENDING_MODERATION: ["PENDING_MODERATION", "VERIFIED", "MISMATCH"],
  VERIFIED: ["VERIFIED", "MISMATCH"],
  FLAGGED_NOT_OWNER: ["FLAGGED_NOT_OWNER", "MISMATCH", "MATCH", "FORMAT_ONLY_EQUIVALENT"],
};

/** Who may move a field INTO a state. */
const ENTRY_ACTORS: Partial<Record<FieldState, Actor[]>> = {
  APPROVED: ["owner"],
  REJECTED: ["owner"],
  APPLIED: ["applier"],
  VERIFIED: ["verifier"],
  PENDING_MODERATION: ["verifier", "applier"],
};

export class TransitionError extends Error {}

export function canTransition(from: FieldState, to: FieldState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: FieldState, to: FieldState, actor: Actor): void {
  if (!canTransition(from, to)) throw new TransitionError(`Illegal transition ${from} -> ${to}`);
  const allowed = ENTRY_ACTORS[to];
  if (allowed && from !== to && !allowed.includes(actor)) {
    throw new TransitionError(`Actor "${actor}" may not move a field to ${to}`);
  }
}

/** States in which a field is "in flight" and a re-scan must not overwrite it. */
export const IN_FLIGHT: FieldState[] = ["APPROVED", "APPLIED", "PENDING_MODERATION"];
