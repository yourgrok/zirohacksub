import { z } from "zod";
import { getDb } from "../core/db.js";
import { nowTs } from "../core/clock.js";
import { getTrace } from "./loop.js";
import { buildRows, type ReportRow } from "./report.js";
import { basisOf } from "./why.js";
import { buildClaimDrafts } from "./claimDraft.js";
import { fastModel, geminiEnabled, llmJson, plannerModel } from "./llm.js";

const site = (p: string) => p.replace(/ \(.*\)/, "");
const list = (a: string[]) => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);

/** What the agent did and found, as a few plain sentences. Built from facts only, so it needs no model and cannot invent anything. */
export function factsOf(bizId: string, runId?: string): string[] {
  const rows = buildRows(bizId);
  const out: string[] = [];
  const sites = [...new Set(rows.map((r) => site(r.platform)))];
  if (!sites.length) return ["No scan has been run yet."];
  out.push(`I checked ${sites.length} listing${sites.length === 1 ? "" : "s"}: ${list(sites)}.`);
  const by = (s: string, f?: (r: ReportRow) => boolean) => rows.filter((r) => r.state === s && (!f || f(r)));
  for (const s of sites) {
    const mine = rows.filter((r) => site(r.platform) === s);
    const verified = mine.filter((r) => r.state === "VERIFIED");
    if (verified.length) out.push(`On ${s} I fixed ${list(verified.map((r) => r.field))} and checked it by reloading the page.`);
    const proposed = mine.filter((r) => r.state === "PROPOSED");
    if (proposed.length) out.push(`On ${s}, ${list(proposed.map((r) => r.field))} ${proposed.length === 1 ? "is" : "are"} wrong, so I wrote ${proposed.length === 1 ? "a fix" : "fixes"} for you to approve.`);
    const pend = mine.filter((r) => r.state === "PENDING_MODERATION");
    if (pend.length) out.push(`${s} accepted my edit but its moderator hasn't approved it yet, so I'm not calling it fixed.`);
    const flagged = mine.filter((r) => r.state === "FLAGGED_NOT_OWNER");
    if (flagged.length) out.push(`${s} belongs to another account, so I left it alone and drafted a request to claim it.`);
    const fmt = mine.filter((r) => r.state === "FORMAT_ONLY_EQUIVALENT");
    if (fmt.length) out.push(`On ${s}, ${list(fmt.map((r) => r.field.toLowerCase()))} ${fmt.length === 1 ? "is" : "are"} written differently but mean${fmt.length === 1 ? "s" : ""} the same, so I did not touch ${fmt.length === 1 ? "it" : "them"}.`);
  }
  if (!by("PROPOSED").length && !by("PENDING_MODERATION").length && !by("FLAGGED_NOT_OWNER").length && !by("MISMATCH").length && !by("APPROVED").length && !by("APPLIED").length) out.push("Everything matches your record.");
  if (runId) {
    const t = getTrace(runId);
    const retried = new Set(t.filter((x) => /recovery: temporary outage/.test(x.note ?? "")).map((x) => (JSON.parse(x.input || "{}") as { platform?: string }).platform ?? ""));
    for (const p of retried) if (p) {
      const failed = t.some((x) => x.tool === "read_listing" && x.output_summary.startsWith("ERROR") && x.input.includes(p));
      out.push(failed ? `${site(rows.find((r) => r.platformId === p)?.platform ?? p)} was not answering, so I could not check it this time. I'll try again.` : `${site(rows.find((r) => r.platformId === p)?.platform ?? p)} was briefly down, so I waited and tried again until it answered.`);
    }
    if (t.some((x) => /recovery: lost write/.test(x.note ?? ""))) out.push("One site said OK but dropped my edit, so I sent the same approved change again and checked.");
    for (const x of t) if (/changed after approval/.test(x.output_summary)) { out.push("A page changed after you approved, so I sent nothing and asked you again."); break; }
  }
  return out;
}

export function briefingText(bizId: string, runId?: string): string { return factsOf(bizId, runId).join(" "); }

export function storeBriefing(runId: string, text: string) { getDb().prepare("UPDATE runs SET briefing=? WHERE id=?").run(text, runId); }
export function latestBriefing(bizId: string): string | null {
  const r = getDb().prepare("SELECT briefing FROM runs WHERE business_id=? AND briefing IS NOT NULL ORDER BY started_at DESC, rowid DESC LIMIT 1").get(bizId) as { briefing: string } | undefined;
  return r?.briefing ?? null;
}

const AiZ = z.object({ briefing: z.string().min(10).max(700), why: z.array(z.object({ id: z.number(), text: z.string().min(5).max(240) })).max(12) });

/**
 * Gemini writes the wording; the facts come from code. Runs in the background after a scan (never blocks it) and is validated;
 * on any failure the built-in sentences stay. The model is told to add no facts, and notes are only kept while the facts they describe are unchanged.
 */
export async function polishWithGemini(bizId: string, runId: string): Promise<void> {
  if (!geminiEnabled()) return;
  const facts = factsOf(bizId, runId);
  const rows = buildRows(bizId).filter((r) => ["PROPOSED", "PENDING_MODERATION", "FLAGGED_NOT_OWNER"].includes(r.state)).slice(0, 12);
  try {
    const res = await llmJson(AiZ, {
      models: [plannerModel(), fastModel()],
      system: `You write for a busy shop owner who is not technical. Rewrite the given FACTS as a friendly briefing of at most 4 short sentences, in first person ("I"). For each ITEM write one plain sentence saying what is different and why it matters. Use ONLY the facts given: never add sites, values, numbers or promises. Answer JSON {"briefing": string, "why": [{"id": number, "text": string}]}.`,
      prompt: `FACTS: ${JSON.stringify(facts)}\nITEMS: ${JSON.stringify(rows.map((r) => ({ id: r.fieldId, site: site(r.platform), field: r.field, state: r.state, listingShows: r.original, ownerRecordSays: r.intended })))}`,
    });
    storeBriefing(runId, res.data.briefing);
    const ins = getDb().prepare("INSERT OR REPLACE INTO ai_notes (business_id, field_id, basis, text, at) VALUES (?,?,?,?,?)");
    for (const w of res.data.why) {
      const r = rows.find((x) => x.fieldId === w.id);
      if (r) ins.run(bizId, r.fieldId, basisOf(r), w.text, nowTs());
    }
  } catch { /* keep the built-in sentences */ }
}

export { buildClaimDrafts };
