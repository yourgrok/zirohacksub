import { mockAuthHeaders } from "../auth/mockCreds.js";
import { audit, createField, getBusiness, getFieldByKey, linkListing, listPlatforms, transition, type FieldRow } from "../core/store.js";
import { getDb } from "../core/db.js";
import { nowTs } from "../core/clock.js";
import { canonHours, hoursEqual, normaliseAddress, normalisePhone } from "../core/normalise.js";
import type { Platform } from "../core/types.js";
import { CreateChangeZ, isCreate, type CreateChange } from "../mock/changes.js";
import { discoverSite } from "../onboarding/discover.js";
import { nameSim } from "../onboarding/similarity.js";
import { baseUrl, fetchPage, parseDashboard, parsePublic } from "./reader.js";
import { normalisePublic } from "./compare.js";
import type { RunState } from "./types.js";

/** The field row that represents "put my business on this site". It goes through the same approve/apply/verify states. */
export const CREATE_KEY = "listing:create";
export const isCreateRow = (f: Pick<FieldRow, "field_key">) => f.field_key === CREATE_KEY;

export class CreateListingError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

function platformOf(platformId: string): Platform {
  const p = listPlatforms().find((x) => x.id === platformId);
  if (!p) throw new CreateListingError("Unknown site.", 404);
  return p;
}

export function createChangeFor(bizId: string): CreateChange {
  const b = getBusiness(bizId);
  return { action: "create_listing", listing: { name: b.name, address: b.address, phone: b.phone, hours: b.hours } };
}

/** Exactly what will be sent, and where — shown on the approval card. */
export function describeCreate(platform: Platform, c: CreateChange): string {
  return [`Create a new listing on ${platform.name}`, `Name: ${c.listing.name}`, `Address: ${c.listing.address}`, `Phone: ${c.listing.phone}`, `Hours: ${canonHours(c.listing.hours)}`].join("\n");
}

const entered = (bizId: string) => { const b = getBusiness(bizId); return { name: b.name, address: b.address, phone: b.phone }; };

/** Propose creating the business on a site where it is not listed. Only creates a card; nothing is sent. */
export async function proposeCreateListing(bizId: string, platformId: string): Promise<FieldRow> {
  const platform = platformOf(platformId);
  const biz = getBusiness(bizId);
  if (biz.status !== "active") throw new CreateListingError("Please log in first.");
  const match = getDb().prepare("SELECT status FROM site_matches WHERE business_id=? AND platform_id=?").get(bizId, platformId) as { status: string } | undefined;
  if (!match) throw new CreateListingError("This business was not set up through matching, so the agent cannot tell whether it is already listed there.");
  if (!["none", "rejected"].includes(match.status)) {
    throw new CreateListingError(
      match.status === "flagged" ? "A listing that looks like yours exists here but belongs to another account. Reclaim it manually; the agent will not create a duplicate."
      : match.status === "unreadable" ? "That site could not be read, so the agent will not create anything there."
      : match.status === "confirmed" || match.status === "linked" || match.status === "created" ? "You already have a listing on this site." : "Not available for this site.");
  }
  // never create a listing where a likely match exists that the owner has not resolved: look again right now
  const look = await discoverSite(platform, entered(bizId));
  if (look.readError) throw new CreateListingError("That site could not be read right now. Please try again later.");
  if (look.status !== "none") throw new CreateListingError("A listing that looks like yours has appeared on this site. Please resolve that match first; the agent will not create a duplicate.");

  const change = createChangeFor(bizId);
  const existing = getFieldByKey(bizId, platformId, CREATE_KEY);
  const display = describeCreate(platform, change);
  if (existing) {
    if (!["REJECTED", "MISMATCH"].includes(existing.state)) throw new CreateListingError("This is already proposed or in progress.");
    transition(existing.id, "PROPOSED", "planner", "proposed again to the owner", { intended: JSON.stringify(change), intended_display: display });
    return getFieldByKey(bizId, platformId, CREATE_KEY)!;
  }
  const row = createField({
    business_id: bizId, platform_id: platformId, field_key: CREATE_KEY, label: "New listing", state: "MISMATCH",
    original_raw: "(not listed on this site)", original_norm: "", current_raw: "(not listed on this site)", current_norm: "",
    intended: JSON.stringify(change), intended_display: display, reason: "your business is not listed here", exception_id: null,
  });
  transition(row.id, "PROPOSED", "planner", "proposed to owner: add this business to the site");
  audit(bizId, "agent", "propose-create", platformId, CREATE_KEY, { fields: change.listing });
  return getFieldByKey(bizId, platformId, CREATE_KEY)!;
}

