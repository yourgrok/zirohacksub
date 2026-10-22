import { prettyDate, TZ, today, daysBetween } from "../core/clock.js";
import { AddressZ, DetailsError, NameZ, PhoneZ, hoursToText, type FieldChange } from "../core/details.js";
import { canonHours, describeHoliday, displayPhone, expandDays, normalisePhone } from "../core/normalise.js";
import { getBusiness, listExceptions } from "../core/store.js";
import { WEEKDAYS, type Day, type WeeklyHours } from "../core/types.js";
import { buildChangeLog } from "../agent/changelog.js";
import { buildRows, latestRunSummary } from "../agent/report.js";
import { coverageOf } from "../onboarding/coverage.js";
import { loadHolidays } from "../foresight/index.js";
import { extractTimes, parseChange, type Chip, type NlContext, type NlResult } from "./parse.js";

/* What the single text box can understand:
 *   - a change to the business record   "change my phone to 98765 43210", "our address is …", "rename the shop to …", "open 9 to 8 Monday to Saturday"
 *   - a closure / special hours on dates "closed on 26th December", "open 10 to 2 on Diwali"  (existing parser)
 *   - a question                          "what are my hours?", "which sites am I listed on?", "what's waiting for approval?"
 * Everything is deterministic. Questions only read; edits only happen after the owner presses Confirm. */

export type TabId = "details" | "sites" | "approvals" | "consistency" | "edit" | "changelog" | "trace" | "holidays" | "add";
export interface DetailIntent { kind: "details"; changes: Partial<Record<"name" | "address" | "phone" | "hours", string>> }
export interface DetailResult { status: "detail"; intent: DetailIntent; changes: FieldChange[]; chips: Chip[]; sentence: string }
export interface AnswerResult { status: "answer"; title: string; lines: string[]; links: { label: string; tab: TabId }[] }
export type Interpreted = NlResult | DetailResult | AnswerResult;

export const HELP_QUESTION =
  "I can change your phone, address, name or opening hours (“change my phone to …”, “open 9 to 8 Monday to Saturday”), set a closure or special hours for a date (“closed on 26th December”), or answer questions (“what are my hours?”, “which sites am I listed on?”). What would you like to do?";

const DAY_RE = "(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*";
const MONTH_RE = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*";

const DAY_NAME: Record<Day, string> = { mon: "Mondays", tue: "Tuesdays", wed: "Wednesdays", thu: "Thursdays", fri: "Fridays", sat: "Saturdays", sun: "Sundays" };
const unquote = (s: string) => s.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").replace(/[.!]+$/, "").trim();
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: TZ, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/* ───────────── editing the record ───────────── */

function detailResult(bizId: string, wanted: DetailIntent["changes"], what: string): DetailResult | AnswerResult | NlResult {
  const cur = getBusiness(bizId);
  const changes: FieldChange[] = [];
  const intent: DetailIntent = { kind: "details", changes: {} };
  try {
    if (wanted.name !== undefined) { const v = NameZ.parse(wanted.name); intent.changes.name = v; if (v !== cur.name) changes.push({ field: "name", label: "Business name", from: cur.name, to: v }); }
    if (wanted.address !== undefined) { const v = AddressZ.parse(wanted.address); intent.changes.address = v; if (v !== cur.address) changes.push({ field: "address", label: "Address", from: cur.address, to: v }); }
    if (wanted.phone !== undefined) { const v = displayPhone(normalisePhone(PhoneZ.parse(wanted.phone))!); intent.changes.phone = v; if (v !== cur.phone) changes.push({ field: "phone", label: "Phone", from: cur.phone, to: v }); }
    if (wanted.hours !== undefined) { intent.changes.hours = wanted.hours; if (wanted.hours !== hoursToText(cur.hours)) changes.push({ field: "hours", label: "Regular hours", from: hoursToText(cur.hours), to: wanted.hours }); }
  } catch (e) {
    const msg = e instanceof DetailsError ? e.message : (e as { issues?: { message: string }[] }).issues?.[0]?.message ?? "That does not look right.";
    return { status: "ask", question: `${msg} What should the ${what} be?` };
  }
  if (!changes.length) {
    return { status: "answer", title: `Nothing to change`, lines: [`Your ${what} is already ${changes.length ? "" : (what === "phone" ? cur.phone : what === "address" ? cur.address : what === "name" ? cur.name : hoursToText(cur.hours))}.`], links: [{ label: "See my details", tab: "details" }] };
  }
  const c = changes[0];
  return {
    status: "detail", intent, changes,
    chips: [{ label: "Action", value: `Change ${changes.map((x) => x.label.toLowerCase()).join(" and ")}` }, ...changes.flatMap((x) => [{ label: `${x.label} now`, value: x.from }, { label: `${x.label} new`, value: x.to }])],
    sentence: `Change your ${changes.map((x) => x.label.toLowerCase()).join(" and ")} from “${c.from}” to “${c.to}”. This updates your record only; the agent then compares every site and asks you to approve each fix.`,
  };
}

