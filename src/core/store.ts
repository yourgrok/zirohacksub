import { getDb } from "./db.js";
import { nowTs } from "./clock.js";
import { assertTransition, type Actor } from "./states.js";
import { describeHoliday } from "./normalise.js";
import type { Business, FieldState, HolidayException, Platform, PlatformListing, WeeklyHours } from "./types.js";

/**
 * Every function here takes the business id explicitly (first argument, required).
 * There is no "current business" default on purpose: forgetting it is a compile error, not a cross-business leak.
 */

export interface BusinessRecord extends Business {
  mockAccount: string;
  status: "pending" | "active";
  isDemo: boolean;
  createdAt: string | null;
}

export function findBusiness(bizId: string): BusinessRecord | undefined {
  const r = getDb().prepare("SELECT * FROM business WHERE id=?").get(bizId) as any;
  if (!r) return undefined;
  return {
    id: r.id, name: r.name, address: r.address, phone: r.phone, hours: JSON.parse(r.hours_json) as WeeklyHours,
    mockAccount: r.mock_account, status: r.status ?? "active", isDemo: !!r.is_demo, createdAt: r.created_at ?? null,
  };
}

export function getBusiness(bizId: string): BusinessRecord {
  const b = findBusiness(bizId);
  if (!b) throw new Error(`Unknown business ${bizId}`);
  return b;
}

export function listExceptions(bizId: string, includeRemoved = true): HolidayException[] {
  const rows = getDb().prepare("SELECT * FROM exceptions WHERE business_id=? ORDER BY start_date, id").all(bizId) as any[];
  return rows
    .map((r) => ({
      id: r.id, start: r.start_date, end: r.end_date, kind: r.kind, open: r.open, close: r.close,
      reason: r.reason, source: r.source, status: r.status,
    }) as HolidayException)
    .filter((e) => includeRemoved || e.status === "active");
}

/** What changed in the owner's record, and when. Shown in the Change Log tab. */
export function logChange(bizId: string, actor: string, kind: "details" | "holiday" | "record", subject: string, from: string | null, to: string | null, note?: string) {
  getDb().prepare("INSERT INTO change_log (business_id,at,actor,kind,subject,old_value,new_value,note) VALUES (?,?,?,?,?,?,?,?)")
    .run(bizId, nowTs(), actor, kind, subject, from, to, note ?? null);
}

const actorOf = (source: HolidayException["source"]) =>
  source === "natural-language" ? "owner (typed it)" : source === "foresight" ? "owner (accepted a suggestion)" : "owner";
const holidaySubject = (e: Pick<HolidayException, "reason">) => `Holiday / special day${e.reason ? ` (${e.reason})` : ""}`;