/** Apply an APPROVED create: re-check for duplicates, then ask the site to create the listing. */
export async function applyCreate(st: RunState, platformId: string, f: FieldRow): Promise<string> {
  const platform = platformOf(platformId);
  const biz = getBusiness(st.bizId);
  const change = CreateChangeZ.parse(JSON.parse(f.intended!));
  const look = await discoverSite(platform, entered(st.bizId));
  if (look.readError || look.status !== "none") {
    transition(f.id, "PROPOSED", "planner", "blocked: a listing that looks like yours exists on this site now — resolve that match first; nothing was created");
    audit(st.bizId, "agent", "create-blocked", platformId, f.field_key, { reason: look.readError ?? look.status });
    return `${CREATE_KEY}: blocked (a matching listing exists or the site is unreadable)`;
  }
  const resp = await fetch(`${baseUrl()}/mock/${platform.slug}/listings`, {
    method: "POST", headers: { "content-type": "application/json", ...mockAuthHeaders(biz.mockAccount) }, body: JSON.stringify(change),
  });
  const body = (await resp.json().catch(() => ({}))) as { listingId?: string };
  audit(st.bizId, "owner-approved", "apply", platformId, f.field_key, { sent: change, http: resp.status, listingId: body.listingId, at: nowTs() });
  if ((resp.status === 200 || resp.status === 202) && body.listingId) {
    const withId = { ...change, listingId: body.listingId };
    transition(f.id, "APPLIED", "applier", resp.status === 202 ? "sent; the site queued the new listing for moderation" : "sent; the site created the listing", { intended: JSON.stringify(withId) });
    return `${CREATE_KEY}: sent (${resp.status}) as ${body.listingId}`;
  }
  if (resp.status === 401 || resp.status === 403) { transition(f.id, "FLAGGED_NOT_OWNER", "system", "the site refused to let this account create a listing"); return `${CREATE_KEY}: refused (${resp.status})`; }
  if (resp.status === 409) { transition(f.id, "PROPOSED", "planner", "the site says a listing with this phone number already exists — nothing was created"); return `${CREATE_KEY}: duplicate refused by the site`; }
  return `${CREATE_KEY}: HTTP ${resp.status} (stays approved)`;
}

/** Reload and verify a created listing: the public page must exist and show the owner's values. */
export async function verifyCreate(st: RunState, platformId: string, f: FieldRow): Promise<string> {
  const platform = platformOf(platformId);
  const biz = getBusiness(st.bizId);
  const change = CreateChangeZ.parse(JSON.parse(f.intended!));
  const id = change.listingId;
  if (!id) { transition(f.id, "MISMATCH", "verifier", "no listing id was returned by the site"); return `${CREATE_KEY}: no listing id`; }
  const page = await fetchPage(`/mock/${platform.slug}/listing/${id}`);
  if (page.status === 200) {
    const pub = parsePublic(platform.slug, page.html);
    const n = normalisePublic(pub);
    const problems: string[] = [];
    if (pub.listingId !== id) problems.push("page shows a different listing id");
    if (n.phone !== normalisePhone(biz.phone)) problems.push("phone differs");
    if (n.address !== normaliseAddress(biz.address)) problems.push("address differs");
    if (!hoursEqual(n.hours, biz.hours) || n.unparsed.length) problems.push("hours differ");
    if (nameSim(pub.name ?? "", biz.name) < 0.95) problems.push("name differs");
    const patch = { current_raw: `${pub.name} · ${pub.address} · ${pub.phone}`, current_norm: id };
    if (problems.length) { transition(f.id, "MISMATCH", "verifier", `the new listing exists but ${problems.join(", ")}`, patch); return `${CREATE_KEY}: listing exists but ${problems.join(", ")}`; }
    transition(f.id, "VERIFIED", "verifier", `reloaded public page of ${id} shows the owner's values`, patch);
    linkListing(st.bizId, platformId, platform.slug, id, "created");
    getDb().prepare("UPDATE site_matches SET status='created', listing_id=?, confirmed_at=? WHERE business_id=? AND platform_id=?").run(id, nowTs(), st.bizId, platformId);
    audit(st.bizId, "verifier", "verify", platformId, f.field_key, { result: "VERIFIED", listingId: id });
    return `${CREATE_KEY}: VERIFIED as ${id}`;
  }
  const dash = await fetchPage(`/mock/${platform.slug}/dashboard`, { headers: mockAuthHeaders(biz.mockAccount) });
  const pending = parseDashboard(dash.html).pending.some((p) => isCreate(p.change) && p.change.listingId === id);
  if (pending) {
    transition(f.id, "PENDING_MODERATION", "verifier", "the public page does not exist yet; the new listing is waiting in the site's moderation queue");
    return `${CREATE_KEY}: PENDING_MODERATION (${id})`;
  }
  transition(f.id, "MISMATCH", "verifier", "the new listing is not on the site and nothing is pending (it may have been rejected)");
  return `${CREATE_KEY}: NOT FOUND`;
}
