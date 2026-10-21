import { describe, expect, it } from "vitest";
import { loadHolidays } from "../src/foresight/index.js";
import { RECORD_HOURS } from "../src/core/seed.js";
import { parseChange, type NlContext, type NlResult } from "../src/nl/parse.js";

const ctx = (over: Partial<NlContext> = {}): NlContext => ({
  today: "2026-10-21", // Wednesday
  hours: RECORD_HOURS,
  exceptions: [],
  holidays: loadHolidays().map((h) => ({ id: h.id, name: h.name, date: h.date })),
  ...over,
});
const ok = (r: NlResult) => { if (r.status !== "ok") throw new Error(`expected ok, got ${JSON.stringify(r)}`); return r.intent; };

describe("plain-language closures (deterministic parser)", () => {
  it("1. 'we are closed on 26th December'", () => {
    expect(ok(parseChange("we are closed on 26th December", ctx()))).toMatchObject({ action: "closed", start: "2026-12-26", end: "2026-12-26" });
  });
  it("2. 'tomorrow the shop is closed'", () => {
    expect(ok(parseChange("tomorrow the shop is closed", ctx()))).toMatchObject({ action: "closed", start: "2026-10-22" });
  });
  it("3. 'closed from 24 to 26 Dec' is a date range, not a time range", () => {
    expect(ok(parseChange("closed from 24 to 26 Dec", ctx()))).toMatchObject({ action: "closed", start: "2026-12-24", end: "2026-12-26", open: null });
  });
  it("4. 'closing early at 3pm this Friday' keeps normal opening time", () => {
    expect(ok(parseChange("closing early at 3pm this Friday", ctx()))).toMatchObject({ action: "special", start: "2026-10-23", open: "09:00", close: "15:00" });
  });
  it("5. 'open 10 to 2 on Diwali' resolves the festival date and pm", () => {
    expect(ok(parseChange("open 10 to 2 on Diwali", ctx()))).toMatchObject({ action: "special", start: "2026-11-08", open: "10:00", close: "14:00", reason: "Diwali (Lakshmi Puja)" });
  });
  it("6. 'closed next Monday for a wedding' captures the reason", () => {
    expect(ok(parseChange("closed next Monday for a wedding", ctx()))).toMatchObject({ action: "closed", start: "2026-10-26", reason: "wedding" });
  });
  it("7. 'ignore that, we are open on the 26th' reopens the saved Dec 26 closure", () => {
    const ex = { id: "ex_1", start: "2026-12-26", end: "2026-12-26", kind: "closed", open: null, close: null, reason: null, source: "natural-language", status: "active" } as const;
    expect(ok(parseChange("ignore that, we are open on the 26th", ctx({ exceptions: [ex] })))).toMatchObject({ action: "reopen", start: "2026-12-26", targetExceptionId: "ex_1" });
  });
  it("8. reopen with nothing saved asks one question", () => {
    const r = parseChange("ignore that, we are open on the 26th", ctx());
    expect(r.status).toBe("ask");
  });
  it("9. date range with explicit year", () => {
    expect(ok(parseChange("shop shut from 5th to 7th January 2027", ctx()))).toMatchObject({ action: "closed", start: "2027-01-05", end: "2027-01-07" });
  });
  it("10. 'closed 24 Dec - 26 Dec'", () => {
    expect(ok(parseChange("closed 24 Dec - 26 Dec", ctx()))).toMatchObject({ start: "2026-12-24", end: "2026-12-26" });
  });
  it("11. explicit time range with am/pm", () => {
    expect(ok(parseChange("open 9am-1pm on 30 Dec", ctx()))).toMatchObject({ action: "special", start: "2026-12-30", open: "09:00", close: "13:00" });
  });
  it("12. relative: day after tomorrow", () => {
    expect(ok(parseChange("closed the day after tomorrow", ctx()))).toMatchObject({ start: "2026-10-23" });
  });
  it("13. weekend means Saturday and Sunday", () => {
    expect(ok(parseChange("closed this weekend", ctx()))).toMatchObject({ start: "2026-10-24", end: "2026-10-25" });
  });
  it("14. past date -> one clarifying question", () => {
    const r = parseChange("closed yesterday", ctx());
    expect(r.status).toBe("ask");
    expect(r.status === "ask" && r.question).toMatch(/already passed/);
  });
  it("15. just-passed day without a year -> asks whether next year was meant", () => {
    const r = parseChange("closed on 12 Oct", ctx()); // 9 days ago
    expect(r.status).toBe("ask");
    expect(r.status === "ask" && r.question).toMatch(/just passed.*12 Oct 2027/);
  });
  it("15b. a date that passed long ago without a year means the next occurrence", () => {
    expect(ok(parseChange("closed on 3 Oct", ctx()))).toMatchObject({ start: "2027-10-03" });
  });
  it("16. no date -> asks which date", () => {
    const r = parseChange("the shop is closed", ctx());
    expect(r).toEqual({ status: "ask", question: "Which date (or dates) is this for?" });
  });
  it("17. date but no action -> asks closed or special", () => {
    const r = parseChange("26th December", ctx());
    expect(r.status).toBe("ask");
    expect(r.status === "ask" && r.question).toMatch(/closed, or special/);
  });
  it("18. ambiguous festival -> asks which Eid", () => {
    const r = parseChange("closed on Eid", ctx({ today: "2027-02-01" }));
    expect(r.status).toBe("ask");
    expect(r.status === "ask" && r.question).toMatch(/Eid ul-Fitr.*Eid al-Adha/);
  });
  it("19. closing early on a day the shop is normally closed asks for hours", () => {
    const c = ctx({ hours: { ...RECORD_HOURS, sun: null } });
    const r = parseChange("closing early at 1pm this Sunday", c);
    expect(r.status).toBe("ask");
  });
  it("20. empty text -> empty", () => { expect(parseChange("   ", ctx())).toEqual({ status: "empty" }); });
  it("21. chips expose action, resolved date, time and reason", () => {
    const r = parseChange("open 10 to 2 on Diwali", ctx());
    expect(r.status === "ok" && r.chips.map((c) => c.label)).toEqual(["Action", "Date", "Time", "Reason"]);
    expect(r.status === "ok" && r.chips[1].value).toBe("Sun 8 Nov 2026");
  });
  it("22. DEMO_NOW changes the resolution", () => {
    expect(ok(parseChange("tomorrow the shop is closed", ctx({ today: "2026-12-31" })))).toMatchObject({ start: "2027-01-01" });
  });
});
