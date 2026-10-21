import fs from "node:fs";
import { z } from "zod";
import { addDays, daysBetween, prettyDate, today } from "../core/clock.js";
import { canonHoliday, parseHolidayLine } from "../core/normalise.js";
import { addException, listExceptions, listFields, listPlatforms, getPlatformListing } from "../core/store.js";
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

export type ChipKind = "NOT_SET" | "RECORD_ONLY" | "CONSISTENT" | "MISMATCH";
export interface SiteShow { platformId: string; platform: string; shows: boolean }
export interface HolidayStatus {
  holiday: Holiday;
  daysAway: number;
  exception: HolidayException | null;
  chip: ChipKind;
  chipText: string;
  sites: SiteShow[];
  mismatchSites: number;
  readiness: number | null;
  suggestion: { kind: "closed" | "special"; open: string | null; close: string | null; label: string };
}
export interface Alert { holidayId: string; name: string; date: string; daysAway: number; milestone: 7 | 14 | 30; chip: ChipKind; message: string }

export const READINESS_FORMULA =
  "Readiness (0-100) = 40 if an exception is set on your record + 40 × (sites showing it correctly ÷ total sites) + 20 if nothing is blocking " +
  "(20 = no site flagged or pending, 10 = some site pending moderation, 0 = some site flagged as not yours). Not set = 0 for the first two parts.";

/** Draft suggestion: national holidays default to Closed, festivals to Special hours. Never applied automatically. */
export function suggest(h: Holiday): HolidayStatus["suggestion"] {
  if (h.kind === "national") return { kind: "closed", open: null, close: null, label: `Closed on ${h.name}` };
  return { kind: "special", open: "10:00", close: "14:00", label: `Special hours 10:00–14:00 on ${h.name}` };
}

function covering(ex: HolidayException[], date: string): HolidayException | null {
  return ex.find((e) => e.status === "active" && e.start <= date && date <= e.end) ?? null;
}

async function readSites() {
  const out: { platformId: string; platform: string; canon: Set<string> }[] = [];
  for (const p of listPlatforms()) {
    const l = getPlatformListing(p.id);
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

export async function foresight(): Promise<{ today: string; windowDays: number; holidays: HolidayStatus[]; alerts: Alert[]; next: HolidayStatus | null; formula: string }> {
  const t = today();
  const until = addDays(t, WINDOW_DAYS);
  const exs = listExceptions();
  const sites = await readSites();
  const fields = listFields();
  const upcoming = loadHolidays().filter((h) => h.date >= t && h.date <= until).sort((a, b) => a.date.localeCompare(b.date));
  const statuses: HolidayStatus[] = upcoming.map((h) => {
    const ex = covering(exs, h.date);
    const daysAway = daysBetween(t, h.date);
    let sitesShow: SiteShow[] = [];
    let chip: ChipKind = "NOT_SET";
    let mismatch = 0;
    if (ex) {
      const want = canonHoliday({ start: ex.start, end: ex.end, kind: ex.kind, open: ex.open, close: ex.close });
      sitesShow = sites.map((s) => ({ platformId: s.platformId, platform: s.platform, shows: s.canon.has(want) }));
      const showing = sitesShow.filter((s) => s.shows).length;
      mismatch = sitesShow.length - showing;
      chip = showing === 0 ? "RECORD_ONLY" : mismatch === 0 ? "CONSISTENT" : "MISMATCH";
    }
    const chipText = { NOT_SET: "Not set", RECORD_ONLY: "Set on record only", CONSISTENT: "Consistent everywhere", MISMATCH: `Mismatch on ${mismatch} site${mismatch === 1 ? "" : "s"}` }[chip];
    return { holiday: h, daysAway, exception: ex, chip, chipText, sites: sitesShow, mismatchSites: mismatch, readiness: null, suggestion: suggest(h) };
  });

  // readiness for the next holiday only
  const next = statuses[0] ?? null;
  if (next) {
    let score = 0;
    if (next.exception) {
      score += 40;
      const total = next.sites.length || 1;
      score += Math.round((40 * next.sites.filter((s) => s.shows).length) / total);
    }
    const key = next.exception ? `holiday:${next.exception.id}` : null;
    const hf = key ? fields.filter((f) => f.field_key === key) : [];
    const blocking = hf.some((f) => f.state === "FLAGGED_NOT_OWNER") ? 0 : hf.some((f) => f.state === "PENDING_MODERATION") ? 10 : 20;
    score += blocking;
    next.readiness = Math.max(0, Math.min(100, score));
  }

  const alerts: Alert[] = [];
  for (const s of statuses) {
    if (s.chip === "CONSISTENT") continue;
    const milestone = ALERT_MILESTONES.slice().reverse().find((m) => s.daysAway <= m); // smallest threshold covering
    if (!milestone) continue;
    const when = s.daysAway === 0 ? "today" : `in ${s.daysAway} day${s.daysAway === 1 ? "" : "s"}`;
    const what = s.chip === "NOT_SET" ? "has no opening-hours exception on your record" : s.chip === "RECORD_ONLY" ? "is set on your record but no listing site shows it" : `is not shown correctly on ${s.mismatchSites} site(s)`;
    alerts.push({ holidayId: s.holiday.id, name: s.holiday.name, date: s.holiday.date, daysAway: s.daysAway, milestone: milestone as 7 | 14 | 30, chip: s.chip, message: `${s.holiday.name} (${prettyDate(s.holiday.date)}) is ${when} and ${what}. Dates can shift — verify first.` });
  }
  return { today: t, windowDays: WINDOW_DAYS, holidays: statuses, alerts, next, formula: READINESS_FORMULA };
}

/** The owner accepted a draft. Creates a record exception (source: foresight); the normal scan → approval → apply → verify pipeline then handles the sites. */
export function acceptDraft(holidayId: string, override?: { kind?: "closed" | "special"; open?: string | null; close?: string | null }): HolidayException {
  const h = loadHolidays().find((x) => x.id === holidayId);
  if (!h) throw new Error("Unknown holiday");
  const s = suggest(h);
  const kind = override?.kind ?? s.kind;
  const open = kind === "closed" ? null : (override?.open ?? s.open ?? "10:00");
  const close = kind === "closed" ? null : (override?.close ?? s.close ?? "14:00");
  return addException({ start: h.date, end: h.date, kind, open, close, reason: h.name, source: "foresight" });
}
