// All date logic is Asia/Kolkata. DEMO_NOW (ISO date) overrides "today".
export const TZ = "Asia/Kolkata";

let override: string | null = null;

/** Programmatic override (used by the test runner); null clears it. */
export function setClockOverride(iso: string | null) {
  override = iso;
}

function fmtParts(d: Date) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(d); // YYYY-MM-DD
}

/** Today's date as YYYY-MM-DD in IST (or DEMO_NOW). */
export function today(): string {
  const o = override ?? process.env.DEMO_NOW;
  if (o && /^\d{4}-\d{2}-\d{2}/.test(o)) return o.slice(0, 10);
  return fmtParts(new Date());
}

export function isDemoNow(): boolean {
  return !!(override ?? process.env.DEMO_NOW);
}

/** A Date at noon UTC for a YYYY-MM-DD string (safe for day arithmetic). */
export function dateOf(ymd: string): Date {
  return new Date(`${ymd}T12:00:00Z`);
}

export function addDays(ymd: string, n: number): string {
  const d = dateOf(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round((dateOf(toYmd).getTime() - dateOf(fromYmd).getTime()) / 86400000);
}

const WD = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WD)[number];
export function weekdayOf(ymd: string): Weekday {
  return WD[dateOf(ymd).getUTCDay()];
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "26 Dec 2026" */
export function prettyDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${d} ${MON[m - 1]} ${y}`;
}
export function prettyDateWithDay(ymd: string): string {
  const w = weekdayOf(ymd);
  return `${w[0].toUpperCase()}${w.slice(1)} ${prettyDate(ymd)}`;
}

/** Real timestamp for logs. */
export function nowTs(): string {
  return new Date().toISOString();
}
