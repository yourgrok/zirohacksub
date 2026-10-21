import { WEEKDAYS, type Day, type HolidayException, type WeeklyHours } from "./types.js";
import { prettyDate } from "./clock.js";

/* ───────────── phone ───────────── */

/** Normalise to E.164, default country +91. Returns null if it cannot be a valid Indian/E.164 number. */
export function normalisePhone(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const hasPlus = s.startsWith("+") || s.startsWith("00");
  let digits = s.replace(/\D/g, "");
  if (s.startsWith("00")) digits = digits.slice(2);
  if (hasPlus) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return null;
}

export function displayPhone(e164: string): string {
  if (e164.startsWith("+91") && e164.length === 13) return `+91 ${e164.slice(3, 8)} ${e164.slice(8)}`;
  return e164;
}

/* ───────────── address ───────────── */

const ABBR: Record<string, string> = {
  ln: "lane", rd: "road", st: "street", ave: "avenue", apt: "apartment", flr: "floor", bldg: "building",
  nr: "near", opp: "opposite", mh: "maharashtra", mkt: "market", sq: "square", blvd: "boulevard",
};

export function normaliseAddress(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.,;:()#'’"\-–—/]/g, " ");
  const tokens = cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => ABBR[t] ?? t)
    .filter((t) => t !== "india");
  return tokens.join(" ");
}

/* ───────────── times ───────────── */

/** Parse "9am", "9:30 PM", "21:00", "9.30pm" -> "HH:MM" (24h). */
export function parseTime(raw: string, fallbackMeridiem?: "am" | "pm"): string | null {
  const m = raw.trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  let mer = m[3]?.replace(/\./g, "") as "am" | "pm" | undefined;
  mer = mer ?? fallbackMeridiem;
  if (min > 59 || h > 24) return null;
  if (mer) {
    if (h < 1 || h > 12) return null;
    if (mer === "pm" && h < 12) h += 12;
    if (mer === "am" && h === 12) h = 0;
  }
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function fmt12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const mer = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${mer}`;
}
export function fmtCompact(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const mer = h >= 12 ? "pm" : "am";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hh}${mer}` : `${hh}:${String(m).padStart(2, "0")}${mer}`;
}

const TIME_RANGE =
  /(\d{1,2}(?:[:.]\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)\s*(?:-|–|—|to|until|till)\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)/i;

/** Find a time range in free text. Returns 24h strings. */
export function parseTimeRange(text: string): { open: string; close: string } | null {
  const m = text.match(TIME_RANGE);
  if (!m) return null;
  const closeMer = m[2].toLowerCase().match(/(am|pm|a\.m\.|p\.m\.)/)?.[1]?.replace(/\./g, "") as "am" | "pm" | undefined;
  const openHasMer = /am|pm|a\.m\.|p\.m\./i.test(m[1]);
  let open = parseTime(m[1], openHasMer ? undefined : closeMer);
  const close = parseTime(m[2]);
  if (open && close && !openHasMer && closeMer && open >= close) open = parseTime(m[1], "am");
  if (!open || !close) return null;
  return { open, close };
}

/* ───────────── weekly hours ───────────── */

const DAY_FULL: Record<Day, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday",
};
export const dayName = (d: Day) => DAY_FULL[d];
export const dayShort = (d: Day) => d[0].toUpperCase() + d.slice(1);

function dayFromToken(tok: string): Day | null {
  const k = tok.trim().toLowerCase().slice(0, 3);
  return (WEEKDAYS as readonly string[]).includes(k) ? (k as Day) : null;
}

function expandDays(spec: string): Day[] {
  const out: Day[] = [];
  const cleaned = spec.replace(/\bto\b/gi, "-").replace(/\band\b|&/gi, ",");
  for (const part of cleaned.split(",")) {
    const rng = part.split(/[-–—]/).map((s) => s.trim()).filter(Boolean);
    if (rng.length === 2) {
      const a = dayFromToken(rng[0]);
      const b = dayFromToken(rng[1]);
      if (!a || !b) continue;
      let i = WEEKDAYS.indexOf(a);
      const j = WEEKDAYS.indexOf(b);
      for (let n = 0; n < 7; n++) {
        out.push(WEEKDAYS[i]);
        if (i === j) break;
        i = (i + 1) % 7;
      }
    } else if (rng.length === 1) {
      const d = dayFromToken(rng[0]);
      if (d) out.push(d);
    }
  }
  return out;
}

