import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setClockOverride } from "../src/core/clock.js";
import { resetAndSeed } from "../src/core/seed.js";
import { addException, getFieldByKey, listExceptions } from "../src/core/store.js";
import { approveAllForPlatform, execute, scan } from "../src/agent/service.js";
import { acceptDraft, clearHoliday, foresight, loadHolidays } from "../src/foresight/index.js";
import { startTestServer } from "./helpers.js";
import { BUSINESS_ID as B } from "../src/core/seed.js";

let s: Awaited<ReturnType<typeof startTestServer>>;
beforeAll(async () => { s = await startTestServer(); });
afterAll(async () => { setClockOverride(null); await s.close(); });
beforeEach(() => { setClockOverride(null); resetAndSeed(); });

describe("holiday data", () => {
  it("every holiday is unverified and has a region", () => {
    const hs = loadHolidays();
    expect(hs.length).toBeGreaterThan(12);
    expect(hs.every((h) => h.verified === false && h.region.length > 0)).toBe(true);
  });
});

describe("foresight @ 2026-10-21", () => {
  it("scans 90 days ahead only", async () => {
    const f = await foresight(B);
    expect(f.today).toBe("2026-10-21");
    expect(f.holidays.map((h) => h.holiday.date).every((d) => d <= "2027-01-19")).toBe(true);
    expect(f.holidays.some((h) => h.holiday.id === "hol_2027_republic")).toBe(false); // 97 days away
  });
  it("status: Diwali saved but not on every site yet (site B differs), others not set", async () => {
    const f = await foresight(B);
    const diwali = f.holidays.find((h) => h.holiday.id === "hol_2026_diwali")!;
    expect(diwali.chip).toBe("SET_PARTIAL");
    expect(diwali.chipText).toBe("Saved — not on all sites yet");
    expect(diwali.setText).toBe("Open 10:00 AM – 2:00 PM");
    expect([diwali.sitesShowing, diwali.sitesTotal]).toEqual([4, 5]);
    const xmas = f.holidays.find((h) => h.holiday.id === "hol_2026_christmas")!;
    expect(xmas.chipText).toBe("Not set");
    expect(xmas.setText).toBeNull();
  });
  it("TC6 core: alerts for an upcoming holiday with no exception (30/14/7 milestones)", async () => {
    const f = await foresight(B);
    const a = f.alerts.find((x) => x.holidayId === "hol_2026_bhaidooj")!;
    expect(a).toBeTruthy();
    expect(a.chip).toBe("NOT_SET");
    expect(a.milestone).toBe(30);
    expect(f.alerts.some((x) => x.holidayId === "hol_2026_christmas")).toBe(false); // 65 days: listed, no alert yet
    setClockOverride("2026-11-04"); // Bhai Dooj in 7 days
    const g = await foresight(B);
    expect(g.alerts.find((x) => x.holidayId === "hol_2026_bhaidooj")!.milestone).toBe(7);
  });
  it("holidays come soonest first and there is no readiness score any more", async () => {
    const f = await foresight(B);
    expect(f.holidays[0].holiday.id).toBe("hol_2026_diwali");
    expect(f.holidays.map((h) => h.holiday.date)).toEqual(f.holidays.map((h) => h.holiday.date).slice().sort());
    expect(f).not.toHaveProperty("next");
    expect(f).not.toHaveProperty("formula");
  });
  it("draft never applies by itself; accepting it goes through approval", async () => {
    const before = listExceptions(B).length;
    await scan(B);
    expect(listExceptions(B).length).toBe(before); // nothing created by scanning/foresight
    const ex = acceptDraft(B, "hol_2026_bhaidooj");
    expect(ex.source).toBe("foresight");
    await scan(B);
    const key = `holiday:${ex.id}`;
    expect(getFieldByKey(B, "site_a", key)!.state).toBe("PROPOSED");
    await execute(B); // no approval yet -> still nothing sent
    expect(getFieldByKey(B, "site_a", key)!.state).toBe("PROPOSED");
    approveAllForPlatform(B, "site_a");
    await execute(B);
    expect(getFieldByKey(B, "site_a", key)!.state).toBe("VERIFIED");
    const f = await foresight(B);
    expect(f.holidays.find((h) => h.holiday.id === "hol_2026_bhaidooj")!.chip).toBe("SET_PARTIAL"); // other sites not yet fixed
  });
  it("after the Diwali fix the status turns Set on all sites and its alert goes away", async () => {
    await scan(B);
    approveAllForPlatform(B, "site_b");
    await execute(B);
    const f = await foresight(B);
    const d = f.holidays.find((h) => h.holiday.id === "hol_2026_diwali")!;
    expect(d.chip).toBe("SET_ALL");
    expect(d.chipText).toBe("Set on all sites");
    expect(f.alerts.some((a) => a.holidayId === "hol_2026_diwali")).toBe(false);
  });
});

