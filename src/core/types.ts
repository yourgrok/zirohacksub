import { z } from "zod";

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Day = (typeof WEEKDAYS)[number];

export const DayHoursZ = z.object({ open: z.string(), close: z.string() }).nullable(); // null = closed
export const WeeklyHoursZ = z.object({
  mon: DayHoursZ, tue: DayHoursZ, wed: DayHoursZ, thu: DayHoursZ, fri: DayHoursZ, sat: DayHoursZ, sun: DayHoursZ,
});
export type WeeklyHours = z.infer<typeof WeeklyHoursZ>;

export const ExceptionZ = z.object({
  id: z.string(),
  start: z.string(), // YYYY-MM-DD
  end: z.string(), // YYYY-MM-DD (== start for single day)
  kind: z.enum(["closed", "special"]),
  open: z.string().nullable(),
  close: z.string().nullable(),
  reason: z.string().nullable(),
  source: z.enum(["owner", "natural-language", "foresight", "seed"]),
  status: z.enum(["active", "removed"]),
});
export type HolidayException = z.infer<typeof ExceptionZ>;

export interface Business {
  id: string;
  name: string;
  address: string;
  phone: string;
  hours: WeeklyHours;
}

export interface Platform {
  id: string;
  name: string;
  slug: string;
}

export interface PlatformListing {
  platformId: string;
  businessId: string;
  listingId: string;
  publicPath: string;
  dashboardPath: string;
}

export const FIELD_STATES = [
  "MATCH", "FORMAT_ONLY_EQUIVALENT", "MISMATCH", "PROPOSED", "APPROVED", "REJECTED",
  "APPLIED", "VERIFIED", "PENDING_MODERATION", "FLAGGED_NOT_OWNER", "SITE_REJECTED",
] as const;
export type FieldState = (typeof FIELD_STATES)[number];
