import { randomBytes } from "node:crypto";
import { z } from "zod";
import { mockAuthHeaders } from "../auth/mockCreds.js";
import { eventRun, logEvent } from "../auth/events.js";
import { formatPin, generatePin, hashPin } from "../auth/pin.js";
import { baseUrl } from "../agent/reader.js";
import { getDb } from "../core/db.js";
import { nowTs } from "../core/clock.js";
import { displayPhone, normalisePhone, parseHoursText } from "../core/normalise.js";
import { audit, findBusiness, linkListing, listPlatforms } from "../core/store.js";
import type { WeeklyHours } from "../core/types.js";
import { DRAFT_TTL_MS, MAX_BUSINESSES, PENDING_BUSINESS_TTL_MS, THRESHOLDS } from "./config.js";
import { matchAllSites, type SiteMatch } from "./discover.js";
import type { Candidate } from "./score.js";

export class OnboardingError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

export const DetailsZ = z.object({
  name: z.string().transform(clean).pipe(z.string().min(2, "Please enter the business name.").max(80)),
  address: z.string().transform(clean).pipe(z.string().min(8, "Please enter the full address.").max(200)),
  phone: z.string().transform(clean).pipe(z.string().max(25).refine((v) => normalisePhone(v) !== null, "That phone number does not look right.")),
  hours: z.string().transform(clean).pipe(z.string().max(300)).optional(),
});
export type Details = z.infer<typeof DetailsZ>;

/** Typical hours used only when the owner entered none and nothing confirmed gives any. Shown to the owner. */
export const DEFAULT_HOURS: WeeklyHours = {
  mon: { open: "09:00", close: "18:00" }, tue: { open: "09:00", close: "18:00" }, wed: { open: "09:00", close: "18:00" },
  thu: { open: "09:00", close: "18:00" }, fri: { open: "09:00", close: "18:00" }, sat: { open: "09:00", close: "18:00" }, sun: null,
};

const rid = (bytes: number) => randomBytes(bytes).toString("base64url");

/* ───────────── housekeeping ───────────── */

export function deleteBusinessData(bizId: string) {
  const d = getDb();
  d.prepare("DELETE FROM state_history WHERE field_id IN (SELECT id FROM field_states WHERE business_id=?)").run(bizId);
  for (const t of ["field_states", "exceptions", "platform_listings", "site_matches", "sessions", "audit_log", "trace", "runs"]) {
    d.prepare(`DELETE FROM ${t} WHERE business_id=?`).run(bizId);
  }
  d.prepare("DELETE FROM business WHERE id=?").run(bizId);
}

/** Businesses whose PIN was never used are discarded; so are stale drafts. Nothing was ever claimed for them. */
export function expirePending(now = Date.now()) {
  const d = getDb();
  const cutoff = new Date(now - PENDING_BUSINESS_TTL_MS).toISOString();
  for (const r of d.prepare("SELECT id FROM business WHERE status='pending' AND created_at < ?").all(cutoff) as { id: string }[]) deleteBusinessData(r.id);
  d.prepare("DELETE FROM onboarding_drafts WHERE expires_at < ?").run(new Date(now).toISOString());
}

/* ───────────── 1. start: read every site, score every listing ───────────── */

export interface DraftView {
  draftId: string;
  details: { name: string; address: string; phone: string; hours: string | null };
  sites: SiteMatch[];
  thresholds: { high: number; low: number; margin: number };
  needsDecision: string[];
}

const needsDecision = (m: SiteMatch) => m.status === "auto" || m.status === "ask";

export async function startOnboarding(raw: unknown): Promise<DraftView> {
  const parsed = DetailsZ.safeParse(raw);
  if (!parsed.success) throw new OnboardingError(parsed.error.issues[0]?.message ?? "Please check the details.");
  const details = parsed.data;
  if (details.hours) {
    const { hours, unparsed } = parseHoursText(details.hours);
    if (unparsed.length || Object.values(hours).every((h) => h === null)) throw new OnboardingError("I could not read those hours. Try: Mon-Sat 9am-9pm; Sun 10am-2pm");
  }
  expirePending();
  if ((getDb().prepare("SELECT COUNT(*) c FROM business").get() as { c: number }).c >= MAX_BUSINESSES) throw new OnboardingError("This demo is full. Please try again later.", 503);

  const phone = displayPhone(normalisePhone(details.phone)!);
  const entered = { name: details.name, address: details.address, phone };
  const draftId = rid(24);
  const runId = eventRun(null, "onboarding", `onb_${draftId.slice(0, 10)}`);
  const t0 = performance.now();
  const sites = await matchAllSites(entered);
  for (const m of sites) {
    logEvent(runId, "match_site", { site: m.platformId }, m.readError
      ? `could not read ${m.platformName}: ${m.readError}`
      : `${m.platformName}: ${m.candidates.length} listing(s) scored; best ${m.candidates[0] ? `${m.candidates[0].score} (${m.candidates[0].listingId})` : "none"} → ${m.status}`, performance.now() - t0);
  }
  const now = Date.now();
  getDb().prepare("INSERT INTO onboarding_drafts (id,details_json,matches_json,run_id,status,created_at,expires_at) VALUES (?,?,?,?,?,?,?)")
    .run(draftId, JSON.stringify({ ...entered, hours: details.hours ?? null }), JSON.stringify(sites), runId, "open", new Date(now).toISOString(), new Date(now + DRAFT_TTL_MS).toISOString());
  return viewOf(draftId, { ...entered, hours: details.hours ?? null }, sites);
}

