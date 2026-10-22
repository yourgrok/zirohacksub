import { getDb } from "../core/db.js";
import { getFieldByKey, listPlatforms } from "../core/store.js";

export type LogKind = "details" | "holiday" | "approval" | "site" | "verified" | "setup";
export interface LogEntry {
  id: string; at: string; who: string; kind: LogKind; kindLabel: string; what: string; from: string | null; to: string | null; site: string | null; note: string | null;
}

const KIND_LABEL: Record<LogKind, string> = {
  details: "Business details", holiday: "Holiday / special day", approval: "Approval", site: "Sent to a site", verified: "Verified", setup: "Set-up",
};

const WHO: Record<string, string> = { owner: "You", "owner-approved": "Agent (you approved it)", agent: "Agent", verifier: "Agent (verifier)", system: "System", "test-runner": "Test runner" };
const who = (a: string) => WHO[a] ?? (a.startsWith("owner (") ? `You${a.slice(5)}` : a); // "owner (typed it)" -> "You (typed it)"

const short = (s: string | null | undefined, n = 160) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s ?? null);

/**
 * One chronological list for the owner: edits to the record (stored when they happen) plus approvals and what was sent to
 * which site (derived from the audit log). Newest first. Scoped to one business.
 */
export function buildChangeLog(bizId: string, limit = 400): LogEntry[] {
  const db = getDb();
  const sites = new Map(listPlatforms().map((p) => [p.id, p.name.replace(/ \(.*\)/, "")]));
  const out: LogEntry[] = [];

  for (const r of db.prepare("SELECT * FROM change_log WHERE business_id=? ORDER BY id DESC LIMIT ?").all(bizId, limit) as any[]) {
    const kind: LogKind = r.kind === "details" ? "details" : r.kind === "holiday" ? "holiday" : "setup";
    out.push({ id: `c${r.id}`, at: r.at, who: who(r.actor), kind, kindLabel: KIND_LABEL[kind], what: r.subject + (r.note && kind !== "setup" ? ` — ${r.note}` : ""), from: short(r.old_value), to: short(r.new_value), site: null, note: kind === "setup" ? r.note : null });
  }

  const label = (platform: string | null, key: string | null) => (platform && key ? getFieldByKey(bizId, platform, key)?.label ?? key : key ?? "");
  for (const a of db.prepare("SELECT * FROM audit_log WHERE business_id=? ORDER BY id DESC LIMIT ?").all(bizId, limit) as any[]) {
    const d = (() => { try { return JSON.parse(a.detail ?? "{}"); } catch { return {}; } })();
    const site = a.platform_id ? sites.get(a.platform_id) ?? a.platform_id : null;
    const f = a.platform_id && a.field_key ? getFieldByKey(bizId, a.platform_id, a.field_key) : undefined;
    const base = { id: `a${a.id}`, at: a.at, who: who(a.actor), site, note: null as string | null };
    switch (a.action) {
      case "approve": out.push({ ...base, kind: "approval", kindLabel: KIND_LABEL.approval, what: `Approved: ${label(a.platform_id, a.field_key)}`, from: short(d.from), to: short(f?.intended_display) }); break;
      case "reject": out.push({ ...base, kind: "approval", kindLabel: KIND_LABEL.approval, what: `Rejected: ${label(a.platform_id, a.field_key)}`, from: null, to: null }); break;
      case "apply": out.push({ ...base, kind: "site", kindLabel: KIND_LABEL.site, what: `Sent: ${label(a.platform_id, a.field_key)} (site answered ${d.http ?? "?"}${d.http === 202 ? " — waiting for the site's moderator" : ""})`, from: null, to: short(f?.intended_display) }); break;
      case "verify": out.push({ ...base, kind: "verified", kindLabel: KIND_LABEL.verified, what: d.result === "VERIFIED" ? `Verified after reload: ${label(a.platform_id, a.field_key)}` : `Checked after reload: ${label(a.platform_id, a.field_key)} is ${String(d.result ?? "").toLowerCase().replace(/_/g, " ")}`, from: null, to: null }); break;
      case "propose-create": out.push({ ...base, kind: "approval", kindLabel: KIND_LABEL.approval, what: "Proposed adding the business to this site", from: null, to: null }); break;
      case "create-blocked": out.push({ ...base, kind: "site", kindLabel: KIND_LABEL.site, what: "Adding the business was blocked: a matching listing exists", from: null, to: null }); break;
      case "flag": if (!d.flagged) break; out.push({ ...base, kind: "site", kindLabel: KIND_LABEL.site, what: `Flagged as not yours${d.reason ? ` (${d.reason})` : ""}`, from: null, to: null }); break;
      case "onboarding-activate": out.push({ ...base, kind: "setup", kindLabel: KIND_LABEL.setup, what: `First login: ${d.linked ?? 0} confirmed listing(s) claimed and linked`, from: null, to: null, site: null }); break;
      default: break; // proposals, plain-language confirmations (logged in change_log), etc. are not repeated here
    }
  }
  return out.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0)).slice(0, limit);
}