function tryEditPhone(bizId: string, t: string) {
  if (!/\b(phone|mobile|contact|number|call us|telephone)\b/i.test(t)) return null;
  const m = t.match(/(\+?\d[\d\s().-]{7,}\d)/);
  if (!m) return null;
  return detailResult(bizId, { phone: m[1].trim() }, "phone number");
}

function tryEditAddress(bizId: string, t: string) {
  const m =
    t.match(/\b(?:address|location)\b[^a-z0-9]*(?:is|to|as|:|=|now)\s*(.+)$/i) ??
    t.match(/\b(?:moved|relocated|shifted|moving)\s+to\s+(.+)$/i) ??
    t.match(/\b(?:new|our)\s+address\b[^a-z0-9]*(.+)$/i);
  if (!m) return null;
  return detailResult(bizId, { address: unquote(m[1]) }, "address");
}

function tryEditName(bizId: string, t: string) {
  const m =
    t.match(/\b(?:rename|renamed|re-?name)\b.*?\b(?:to|as)\s+(.+)$/i) ??
    t.match(/\b(?:business|shop|store|cafe|restaurant|bakery)?\s*name\b[^a-z0-9]*(?:is|to|as|:|=|now)\s*(.+)$/i) ??
    t.match(/\bnow\s+called\s+(.+)$/i);
  if (!m) return null;
  return detailResult(bizId, { name: unquote(m[1]) }, "business name");
}

