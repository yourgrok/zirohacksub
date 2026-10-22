import fs from "node:fs";
import { z } from "zod";
import { addDays, daysBetween, prettyDate, today } from "../core/clock.js";
import { canonHoliday, parseHolidayLine } from "../core/normalise.js";
import { getPlatformListing, listExceptions, listLinkedPlatforms, removeException, upsertException } from "../core/store.js";
import type { HolidayException } from "../core/types.js";
import { fetchPage, parsePublic } from "../agent/reader.js";

const HolidayZ = z.object({
  id: z.string(), name: z.string(), date: z.string(), region: z.string(),
  kind: z.enum(["national", "festival", "observance"]), verified: z.boolean(), note: z.string().optional(),
});
export type Holiday = z.infer<typeof HolidayZ>;

export const WINDOW_DAYS = 90;
export const ALERT_MILESTONES = [30, 14, 7] as const;

export function loadHolidays(): Holiday[] {
  const raw = fs.readFileSync(new URL("../../data/holidays.json", import.meta.url), "utf8");
  return z.array(HolidayZ).parse(JSON.parse(raw));
}

/**
 * Per-holiday status on the Holidays tab. Field-level mismatches live in the scan / Approvals tabs, not here:
 *   NOT_SET     – no hours decided for this day on the owner's record
 *   SET_PARTIAL – decided on the record, but not every linked site shows it yet (see Approvals)
 *   SET_ALL     – decided on the record and every linked site shows it
 */
export type ChipKind = "NOT_SET" | "SET_PARTIAL" | "SET_ALL";
export interface HolidayStatus {
  holiday: Holiday;
  daysAway: number;
  exception: HolidayException | null;
  chip: ChipKind;
  chipText: string;
  /** What is set, in words ("Closed all day", "Open 10:00 AM – 2:00 PM"); null when not set. */
  setText: string | null;
  sitesShowing: number;
  sitesTotal: number;
  /** false when the day is part of a longer closure the owner typed in Edit & Ask (change that one there). */
  editable: boolean;
  suggestion: { kind: "closed" | "special"; open: string | null; close: string | null; label: string };
}
export interface Alert { holidayId: string; name: string; date: string; daysAway: number; milestone: 7 | 14 | 30; chip: ChipKind; message: string }

export class HolidayInputError extends Error { status = 400; }

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "14:00" -> "2:00 PM" */
export function time12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function describeSet(e: Pick<HolidayException, "kind" | "open" | "close">): string {
  return e.kind === "closed" || !e.open || !e.close ? "Closed all day" : `Open ${time12(e.open)} – ${time12(e.close)}`;
}

/** Draft suggestion: national holidays default to Closed, festivals to Special hours. Never applied automatically. */
export function suggest(h: Holiday): HolidayStatus["suggestion"] {
  if (h.kind === "national") return { kind: "closed", open: null, close: null, label: `Closed on ${h.name}` };
  return { kind: "special", open: "10:00", close: "14:00", label: `Special hours 10:00–14:00 on ${h.name}` };
}

function covering(ex: HolidayException[], date: string): HolidayException | null {
  return ex.find((e) => e.status === "active" && e.start <= date && date <= e.end) ?? null;
}

const isSingleDay = (e: HolidayException, date: string) => e.start === date && e.end === date;

async function readSites(bizId: string) {
  const out: { platformId: string; platform: string; canon: Set<string> }[] = [];
  for (const p of listLinkedPlatforms(bizId)) {
    const l = getPlatformListing(bizId, p.id);
    try {
      const page = await fetchPage(l.publicPath);
      const pub = parsePublic(p.slug, page.html);
      const canon = new Set<string>();
      for (const line of pub.holidayLines) { const h = parseHolidayLine(line); if (h) canon.add(canonHoliday(h)); }
      out.push({ platformId: p.id, platform: p.name, canon });
    } catch {
      out.push({ platformId: p.id, platform: p.name, canon: new Set() });
    }
  }
  return out;
}

