import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setClockOverride } from "../src/core/clock.js";
import { resetAndSeed } from "../src/core/seed.js";
import { getFieldByKey, listExceptions } from "../src/core/store.js";
import { approveAllForPlatform, execute, scan } from "../src/agent/service.js";
import { acceptDraft, foresight, loadHolidays } from "../src/foresight/index.js";
import { startTestServer } from "./helpers.js";

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
    const f = await foresight();
    expect(f.today).toBe("2026-10-21");
    expect(f.holidays.map((h) => h.holiday.date).every((d) => d <= "2027-01-19")).toBe(true);
    expect(f.holidays.some((h) => h.holiday.id === "hol_2027_republic")).toBe(false); // 97 days away
  });
  it("chips: Diwali mismatch on 1 site, others not set", async () => {
    const f = await foresight();
    const diwali = f.holidays.find((h) => h.holiday.id === "hol_2026_diwali")!;
    expect(diwali.chip).toBe("MISMATCH");
    expect(diwali.chipText).toBe("Mismatch on 1 site");
    expect(f.holidays.find((h) => h.holiday.id === "hol_2026_christmas")!.chipText).toBe("Not set");
  });
  it("TC6 core: alerts for an upcoming holiday with no exception (30/14/7 milestones)", async () => {
    const f = await foresight();
    const a = f.alerts.find((x) => x.holidayId === "hol_2026_bhaidooj")!;
    expect(a).toBeTruthy();
    expect(a.chip).toBe("NOT_SET");
    expect(a.milestone).toBe(30);
    expect(f.alerts.some((x) => x.holidayId === "hol_2026_christmas")).toBe(false); // 65 days: listed, no alert yet
    setClockOverride("2026-11-04"); // Bhai Dooj in 7 days
    const g = await foresight();
    expect(g.alerts.find((x) => x.holidayId === "hol_2026_bhaidooj")!.milestone).toBe(7);
  });
  it("readiness formula for next holiday", async () => {
    const f = await foresight();
    expect(f.next!.holiday.id).toBe("hol_2026_diwali");
    expect(f.next!.readiness).toBe(40 + 32 + 20);
    expect(f.formula).toMatch(/40/);
  });
  it("draft never applies by itself; accepting it goes through approval", async () => {
    const before = listExceptions().length;
    await scan();
    expect(listExceptions().length).toBe(before); // nothing created by scanning/foresight
    const ex = acceptDraft("hol_2026_bhaidooj");
    expect(ex.source).toBe("foresight");
    await scan();
    const key = `holiday:${ex.id}`;
    expect(getFieldByKey("site_a", key)!.state).toBe("PROPOSED");
    await execute(); // no approval yet -> still nothing sent
    expect(getFieldByKey("site_a", key)!.state).toBe("PROPOSED");
    approveAllForPlatform("site_a");
    await execute();
    expect(getFieldByKey("site_a", key)!.state).toBe("VERIFIED");
    const f = await foresight();
    expect(f.holidays.find((h) => h.holiday.id === "hol_2026_bhaidooj")!.chip).toBe("MISMATCH"); // other sites not yet fixed
  });
  it("after the Diwali fix the chip turns Consistent and readiness 100", async () => {
    await scan();
    approveAllForPlatform("site_b");
    await execute();
    const f = await foresight();
    expect(f.holidays.find((h) => h.holiday.id === "hol_2026_diwali")!.chip).toBe("CONSISTENT");
    expect(f.next!.readiness).toBe(100);
  });
});