/** Parse a block of hours lines in any of the formats the mock sites use. Unmentioned days are closed. */
export function parseHoursText(text: string): { hours: WeeklyHours; unparsed: string[] } {
  const hours = Object.fromEntries(WEEKDAYS.map((d) => [d, null])) as WeeklyHours;
  const unparsed: string[] = [];
  for (const line of text.split(/\n|;/).map((l) => l.trim()).filter(Boolean)) {
    const m = line.match(/^([A-Za-z][A-Za-z ,&\-–—]*?)\s*[:|]?\s*(closed|\d.*)$/i);
    if (!m) { unparsed.push(line); continue; }
    const days = expandDays(m[1]);
    if (!days.length) { unparsed.push(line); continue; }
    if (/^closed$/i.test(m[2])) { for (const d of days) hours[d] = null; continue; }
    const r = parseTimeRange(m[2]);
    if (!r) { unparsed.push(line); continue; }
    for (const d of days) hours[d] = { open: r.open, close: r.close };
  }
  return { hours, unparsed };
}

/** Canonical one-line string, grouping consecutive identical days. Used for comparison and display. */
export function canonHours(h: WeeklyHours): string {
  const parts: string[] = [];
  let i = 0;
  const key = (d: Day) => (h[d] ? `${h[d]!.open}-${h[d]!.close}` : "closed");
  while (i < 7) {
    let j = i;
    while (j + 1 < 7 && key(WEEKDAYS[j + 1]) === key(WEEKDAYS[i])) j++;
    const label = i === j ? dayShort(WEEKDAYS[i]) : `${dayShort(WEEKDAYS[i])}-${dayShort(WEEKDAYS[j])}`;
    parts.push(`${label} ${key(WEEKDAYS[i])}`);
    i = j + 1;
  }
  return parts.join("; ");
}

export function hoursEqual(a: WeeklyHours, b: WeeklyHours): boolean {
  return canonHours(a) === canonHours(b);
}

export type HoursStyle = "perDay12" | "grouped24" | "perDayCompact" | "grouped12to";

/** Render weekly hours the way each mock site displays them. */
export function formatHours(h: WeeklyHours, style: HoursStyle): string {
  if (style === "perDay12" || style === "perDayCompact") {
    return WEEKDAYS.map((d) => {
      const v = h[d];
      const t = !v ? "Closed" : style === "perDay12" ? `${fmt12(v.open)} – ${fmt12(v.close)}` : `${fmtCompact(v.open)} - ${fmtCompact(v.close)}`;
      return style === "perDay12" ? `${dayName(d)}: ${t}` : `${dayShort(d)} ${t}`;
    }).join("\n");
  }
  // grouped
  const lines: string[] = [];
  let i = 0;
  const key = (d: Day) => (h[d] ? `${h[d]!.open}|${h[d]!.close}` : "closed");
  while (i < 7) {
    let j = i;
    while (j + 1 < 7 && key(WEEKDAYS[j + 1]) === key(WEEKDAYS[i])) j++;
    const v = h[WEEKDAYS[i]];
    const label = i === j ? dayShort(WEEKDAYS[i]) : `${dayShort(WEEKDAYS[i])}${style === "grouped24" ? "–" : " to "}${dayShort(WEEKDAYS[j])}`;
    const t = !v ? "Closed" : style === "grouped24" ? `${v.open}–${v.close}` : `${fmt12(v.open)} to ${fmt12(v.close)}`;
    lines.push(`${label}: ${t}`);
    i = j + 1;
  }
  return lines.join("\n");
}

/* ───────────── holiday exceptions ───────────── */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const mIdx = (s: string) => MONTHS.indexOf(s.toLowerCase().slice(0, 3));
const pad = (n: number) => String(n).padStart(2, "0");

