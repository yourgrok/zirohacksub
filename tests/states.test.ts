import { beforeEach, describe, expect, it } from "vitest";
import { FIELD_STATES, type FieldState } from "../src/core/types.js";
import { TRANSITIONS, TransitionError, assertTransition, canTransition } from "../src/core/states.js";
import { resetAndSeed } from "../src/core/seed.js";
import { createField, getField, transition } from "../src/core/store.js";

describe("state machine table", () => {
  it("covers every state", () => {
    for (const s of FIELD_STATES) expect(TRANSITIONS[s]).toBeDefined();
  });
  it("happy path is allowed", () => {
    const path: FieldState[] = ["MISMATCH", "PROPOSED", "APPROVED", "APPLIED", "VERIFIED"];
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i], path[i + 1])).toBe(true);
  });
  it("pending path is allowed", () => {
    expect(canTransition("APPLIED", "PENDING_MODERATION")).toBe(true);
    expect(canTransition("PENDING_MODERATION", "VERIFIED")).toBe(true);
  });
  it.each([
    ["MISMATCH", "APPROVED"], ["MISMATCH", "APPLIED"], ["MISMATCH", "VERIFIED"], ["PROPOSED", "APPLIED"],
    ["PROPOSED", "VERIFIED"], ["APPROVED", "VERIFIED"], ["FLAGGED_NOT_OWNER", "APPROVED"], ["FLAGGED_NOT_OWNER", "APPLIED"],
    ["PENDING_MODERATION", "APPLIED"], ["REJECTED", "APPROVED"], ["MATCH", "APPLIED"],
  ] as [FieldState, FieldState][])("blocks %s -> %s", (a, b) => {
    expect(canTransition(a, b)).toBe(false);
    expect(() => assertTransition(a, b, "owner")).toThrow(TransitionError);
  });
  it("only the verifier may enter VERIFIED; only the owner may approve", () => {
    expect(() => assertTransition("APPLIED", "VERIFIED", "planner")).toThrow(TransitionError);
    expect(() => assertTransition("APPLIED", "VERIFIED", "applier")).toThrow(TransitionError);
    expect(() => assertTransition("APPLIED", "VERIFIED", "verifier")).not.toThrow();
    expect(() => assertTransition("PROPOSED", "APPROVED", "planner")).toThrow(TransitionError);
    expect(() => assertTransition("PROPOSED", "APPROVED", "owner")).not.toThrow();
  });
});

describe("transition() persistence", () => {
  beforeEach(() => resetAndSeed());
  const base = {
    business_id: "biz_sunrise_001", platform_id: "site_a", field_key: "phone", label: "Phone", state: "MISMATCH" as FieldState,
    original_raw: "x", original_norm: "x", current_raw: "x", current_norm: "x", intended: "y", intended_display: "y",
    reason: null, exception_id: null,
  };
  it("records history and rejects illegal moves", () => {
    const f = createField(base);
    transition(f.id, "PROPOSED", "planner", "proposed");
    transition(f.id, "APPROVED", "owner", "approved");
    expect(() => transition(f.id, "VERIFIED", "verifier", "skip apply")).toThrow(TransitionError);
    expect(getField(f.id)!.state).toBe("APPROVED");
    transition(f.id, "APPLIED", "applier", "sent");
    transition(f.id, "VERIFIED", "verifier", "reloaded");
    expect(getField(f.id)!.state).toBe("VERIFIED");
  });
});
