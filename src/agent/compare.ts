import { canonHoliday, canonHours, describeHoliday, displayPhone, hoursEqual, normaliseAddress, normalisePhone, parseHolidayLine, parseHoursText, type ParsedHoliday } from "../core/normalise.js";
import { today } from "../core/clock.js";
import type { Business, FieldState, HolidayException, WeeklyHours } from "../core/types.js";
import type { Change } from "../mock/changes.js";
import type { PublicRead } from "./reader.js";

export interface Normalised {
  phone: string | null;
  address: string;
  hours: WeeklyHours;
  hoursCanon: string;
  holidays: (ParsedHoliday & { canon: string })[];
  unparsed: string[];
}

export function normalisePublic(p: PublicRead): Normalised {
  const { hours, unparsed } = parseHoursText(p.hoursLines.join("\n"));
  const holidays: Normalised["holidays"] = [];
  for (const l of p.holidayLines) {
    const h = parseHolidayLine(l);
    if (h) holidays.push({ ...h, canon: canonHoliday(h) });
    else unparsed.push(l);
  }
  return { phone: p.phone ? normalisePhone(p.phone) : null, address: normaliseAddress(p.address ?? ""), hours, hoursCanon: canonHours(hours), holidays, unparsed };
}

export type CmpState = Extract<FieldState, "MATCH" | "FORMAT_ONLY_EQUIVALENT" | "MISMATCH">;

export interface Comparison {
  key: string;
  label: string;
  state: CmpState;
  currentRaw: string;
  currentNorm: string;
  intendedNorm: string;
  intendedDisplay: string;
  change: Change | null; // what to send when it is a mismatch
  exceptionId: string | null;
  note: string;
}

const exHoliday = (e: HolidayException): ParsedHoliday => ({ start: e.start, end: e.end, kind: e.kind, open: e.open, close: e.close });

/** Compare meaning, not formatting. Returns one result per field that matters for this listing. */
export function compareAll(biz: Business, exceptions: HolidayException[], raw: PublicRead, n: Normalised): Comparison[] {
  const out: Comparison[] = [];

  // phone
  const wantPhone = normalisePhone(biz.phone)!;
  const rawPhone = raw.phone ?? "";
  let pState: CmpState, pNote: string;
  if (n.phone === wantPhone) {
    pState = rawPhone.trim() === biz.phone.trim() ? "MATCH" : "FORMAT_ONLY_EQUIVALENT";
    pNote = pState === "MATCH" ? "identical" : "same number, different formatting — no change needed";
  } else { pState = "MISMATCH"; pNote = n.phone ? "different number" : "listing phone could not be parsed"; }
  out.push({ key: "phone", label: "Phone", state: pState, currentRaw: rawPhone, currentNorm: n.phone ?? "(unparseable)", intendedNorm: wantPhone,
    intendedDisplay: biz.phone, change: pState === "MISMATCH" ? { action: "set_phone", value: biz.phone } : null, exceptionId: null, note: pNote });

  // address
  const wantAddr = normaliseAddress(biz.address);
  const rawAddr = raw.address ?? "";
  let aState: CmpState, aNote: string;
  if (n.address === wantAddr) {
    aState = rawAddr.trim() === biz.address.trim() ? "MATCH" : "FORMAT_ONLY_EQUIVALENT";
    aNote = aState === "MATCH" ? "identical" : "same address, different formatting/abbreviations — no change needed";
  } else { aState = "MISMATCH"; aNote = "different address"; }
  out.push({ key: "address", label: "Address", state: aState, currentRaw: rawAddr, currentNorm: n.address, intendedNorm: wantAddr,
    intendedDisplay: biz.address, change: aState === "MISMATCH" ? { action: "set_address", value: biz.address } : null, exceptionId: null, note: aNote });

  // regular hours (separate from holidays)
  const hEq = hoursEqual(n.hours, biz.hours) && n.unparsed.length === 0;
  out.push({ key: "hours", label: "Regular hours", state: hEq ? "MATCH" : "MISMATCH", currentRaw: raw.hoursLines.join("; "), currentNorm: n.hoursCanon,
    intendedNorm: canonHours(biz.hours), intendedDisplay: canonHours(biz.hours),
    change: hEq ? null : { action: "set_hours", hours: biz.hours }, exceptionId: null,
    note: hEq ? "same weekly hours" : "weekly hours differ" });

  // holiday exceptions (each its own field)
  const t = today();
  for (const e of exceptions) {
    if (e.end < t) continue; // past
    const want = exHoliday(e);
    const site = n.holidays.find((h) => h.start === e.start && h.end === e.end);
    const key = `holiday:${e.id}`;
    const label = `Holiday ${e.start}${e.start !== e.end ? ".." + e.end : ""}${e.reason ? ` (${e.reason})` : ""}`;
    if (e.status === "removed") {
      if (!site) continue; // nothing listed, nothing to remove
      out.push({ key, label, state: "MISMATCH", currentRaw: describeHoliday(site), currentNorm: site.canon, intendedNorm: "(no special hours)",
        intendedDisplay: "(remove this special day)", change: { action: "remove_holiday", start: e.start, end: e.end }, exceptionId: e.id, note: "owner cancelled this special day; the listing still shows it" });
      continue;
    }
    const wantCanon = canonHoliday(want);
    const intendedDisplay = describeHoliday(want);
    const same = site?.canon === wantCanon;
    out.push({ key, label, state: same ? "MATCH" : "MISMATCH", currentRaw: site ? describeHoliday(site) : "(not listed)", currentNorm: site?.canon ?? "(not listed)",
      intendedNorm: wantCanon, intendedDisplay,
      change: same ? null : { action: "set_holiday", holiday: { ...want, reason: e.reason } }, exceptionId: e.id,
      note: same ? "same holiday hours" : site ? "holiday hours differ" : "holiday not listed on this site" });
  }
  return out;
}

/** Does a public read already show the intended value for a field? Used by the verifier and by idempotent apply. */
export function showsIntended(key: string, change: Change, n: Normalised): boolean {
  switch (change.action) {
    case "set_phone": return n.phone === normalisePhone(change.value);
    case "set_address": return n.address === normaliseAddress(change.value);
    case "set_hours": return hoursEqual(n.hours, change.hours) && n.unparsed.length === 0;
    case "set_holiday": {
      const w = { start: change.holiday.start, end: change.holiday.end, kind: change.holiday.kind, open: change.holiday.open, close: change.holiday.close };
      return n.holidays.some((h) => h.canon === canonHoliday(w));
    }
    case "remove_holiday": return !n.holidays.some((h) => h.start === change.start && h.end === change.end);
  }
  void key;
}

/** Stable form of a change, used to match dashboard pending items against our intended edit. */
export function changeKey(c: Change): string {
  switch (c.action) {
    case "set_phone": return `phone:${normalisePhone(c.value)}`;
    case "set_address": return `address:${normaliseAddress(c.value)}`;
    case "set_hours": return `hours:${canonHours(c.hours)}`;
    case "set_holiday": return `holiday:${canonHoliday({ start: c.holiday.start, end: c.holiday.end, kind: c.holiday.kind, open: c.holiday.open, close: c.holiday.close })}`;
    case "remove_holiday": return `remove:${c.start}..${c.end}`;
  }
}

export { displayPhone };