let exSeq = 0;
export function addException(bizId: string, e: Omit<HolidayException, "id" | "status">): HolidayException {
  if (e.source !== "seed") logChange(bizId, actorOf(e.source), "holiday", holidaySubject(e), "(none)", describeHoliday(e));
  const id = `ex_${Date.now().toString(36)}${(exSeq++).toString(36)}`;
  getDb().prepare("INSERT INTO exceptions (id,business_id,start_date,end_date,kind,open,close,reason,source,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, bizId, e.start, e.end, e.kind, e.open, e.close, e.reason, e.source, "active", nowTs());
  return { ...e, id, status: "active" };
}

export function removeException(bizId: string, id: string, actor = "owner") {
  const e = listExceptions(bizId).find((x) => x.id === id && x.status === "active");
  getDb().prepare("UPDATE exceptions SET status='removed' WHERE id=? AND business_id=?").run(id, bizId);
  if (e) logChange(bizId, actor, "holiday", holidaySubject(e), describeHoliday(e), "(cancelled)");
}

/** Create an exception, or update the one that already covers exactly the same dates (re-activating it if it was removed). */
export function upsertException(bizId: string, e: Omit<HolidayException, "id" | "status">): HolidayException {
  const found = listExceptions(bizId).find((x) => x.start === e.start && x.end === e.end);
  if (!found) return addException(bizId, e);
  logChange(bizId, actorOf(e.source), "holiday", holidaySubject(e), found.status === "active" ? describeHoliday(found) : "(cancelled)", describeHoliday(e));
  getDb().prepare("UPDATE exceptions SET kind=?, open=?, close=?, reason=?, source=?, status='active' WHERE id=? AND business_id=?")
    .run(e.kind, e.open, e.close, e.reason, e.source, found.id, bizId);
  return { ...e, id: found.id, status: "active" };
}

/* ───────────── platforms and this business's linked listings ───────────── */

export function listPlatforms(): Platform[] {
  return getDb().prepare("SELECT * FROM platforms ORDER BY id").all() as Platform[];
}

export function findPlatformListing(bizId: string, platformId: string): PlatformListing | undefined {
  const r = getDb().prepare("SELECT * FROM platform_listings WHERE platform_id=? AND business_id=?").get(platformId, bizId) as any;
  return r && { platformId: r.platform_id, businessId: r.business_id, listingId: r.listing_id, publicPath: r.public_path, dashboardPath: r.dashboard_path };
}

export function getPlatformListing(bizId: string, platformId: string): PlatformListing {
  const l = findPlatformListing(bizId, platformId);
  if (!l) throw new Error(`${platformId} has no linked listing for this business`);
  return l;
}

/** Platforms on which this business has a confirmed, linked listing (the only ones the agent may read or edit). */
export function listLinkedPlatforms(bizId: string): Platform[] {
  return getDb().prepare(
    "SELECT p.* FROM platforms p JOIN platform_listings l ON l.platform_id=p.id WHERE l.business_id=? ORDER BY p.id",
  ).all(bizId) as Platform[];
}

/** Platforms the execute phase must visit: linked ones plus any with approved / in-flight work (e.g. a listing being created). */
export function listPlatformsWithWork(bizId: string): Platform[] {
  return getDb().prepare(
    `SELECT DISTINCT p.* FROM platforms p WHERE p.id IN (SELECT platform_id FROM platform_listings WHERE business_id=?)
       OR p.id IN (SELECT platform_id FROM field_states WHERE business_id=? AND state IN ('APPROVED','APPLIED','PENDING_MODERATION'))
     ORDER BY p.id`,
  ).all(bizId, bizId) as Platform[];
}

export function linkListing(bizId: string, platformId: string, slug: string, listingId: string, source: "seed" | "matched" | "created") {
  getDb().prepare("INSERT OR REPLACE INTO platform_listings (platform_id,business_id,listing_id,public_path,dashboard_path,source,linked_at) VALUES (?,?,?,?,?,?,?)")
    .run(platformId, bizId, listingId, `/mock/${slug}/listing/${listingId}`, `/mock/${slug}/dashboard/${listingId}`, source, nowTs());
}

/* ───────────── field states ───────────── */

export interface FieldRow {
  id: number;
  business_id: string;
  platform_id: string;
  field_key: string;
  label: string;
  state: FieldState;
  original_raw: string | null;
  original_norm: string | null;
  current_raw: string | null;
  current_norm: string | null;
  intended: string | null;
  intended_display: string | null;
  reason: string | null;
  exception_id: string | null;
  updated_at: string;
}

/** Lookup by id. Callers that act for a logged-in business must check `row.business_id` (see getOwnedField). */
export function getField(id: number): FieldRow | undefined {
  return getDb().prepare("SELECT * FROM field_states WHERE id=?").get(id) as FieldRow | undefined;
}
/** Returns the field only if it belongs to this business; otherwise undefined (callers answer 404, never "not yours"). */
export function getOwnedField(bizId: string, id: number): FieldRow | undefined {
  const f = getField(id);
  return f && f.business_id === bizId ? f : undefined;
}
export function getFieldByKey(bizId: string, platformId: string, key: string): FieldRow | undefined {
  return getDb().prepare("SELECT * FROM field_states WHERE business_id=? AND platform_id=? AND field_key=?").get(bizId, platformId, key) as FieldRow | undefined;
}
export function listFields(bizId: string, platformId?: string): FieldRow[] {
  const q = platformId
    ? getDb().prepare("SELECT * FROM field_states WHERE business_id=? AND platform_id=? ORDER BY id").all(bizId, platformId)
    : getDb().prepare("SELECT * FROM field_states WHERE business_id=? ORDER BY platform_id, id").all(bizId);
  return q as FieldRow[];
}

export function audit(bizId: string | null, actor: string, action: string, platformId: string | null, fieldKey: string | null, detail: unknown) {
  getDb().prepare("INSERT INTO audit_log (at,actor,action,platform_id,field_key,detail,business_id) VALUES (?,?,?,?,?,?,?)")
    .run(nowTs(), actor, action, platformId, fieldKey, JSON.stringify(detail ?? {}), bizId);
}

/** The single place a field's state changes. Enforces the transition table and entry actors. */
export function transition(id: number, to: FieldState, actor: Actor, note: string, patch: Partial<FieldRow> = {}) {
  const f = getField(id);
  if (!f) throw new Error(`No field ${id}`);
  assertTransition(f.state, to, actor);
  const cols = { ...patch, state: to, reason: note, updated_at: nowTs() } as Record<string, unknown>;
  delete cols.business_id; // a field never changes owner
  const sets = Object.keys(cols).map((k) => `${k}=@${k}`).join(", ");
  getDb().prepare(`UPDATE field_states SET ${sets} WHERE id=@id`).run({ ...cols, id });
  if (f.state !== to) {
    getDb().prepare("INSERT INTO state_history (field_id,from_state,to_state,actor,at,note) VALUES (?,?,?,?,?,?)")
      .run(id, f.state, to, actor, nowTs(), note);
  }
}

/** Create a field row (first time seen). New rows start in `initial` without transition checks. */
export function createField(row: Omit<FieldRow, "id" | "updated_at">): FieldRow {
  const r = getDb().prepare(`INSERT INTO field_states
    (business_id,platform_id,field_key,label,state,original_raw,original_norm,current_raw,current_norm,intended,intended_display,reason,exception_id,updated_at)
    VALUES (@business_id,@platform_id,@field_key,@label,@state,@original_raw,@original_norm,@current_raw,@current_norm,@intended,@intended_display,@reason,@exception_id,@updated_at)`)
    .run({ ...row, updated_at: nowTs() });
  getDb().prepare("INSERT INTO state_history (field_id,from_state,to_state,actor,at,note) VALUES (?,?,?,?,?,?)")
    .run(r.lastInsertRowid, null, row.state, "comparator", nowTs(), row.reason ?? "first seen");
  return getField(Number(r.lastInsertRowid))!;
}

export function history(fieldId: number) {
  return getDb().prepare("SELECT * FROM state_history WHERE field_id=? ORDER BY id").all(fieldId);
}