function viewOf(draftId: string, details: DraftView["details"], sites: SiteMatch[]): DraftView {
  return { draftId, details, sites, thresholds: { high: THRESHOLDS.HIGH, low: THRESHOLDS.LOW, margin: THRESHOLDS.MARGIN }, needsDecision: sites.filter(needsDecision).map((m) => m.platformId) };
}

function loadDraft(draftId: string) {
  const r = getDb().prepare("SELECT * FROM onboarding_drafts WHERE id=?").get(draftId) as any;
  if (!r || r.status !== "open" || Date.parse(r.expires_at) < Date.now()) return null;
  return { id: r.id as string, runId: r.run_id as string, details: JSON.parse(r.details_json) as DraftView["details"], sites: JSON.parse(r.matches_json) as SiteMatch[] };
}

export function getDraft(draftId: string): DraftView | null {
  const d = loadDraft(String(draftId));
  return d && viewOf(d.id, d.details, d.sites);
}

/* ───────────── 2. confirm: owner says "yes, that's me" per site ───────────── */

export const DecisionsZ = z.record(z.string(), z.object({ action: z.enum(["confirm", "reject"]), listingId: z.string().max(40).optional() }));

export interface Created { pin: string; businessName: string; expiresInMinutes: number; confirmed: number; hoursAssumed: boolean }

