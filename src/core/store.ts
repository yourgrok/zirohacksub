import { getDb } from "./db.js";
import { nowTs } from "./clock.js";
import { assertTransition, type Actor } from "./states.js";
import { BUSINESS_ID } from "./seed.js";
import type { Business, FieldState, HolidayException, Platform, PlatformListing, WeeklyHours } from "./types.js";

export function getBusiness(): Business {
  const r = getDb().prepare("SELECT * FROM business WHERE id=?").get(BUSINESS_ID) as any;
  return { id: r.id, name: r.name, address: r.address, phone: r.phone, hours: JSON.parse(r.hours_json) as WeeklyHours };
}

export function listExceptions(includeRemoved = true): HolidayException[] {
  const rows = getDb().prepare("SELECT * FROM exceptions WHERE business_id=? ORDER BY start_date, id").all(BUSINESS_ID) as any[];
  return rows
    .map((r) => ({
      id: r.id, start: r.start_date, end: r.end_date, kind: r.kind, open: r.open, close: r.close,
      reason: r.reason, source: r.source, status: r.status,
    }) as HolidayException)
    .filter((e) => includeRemoved || e.status === "active");
}

let exSeq = 0;
export function addException(e: Omit<HolidayException, "id" | "status">): HolidayException {
  const id = `ex_${Date.now().toString(36)}${(exSeq++).toString(36)}`;
  getDb().prepare("INSERT INTO exceptions (id,business_id,start_date,end_date,kind,open,close,reason,source,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, BUSINESS_ID, e.start, e.end, e.kind, e.open, e.close, e.reason, e.source, "active", nowTs());
  return { ...e, id, status: "active" };
}

export function removeException(id: string) {
  getDb().prepare("UPDATE exceptions SET status='removed' WHERE id=?").run(id);
}

export function listPlatforms(): Platform[] {
  return getDb().prepare("SELECT * FROM platforms ORDER BY id").all() as Platform[];
}

export function getPlatformListing(platformId: string): PlatformListing {
  const r = getDb().prepare("SELECT * FROM platform_listings WHERE platform_id=? AND business_id=?").get(platformId, BUSINESS_ID) as any;
  return { platformId: r.platform_id, businessId: r.business_id, listingId: r.listing_id, publicPath: r.public_path, dashboardPath: r.dashboard_path };
}

/* ───────────── field states ───────────── */

export interface FieldRow {
  id: number;
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

export function getField(id: number): FieldRow | undefined {
  return getDb().prepare("SELECT * FROM field_states WHERE id=?").get(id) as FieldRow | undefined;
}
export function getFieldByKey(platformId: string, key: string): FieldRow | undefined {
  return getDb().prepare("SELECT * FROM field_states WHERE platform_id=? AND field_key=?").get(platformId, key) as FieldRow | undefined;
}
export function listFields(platformId?: string): FieldRow[] {
  const q = platformId
    ? getDb().prepare("SELECT * FROM field_states WHERE platform_id=? ORDER BY id").all(platformId)
    : getDb().prepare("SELECT * FROM field_states ORDER BY platform_id, id").all();
  return q as FieldRow[];
}

export function audit(actor: string, action: string, platformId: string | null, fieldKey: string | null, detail: unknown) {
  getDb().prepare("INSERT INTO audit_log (at,actor,action,platform_id,field_key,detail) VALUES (?,?,?,?,?,?)")
    .run(nowTs(), actor, action, platformId, fieldKey, JSON.stringify(detail ?? {}));
}

/** The single place a field's state changes. Enforces the transition table and entry actors. */
export function transition(id: number, to: FieldState, actor: Actor, note: string, patch: Partial<FieldRow> = {}) {
  const f = getField(id);
  if (!f) throw new Error(`No field ${id}`);
  assertTransition(f.state, to, actor);
  const cols = { ...patch, state: to, reason: note, updated_at: nowTs() } as Record<string, unknown>;
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
    (platform_id,field_key,label,state,original_raw,original_norm,current_raw,current_norm,intended,intended_display,reason,exception_id,updated_at)
    VALUES (@platform_id,@field_key,@label,@state,@original_raw,@original_norm,@current_raw,@current_norm,@intended,@intended_display,@reason,@exception_id,@updated_at)`)
    .run({ ...row, updated_at: nowTs() });
  getDb().prepare("INSERT INTO state_history (field_id,from_state,to_state,actor,at,note) VALUES (?,?,?,?,?,?)")
    .run(r.lastInsertRowid, null, row.state, "comparator", nowTs(), row.reason ?? "first seen");
  return getField(Number(r.lastInsertRowid))!;
}

export function history(fieldId: number) {
  return getDb().prepare("SELECT * FROM state_history WHERE field_id=? ORDER BY id").all(fieldId);
}
