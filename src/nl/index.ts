import { z } from "zod";
import { today, weekdayOf } from "../core/clock.js";
import { audit, getBusiness, listExceptions, removeException, upsertException } from "../core/store.js";
import type { HolidayException } from "../core/types.js";
import { fastModel, geminiEnabled, llmJson, plannerModel, LlmError } from "../agent/llm.js";
import { loadHolidays } from "../foresight/index.js";
import { IntentZ, intentKey, parseChange, type Chip, type Intent, type NlContext, type NlResult } from "./parse.js";
import { prettyDate, prettyDateWithDay } from "../core/clock.js";
import { fmt12 } from "../core/normalise.js";

export function liveContext(bizId: string): NlContext {
  return {
    today: today(),
    hours: getBusiness(bizId).hours,
    exceptions: listExceptions(bizId),
    holidays: loadHolidays().map((h) => ({ id: h.id, name: h.name, date: h.date })),
  };
}

/** Instant, always available, never blocks on an LLM. */
export function preview(bizId: string, text: string): NlResult {
  return parseChange(text, liveContext(bizId));
}

export function chipsFor(i: Intent): Chip[] {
  const date = i.start === i.end ? prettyDateWithDay(i.start) : `${prettyDateWithDay(i.start)} → ${prettyDateWithDay(i.end)}`;
  const action = i.action === "closed" ? "Closed" : i.action === "special" ? "Special hours" : "Reopen (cancel the saved change)";
  return [
    { label: "Action", value: action }, { label: "Date", value: date },
    ...(i.open && i.close ? [{ label: "Time", value: `${fmt12(i.open)} – ${fmt12(i.close)}` }] : []),
    ...(i.reason ? [{ label: "Reason", value: i.reason }] : []),
  ];
}

/* ───────────── Gemini cross-check ───────────── */

const GeminiNlZ = z.object({
  status: z.enum(["ok", "ask"]),
  action: z.enum(["closed", "special", "reopen"]).nullable().optional(),
  start: z.string().nullable().optional(),
  end: z.string().nullable().optional(),
  open: z.string().nullable().optional(),
  close: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  question: z.string().nullable().optional(),
});

export type Refinement =
  | { verdict: "skipped"; note: string }
  | { verdict: "agree"; note: string }
  | { verdict: "conflict"; deterministic: Intent; gemini: Intent; geminiChips: Chip[]; deterministicChips: Chip[]; note: string }
  | { verdict: "unavailable"; note: string };

const SYSTEM = `You convert a shop owner's sentence into ONE structured holiday-hours change. Today's date and weekday are given; resolve every relative date against them (timezone Asia/Kolkata).
Return JSON: {"status":"ok"|"ask","action":"closed"|"special"|"reopen","start":"YYYY-MM-DD","end":"YYYY-MM-DD","open":"HH:MM"|null,"close":"HH:MM"|null,"reason":string|null,"question":string|null}.
- "closed": shop closed all day. "special": different opening hours (24h HH:MM). "reopen": cancel a previously saved change.
- If the date is in the past, unclear, or the action is ambiguous, answer status "ask" with exactly one short question.
- Never invent dates. end equals start for a single day.`;

export async function refine(bizId: string, text: string): Promise<Refinement> {
  if (!geminiEnabled()) return { verdict: "skipped", note: "No Gemini key — deterministic parser only." };
  const ctx = liveContext(bizId);
  const det = parseChange(text, ctx);
  if (det.status === "empty") return { verdict: "skipped", note: "empty" };
  try {
    const t = ctx.today;
    const res = await llmJson(GeminiNlZ, {
      models: [fastModel(), plannerModel()],
      system: SYSTEM,
      prompt: `TODAY: ${t} (${weekdayOf(t)})\nNORMAL_HOURS: ${JSON.stringify(ctx.hours)}\nSAVED_CHANGES: ${JSON.stringify(ctx.exceptions.filter((e) => e.status === "active").map((e) => ({ id: e.id, start: e.start, end: e.end, kind: e.kind })))}\nFESTIVALS: ${JSON.stringify(ctx.holidays.slice(0, 12))}\nOWNER_SAYS: ${text}`,
    });
    const g = res.data;
    if (det.status === "ask") return { verdict: "agree", note: `Gemini ${g.status === "ask" ? "also needs clarification" : "had an answer, but the deterministic parser needs clarification first"}.` };
    if (g.status === "ask") return { verdict: "agree", note: `Gemini was unsure ("${g.question ?? "?"}"); using the deterministic reading.` };
    const parsed = IntentZ.safeParse({ action: g.action, start: g.start, end: g.end ?? g.start, open: g.open ?? null, close: g.close ?? null, reason: g.reason ?? null });
    if (!parsed.success || parsed.data.start < t || parsed.data.end < parsed.data.start) return { verdict: "unavailable", note: "Gemini's answer failed validation; ignored." };
    const gi = parsed.data;
    // reasons are free text, not a disagreement
    if (intentKey(gi) === intentKey(det.intent)) return { verdict: "agree", note: `Gemini (${res.model}) agrees.` };
    return { verdict: "conflict", deterministic: det.intent, gemini: gi, deterministicChips: chipsFor(det.intent), geminiChips: chipsFor(gi), note: `Gemini (${res.model}) read this differently — which is right?` };
  } catch (e) {
    return { verdict: "unavailable", note: `Gemini unavailable (${e instanceof LlmError ? e.kind : "error"}); deterministic reading used.` };
  }
}

/* ───────────── confirm ───────────── */

export class IntentError extends Error { status = 400; }

/** Nothing is saved until the owner presses Confirm — this is the only place an NL change is persisted. */
export function confirmIntent(bizId: string, raw: unknown): HolidayException {
  const parsed = IntentZ.safeParse(raw);
  if (!parsed.success) throw new IntentError("That change is not valid.");
  const i = parsed.data;
  const t = today();
  if (i.end < i.start) throw new IntentError("End date is before start date.");
  if (i.action === "reopen") {
    const target = listExceptions(bizId).find((e) => e.id === i.targetExceptionId && e.status === "active");
    if (!target) throw new IntentError("There is no saved change to cancel.");
    removeException(bizId, target.id);
    audit(bizId, "owner", "nl-reopen", null, `holiday:${target.id}`, { cancelled: target });
    return { ...target, status: "removed" };
  }
  if (i.start < t) throw new IntentError(`${prettyDate(i.start)} has already passed.`);
  if (i.action === "special" && (!i.open || !i.close || i.close <= i.open)) throw new IntentError("Special hours need an opening time before the closing time.");
  const ex = upsertException(bizId, { start: i.start, end: i.end, kind: i.action === "closed" ? "closed" : "special", open: i.action === "closed" ? null : i.open, close: i.action === "closed" ? null : i.close, reason: i.reason, source: "natural-language" });
  audit(bizId, "owner", "nl-confirm", null, `holiday:${ex.id}`, { intent: i });
  return ex;
}