export async function foresight(bizId: string): Promise<{ today: string; windowDays: number; holidays: HolidayStatus[]; alerts: Alert[] }> {
  const t = today();
  const until = addDays(t, WINDOW_DAYS);
  const exs = listExceptions(bizId);
  const sites = await readSites(bizId);
  const upcoming = loadHolidays().filter((h) => h.date >= t && h.date <= until).sort((a, b) => a.date.localeCompare(b.date));
  const statuses: HolidayStatus[] = upcoming.map((h) => {
    const ex = covering(exs, h.date);
    const daysAway = daysBetween(t, h.date);
    let chip: ChipKind = "NOT_SET";
    let showing = 0;
    if (ex) {
      const want = canonHoliday({ start: ex.start, end: ex.end, kind: ex.kind, open: ex.open, close: ex.close });
      showing = sites.filter((s) => s.canon.has(want)).length;
      chip = sites.length > 0 && showing === sites.length ? "SET_ALL" : "SET_PARTIAL";
    }
    const chipText = { NOT_SET: "Not set", SET_PARTIAL: "Saved — not on all sites yet", SET_ALL: "Set on all sites" }[chip];
    return {
      holiday: h, daysAway, exception: ex, chip, chipText,
      setText: ex ? describeSet(ex) : null,
      sitesShowing: showing, sitesTotal: sites.length,
      editable: !ex || isSingleDay(ex, h.date),
      suggestion: suggest(h),
    };
  });

  const alerts: Alert[] = [];
  for (const s of statuses) {
    if (s.chip === "SET_ALL") continue;
    const milestone = ALERT_MILESTONES.slice().reverse().find((m) => s.daysAway <= m); // smallest threshold covering
    if (!milestone) continue;
    const when = s.daysAway === 0 ? "today" : `in ${s.daysAway} day${s.daysAway === 1 ? "" : "s"}`;
    const what = s.chip === "NOT_SET" ? "has no opening-hours exception on your record" : "is saved on your record but not on all your listing sites yet (see Approvals)";
    alerts.push({ holidayId: s.holiday.id, name: s.holiday.name, date: s.holiday.date, daysAway: s.daysAway, milestone: milestone as 7 | 14 | 30, chip: s.chip, message: `${s.holiday.name} (${prettyDate(s.holiday.date)}) is ${when} and ${what}. Dates can shift — verify first.` });
  }
  return { today: t, windowDays: WINDOW_DAYS, holidays: statuses, alerts };
}

function guardEditable(bizId: string, h: Holiday): HolidayException | null {
  const ex = covering(listExceptions(bizId), h.date);
  if (ex && !isSingleDay(ex, h.date))
    throw new HolidayInputError(`${h.name} is part of a longer closure you set (${prettyDate(ex.start)} – ${prettyDate(ex.end)}). Change that one in Edit & Ask.`);
  return ex;
}

/**
 * The owner chose Closed / Special hours for a holiday (the draft suggestion, or their own times).
 * Saves it on the owner's record only (creating the exception, or updating the one already set for that day);
 * the normal scan → approval → apply → verify pipeline then handles the sites.
 */
export function acceptDraft(bizId: string, holidayId: string, override?: { kind?: "closed" | "special"; open?: string | null; close?: string | null }): HolidayException {
  const h = loadHolidays().find((x) => x.id === holidayId);
  if (!h) throw new HolidayInputError("Unknown holiday");
  guardEditable(bizId, h);
  const s = suggest(h);
  const kind = override?.kind ?? s.kind;
  if (kind !== "closed" && kind !== "special") throw new HolidayInputError("Choose Closed or Special hours.");
  let open: string | null = null;
  let close: string | null = null;
  if (kind === "special") {
    open = override?.open ?? s.open ?? "10:00";
    close = override?.close ?? s.close ?? "14:00";
    if (!HHMM.test(open) || !HHMM.test(close)) throw new HolidayInputError("Enter the opening and closing time like 10:00 and 14:00.");
    if (open >= close) throw new HolidayInputError("The closing time must be after the opening time.");
  }
  return upsertException(bizId, { start: h.date, end: h.date, kind, open, close, reason: h.name, source: "foresight" });
}

/** "Open as usual": cancel the exception saved for that day. A scan then proposes removing it from any site that still shows it. */
export function clearHoliday(bizId: string, holidayId: string): { ok: true; cleared: boolean } {
  const h = loadHolidays().find((x) => x.id === holidayId);
  if (!h) throw new HolidayInputError("Unknown holiday");
  const ex = guardEditable(bizId, h);
  if (!ex) return { ok: true, cleared: false }; // already open as usual
  removeException(bizId, ex.id);
  return { ok: true, cleared: true };
}