/** Creates the (still pending) business and returns its PIN ONCE. Only the HMAC of the PIN is stored. */
export function confirmOnboarding(draftId: string, rawDecisions: unknown): Created {
  const draft = loadDraft(String(draftId));
  if (!draft) throw new OnboardingError("This set-up has expired. Please start again.", 404);
  const dec = DecisionsZ.safeParse(rawDecisions);
  if (!dec.success) throw new OnboardingError("Please answer for every site.");
  const decisions = dec.data;

  // validate against the SERVER's stored matches — never trust scores or ids sent by the browser
  const chosen = new Map<string, Candidate>();
  for (const m of draft.sites) {
    const d = decisions[m.platformId];
    if (needsDecision(m)) {
      if (!d) throw new OnboardingError(`Please confirm or reject the match on ${m.platformName}.`);
      if (d.action === "confirm") {
        const cand = m.candidates.find((c) => c.listingId === d.listingId);
        if (!cand) throw new OnboardingError(`That listing is not one of the matches on ${m.platformName}.`);
        if (cand.claimed) throw new OnboardingError(`That listing on ${m.platformName} is already claimed by another account.`);
        if (cand.score < THRESHOLDS.LOW) throw new OnboardingError(`That listing on ${m.platformName} is too different to link.`);
        chosen.set(m.platformId, cand);
      }
    } else if (d?.action === "confirm") {
      throw new OnboardingError(m.status === "claimed" ? `The listing on ${m.platformName} is claimed by another account and cannot be linked.` : `There is nothing to confirm on ${m.platformName}.`);
    }
  }

  const d = getDb();
  const taken = d.prepare("UPDATE onboarding_drafts SET status='used' WHERE id=? AND status='open'").run(draft.id);
  if (!Number(taken.changes)) throw new OnboardingError("This set-up was already completed.", 409); // a PIN is shown exactly once

  // hours: what the owner typed, otherwise typical hours (the owner is told which)
  const hoursAssumed = !draft.details.hours;
  const hours: WeeklyHours = draft.details.hours ? parseHoursText(draft.details.hours).hours : DEFAULT_HOURS;

  const bizId = `biz_${randomBytes(6).toString("hex")}`;
  let pin = "", pinHash = "";
  for (let i = 0; i < 5; i++) { // a collision is astronomically unlikely, but the lookup key must be unique
    pin = generatePin(); pinHash = hashPin(pin);
    if (!d.prepare("SELECT 1 FROM business WHERE pin_hmac=?").get(pinHash)) break;
  }
  const tx = d.transaction(() => {
    d.prepare("INSERT INTO business (id,name,address,phone,hours_json,pin_hmac,mock_account,status,is_demo,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(bizId, draft.details.name, draft.details.address, draft.details.phone, JSON.stringify(hours), pinHash, `acct_${bizId}`, "pending", 0, new Date().toISOString());
    const ins = d.prepare("INSERT INTO site_matches (business_id,platform_id,status,listing_id,score,breakdown_json,candidates_json,confirmed_at,note,source) VALUES (?,?,?,?,?,?,?,?,?,?)");
    for (const m of draft.sites) {
      const c = chosen.get(m.platformId);
      const rejected = needsDecision(m) && decisions[m.platformId]?.action === "reject";
      const status = c ? "confirmed" : rejected ? "rejected" : m.status === "claimed" ? "flagged" : m.readError ? "unreadable" : "none";
      const shown = m.pick ?? m.candidates[0] ?? null;
      const ref = c ?? shown;
      ins.run(bizId, m.platformId, status, ref?.listingId ?? null, ref?.score ?? null, ref ? JSON.stringify(ref.breakdown) : null, JSON.stringify(m.candidates), c ? nowTs() : null, m.reason, "onboarding");
    }
    // the onboarding trace now belongs to the new business
    d.prepare("UPDATE runs SET business_id=? WHERE id=?").run(bizId, draft.runId);
    d.prepare("UPDATE trace SET business_id=? WHERE run_id=?").run(bizId, draft.runId);
  });
  tx();
  for (const m of draft.sites) {
    const c = chosen.get(m.platformId);
    if (needsDecision(m)) logEvent(draft.runId, "owner_confirm", { site: m.platformId }, c ? `owner confirmed ${c.listingId} (score ${c.score})` : "owner rejected the match");
  }
  logEvent(draft.runId, "create_business", { business: bizId }, `business created (pending first login); ${chosen.size} listing(s) confirmed`);
  audit(bizId, "owner", "onboarding-confirm", null, null, { confirmed: [...chosen.values()].map((c) => c.listingId) });
  return { pin: formatPin(pin), businessName: draft.details.name, expiresInMinutes: Math.round(PENDING_BUSINESS_TTL_MS / 60000), confirmed: chosen.size, hoursAssumed };
}

/* ───────────── 3. activation: first successful login claims the confirmed listings ───────────── */

const inflight = new Map<string, Promise<boolean>>();

export function activateBusiness(bizId: string): Promise<boolean> {
  const running = inflight.get(bizId);
  if (running) return running;
  const p = doActivate(bizId).finally(() => inflight.delete(bizId));
  inflight.set(bizId, p);
  return p;
}

async function doActivate(bizId: string): Promise<boolean> {
  const biz = findBusiness(bizId);
  if (!biz) return false;
  if (biz.status === "active") return true;
  if (biz.createdAt && Date.parse(biz.createdAt) < Date.now() - PENDING_BUSINESS_TTL_MS) { deleteBusinessData(bizId); return false; }
  const d = getDb();
  const run = (d.prepare("SELECT id FROM runs WHERE business_id=? AND kind='onboarding'").get(bizId) as { id: string } | undefined)?.id ?? eventRun(bizId, "onboarding");
  const platforms = new Map(listPlatforms().map((p) => [p.id, p]));
  const rows = d.prepare("SELECT * FROM site_matches WHERE business_id=? AND status='confirmed'").all(bizId) as { platform_id: string; listing_id: string }[];
  for (const r of rows) {
    const p = platforms.get(r.platform_id)!;
    const t0 = performance.now();
    let code = 0;
    try {
      // mock stand-in for "claim this business" — real sites verify ownership (OTP / postcard) and that step is always the human's
      const resp = await fetch(`${baseUrl()}/mock/${p.slug}/claim/${r.listing_id}`, { method: "POST", headers: { "content-type": "application/json", ...mockAuthHeaders(biz.mockAccount) }, body: "{}" });
      code = resp.status;
    } catch { code = 0; }
    if (code === 200) {
      linkListing(bizId, p.id, p.slug, r.listing_id, "matched");
      d.prepare("UPDATE site_matches SET status='linked' WHERE business_id=? AND platform_id=?").run(bizId, p.id);
      logEvent(run, "claim_listing", { site: p.id, listing: r.listing_id }, `claimed ${r.listing_id} on ${p.name} for this business`, performance.now() - t0);
    } else {
      d.prepare("UPDATE site_matches SET status='flagged', note=? WHERE business_id=? AND platform_id=?")
        .run(code === 409 ? "someone else claimed this listing while you were setting up — it was not linked" : `the site did not accept the claim (HTTP ${code || "no answer"}) — it was not linked`, bizId, p.id);
      logEvent(run, "claim_listing", { site: p.id, listing: r.listing_id }, `claim refused (HTTP ${code || "no answer"}); not linked`, performance.now() - t0);
    }
  }
  d.prepare("UPDATE business SET status='active' WHERE id=?").run(bizId);
  audit(bizId, "system", "onboarding-activate", null, null, { linked: rows.length });
  return true;
}
