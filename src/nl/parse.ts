import * as chrono from "chrono-node";
import { z } from "zod";
import { addDays, daysBetween, prettyDate, prettyDateWithDay, weekdayOf } from "../core/clock.js";
import { fmt12, parseTime } from "../core/normalise.js";
import type { HolidayException, WeeklyHours } from "../core/types.js";

export const IntentZ = z.object({
  action: z.enum(["closed", "special", "reopen"]),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  open: z.string().nullable(),
  close: z.string().nullable(),
  reason: z.string().nullable(),
  targetExceptionId: z.string().nullable().optional(),
});
export type Intent = z.infer<typeof IntentZ>;

export type NlResult =
  | { status: "ok"; intent: Intent; chips: Chip[]; sentence: string }
  | { status: "ask"; question: string }
  | { status: "empty" };
export interface Chip { label: string; value: string }

export interface NlContext {
  today: string;
  hours: WeeklyHours;
  exceptions: HolidayException[];
  holidays: { id: string; name: string; date: string }[];
}

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
const GENERIC = new Set(["day", "new", "year", "years", "jayanti", "good", "friday", "dr", "the", "puja", "ul", "al"]);
const WEEKDAYS = new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);

/** A time range such as "10 to 2", "9am-5pm", "10:00 - 14:00" — but NOT a date range like "24 to 26 Dec" or "5th to 7th". */
const TIME_RANGE_RE = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-|–|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?!\s*(?:st|nd|rd|th)\b)(?!\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/i;

function hhmm(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function extractTimes(text: string): { open: string | null; close: string | null; kind: "range" | "close" | "open" | null; rest: string } {
  const r = text.match(TIME_RANGE_RE);
  if (r) {
    const [, h1, m1, mer1, h2, m2, mer2] = r;
    const looksLikeTime = mer1 || mer2 || m1 || m2 || (Number(h1) <= 12 && Number(h2) <= 12) || (Number(h1) <= 24 && Number(h2) <= 24 && (m1 || m2));
    if (looksLikeTime && Number(h1) <= 24 && Number(h2) <= 24) {
      const o = parseTime(`${h1}${m1 ? ":" + m1 : ""}${mer1 ? mer1 : mer2 ?? ""}`) ;
      let c = parseTime(`${h2}${m2 ? ":" + m2 : ""}${mer2 ?? ""}`);
      if (o && c) {
        // "10 to 2" with no am/pm: the closing time must be after opening -> afternoon
        if (!mer1 && !mer2 && c <= o && Number(h2) < 12) c = hhmm(Number(h2) + 12, Number(m2 ?? 0));
        return { open: o, close: c, kind: "range", rest: text.replace(r[0], " ") };
      }
    }
  }
  const single = text.match(/\b(?:(at|by|till|until|from|after|before)\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (single) {
    const t = parseTime(`${single[2]}${single[3] ? ":" + single[3] : ""}${single[4]}`);
    if (t) {
      const lower = text.toLowerCase();
      const opening = /\b(open(?:ing)?\s+(?:late|at|from)|start(?:ing)?|opens?)\b/.test(lower) && !/\bclos/.test(lower);
      return { open: opening ? t : null, close: opening ? null : t, kind: opening ? "open" : "close", rest: text.replace(single[0], " ") };
    }
  }
  return { open: null, close: null, kind: null, rest: text };
}

function ymd(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

interface DateFound { start: string; end: string; certainYear: boolean; dayOnly?: number; holidayName?: string; ambiguousHoliday?: string[] }

function findDates(text: string, ctx: NlContext): DateFound | null {
  const ref = new Date(`${ctx.today}T12:00:00+05:30`);
  // weekend special-case
  const parsed = chrono.en.GB.parse(text, { instant: ref, timezone: "IST" }, { forwardDate: true });
  const p = parsed.find((r) => r.start.isCertain("day") || r.start.isCertain("weekday") || /weekend/i.test(r.text) || r.start.isCertain("month"));
  if (p) {
    let s = ymd(p.start.get("year")!, p.start.get("month")!, p.start.get("day")!);
    let e = p.end ? ymd(p.end.get("year")!, p.end.get("month")!, p.end.get("day")!) : s;
    if (/weekend/i.test(p.text)) { const sat = weekdayOf(s) === "sun" ? addDays(s, -1) : s; s = sat; e = addDays(sat, 1); }
    if (e < s) e = s;
    return { start: s, end: e, certainYear: p.start.isCertain("year") };
  }
  // "the 26th" (day of month only)
  const dm = text.match(new RegExp(`\\b(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)\\b(?!\\s*(?:of\\s+)?(?:${MONTHS}))`, "i"));
  if (dm) {
    const day = Number(dm[1]);
    const [y, m, d] = ctx.today.split("-").map(Number);
    let yy = y, mm = m;
    if (day < d) { mm++; if (mm > 12) { mm = 1; yy++; } }
    const s = ymd(yy, mm, day);
    return { start: s, end: s, certainYear: false, dayOnly: day };
  }
  // holiday names
  const low = text.toLowerCase();
  const hits = ctx.holidays.filter((h) => {
    const full = h.name.toLowerCase();
    if (low.includes(full)) return true;
    return full.split(/[^a-z]+/).filter((t) => t.length >= 3 && !GENERIC.has(t) && !WEEKDAYS.has(t)).some((t) => new RegExp(`\\b${t}\\b`).test(low));
  });
  const upcoming = hits.filter((h) => h.date >= ctx.today);
  const pool = upcoming.length ? upcoming : hits;
  if (pool.length > 1) {
    return { start: pool[0].date, end: pool[0].date, certainYear: true, ambiguousHoliday: pool.map((h) => `${h.name} (${prettyDate(h.date)})`) };
  }
  if (pool.length) return { start: pool[0].date, end: pool[0].date, certainYear: true, holidayName: pool[0].name };
  return null;
}

function extractReason(text: string): string | null {
  const m = text.match(/\b(?:for|because(?: of)?|due to)\s+(?:a|an|the)?\s*([a-z][a-z' -]{2,40}?)\s*[.!?]*$/i);
  if (!m) return null;
  const r = m[1].trim();
  if (/^(today|tomorrow|the day|next|this|\d)/i.test(r)) return null;
  return r;
}

const timeStr = (a: string | null, b: string | null) => (a && b ? `${fmt12(a)} – ${fmt12(b)}` : "");

export function parseChange(textRaw: string, ctx: NlContext): NlResult {
  const text = textRaw.trim();
  if (!text) return { status: "empty" };
  const lower = text.toLowerCase();

  const times = extractTimes(text);
  const dates = findDates(times.rest, ctx);

  /* action */
  const wantsCancel = /\b(ignore|cancel|undo|scrap|forget|never ?mind|remove|re-?open)\b/.test(lower);
  const saysOpen = /\b(we(?:'re| are)?\s+open|stay(?:ing)? open|open as usual|normal hours|open normally)\b/.test(lower);
  const saysClosed = /\b(clos(?:e|ed|ing)|shut|holiday|day off|not open|won'?t open|off)\b/.test(lower);
  const hasTime = times.kind !== null;
  const specialWords = /\b(early|late|half[- ]day|special hours|shorter hours)\b/.test(lower);

  let action: Intent["action"] | null = null;
  if (wantsCancel || (saysOpen && !hasTime)) action = "reopen";
  if (!action && (hasTime || specialWords)) action = "special";
  if (!action && saysClosed && !saysOpen) action = "closed";
  if (!action && saysClosed && saysOpen) return { status: "ask", question: "Do you want the shop closed or open on that day?" };

  if (!dates) {
    if (action === "reopen") return { status: "ask", question: "Which date do you want to reopen?" };
    return { status: "ask", question: "Which date (or dates) is this for?" };
  }
  if (dates.ambiguousHoliday) return { status: "ask", question: `Which one: ${dates.ambiguousHoliday.join(" or ")}?` };

  /* past-date handling */
  const todayYear = Number(ctx.today.slice(0, 4));
  if (dates.start < ctx.today) return { status: "ask", question: `${prettyDate(dates.start)} has already passed — which date did you mean?` };
  if (!dates.certainYear && !dates.dayOnly && !dates.holidayName) {
    const [, m, d] = dates.start.split("-").map(Number);
    const thisYear = ymd(todayYear, m, d);
    if (thisYear < ctx.today && daysBetween(thisYear, ctx.today) <= 14) {
      return { status: "ask", question: `${prettyDate(thisYear)} has just passed — did you mean ${prettyDate(dates.start)}?` };
    }
  }

  if (!action) {
    return { status: "ask", question: `Do you want ${prettyDate(dates.start)}${dates.end !== dates.start ? " – " + prettyDate(dates.end) : ""} marked as closed, or special opening hours?` };
  }

  const reason = dates.holidayName ?? extractReason(text);
  const range = dates.start === dates.end ? prettyDateWithDay(dates.start) : `${prettyDateWithDay(dates.start)} → ${prettyDateWithDay(dates.end)}`;

  if (action === "reopen") {
    const active = ctx.exceptions.filter((e) => e.status === "active" && e.end >= ctx.today);
    let targets = active.filter((e) => e.start <= dates.start && dates.start <= e.end);
    if (dates.dayOnly) targets = active.filter((e) => Number(e.start.slice(8)) === dates.dayOnly);
    if (targets.length !== 1) {
      return { status: "ask", question: targets.length === 0 ? `There is no closure or special hours saved for ${dates.dayOnly ? "the " + dates.dayOnly + "th" : prettyDate(dates.start)}. Which date do you want to reopen?` : `Which one should reopen: ${targets.map((t) => prettyDate(t.start)).join(" or ")}?` };
    }
    const t = targets[0];
    const intent: Intent = { action: "reopen", start: t.start, end: t.end, open: null, close: null, reason: t.reason, targetExceptionId: t.id };
    return {
      status: "ok", intent,
      chips: [{ label: "Action", value: "Reopen (cancel the saved change)" }, { label: "Date", value: t.start === t.end ? prettyDateWithDay(t.start) : `${prettyDate(t.start)} → ${prettyDate(t.end)}` }],
      sentence: `Cancel the saved ${t.kind === "closed" ? "closure" : "special hours"} on ${prettyDate(t.start)} so the shop is open as normal.`,
    };
  }

  if (action === "closed") {
    const intent: Intent = { action, start: dates.start, end: dates.end, open: null, close: null, reason };
    return {
      status: "ok", intent,
      chips: [{ label: "Action", value: "Closed" }, { label: "Date", value: range }, ...(reason ? [{ label: "Reason", value: reason }] : [])],
      sentence: `Mark the shop closed ${dates.start === dates.end ? "on " + prettyDate(dates.start) : "from " + prettyDate(dates.start) + " to " + prettyDate(dates.end)}.`,
    };
  }

  // special hours — fill the missing side from normal hours of that weekday
  let { open, close } = times;
  const normal = ctx.hours[weekdayOf(dates.start)];
  if (!open || !close) {
    if (!normal) return { status: "ask", question: `The shop is normally closed on ${prettyDateWithDay(dates.start)}. What opening hours do you want (for example 10am to 2pm)?` };
    open = open ?? normal.open;
    close = close ?? normal.close;
  }
  if (close <= open) return { status: "ask", question: `Closing time ${fmt12(close)} is not after opening time ${fmt12(open)}. What hours do you mean?` };
  const intent: Intent = { action: "special", start: dates.start, end: dates.end, open, close, reason };
  return {
    status: "ok", intent,
    chips: [{ label: "Action", value: "Special hours" }, { label: "Date", value: range }, { label: "Time", value: timeStr(open, close) }, ...(reason ? [{ label: "Reason", value: reason }] : [])],
    sentence: `Open ${timeStr(open, close)} ${dates.start === dates.end ? "on " + prettyDate(dates.start) : "from " + prettyDate(dates.start) + " to " + prettyDate(dates.end)}.`,
  };
}

/** Stable key for cross-checking two parses. */
export function intentKey(i: Intent): string {
  return [i.action, i.start, i.end, i.open ?? "", i.close ?? ""].join("|");
}

