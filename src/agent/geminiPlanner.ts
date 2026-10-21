import { z } from "zod";
import { llmJson, LlmError, fastModel, plannerModel, geminiEnabled } from "./llm.js";
import { deterministicPlanner } from "./planners.js";
import { toolCatalogue } from "./tools.js";
import { DecisionZ, type PlanView, type Planner, type PlannerResult, type RunState } from "./types.js";
import { buildRows, templateSummary } from "./report.js";

const SYSTEM = `You are the planning step of a business-listing consistency agent. You never edit anything yourself.
Each turn you choose exactly ONE next tool from the tool list, normally one of the "legal" tools listed for a platform.
Rules you must respect (they are also enforced in code, and anything else is blocked):
- Only apply_approved for fields the owner has approved. Never invent approvals.
- Use flag_listing only when a platform denied permission (canEdit=false).
- Formatting-only differences (phone formats, address abbreviations) are not mismatches.
- When nothing is left to do, answer tool="done".
Answer ONLY with JSON: {"tool": string, "platform": string|null, "rationale": string}.`;

const MAX_CALLS = () => Number(process.env.GEMINI_MAX_CALLS_PER_RUN ?? 60);

export const geminiPlanner: Planner = {
  name: "gemini",
  async next(view: PlanView, st: RunState): Promise<PlannerResult> {
    const fallback = async (why: string): Promise<PlannerResult> => {
      const d = await deterministicPlanner.next(view, st);
      return { decision: d.decision, decider: "Fallback", note: `Gemini unavailable for this step (${why}) — deterministic planner used` };
    };
    if (st.geminiCalls >= MAX_CALLS()) return fallback("per-run Gemini call budget reached");
    st.geminiCalls++;
    // Gemini only sees: tool list, business record, platform states and previous tool results. Never secrets.
    const prompt = `TOOLS: ${JSON.stringify(toolCatalogue())}\nSTATE: ${JSON.stringify(view)}`;
    try {
      const res = await llmJson(DecisionZ, { models: [plannerModel(), fastModel()], system: SYSTEM, prompt });
      return { decision: res.data, decider: "Gemini", note: `model ${res.model}${res.cached ? " (cached)" : ""}` };
    } catch (e) {
      const err = e instanceof LlmError ? e : new LlmError("error", String((e as Error).message));
      return fallback(`${err.kind}: ${err.message}`);
    }
  },
};

const SummaryZ = z.object({ summary: z.string().min(5).max(400) });

/** Plain-English headline for the report. Gemini when available; deterministic template otherwise. */
export async function summariseReport(): Promise<{ text: string; decider: "Gemini" | "Deterministic" | "Fallback"; note?: string }> {
  const template = templateSummary();
  if (!geminiEnabled()) {
    return { text: template, decider: "Deterministic" };
  }
  const rows = buildRows().map((r) => ({ platform: r.platform, field: r.field, state: r.state }));
  try {
    const res = await llmJson(SummaryZ, {
      models: [plannerModel(), fastModel()],
      system: `Write a short plain-English status for a shop owner (max 2 sentences) from the field states. Only state facts present in the data: VERIFIED = fixed and re-checked, PENDING_MODERATION = waiting for the site, FLAGGED_NOT_OWNER = owner must reclaim the listing, PROPOSED = waiting for owner approval. Answer JSON {"summary": string}.`,
      prompt: `FIELDS: ${JSON.stringify(rows)}\nTEMPLATE_FOR_REFERENCE: ${template}`,
    });
    return { text: res.data.summary, decider: "Gemini", note: `model ${res.model}` };
  } catch (e) {
    return { text: template, decider: "Fallback", note: `${(e as LlmError).kind ?? "error"}: ${(e as Error).message}` };
  }
}
