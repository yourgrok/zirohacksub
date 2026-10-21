import { getDb } from "../core/db.js";
import { listFields, listPlatforms, type FieldRow } from "../core/store.js";

export interface ReportRow {
  fieldId: number; platform: string; platformId: string; field: string; fieldKey: string;
  original: string; intended: string; approval: string; verified: string; state: string; reason: string; current: string; currentNorm: string;
}

const approvalOf = (s: string) =>
  ({ PROPOSED: "Awaiting your approval", APPROVED: "Approved", APPLIED: "Approved", VERIFIED: "Approved", PENDING_MODERATION: "Approved",
     REJECTED: "Rejected", FLAGGED_NOT_OWNER: "Not editable — flagged", MATCH: "Not needed", FORMAT_ONLY_EQUIVALENT: "Not needed", MISMATCH: "Not proposed yet" } as Record<string, string>)[s];

const verifiedOf = (s: string) =>
  ({ VERIFIED: "VERIFIED (page reloaded and checked)", PENDING_MODERATION: "PENDING — waiting for the site's moderator", APPLIED: "Applied — not yet verified",
     FLAGGED_NOT_OWNER: "FLAGGED — not the listing owner", MATCH: "No change needed", FORMAT_ONLY_EQUIVALENT: "No change needed (formatting only)",
     PROPOSED: "—", APPROVED: "—", REJECTED: "—", MISMATCH: "—" } as Record<string, string>)[s];

export function buildRows(): ReportRow[] {
  const names = new Map(listPlatforms().map((p) => [p.id, p.name]));
  return listFields().map((f: FieldRow) => ({
    fieldId: f.id, platform: names.get(f.platform_id) ?? f.platform_id, platformId: f.platform_id, field: f.label, fieldKey: f.field_key,
    original: f.original_raw ?? "", intended: f.intended_display ?? "", approval: approvalOf(f.state), verified: verifiedOf(f.state),
    state: f.state, reason: f.reason ?? "", current: f.current_raw ?? "", currentNorm: f.current_norm ?? "",
  }));
}

/** Plain-English template summary (used when there is no Gemini key, or as the fallback). */
export function templateSummary(): string {
  const rows = buildRows();
  const by = (s: string) => rows.filter((r) => r.state === s);
  const sites = (rs: ReportRow[]) => [...new Set(rs.map((r) => r.platform.replace(/ \(.*\)/, "")))];
  const parts: string[] = [];
  const v = by("VERIFIED"), p = by("PENDING_MODERATION"), f = by("FLAGGED_NOT_OWNER"), pr = by("PROPOSED"), ap = by("APPROVED").concat(by("APPLIED")), fo = by("FORMAT_ONLY_EQUIVALENT"), mm = by("MISMATCH");
  if (v.length) parts.push(`${sites(v).length} site(s) fixed and verified (${sites(v).join(", ")})`);
  if (p.length) parts.push(`${sites(p).length} pending moderation (${sites(p).join(", ")})`);
  if (f.length) parts.push(`${sites(f).length} need you to reclaim the listing (${sites(f).join(", ")})`);
  if (pr.length) parts.push(`${pr.length} change(s) waiting for your approval`);
  if (ap.length) parts.push(`${ap.length} approved change(s) not yet verified`);
  if (mm.length) parts.push(`${mm.length} mismatch(es) not yet proposed`);
  if (fo.length) parts.push(`${fo.length} formatting-only difference(s) ignored`);
  if (!parts.length) return rows.length ? "All listings are consistent with your record. Nothing to change." : "No scan has been run yet.";
  return parts.join("; ") + ".";
}

export function latestRunSummary(): string | null {
  const r = getDb().prepare("SELECT summary FROM runs WHERE summary IS NOT NULL ORDER BY started_at DESC, rowid DESC LIMIT 1").get() as { summary: string } | undefined;
  return r?.summary ?? null;
}

export function toCsv(rows: ReportRow[]): string {
  const q = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const head = ["Platform", "Field", "Original value", "Intended value", "Approval status", "Verified status"];
  return [head.map(q).join(","), ...rows.map((r) => [r.platform, r.field, r.original, r.intended, r.approval, r.verified].map(q).join(","))].join("\r\n");
}
