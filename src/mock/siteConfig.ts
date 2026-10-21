import type { HolidayStyle, HoursStyle } from "../core/normalise.js";

/** How each mock site formats and marks up its pages. The readers (agent side) use the same selectors. */
export interface SiteCfg {
  slug: string;
  brand: string;
  moderation: boolean;
  hoursStyle: HoursStyle;
  holidayStyle: HolidayStyle;
  sel: { name: string; address: string; phone: string; hours: string; holidays: string };
}

export const SITE_CFG: Record<string, SiteCfg> = {
  a: { slug: "a", brand: "Listify", moderation: false, hoursStyle: "perDay12", holidayStyle: "long12",
    sel: { name: ".biz-name", address: ".addr", phone: ".phone", hours: ".hours-table", holidays: ".special li" } },
  b: { slug: "b", brand: "CityPages", moderation: false, hoursStyle: "grouped24", holidayStyle: "iso24",
    sel: { name: ".title", address: ".location", phone: ".contact-num", hours: ".timing-list", holidays: ".holiday-list li" } },
  c: { slug: "c", brand: "LocalLoop", moderation: false, hoursStyle: "perDayCompact", holidayStyle: "slash",
    sel: { name: ".shop-name", address: ".where", phone: ".call", hours: ".open-times", holidays: ".festival-hours li" } },
  d: { slug: "d", brand: "NearbyNow", moderation: false, hoursStyle: "perDay12", holidayStyle: "long12",
    sel: { name: ".listing-title", address: ".postal", phone: ".tel-number", hours: ".schedule", holidays: ".exceptions li" } },
  e: { slug: "e", brand: "ShopFront", moderation: true, hoursStyle: "grouped12to", holidayStyle: "long12",
    sel: { name: ".store", address: ".street", phone: ".ph", hours: ".hrs", holidays: ".closures p" } },
};

export const SLUG_TO_PLATFORM = (slug: string) => `site_${slug}`;
