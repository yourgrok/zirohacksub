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

export function summariseChange(c: Change | CreateChange): string {
  switch (c.action) {
    case "create_listing": return `Create new listing "${c.listing.name}"`;
    case "set_phone": return `Change phone to ${c.value}`;
    case "set_address": return `Change address to ${c.value}`;
    case "set_hours": return "Change weekly opening hours";
    case "set_holiday": return `Set special day ${c.holiday.start}..${c.holiday.end}`;
    case "remove_holiday": return `Remove special day ${c.start}..${c.end}`;
  }
}

/** Asking a site to create a brand-new listing for the owner. The site assigns the listing id. */
export const CreateChangeZ = z.object({
  action: z.literal("create_listing"),
  listingId: z.string().optional(), // filled in once the site has assigned one
  listing: z.object({
    name: z.string().min(2).max(80),
    address: z.string().min(8).max(200),
    phone: z.string().min(7).max(25),
    hours: WeeklyHoursZ,
  }),
});
export type CreateChange = z.infer<typeof CreateChangeZ>;

/** Anything a dashboard can show as "pending review". */
export const AnyChangeZ = z.union([ChangeZ, CreateChangeZ]);
export type AnyChange = z.infer<typeof AnyChangeZ>;

export function isCreate(c: AnyChange | null | undefined): c is CreateChange {
  return !!c && c.action === "create_listing";
}
