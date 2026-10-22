/**
 * All matching constants in ONE place. Tune here; nothing else in the code hard-codes them.
 *
 * score(0-100) = phone*40% + address*35% + name*25%   (each field similarity is 0..1)
 */
export const WEIGHTS = { phone: 40, address: 35, name: 25 } as const;

export const THRESHOLDS = {
  /** top score at or above this (and a clear margin) -> proposed automatically (the owner still has to confirm) */
  HIGH: 75,
  /** below this -> "no listing found on this site" */
  LOW: 45,
  /** the top score must beat the runner-up on the same site by at least this much to be proposed automatically */
  MARGIN: 15,
} as const;

/** How many candidates the owner sees per site when they have to choose. */
export const MAX_CANDIDATES_SHOWN = 3;

/** Inside the address score: street-level words matter more than the (often shared) postcode. */
export const ADDRESS_MIX = { tokens: 0.7, pincode: 0.3 } as const;
/** Inside the name score. */
export const NAME_MIX = { jaroWinkler: 0.5, tokens: 0.5 } as const;
/** Two words count as "the same word" in a name when their Jaro-Winkler similarity is at least this. */
export const NAME_TOKEN_MATCH = 0.88;
/** Same idea for address words (typos), only applied to words of 5+ letters. */
export const ADDRESS_TOKEN_MATCH = 0.92;

/** Words ignored when comparing business names. */
export const NAME_STOPWORDS = new Set(["and", "the", "of", "co", "company", "pvt", "ltd", "llp", "private", "limited", "inc"]);

/** Onboarding housekeeping. */
export const PENDING_BUSINESS_TTL_MS = 30 * 60_000; // a business whose PIN was never used is discarded after this
export const DRAFT_TTL_MS = 30 * 60_000;
export const MAX_BUSINESSES = 200; // stops anonymous sign-ups from filling a free-tier database
