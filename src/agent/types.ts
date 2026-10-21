import { z } from "zod";
import type { FieldState } from "../core/types.js";
import type { Comparison, Normalised } from "./compare.js";
import type { DashboardRead, PublicRead } from "./reader.js";

export const TOOL_NAMES = ["read_listing", "normalise", "compare", "propose", "apply_approved", "reload_and_verify", "flag_listing", "ask_owner"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export type Decider = "Gemini" | "Deterministic" | "Fallback" | "Blocked";

export const DecisionZ = z.object({
  tool: z.enum([...TOOL_NAMES, "done"]),
  platform: z.string().nullable().optional(),
  fields: z.array(z.string()).nullable().optional(),
  reason: z.string().nullable().optional(),
  question: z.string().nullable().optional(),
  rationale: z.string().default(""),
});
export type Decision = z.infer<typeof DecisionZ>;

export type Stage = "unread" | "read" | "normalised" | "compared" | "decided" | "idle" | "applied" | "verified" | "skipped";

export interface RunState {
  runId: string;
  phase: "scan" | "execute";
  reads: Map<string, { pub: PublicRead; dash: DashboardRead; via: string }>;
  norms: Map<string, Normalised>;
  comps: Map<string, Comparison[]>;
  stage: Map<string, Stage>;
  canEdit: Map<string, boolean>;
  asked: boolean;
  geminiCalls: number;
  recent: string[];
}

export interface PlatformView {
  id: string;
  name: string;
  stage: Stage;
  canEdit: boolean | null;
  counts: Partial<Record<FieldState, number>>;
  legal: ToolName[];
}

export interface PlanView {
  phase: "scan" | "execute";
  business: { name: string; address: string; phone: string };
  platforms: PlatformView[];
  proposalsOutstanding: number;
  asked: boolean;
  recent: string[];
}

export interface PlannerResult { decision: Decision; decider: Decider; note?: string }
export interface Planner {
  name: "gemini" | "deterministic" | "rogue";
  next(view: PlanView, state: RunState): Promise<PlannerResult>;
}
