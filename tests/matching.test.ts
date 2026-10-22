import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUSINESS, DECOY, GREEN_LEAF } from "../src/core/seed.js";
import { THRESHOLDS, WEIGHTS } from "../src/onboarding/config.js";
import { discoverSite, matchAllSites } from "../src/onboarding/discover.js";
import { addressSim, jaroWinkler, nameSim, nameTokens, phoneKey, phoneSim } from "../src/onboarding/similarity.js";
import { decideSite, scoreListing, type Candidate } from "../src/onboarding/score.js";
import { listPlatforms } from "../src/core/store.js";
import { startTestServer } from "./helpers.js";

const sunrise = { name: BUSINESS.name, address: BUSINESS.address, phone: BUSINESS.phone };
const trueListing = { name: BUSINESS.name, address: BUSINESS.address, phone: BUSINESS.phone };
const lookAlike = { name: DECOY.name, address: DECOY.address, phone: DECOY.phone };

describe("config", () => {
  it("weights add up to 100 and thresholds are sane", () => {
    expect(WEIGHTS.phone + WEIGHTS.address + WEIGHTS.name).toBe(100);
    expect(THRESHOLDS.LOW).toBeLessThan(THRESHOLDS.HIGH);
    expect(THRESHOLDS.MARGIN).toBeGreaterThan(0);
  });
});

describe("phone matching", () => {
  it.each([
    ["+91 90000 00001", "090000 00001"], ["+919000000001", "9000000001"], ["0091-90000-00001", "(90000) 00001"], ["91 9000000001", "+91-90000-00001"],
  ])("%s == %s", (a, b) => { expect(phoneKey(a)).toBe("9000000001"); expect(phoneSim(a, b)).toBe(1); });
  it("different numbers and missing numbers give no signal", () => {
    expect(phoneSim("+91 90000 00001", "+91 90000 00099")).toBe(0);
    expect(phoneSim("+91 90000 00001", null)).toBe(0);
    expect(phoneSim("12", "12")).toBe(0);
  });
});

describe("address matching", () => {
  it("abbreviations, case and punctuation do not matter", () => {
    expect(addressSim("42 Marigold Lane, Koregaon Park, Pune, Maharashtra 411001", "42 MARIGOLD LN., koregaon park, Pune, MH - 411001")).toBeCloseTo(1, 5);
  });
  it("a missing state still matches strongly, a different street does not", () => {
    expect(addressSim(GREEN_LEAF.address, "8 Lotus St., Baner, Pune - 411045")).toBeGreaterThan(0.9);
    expect(addressSim(BUSINESS.address, DECOY.address)).toBeLessThan(0.6);
  });
  it("same pincode alone is not enough", () => {
    expect(addressSim("1 Foo Street, Pune 411001", "99 Bar Avenue, Pune 411001")).toBeLessThan(0.6);
  });
  it("a typo in a long word is tolerated", () => {
    expect(addressSim("42 Marigold Lane, Koregaon Park, Pune 411001", "42 Marigold Lane, Koregoan Park, Pune 411001")).toBeGreaterThan(0.9);
  });
});

describe("name matching", () => {
  it("normalises case, accents, & and legal words", () => {
    expect(nameTokens("Green Leaf Café Pvt. Ltd.")).toEqual(["green", "leaf", "cafe"]);
    expect(nameSim("Sunrise Sweets & Bakery", "SUNRISE SWEETS AND BAKERY")).toBeGreaterThan(0.99);
    expect(nameSim("Green Leaf Cafe", "Green Leaf Café")).toBeGreaterThan(0.99);
  });
  it("small differences stay high, different names go low", () => {
    expect(nameSim("Jaggis", "Jaggi")).toBeGreaterThan(0.85);
    expect(nameSim("Sunrise Sweets & Bakery", "Sunrise Sweet House")).toBeLessThan(0.85);
    expect(nameSim("Sunrise Sweets & Bakery", "Moonlight Pharmacy")).toBeLessThan(0.5);
  });
  it("Jaro-Winkler sanity", () => {
    expect(jaroWinkler("martha", "marhta")).toBeCloseTo(0.961, 2);
    expect(jaroWinkler("abc", "xyz")).toBe(0);
  });
});

describe("true listing vs look-alike (Sunrise Sweet House)", () => {
  it("the true listing scores 100, the look-alike scores clearly lower and below LOW", () => {
    const t = scoreListing(sunrise, trueListing);
    const l = scoreListing(sunrise, lookAlike);
    expect(t.score).toBe(100);
    expect(l.score).toBeLessThan(THRESHOLDS.LOW);
    expect(t.score - l.score).toBeGreaterThan(THRESHOLDS.MARGIN * 2);
    expect(l.breakdown.phone.points).toBe(0);
    expect(l.breakdown.phone.why).toBe("different phone number");
  });
  it("the breakdown explains every field", () => {
    const b = scoreListing(sunrise, lookAlike).breakdown;
    expect(Object.keys(b)).toEqual(["phone", "address", "name"]);
    for (const f of Object.values(b)) { expect(f.why.length).toBeGreaterThan(3); expect(f.points).toBeLessThanOrEqual(f.max); }
  });
  it("formatting-only differences still score 100 (TC2 situation)", () => {
    const s = scoreListing(sunrise, { name: "SUNRISE SWEETS AND BAKERY", address: "42 Marigold Ln., Koregaon Park, Pune, MH - 411001", phone: "090000 00001" });
    expect(s.score).toBeGreaterThanOrEqual(99);
  });
  it("partial matches land in the middle", () => {
    const oldPhone = scoreListing(sunrise, { ...trueListing, phone: "+91 90000 00099" }); // moved phone only (site D situation)
    expect(oldPhone.score).toBe(60);
    expect(oldPhone.score).toBeGreaterThanOrEqual(THRESHOLDS.LOW);
    expect(oldPhone.score).toBeLessThan(THRESHOLDS.HIGH);
    const noName = scoreListing(sunrise, { name: "Completely Different Name", address: BUSINESS.address, phone: BUSINESS.phone });
    expect(noName.score).toBeGreaterThanOrEqual(THRESHOLDS.HIGH); // phone + address are enough on their own
  });
});