const DATE_RES: { re: RegExp; f: (m: RegExpMatchArray) => string | null }[] = [
  { re: /(\d{4})-(\d{2})-(\d{2})/g, f: (m) => `${m[1]}-${m[2]}-${m[3]}` },
  { re: /(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/g, f: (m) => (mIdx(m[2]) >= 0 ? `${m[3]}-${pad(mIdx(m[2]) + 1)}-${pad(+m[1])}` : null) },
  { re: /([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/g, f: (m) => (mIdx(m[1]) >= 0 ? `${m[3]}-${pad(mIdx(m[1]) + 1)}-${pad(+m[2])}` : null) },
  { re: /(\d{1,2})\/(\d{1,2})\/(\d{4})/g, f: (m) => `${m[3]}-${pad(+m[2])}-${pad(+m[1])}` },
];

/** Extract all dates (in textual order) from a string, returning them and the string with dates removed. */
export function extractDates(text: string): { dates: string[]; rest: string } {
  const found: { idx: number; ymd: string }[] = [];
  let rest = text;
  for (const { re, f } of DATE_RES) {
    rest = rest.replace(re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpMatchArray;
      const idx = args[args.length - 2] as number;
      const ymd = f(m);
      if (!ymd) return args[0];
      found.push({ idx, ymd });
      return " ";
    });
  }
  // indexes are relative to progressively-modified strings; ordering by value is the reliable cross-format order
  found.sort((a, b) => (a.ymd < b.ymd ? -1 : 1));
  return { dates: found.map((f) => f.ymd), rest };
}

export interface ParsedHoliday {
  start: string;
  end: string;
  kind: "closed" | "special";
  open: string | null;
  close: string | null;
}

/** Parse one displayed holiday line like "8 Nov 2026 (Diwali): 10:00 AM – 2:00 PM" or "2026-12-26 · Closed". */
export function parseHolidayLine(line: string): ParsedHoliday | null {
  const noParens = line.replace(/\([^)]*\)/g, " ");
  const { dates, rest } = extractDates(noParens);
  if (!dates.length) return null;
  const start = dates[0];
  const end = dates[dates.length - 1];
  if (/closed/i.test(rest)) return { start, end, kind: "closed", open: null, close: null };
  const r = parseTimeRange(rest);
  if (!r) return null;
  return { start, end, kind: "special", open: r.open, close: r.close };
}

export type HolidayStyle = "long12" | "iso24" | "slash";

export function formatHolidayLine(e: Pick<HolidayException, "start" | "end" | "kind" | "open" | "close" | "reason">, style: HolidayStyle): string {
  const dateStr = (ymd: string) => {
    if (style === "iso24") return ymd;
    if (style === "slash") { const [y, m, d] = ymd.split("-"); return `${d}/${m}/${y}`; }
    return prettyDate(ymd);
  };
  const range = e.start === e.end ? dateStr(e.start) : `${dateStr(e.start)} to ${dateStr(e.end)}`;
  const name = e.reason ? ` (${e.reason})` : "";
  const t = e.kind === "closed" ? "Closed" : style === "iso24" ? `${e.open}–${e.close}` : style === "slash" ? `${fmtCompact(e.open!)} - ${fmtCompact(e.close!)}` : `${fmt12(e.open!)} – ${fmt12(e.close!)}`;
  return style === "iso24" ? `${range}${name} · ${t}` : `${range}${name}: ${t}`;
}

/** Canonical comparison key of one holiday entry (ignores the reason/label). */
export function canonHoliday(e: Pick<ParsedHoliday, "start" | "end" | "kind" | "open" | "close">): string {
  return e.kind === "closed" ? `${e.start}..${e.end} closed` : `${e.start}..${e.end} ${e.open}-${e.close}`;
}

export function describeHoliday(e: Pick<ParsedHoliday, "start" | "end" | "kind" | "open" | "close">): string {
  const d = e.start === e.end ? prettyDate(e.start) : `${prettyDate(e.start)} to ${prettyDate(e.end)}`;
  return e.kind === "closed" ? `${d}: Closed` : `${d}: ${fmt12(e.open!)} – ${fmt12(e.close!)}`;
}
