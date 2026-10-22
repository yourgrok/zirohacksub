import { z } from "zod";
import { canonHours, displayPhone, normalisePhone, parseHoursText } from "./normalise.js";
import { getDb } from "./db.js";
import { audit, getBusiness, listFields, logChange, transition } from "./store.js";
import type { WeeklyHours } from "./types.js";

export const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

/** Field validators shared by onboarding and "edit my details". */
export const NameZ = z.string().transform(clean).pipe(z.string().min(2, "Please enter the business name.").max(80, "That name is too long."));
export const AddressZ = z.string().transform(clean).pipe(z.string().min(8, "Please enter the full address.").max(200, "That address is too long."));
export const PhoneZ = z.string().transform(clean).pipe(z.string().max(25).refine((v) => normalisePhone(v) !== null, "That phone number does not look right."));
export const HoursTextZ = z.string().transform(clean).pipe(z.string().max(300));

export class DetailsError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** Parse a typed schedule like "Mon-Sat 9am-9pm; Sun 10am-2pm". Throws a plain-language error when it cannot be read. */
export function parseHoursInput(text: string): WeeklyHours {
  const { hours, unparsed } = parseHoursText(text);
  if (unparsed.length || Object.values(hours).every((h) => h === null)) throw new DetailsError("I could not read those hours. Try: Mon-Sat 9am-9pm; Sun 10am-2pm");
  return hours;
}

/** The editable text form of a schedule (round-trips through parseHoursInput). */
export const hoursToText = (h: WeeklyHours) => canonHours(h);

export const EditZ = z.object({ name: z.string().optional(), address: z.string().optional(), phone: z.string().optional(), hours: z.string().optional() });

export interface FieldChange { field: "name" | "address" | "phone" | "hours"; label: string; from: string; to: string }
export interface EditResult { changed: FieldChange[]; reviewAgain: number }

const LABEL = { name: "Business name", address: "Address", phone: "Phone", hours: "Regular hours" } as const;

/**
 * Change the owner-approved record. Nothing is sent to any listing site: the next scan compares every site with the
 * new record and offers approval cards. Approvals the owner gave for the OLD values (not yet sent) go back to "review".
 */
export function updateBusinessDetails(bizId: string, raw: unknown, actor = "owner"): EditResult {
  const parsed = EditZ.safeParse(raw);
  if (!parsed.success) throw new DetailsError("Please check the details.");
  const input = parsed.data;
  const cur = getBusiness(bizId);
  const issue = (r: { success: true; data: string } | { success: false; error: z.ZodError }): string => {
    if (!r.success) throw new DetailsError(r.error.issues[0]?.message ?? "Please check the details.");
    return r.data;
  };

  const changes: FieldChange[] = [];
  const next: Partial<Record<FieldChange["field"], string>> = {};
  let hoursNew: WeeklyHours | null = null;
  if (input.name !== undefined) { const v = issue(NameZ.safeParse(input.name)); if (v !== cur.name) changes.push({ field: "name", label: LABEL.name, from: cur.name, to: v }); next.name = v; }
  if (input.address !== undefined) { const v = issue(AddressZ.safeParse(input.address)); if (v !== cur.address) changes.push({ field: "address", label: LABEL.address, from: cur.address, to: v }); next.address = v; }
  if (input.phone !== undefined) {
    const v = displayPhone(normalisePhone(issue(PhoneZ.safeParse(input.phone)))!);
    if (v !== cur.phone) changes.push({ field: "phone", label: LABEL.phone, from: cur.phone, to: v });
    next.phone = v;
  }
  if (input.hours !== undefined) {
    hoursNew = parseHoursInput(issue(HoursTextZ.safeParse(input.hours)));
    if (canonHours(hoursNew) !== canonHours(cur.hours)) changes.push({ field: "hours", label: LABEL.hours, from: canonHours(cur.hours), to: canonHours(hoursNew) });
  }
  if (!changes.length) return { changed: [], reviewAgain: 0 };

  const db = getDb();
  let reviewAgain = 0;
  db.transaction(() => {
    for (const c of changes) {
      if (c.field === "hours") db.prepare("UPDATE business SET hours_json=? WHERE id=?").run(JSON.stringify(hoursNew), bizId);
      else db.prepare(`UPDATE business SET ${c.field}=? WHERE id=?`).run(next[c.field], bizId);
      logChange(bizId, actor, "details", c.label, c.from, c.to);
    }
    // an approval given for the old value must not send the old value later
    const keys = new Set<string>(changes.map((c) => c.field));
    for (const f of listFields(bizId)) {
      if (f.state === "APPROVED" && keys.has(f.field_key)) {
        transition(f.id, "PROPOSED", "planner", "your record changed after you approved this — please review it again");
        reviewAgain++;
      }
    }
  })();
  audit(bizId, actor, "edit-details", null, null, { fields: changes.map((c) => c.field) });
  return { changed: changes, reviewAgain };
}
