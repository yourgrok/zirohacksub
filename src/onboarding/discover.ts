import { fetchPage, parseIndex, parsePublic } from "../agent/reader.js";
import { listPlatforms } from "../core/store.js";
import type { Platform } from "../core/types.js";
import { decideSite, scoreListing, type Candidate, type EnteredDetails, type SiteDecision } from "./score.js";

export interface SiteMatch extends SiteDecision {
  platformId: string;
  platformName: string;
  /** set when the site could not be read; the owner is told and no listing is created there */
  readError: string | null;
}

/** Read EVERY listing a site shows (including look-alikes) through the normal reader, then score each one. */
export async function discoverSite(platform: Platform, entered: EnteredDetails): Promise<SiteMatch> {
  try {
    const index = await fetchPage(`/mock/${platform.slug}/`);
    if (index.status !== 200) throw new Error(`index page returned HTTP ${index.status}`);
    const ids = parseIndex(index.html);
    const candidates = (await Promise.all(ids.map(async ({ listingId }): Promise<Candidate | null> => {
      const publicPath = `/mock/${platform.slug}/listing/${listingId}`;
      const page = await fetchPage(publicPath);
      if (page.status !== 200) return null;
      const pub = parsePublic(platform.slug, page.html);
      if (pub.listingId !== listingId) return null; // a page that does not carry its own id is not trusted
      const scored = scoreListing(entered, { name: pub.name, address: pub.address, phone: pub.phone });
      return { platformId: platform.id, listingId, name: pub.name, address: pub.address, phone: pub.phone, claimed: pub.claimState === "claimed", publicPath, ...scored };
    }))).filter((c): c is Candidate => !!c);
    return { platformId: platform.id, platformName: platform.name, readError: null, ...decideSite(candidates) };
  } catch (e) {
    return { platformId: platform.id, platformName: platform.name, readError: String((e as Error).message), status: "none", pick: null, candidates: [], runnerUp: null, reason: "this site could not be read, so nothing was matched here" };
  }
}

export async function matchAllSites(entered: EnteredDetails): Promise<SiteMatch[]> {
  return Promise.all(listPlatforms().map((p) => discoverSite(p, entered)));
}
