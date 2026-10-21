import { describe, expect, it } from "vitest";
import {
  canonHoliday, canonHours, displayPhone, formatHolidayLine, formatHours, hoursEqual,
  normaliseAddress, normalisePhone, parseHolidayLine, parseHoursText, parseTime, parseTimeRange,
  type HoursStyle, type HolidayStyle,
} from "../src/core/normalise.js";
import type { WeeklyHours } from "../src/core/types.js";

const H: WeeklyHours = {
  mon: { open: "09:00", close: "21:00" }, tue: { open: "09:00", close: "21:00" }, wed: { open: "09:00", close: "21:00" },
  thu: { open: "09:00", close: "21:00" }, fri: { open: "09:00", close: "21:00" }, sat: { open: "09:00", close: "21:00" },
  sun: { open: "10:00", close: "14:00" },
};

describe("phone", () => {
  it.each([
    ["+91 90000 00001", "+919000000001"],
    ["090000 00001", "+919000000001"],
    ["+91-90000-00001", "+919000000001"],
    ["(90000) 00001", "+919000000001"],
    ["919000000001", "+919000000001"],
    ["0091 9000000001", "+919000000001"],
  ])("%s -> %s", (raw, exp) => expect(normalisePhone(raw)).toBe(exp));
  it("rejects junk", () => {
    expect(normalisePhone("12345")).toBeNull();
    expect(normalisePhone("")).toBeNull();
  });
  it("different numbers stay different", () => {
    expect(normalisePhone("+91 90000 00099")).not.toBe(normalisePhone("+91 90000 00001"));
  });
  it("display", () => expect(displayPhone("+919000000001")).toBe("+91 90000 00001"));
});

describe("address", () => {
  it("ignores case, punctuation, abbreviations", () => {
    expect(normaliseAddress("42, Marigold Lane, Koregaon Park, Pune - 411001"))
      .toBe(normaliseAddress("42 MARIGOLD LN., koregaon park, Pune 411001"));
  });
  it("real difference is kept", () => {
    expect(normaliseAddress("42 Marigold Lane, Pune")).not.toBe(normaliseAddress("17 Maple Road, Pune"));
  });
});

describe("times", () => {
  it("parses", () => {
    expect(parseTime("9am")).toBe("09:00");
    expect(parseTime("9:30 PM")).toBe("21:30");
    expect(parseTime("12 am")).toBe("00:00");
    expect(parseTime("21:00")).toBe("21:00");
  });
  it("ranges infer meridiem", () => {
    expect(parseTimeRange("9 - 9pm")).toEqual({ open: "09:00", close: "21:00" });
    expect(parseTimeRange("10 to 2pm")).toEqual({ open: "10:00", close: "14:00" });
    expect(parseTimeRange("10:00 AM – 2:00 PM")).toEqual({ open: "10:00", close: "14:00" });
  });
});

describe("weekly hours", () => {
  const styles: HoursStyle[] = ["perDay12", "grouped24", "perDayCompact", "grouped12to"];
  it.each(styles)("round-trips style %s", (s) => {
    const { hours, unparsed } = parseHoursText(formatHours(H, s));
    expect(unparsed).toEqual([]);
    expect(hoursEqual(hours, H)).toBe(true);
  });
  it("detects a real difference", () => {
    const other = { ...H, sun: null };
    expect(hoursEqual(parseHoursText(formatHours(other, "grouped24")).hours, H)).toBe(false);
  });
  it("canonical string groups days", () => {
    expect(canonHours(H)).toBe("Mon-Sat 09:00-21:00; Sun 10:00-14:00");
  });
});

describe("holiday lines", () => {
  const ex = { start: "2026-11-08", end: "2026-11-08", kind: "special" as const, open: "10:00", close: "14:00", reason: "Diwali" };
  const closed = { start: "2026-12-24", end: "2026-12-26", kind: "closed" as const, open: null, close: null, reason: null };
  const styles: HolidayStyle[] = ["long12", "iso24", "slash"];
  it.each(styles)("round-trips special in %s", (s) => {
    expect(canonHoliday(parseHolidayLine(formatHolidayLine(ex, s))!)).toBe(canonHoliday(ex));
  });
  it.each(styles)("round-trips closed range in %s", (s) => {
    expect(canonHoliday(parseHolidayLine(formatHolidayLine(closed, s))!)).toBe(canonHoliday(closed));
  });
  it("different hours -> different canon", () => {
    const b = parseHolidayLine("8 Nov 2026 (Diwali): Closed")!;
    expect(canonHoliday(b)).not.toBe(canonHoliday(ex));
  });
  it("returns null for junk", () => expect(parseHolidayLine("hello world")).toBeNull());
});
