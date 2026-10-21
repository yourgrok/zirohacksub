import { z } from "zod";
import { WeeklyHoursZ } from "../core/types.js";

export const HolidayEntryZ = z.object({
  start: z.string(),
  end: z.string(),
  kind: z.enum(["closed", "special"]),
  open: z.string().nullable(),
  close: z.string().nullable(),
  reason: z.string().nullable().optional(),
});
export type HolidayEntry = z.infer<typeof HolidayEntryZ>;

/** The write API of the mock dashboards. */
export const ChangeZ = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set_phone"), value: z.string() }),
  z.object({ action: z.literal("set_address"), value: z.string() }),
  z.object({ action: z.literal("set_hours"), hours: WeeklyHoursZ }),
  z.object({ action: z.literal("set_holiday"), holiday: HolidayEntryZ }),
  z.object({ action: z.literal("remove_holiday"), start: z.string(), end: z.string() }),
]);
export type Change = z.infer<typeof ChangeZ>;

export function summariseChange(c: Change): string {
  switch (c.action) {
    case "set_phone": return `Change phone to ${c.value}`;
    case "set_address": return `Change address to ${c.value}`;
    case "set_hours": return "Change weekly opening hours";
    case "set_holiday": return `Set special day ${c.holiday.start}..${c.holiday.end}`;
    case "remove_holiday": return `Remove special day ${c.start}..${c.end}`;
  }
}
