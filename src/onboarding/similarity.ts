import { normaliseAddress } from "../core/normalise.js";
import { ADDRESS_MIX, ADDRESS_TOKEN_MATCH, NAME_MIX, NAME_STOPWORDS, NAME_TOKEN_MATCH } from "./config.js";

/* ───────────── phone ───────────── */

/** digits only, +91 / 91 / 0 / 00 prefixes stripped. Two numbers are "the same" when their keys are equal. */
export function phoneKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("91") && d.length > 10) d = d.slice(2);
  if (d.startsWith("0") && d.length === 11) d = d.slice(1);
  return d.length >= 7 ? d : null;
}

export function phoneSim(a: string | null | undefined, b: string | null | undefined): number {
  const x = phoneKey(a), y = phoneKey(b);
  return x && y && x === y ? 1 : 0; // an exact match is a very strong signal; anything else is no signal
}

/* ───────────── Jaro-Winkler ───────────── */

export function jaro(a: string, b: string): number {
  if (a === b) return a.length ? 1 : 0;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array(a.length).fill(false), bm = new Array(b.length).fill(false);
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (!bm[j] && a[i] === b[j]) { am[i] = bm[j] = true; m++; break; }
    }
  }
  if (!m) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < a.length; i++) if (am[i]) { while (!bm[k]) k++; if (a[i] !== b[k]) t++; k++; }
  return (m / a.length + m / b.length + (m - t / 2) / m) / 3;
}

export function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  if (j < 0.7) return j;
  let p = 0;
  while (p < 4 && p < a.length && p < b.length && a[p] === b[p]) p++;
  return j + p * 0.1 * (1 - j);
}

/** Dice coefficient over two word lists where near-identical words (per `isSame`) count as the same word. */
function fuzzyDice(a: string[], b: string[], isSame: (x: string, y: string) => boolean): number {
  if (!a.length || !b.length) return 0;
  const used = new Set<number>();
  let m = 0;
  for (const x of a) {
    let best = -1, bestScore = 0;
    b.forEach((y, i) => {
      if (used.has(i) || !isSame(x, y)) return;
      const s = x === y ? 2 : jaroWinkler(x, y);
      if (s > bestScore) { bestScore = s; best = i; }
    });
    if (best >= 0) { used.add(best); m++; }
  }
  return (2 * m) / (a.length + b.length);
}

/* ───────────── name ───────────── */

export function nameTokens(raw: string): string[] {
  return raw
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // café -> cafe
    .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/).filter((t) => t && !NAME_STOPWORDS.has(t));
}

export function nameSim(a: string, b: string): number {
  const ta = nameTokens(a), tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  const jw = jaroWinkler(ta.join(" "), tb.join(" "));
  const tok = fuzzyDice(ta, tb, (x, y) => x === y || jaroWinkler(x, y) >= NAME_TOKEN_MATCH);
  return Math.min(1, NAME_MIX.jaroWinkler * jw + NAME_MIX.tokens * tok);
}

/* ───────────── address ───────────── */

function addressParts(raw: string): { pin: string | null; words: string[] } {
  const toks = normaliseAddress(raw).split(" ").filter(Boolean);
  const pin = toks.find((t) => /^\d{6}$/.test(t)) ?? null;
  return { pin, words: toks.filter((t) => t !== pin) };
}

export function addressSim(a: string, b: string): number {
  const x = addressParts(a), y = addressParts(b);
  const tokenSim = fuzzyDice(x.words, y.words, (p, q) => p === q || (p.length >= 5 && q.length >= 5 && jaroWinkler(p, q) >= ADDRESS_TOKEN_MATCH));
  if (x.pin && y.pin) return ADDRESS_MIX.tokens * tokenSim + ADDRESS_MIX.pincode * (x.pin === y.pin ? 1 : 0);
  return tokenSim; // no pincode on one side: do not punish, use the words only
}
