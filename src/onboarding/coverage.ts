import { getDb } from "../core/db.js";
import { getFieldByKey, listPlatforms, findPlatformListing } from "../core/store.js";
import { CREATE_KEY } from "../agent/createListing.js";

export type CoverageStatus = "listed" | "missing" | "proposed" | "pending" | "flagged" | "unreadable";
export interface Coverage { platformId: string; name: string; status: CoverageStatus; listingId: string | null; canAdd: boolean; note: string }

/** "Listed on X, Y. Not listed on Z, W." — one row per site, with whether the agent may offer to add the business there. */
export function coverageOf(bizId: string): Coverage[] {
  return listPlatforms().map((p) => {
    const linked = findPlatformListing(bizId, p.id);
    if (linked) return { platformId: p.id, name: p.name, status: "listed" as const, listingId: linked.listingId, canAdd: false, note: "listed" };
    const m = getDb().prepare("SELECT status FROM site_matches WHERE business_id=? AND platform_id=?").get(bizId, p.id) as { status: string } | undefined;
    const create = getFieldByKey(bizId, p.id, CREATE_KEY);
    if (create) {
      if (create.state === "PROPOSED" || create.state === "APPROVED") return { platformId: p.id, name: p.name, status: "proposed" as const, listingId: null, canAdd: false, note: "waiting for your approval below" };
      if (create.state === "APPLIED" || create.state === "PENDING_MODERATION") return { platformId: p.id, name: p.name, status: "pending" as const, listingId: null, canAdd: false, note: "sent — waiting for the site to publish it" };
      if (create.state === "FLAGGED_NOT_OWNER") return { platformId: p.id, name: p.name, status: "flagged" as const, listingId: null, canAdd: false, note: "the site refused to create it" };
      // REJECTED / MISMATCH: the owner may ask again
      return { platformId: p.id, name: p.name, status: "missing" as const, listingId: null, canAdd: true, note: create.state === "REJECTED" ? "you rejected adding it here" : "the last attempt did not work" };
    }
    if (m?.status === "flagged") return { platformId: p.id, name: p.name, status: "flagged" as const, listingId: null, canAdd: false, note: "a listing that looks like yours is claimed by another account — reclaim it on the site yourself" };
    if (m?.status === "unreadable") return { platformId: p.id, name: p.name, status: "unreadable" as const, listingId: null, canAdd: false, note: "this site could not be read" };
    if (m?.status === "none" || m?.status === "rejected") return { platformId: p.id, name: p.name, status: "missing" as const, listingId: null, canAdd: true, note: "not listed here" };
    return { platformId: p.id, name: p.name, status: "missing" as const, listingId: null, canAdd: false, note: "not listed here" };
  });
}
