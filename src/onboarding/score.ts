import { THRESHOLDS, WEIGHTS, MAX_CANDIDATES_SHOWN } from "./config.js";
import { addressSim, nameSim, phoneSim } from "./similarity.js";

export interface EnteredDetails { name: string; address: string; phone: string }
export interface ListingFacts { name: string | null; address: string | null; phone: string | null }

export interface FieldScore { similarity: number; points: number; max: number; why: string }
export interface Breakdown { phone: FieldScore; address: FieldScore; name: FieldScore }
export interface Scored { score: number; breakdown: Breakdown }

const pct = (x: number) => `${Math.round(x * 100)}%`;
const round1 = (x: number) => Math.round(x * 10) / 10;

export function scoreListing(entered: EnteredDetails, l: ListingFacts): Scored {
  const p = phoneSim(entered.phone, l.phone);
  const a = addressSim(entered.address, l.address ?? "");
  const n = nameSim(entered.name, l.name ?? "");
  const breakdown: Breakdown = {
    phone: { similarity: p, max: WEIGHTS.phone, points: round1(p * WEIGHTS.phone), why: p === 1 ? "same phone number" : l.phone ? "different phone number" : "no phone number on the listing" },
    address: { similarity: a, max: WEIGHTS.address, points: round1(a * WEIGHTS.address), why: a >= 0.9 ? "same address" : a >= 0.5 ? `address partly matches (${pct(a)})` : `address is different (${pct(a)} alike)` },
    name: { similarity: n, max: WEIGHTS.name, points: round1(n * WEIGHTS.name), why: n >= 0.9 ? "same or almost the same name" : n >= 0.6 ? `similar name (${pct(n)})` : `name is different (${pct(n)} alike)` },
  };
  const score = round1(breakdown.phone.points + breakdown.address.points + breakdown.name.points);
  return { score, breakdown };
}

/* ───────────── decision rules ───────────── */

export interface Candidate extends ListingFacts, Scored {
  platformId: string;
  listingId: string;
  /** someone's account already owns this listing (TC3 behaviour: never linked, flagged instead) */
  claimed: boolean;
  publicPath: string;
}

/** auto  = proposed automatically (owner still confirms)     ask = owner must choose or reject
 *  none  = no listing found on this site                     claimed = good match but someone else owns it -> flag */
export type SiteStatus = "auto" | "ask" | "none" | "claimed";

export interface SiteDecision {
  status: SiteStatus;
  pick: Candidate | null;
  /** the best few, highest score first (what the owner sees) */
  candidates: Candidate[];
  runnerUp: number | null;
  reason: string;
}

export function decideSite(all: Candidate[]): SiteDecision {
  const sorted = [...all].sort((x, y) => y.score - x.score);
  const top = sorted[0] ?? null;
  const second = sorted[1] ?? null;
  const shown = sorted.slice(0, MAX_CANDIDATES_SHOWN);
  const runnerUp = second ? second.score : null;
  if (!top || top.score < THRESHOLDS.LOW) {
    return { status: "none", pick: null, candidates: shown, runnerUp, reason: top ? `best match scored only ${top.score} (below ${THRESHOLDS.LOW}) — no listing of yours found here` : "no listings on this site" };
  }
  if (top.claimed) {
    return { status: "claimed", pick: top, candidates: shown, runnerUp, reason: `looks like your listing (score ${top.score}) but it is already claimed by another account — it will not be linked or edited` };
  }
  const margin = top.score - (second?.score ?? 0);
  if (top.score >= THRESHOLDS.HIGH && margin >= THRESHOLDS.MARGIN) {
    return { status: "auto", pick: top, candidates: shown, runnerUp, reason: `strong match (score ${top.score}, ${round1(margin)} ahead of the next listing)` };
  }
  const why = top.score < THRESHOLDS.HIGH ? `score ${top.score} is between ${THRESHOLDS.LOW} and ${THRESHOLDS.HIGH}` : `score ${top.score} is only ${round1(margin)} ahead of the next listing (needs ${THRESHOLDS.MARGIN})`;
  return { status: "ask", pick: top, candidates: shown, runnerUp, reason: `not sure: ${why} — please choose` };
}