describe("decision rules", () => {
  const cand = (id: string, score: number, claimed = false): Candidate => ({
    platformId: "site_x", listingId: id, name: "n", address: "a", phone: "p", claimed, publicPath: "/x", score,
    breakdown: { phone: { similarity: 0, points: 0, max: 40, why: "" }, address: { similarity: 0, points: 0, max: 35, why: "" }, name: { similarity: 0, points: 0, max: 25, why: "" } },
  });
  it("auto: top >= HIGH and ahead of the runner-up by MARGIN", () => {
    const d = decideSite([cand("a", 100), cand("b", 37)]);
    expect(d.status).toBe("auto"); expect(d.pick!.listingId).toBe("a");
  });
  it("exactly at the thresholds", () => {
    expect(decideSite([cand("a", THRESHOLDS.HIGH)]).status).toBe("auto");
    expect(decideSite([cand("a", THRESHOLDS.HIGH - 0.1)]).status).toBe("ask");
    expect(decideSite([cand("a", THRESHOLDS.HIGH), cand("b", THRESHOLDS.HIGH - THRESHOLDS.MARGIN)]).status).toBe("auto");
    expect(decideSite([cand("a", THRESHOLDS.HIGH), cand("b", THRESHOLDS.HIGH - THRESHOLDS.MARGIN + 0.1)]).status).toBe("ask");
    expect(decideSite([cand("a", THRESHOLDS.LOW)]).status).toBe("ask");
    expect(decideSite([cand("a", THRESHOLDS.LOW - 0.1)]).status).toBe("none");
  });
  it("margin too small -> ask, even with two high scores", () => {
    const d = decideSite([cand("a", 95), cand("b", 90)]);
    expect(d.status).toBe("ask");
    expect(d.candidates.map((c) => c.listingId)).toEqual(["a", "b"]);
  });
  it("below LOW or empty -> none", () => {
    expect(decideSite([cand("a", 30)]).status).toBe("none");
    expect(decideSite([]).status).toBe("none");
  });
  it("a good match that someone else owns is flagged, never auto/ask", () => {
    const d = decideSite([cand("a", 100, true), cand("b", 20)]);
    expect(d.status).toBe("claimed");
  });
  it("candidates are sorted, limited to 3", () => {
    const d = decideSite([cand("a", 50), cand("b", 80), cand("c", 60), cand("d", 55)]);
    expect(d.candidates.map((c) => c.listingId)).toEqual(["b", "c", "d"]);
  });
});

describe("matching against the five mock sites", () => {
  let s: Awaited<ReturnType<typeof startTestServer>>;
  beforeAll(async () => { s = await startTestServer(); });
  afterAll(async () => { await s.close(); });

  it("Green Leaf Cafe: auto on A and C, look-alike only on B, claimed on D, nothing on E", async () => {
    const m = await matchAllSites({ name: GREEN_LEAF.name, address: GREEN_LEAF.address, phone: GREEN_LEAF.phone });
    const by = Object.fromEntries(m.map((x) => [x.platformId, x]));
    expect(by.site_a).toMatchObject({ status: "auto", pick: { listingId: "LST-A-4001", claimed: false } });
    expect(by.site_a.pick!.score).toBe(100);
    expect(by.site_c).toMatchObject({ status: "auto", pick: { listingId: "LST-C-4001" } });
    expect(by.site_c.pick!.score).toBeGreaterThanOrEqual(95);
    expect(by.site_b.status).toBe("none"); // "Green Leaf Cafe & Bakery" in Kothrud is a different business
    expect(by.site_b.candidates[0].listingId).toBe("LST-B-4002");
    expect(by.site_b.candidates[0].score).toBeLessThan(THRESHOLDS.LOW);
    expect(by.site_d).toMatchObject({ status: "claimed", pick: { listingId: "LST-D-4001", claimed: true } });
    expect(by.site_e.status).toBe("none");
    expect(m.every((x) => x.readError === null)).toBe(true);
  });
  it("entering Sunrise's own details: every real Sunrise listing is claimed -> flagged; decoys never win", async () => {
    const m = await matchAllSites(sunrise);
    for (const x of m) {
      expect(x.status).toBe("claimed");
      expect(x.pick!.listingId).toMatch(/-1001$/);
      expect(x.candidates.find((c) => c.listingId.endsWith("-2002"))!.score).toBeLessThan(THRESHOLDS.LOW);
    }
  });
  it("a site that cannot be read is reported, not guessed", async () => {
    const bad = await discoverSite({ id: "site_zz", name: "Nowhere", slug: "zz" }, sunrise);
    expect(bad.status).toBe("none");
    expect(bad.readError).toBeTruthy();
    expect(listPlatforms()).toHaveLength(5);
  });
  it("reads each site's index plus every listing page", async () => {
    const a = await discoverSite(listPlatforms()[0], sunrise);
    expect(a.candidates.length).toBe(3); // shown top 3 of: Sunrise, Sunrise Sweet House, Green Leaf Cafe
  });
});