describe("owner chooses hours for a holiday", () => {
  const active = () => listExceptions(B).filter((e) => e.status === "active");

  it("editing special hours updates the exception already set for that day (no duplicate)", () => {
    const before = active();
    const diwali = before.find((e) => e.start === "2026-11-08")!;
    const ex = acceptDraft(B, "hol_2026_diwali", { kind: "special", open: "11:00", close: "15:30" });
    expect(ex.id).toBe(diwali.id);
    expect(active().length).toBe(before.length);
    const now = active().find((e) => e.id === diwali.id)!;
    expect([now.open, now.close, now.source]).toEqual(["11:00", "15:30", "foresight"]);
  });

  it("Closed clears the times; Special hours falls back to the suggestion when none are given", () => {
    const closed = acceptDraft(B, "hol_2026_christmas", { kind: "closed" });
    expect([closed.kind, closed.open, closed.close]).toEqual(["closed", null, null]);
    const special = acceptDraft(B, "hol_2026_bhaidooj", { kind: "special" });
    expect([special.open, special.close]).toEqual(["10:00", "14:00"]);
  });

  it("rejects bad times with a 400-style error and saves nothing", () => {
    const before = active().length;
    for (const bad of [{ open: "14:00", close: "10:00" }, { open: "10:00", close: "10:00" }, { open: "25:00", close: "26:00" }, { open: "9am", close: "2pm" }]) {
      try { acceptDraft(B, "hol_2026_bhaidooj", { kind: "special", ...bad }); throw new Error("should have thrown"); }
      catch (e: any) { expect(e.status).toBe(400); }
    }
    expect(() => acceptDraft(B, "hol_2026_bhaidooj", { kind: "weird" as any })).toThrow();
    expect(active().length).toBe(before);
  });

  it("Open as usual cancels the saved exception; clearing something not set is a harmless no-op", async () => {
    expect(clearHoliday(B, "hol_2026_christmas")).toEqual({ ok: true, cleared: false });
    expect(clearHoliday(B, "hol_2026_diwali")).toEqual({ ok: true, cleared: true });
    expect(active().some((e) => e.start === "2026-11-08")).toBe(false);
    const f = await foresight(B);
    expect(f.holidays.find((h) => h.holiday.id === "hol_2026_diwali")!.chip).toBe("NOT_SET");
  });

  it("a day inside a longer closure typed in Edit & Ask is not editable here", async () => {
    addException(B, { start: "2026-12-24", end: "2026-12-26", kind: "closed", open: null, close: null, reason: "winter break", source: "owner" });
    const f = await foresight(B);
    expect(f.holidays.find((h) => h.holiday.id === "hol_2026_christmas")!.editable).toBe(false);
    expect(() => acceptDraft(B, "hol_2026_christmas", { kind: "closed" })).toThrow(/longer closure/);
    expect(() => clearHoliday(B, "hol_2026_christmas")).toThrow(/longer closure/);
  });

  it("nothing reaches a site until approved: editing hours and Open as usual only create proposals", async () => {
    const diwaliId = active().find((e) => e.start === "2026-11-08")!.id;
    const key = `holiday:${diwaliId}`;
    acceptDraft(B, "hol_2026_diwali", { kind: "special", open: "11:00", close: "15:30" });
    await scan(B);
    expect(getFieldByKey(B, "site_a", key)!.state).toBe("PROPOSED"); // site A still shows 10-14
    await execute(B); // no approval clicked
    expect(getFieldByKey(B, "site_a", key)!.state).toBe("PROPOSED");
    clearHoliday(B, "hol_2026_diwali");
    await scan(B);
    expect(getFieldByKey(B, "site_a", key)!.state).toBe("PROPOSED"); // proposes removing it from the listing
    await execute(B);
    expect(getFieldByKey(B, "site_a", key)!.state).toBe("PROPOSED");
  });
});
