import { getDb } from "../core/db.js";

/** One plain sentence per field saying what the agent found and why it did (or did not do) something. Facts only, no model needed. */
export interface WhyInput { platform: string; field: string; fieldKey: string; state: string; original: string; intended: string; reason: string }

const site = (p: string) => p.replace(/ \(.*\)/, "");

export function whyOf(r: WhyInput): string {
  const s = site(r.platform);
  const holiday = r.fieldKey.startsWith("holiday:");
  switch (r.state) {
    case "PROPOSED":
      if (/changed after you approved/i.test(r.reason)) return r.reason;
      if (holiday && /closed/i.test(r.original)) return `${s} lists this day as Closed, but your record says you are open. A customer would stay away, so I'm proposing the fix. Nothing is sent until you approve.`;
      return `${s} shows "${r.original}" but your record says "${r.intended}". That is a real difference in meaning, not just formatting, so I'm proposing a fix. Nothing is sent until you approve.`;
    case "FORMAT_ONLY_EQUIVALENT": return `${s} writes this differently but it means the same as your record, so I left it alone.`;
    case "MATCH": return `${s} already matches your record.`;
    case "APPROVED": return `You approved this. I'll send it to ${s} when you press Apply.`;
    case "APPLIED": return `Sent to ${s}. I still have to reload the page to check it.`;
    case "PENDING_MODERATION": return `${s} accepted the edit but its moderator has not approved it, so the public page still shows the old value. I won't call it fixed until I see it live.`;
    case "SITE_REJECTED": return `The moderator of ${s} (or the site owner) rejected this edit, so the public page still shows the old value. I will not send it again unless you approve it again.`;
    case "VERIFIED": return `I reloaded the ${s} page and it now shows the value you approved.`;
    case "FLAGGED_NOT_OWNER": return `This ${s} listing is claimed by another account, so I did not touch it. I drafted a claim request for you.`;
    case "REJECTED": return `You rejected this change, so I'm leaving ${s} as it is.`;
    default: return r.reason || "";
  }
}

/** Optional wording written by Gemini for the same facts (stored separately; used only while the facts are unchanged). */
export const basisOf = (r: { state: string; original: string; intended: string }) => `${r.state}|${r.original}|${r.intended}`;

export function aiNoteFor(bizId: string, fieldId: number, basis: string): string | null {
  const n = getDb().prepare("SELECT basis, text FROM ai_notes WHERE business_id=? AND field_id=?").get(bizId, fieldId) as { basis: string; text: string } | undefined;
  return n && n.basis === basis ? n.text : null;
}