const hasDate = (t: string) =>
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH_RE}|\\b${MONTH_RE}\\s+\\d{1,2}|\\b\\d{1,2}[/-]\\d{1,2}([/-]\\d{2,4})?\\b|\\b(today|tomorrow|yesterday|tonight)\\b|\\b(this|next)\\s+(${DAY_RE}|week|weekend|month)\\b`, "i").test(t);

/** "closed on Sundays", "open 9 to 8 Monday to Saturday", "weekdays 8am-6pm". Needs a weekly cue and no calendar date. */
function tryWeeklyHours(bizId: string, t: string): ReturnType<typeof detailResult> | null {
  if (hasDate(t)) return null;
  const days = new Set<Day>();
  const range = t.match(new RegExp(`\\b(${DAY_RE})\\s*(?:to|-|–|—|through|thru|till|until)\\s*(${DAY_RE})\\b`, "i"));
  const every = [...t.matchAll(new RegExp(`\\b(?:every|each)\\s+(${DAY_RE})\\b`, "gi"))].map((m) => m[1]);
  const plural = [...t.matchAll(/\b(mon|tues?|wednes|thurs?|fri|satur|sun)days\b/gi)].map((m) => m[1]);
  let cue = false;
  if (range) { for (const d of expandDays(`${range[1].slice(0, 3)}-${range[2].slice(0, 3)}`)) days.add(d); cue = true; }
  if (/\bweekdays?\b/i.test(t)) { (["mon", "tue", "wed", "thu", "fri"] as Day[]).forEach((d) => days.add(d)); cue = true; }
  if (/\bweekends?\b/i.test(t)) { days.add("sat"); days.add("sun"); cue = true; }
  if (/\b(every\s*day|daily|all\s+days|7\s+days|seven\s+days)\b/i.test(t)) { WEEKDAYS.forEach((d) => days.add(d)); cue = true; }
  for (const d of [...every, ...plural]) { const k = d.slice(0, 3).toLowerCase() as Day; if ((WEEKDAYS as readonly string[]).includes(k)) { days.add(k); cue = true; } }
  if (!cue && /\b(hours|timings?|schedule)\b/i.test(t)) {
    for (const m of t.matchAll(new RegExp(`\\b(${DAY_RE})\\b`, "gi"))) { const k = m[1].slice(0, 3).toLowerCase() as Day; if ((WEEKDAYS as readonly string[]).includes(k)) { days.add(k); cue = true; } }
  }
  if (!cue || !days.size) return null;

  const times = extractTimes(t);
  const closed = /\b(closed|shut|not\s+open|off|won'?t\s+open)\b/i.test(t) && times.kind !== "range";
  if (!closed && !times.kind) {
    // "open on Sundays" says the days but not the hours: ask once, do not guess
    if (/\b(open|opening)\b/i.test(t)) return { status: "ask", question: `What opening hours do you want on ${[...days].map((d) => DAY_NAME[d]).join(", ")}? (for example 10am to 2pm)` } as NlResult;
    return null;
  }

  const cur = getBusiness(bizId).hours;
  const next = { ...cur } as WeeklyHours;
  for (const d of days) {
    if (closed) next[d] = null;
    else if (times.kind === "range") next[d] = { open: times.open!, close: times.close! };
    else if (cur[d]) next[d] = { open: times.open ?? cur[d]!.open, close: times.close ?? cur[d]!.close };
    else return { status: "ask", question: `You are normally closed on ${DAY_NAME[d]}. What opening hours do you want (for example 10am to 2pm)?` } as NlResult;
  }
  for (const d of WEEKDAYS) if (next[d] && next[d]!.close <= next[d]!.open) return { status: "ask", question: "The closing time must be after the opening time. What hours do you mean?" } as NlResult;
  return detailResult(bizId, { hours: hoursToText(next) }, "opening hours");
}

/* ───────────── answering questions ───────────── */

const STATE_WORDS: Record<string, string> = {
  MATCH: "matches", FORMAT_ONLY_EQUIVALENT: "same, formatted differently", MISMATCH: "differs", PROPOSED: "differs — waiting for your approval", APPROVED: "approved, not sent yet",
  REJECTED: "differs — you rejected the fix", APPLIED: "sent, not yet verified", VERIFIED: "verified", PENDING_MODERATION: "pending the site's moderator", FLAGGED_NOT_OWNER: "claimed by another account",
};

function fieldAnswer(bizId: string, key: string, title: string, recordValue: string, tab: TabId = "consistency"): AnswerResult {
  const rows = buildRows(bizId).filter((r) => r.fieldKey === key);
  const lines = [`On your record: ${recordValue}`];
  if (!rows.length) lines.push("Not checked on the listing sites yet — press “Scan listings”.");
  for (const r of rows) lines.push(`${r.platform.replace(/ \(.*\)/, "")}: ${r.current || r.original || "—"} — ${STATE_WORDS[r.state] ?? r.state}`);
  return { status: "answer", title, lines, links: [{ label: "Open the consistency table", tab }, { label: "Change it", tab: "edit" }] };
}

function holidaysAnswer(bizId: string): AnswerResult {
  const ex = listExceptions(bizId, false);
  const lines: string[] = [];
  if (!ex.length) lines.push("No holidays or special days are saved on your record.");
  for (const e of ex) lines.push(`${describeHoliday(e)}${e.reason ? ` (${e.reason})` : ""}`);
  const t = today();
  const upcoming = loadHolidays().filter((h) => h.date >= t && daysBetween(t, h.date) <= 60).slice(0, 4);
  for (const h of upcoming) {
    const set = ex.some((e) => e.start <= h.date && h.date <= e.end);
    lines.push(`Coming up: ${h.name}, ${prettyDate(h.date)} (in ${daysBetween(t, h.date)} days) — ${set ? "special hours are set" : "nothing set yet"}`);
  }
  return { status: "answer", title: "Holidays and special days", lines, links: [{ label: "Open upcoming holidays", tab: "holidays" }] };
}

export function answerQuestion(bizId: string, text: string): AnswerResult | NlResult {
  const t = text.toLowerCase();
  const b = getBusiness(bizId);
  const has = (re: RegExp) => re.test(t);

  if (has(/\b(pin|password|passcode)\b/)) return { status: "answer", title: "About your PIN", lines: ["Your PIN is never stored or shown. Only a scrambled version is kept, so nobody can read it back, not even us.", "If you have lost it, there is no way to recover it yet."], links: [] };
  if (has(/\b(help|what can you do|what do you do|how do i|how to|commands?)\b/)) return { status: "answer", title: "What I can do", lines: [HELP_QUESTION.replace(" What would you like to do?", "")], links: [{ label: "Edit & ask", tab: "edit" }] };
  if (has(/\b(pending|approval|approvals|approve|waiting|needs? (?:my )?attention|to do)\b/)) {
    const rows = buildRows(bizId).filter((r) => ["PROPOSED", "APPROVED", "PENDING_MODERATION", "FLAGGED_NOT_OWNER"].includes(r.state));
    const lines = rows.length ? rows.slice(0, 8).map((r) => `${r.platform.replace(/ \(.*\)/, "")} — ${r.field}: ${STATE_WORDS[r.state]}${r.state === "PROPOSED" ? ` (${r.original || "—"} → ${r.intended.split("\n")[0]})` : ""}`) : ["Nothing is waiting for you."];
    if (rows.length > 8) lines.push(`…and ${rows.length - 8} more.`);
    return { status: "answer", title: `${rows.length} item(s) need attention`, lines, links: [{ label: "Open approvals", tab: "approvals" }] };
  }
  if (has(/\b(changed?|changes|history|log|edited|updated|recent|last)\b/)) {
    const e = buildChangeLog(bizId, 40).slice(0, 6);
    return { status: "answer", title: "Latest changes", lines: e.length ? e.map((x) => `${when(x.at)} — ${x.what}${x.from || x.to ? `: ${x.from ?? "—"} → ${x.to ?? "—"}` : ""}${x.site ? ` (${x.site})` : ""}`) : ["No changes yet."], links: [{ label: "Open the change log", tab: "changelog" }] };
  }
  if (has(/\b(holidays?|festivals?|closures?|special|exceptions?|diwali|christmas|closed on|off days?|days off)\b/)) return holidaysAnswer(bizId);
  if (has(/\b(sites?|listings?|platforms?|listed|where am i|directories|websites?)\b/)) {
    const cov = coverageOf(bizId);
    const lines = cov.map((c) => `${c.name.replace(/ \(.*\)/, "")}: ${c.status === "listed" ? `listed (${c.listingId})` : c.note}`);
    return { status: "answer", title: `Listed on ${cov.filter((c) => c.status === "listed").length} of ${cov.length} sites`, lines, links: [{ label: "Open listings & sites", tab: "sites" }] };
  }
  if (has(/\b(phone|mobile|number|contact|call)\b/)) return fieldAnswer(bizId, "phone", "Your phone number", b.phone);
  if (has(/\b(address|location|located|street)\b/)) return fieldAnswer(bizId, "address", "Your address", b.address);
  if (has(/\b(hours?|timings?|schedule|open|opening|close|closing)\b/)) return fieldAnswer(bizId, "hours", "Your opening hours", hoursToText(b.hours));
  if (has(/\b(business )?name\b|\bcalled\b/)) return fieldAnswer(bizId, "name", "Your business name", b.name);
  if (has(/\b(id|uid|identifier)\b/)) return { status: "answer", title: "Your business ID", lines: [b.id], links: [{ label: "See my details", tab: "details" }] };
  if (has(/\b(status|summary|overview|consistent|verified|mismatch|how am i|how are we|doing|everything)\b/)) {
    const rows = buildRows(bizId);
    const n = (s: string) => rows.filter((r) => r.state === s).length;
    return { status: "answer", title: "Where things stand", lines: [
      rows.length ? `${rows.length} checks across your sites: ${n("MATCH") + n("FORMAT_ONLY_EQUIVALENT")} fine, ${n("VERIFIED")} verified, ${n("PROPOSED")} need your approval, ${n("PENDING_MODERATION")} pending moderation, ${n("FLAGGED_NOT_OWNER")} flagged.` : "Nothing has been scanned yet — press “Scan listings”.",
      latestRunSummary(bizId) ?? "",
    ].filter(Boolean), links: [{ label: "Open the consistency table", tab: "consistency" }] };
  }
  return { status: "ask", question: HELP_QUESTION };
}

/* ───────────── the one entry point ───────────── */

const STRONG_Q = /^\s*(what|whats|what's|which|when|where|who|how|show|list|tell|give|display|is|are|do|does|did|any|have|has)\b(?!\s+not\b)/i;
const DATEISH_OR_ACTION = /\b(clos|shut|open|hours?|holiday|off|early|late|reopen|cancel|ignore|undo|special|today|tomorrow|yesterday|next|this|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

export function interpret(bizId: string, text: string, ctx: NlContext): Interpreted {
  const t = text.trim();
  if (!t) return { status: "empty" };

  const isQuestion = STRONG_Q.test(t) && !/^\s*do\s*n['o]?t\b/i.test(t);
  if (isQuestion) return answerQuestion(bizId, t);

  // edits of the record (explicit new value) come before date handling: "change my phone to …" has no date
  const edit = tryEditPhone(bizId, t) ?? tryEditAddress(bizId, t) ?? tryEditName(bizId, t) ?? tryWeeklyHours(bizId, t);
  if (edit) return edit;

  const date = parseChange(t, ctx);
  if (date.status === "ok") return date;
  if (/\?\s*$/.test(t)) return answerQuestion(bizId, t);
  // a date question that is really "I did not understand": only ask for a date when the text talked about closing/opening/dates
  if (date.status === "ask" && !DATEISH_OR_ACTION.test(t)) return { status: "ask", question: HELP_QUESTION };
  return date;
}

