import { getDb } from "../core/db.js";
import { CREATE_KEY } from "./createListing.js";
import { listFields, listPlatforms, type FieldRow } from "../core/store.js";
import { aiNoteFor, basisOf, whyOf } from "./why.js";

export interface ReportRow {
  fieldId: number; platform: string; platformId: string; field: string; fieldKey: string;
  original: string; intended: string; approval: string; verified: string; state: string; reason: string; current: string; currentNorm: string;
  why: string; whySource: "agent" | "Gemini";
}

const approvalOf = (s: string) =>
  ({ PROPOSED: "Awaiting your approval", APPROVED: "Approved", APPLIED: "Approved", VERIFIED: "Approved", PENDING_MODERATION: "Approved",
     REJECTED: "Rejected", FLAGGED_NOT_OWNER: "Not editable — flagged", MATCH: "Not needed", FORMAT_ONLY_EQUIVALENT: "Not needed", MISMATCH: "Not proposed yet" } as Record<string, string>)[s];

const verifiedOf = (s: string) =>
  ({ VERIFIED: "VERIFIED (page reloaded and checked)", PENDING_MODERATION: "PENDING — waiting for the site's moderator", APPLIED: "Applied — not yet verified",
     FLAGGED_NOT_OWNER: "FLAGGED — not the listing owner", MATCH: "No change needed", FORMAT_ONLY_EQUIVALENT: "No change needed (formatting only)",
     PROPOSED: "—", APPROVED: "—", REJECTED: "—", MISMATCH: "—" } as Record<string, string>)[s];

export function buildRows(bizId: string): ReportRow[] {
  const names = new Map(listPlatforms().map((p) => [p.id, p.name]));
  return listFields(bizId).map((f: FieldRow) => {
    const base = {
      fieldId: f.id, platform: names.get(f.platform_id) ?? f.platform_id, platformId: f.platform_id, field: f.label, fieldKey: f.field_key,
      original: f.original_raw ?? "", intended: f.intended_display ?? "", approval: approvalOf(f.state), verified: verifiedOf(f.state),
      state: f.state, reason: f.reason ?? "", current: f.current_raw ?? "", currentNorm: f.current_norm ?? "",
    };
    const ai = aiNoteFor(bizId, f.id, basisOf(base));
    return { ...base, why: ai ?? whyOf(base), whySource: ai ? "Gemini" as const : "agent" as const };
  });
}

/** Plain-English template summary (used when there is no Gemini key, or as the fallback). */
export function templateSummary(bizId: string): string {
  const rows = buildRows(bizId);
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

export function latestRunSummary(bizId: string): string | null {
  const r = getDb().prepare("SELECT summary FROM runs WHERE business_id=? AND summary IS NOT NULL ORDER BY started_at DESC, rowid DESC LIMIT 1").get(bizId) as { summary: string } | undefined;
  return r?.summary ?? null;
}

export function toCsv(rows: ReportRow[]): string {
  const q = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const head = ["Platform", "Field", "Original value", "Intended value", "Approval status", "Verified status"];
  return [head.map(q).join(","), ...rows.map((r) => [r.platform, r.field, r.original, r.intended, r.approval, r.verified].map(q).join(","))].join("\r\n");
}

/* ───────────── "how your listings were matched" (new owners only) ───────────── */

export interface MatchRow {
  platformId: string; platform: string; listingId: string; score: number | null; confirmation: string; status: string; note: string;
  why: string; created: { intended: string; approval: string; verified: string; state: string } | null;
}

const CONFIRM_TEXT: Record<string, string> = {
  confirmed: "Confirmed by owner", linked: "Confirmed by owner", rejected: "Rejected by owner", flagged: "Flagged: claimed by another account (not linked)",
  none: "No listing found", created: "Created by the agent after owner approval", unreadable: "Site could not be read",
};

export function buildMatchRows(bizId: string): MatchRow[] {
  const names = new Map(listPlatforms().map((p) => [p.id, p.name]));
  const rows = getDb().prepare("SELECT * FROM site_matches WHERE business_id=? ORDER BY platform_id").all(bizId) as any[];
  return rows.map((m) => {
    const bd = m.breakdown_json ? JSON.parse(m.breakdown_json) : null;
    const f = listFields(bizId, m.platform_id).find((x) => x.field_key === CREATE_KEY);
    // "no listing found" must not show the unrelated best-scoring look-alike as if it were a match
    const noMatch = m.status === "none" || m.status === "unreadable";
    return {
      platformId: m.platform_id, platform: names.get(m.platform_id) ?? m.platform_id, listingId: noMatch ? "—" : m.listing_id ?? "—", score: noMatch ? null : m.score ?? null,
      confirmation: CONFIRM_TEXT[m.status] ?? m.status, status: m.status, note: m.note ?? "",
      why: bd && !noMatch ? `phone ${bd.phone.points}/${bd.phone.max} · address ${bd.address.points}/${bd.address.max} · name ${bd.name.points}/${bd.name.max}` : "",
      created: f ? { intended: f.intended_display ?? "", approval: approvalOf(f.state), verified: verifiedOf(f.state), state: f.state } : null,
    };
  });
}

export function matchesToCsv(rows: MatchRow[]): string {
  const q = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const head = ["Site", "Matched listing ID", "Match score", "Why", "Owner confirmation", "Created listing: intended", "Approval status", "Verified status"];
  return [head.map(q).join(","), ...rows.map((r) => [r.platform, r.listingId, r.score ?? "", r.why, r.confirmation, r.created?.intended ?? "", r.created?.approval ?? "", r.created?.verified ?? ""].map((x) => q(String(x))).join(","))].join("\r\n");
}
