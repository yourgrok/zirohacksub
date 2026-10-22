import { getBusiness, getPlatformListing, listFields, listPlatforms } from "../core/store.js";

export interface ClaimDraft {
  platformId: string; platform: string; listingId: string; listingPath: string;
  subject: string; body: string; steps: string[]; blockedFields: string[];
}

/**
 * For every listing we may not edit, the agent does the paperwork it is allowed to do: a ready-to-send request and the manual steps.
 * It never sends anything and never touches OTP / CAPTCHA / phone or postcard verification: those stay with the owner.
 */
export function buildClaimDrafts(bizId: string): ClaimDraft[] {
  const b = getBusiness(bizId);
  const names = new Map(listPlatforms().map((p) => [p.id, p.name]));
  const flagged = new Map<string, string[]>();
  for (const f of listFields(bizId)) if (f.state === "FLAGGED_NOT_OWNER") flagged.set(f.platform_id, [...(flagged.get(f.platform_id) ?? []), f.label]);
  const out: ClaimDraft[] = [];
  for (const [pid, labels] of flagged) {
    const l = getPlatformListing(bizId, pid);
    const platform = names.get(pid) ?? pid;
    const short = platform.replace(/ \(.*\)/, "");
    out.push({
      platformId: pid, platform, listingId: l.listingId, listingPath: l.publicPath, blockedFields: labels,
      subject: `Ownership request for listing ${l.listingId} (${b.name})`,
      body: `Hello ${short} support team,\n\nI am the owner of ${b.name}. The listing ${l.listingId} on your site is currently managed by another account, so I cannot correct its details (${labels.join(", ")}).\n\nCorrect details for my business:\n- Name: ${b.name}\n- Address: ${b.address}\n- Phone: ${b.phone}\n\nPlease tell me how I can verify ownership and take over this listing, or remove the other account's access if it is not mine.\n\nThank you,\nOwner of ${b.name}`,
      steps: [
        `Open the ${short} listing page and press "Claim this business" (or send the message above to ${short} support).`,
        "Finish the site's own check yourself (a code, a phone call or a postcard). The agent never does this step for you.",
        "Come back here and press Scan listings. The agent will see you manage the listing and propose the fixes.",
      ],
    });
  }
  return out;
}
