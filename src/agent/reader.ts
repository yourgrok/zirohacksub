import * as cheerio from "cheerio";
import { SITE_CFG } from "../mock/siteConfig.js";
import { ChangeZ, type Change } from "../mock/changes.js";

export type ReaderMode = "playwright" | "http" | "auto";
export const readerMode = (): ReaderMode => {
  const m = (process.env.READER_MODE ?? "auto").toLowerCase();
  return m === "playwright" || m === "http" ? m : "auto";
};
export const baseUrl = () => process.env.BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;

export interface FetchedPage { html: string; status: number; via: "http" | "playwright" }

let pwBrowser: any = null;
let pwBroken = false;

async function getBrowser() {
  if (pwBrowser) return pwBrowser;
  const { chromium } = await import("playwright");
  const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  pwBrowser = await chromium.launch({ headless: true, timeout: 20000, ...(exe ? { executablePath: exe } : {}), args: ["--no-sandbox"] });
  return pwBrowser;
}

export async function closeReader() {
  try { await pwBrowser?.close(); } catch { /* ignore */ }
  pwBrowser = null;
}

async function viaHttp(url: string, headers?: Record<string, string>): Promise<FetchedPage> {
  const r = await fetch(url, { cache: "no-store", headers });
  return { html: await r.text(), status: r.status, via: "http" };
}

async function viaPlaywright(url: string, screenshotPath?: string, headers?: Record<string, string>): Promise<FetchedPage> {
  const b = await getBrowser();
  const ctx = await b.newContext({ viewport: { width: 1000, height: 900 }, ...(headers ? { extraHTTPHeaders: headers } : {}) });
  try {
    const page = await ctx.newPage();
    const resp = await page.goto(url, { waitUntil: "load", timeout: 15000 });
    if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: true });
    return { html: await page.content(), status: resp?.status() ?? 0, via: "playwright" };
  } finally {
    await ctx.close();
  }
}

/** Always reloads from the server (no cache). READER_MODE decides the engine; auto falls back to http. */
export async function fetchPage(path: string, opts: { screenshotPath?: string; headers?: Record<string, string> } = {}): Promise<FetchedPage> {
  const url = path.startsWith("http") ? path : baseUrl() + path;
  const mode = readerMode();
  if (mode === "http" || (mode === "auto" && pwBroken)) return viaHttp(url, opts.headers);
  try {
    return await viaPlaywright(url, opts.screenshotPath, opts.headers);
  } catch (e) {
    if (mode === "playwright") throw e;
    pwBroken = true;
    return viaHttp(url, opts.headers);
  }
}

export async function playwrightAvailable(): Promise<boolean> {
  try { await getBrowser(); return true; } catch { return false; }
}

/* ───────────── parsing ───────────── */

function htmlToLines(inner: string | null): string[] {
  if (!inner) return [];
  const withBreaks = inner.replace(/<\/(tr|li|p|div|dd|h\d)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ");
  const text = cheerio.load(`<x>${withBreaks}</x>`)("x").text();
  return text.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

export interface PublicRead {
  listingId: string | null;
  /** "claimed" (an owner account exists) or "unclaimed" — shown publicly by real listing sites ("Claim this business") */
  claimState: string | null;
  name: string | null;
  address: string | null;
  phone: string | null;
  hoursLines: string[];
  holidayLines: string[];
}

export function parsePublic(slug: string, html: string): PublicRead {
  const cfg = SITE_CFG[slug];
  const $ = cheerio.load(html);
  const t = (sel: string) => { const el = $(sel).first(); return el.length ? el.text().replace(/\s+/g, " ").trim() : null; };
  return {
    listingId: $("[data-listing-id]").first().attr("data-listing-id") ?? null,
    claimState: $("[data-claim-state]").first().attr("data-claim-state") ?? null,
    name: t(cfg.sel.name),
    address: t(cfg.sel.address),
    phone: t(cfg.sel.phone),
    hoursLines: htmlToLines($(cfg.sel.hours).first().html()),
    holidayLines: $(cfg.sel.holidays).map((_, el) => $(el).text().replace(/\s+/g, " ").trim()).get().filter(Boolean),
  };
}

export interface DashboardRead {
  listingId: string | null;
  canEdit: boolean;
  claimedByOther: boolean;
  pending: { summary: string; change: Change | null }[];
}

export function parseDashboard(html: string): DashboardRead {
  const $ = cheerio.load(html);
  const root = $("[data-listing-id]").first();
  const canEdit = root.attr("data-can-edit") === "true";
  const pending = $(".pending-change").map((_, el) => {
    let change: Change | null = null;
    try { const p = ChangeZ.safeParse(JSON.parse($(el).attr("data-change") ?? "")); if (p.success) change = p.data; } catch { /* ignore */ }
    return { summary: $(el).text().replace(/\s+/g, " ").trim(), change };
  }).get();
  return { listingId: root.attr("data-listing-id") ?? null, canEdit, claimedByOther: $(".claim-banner").attr("data-claim") === "other", pending };
}

/** The site's search/index page: every listing it shows (including look-alikes), by listing id. */
export function parseIndex(html: string): { listingId: string; name: string }[] {
  const $ = cheerio.load(html);
  const out: { listingId: string; name: string }[] = [];
  $('a[href*="/listing/"]').each((_, el) => {
    const id = ($(el).attr("href") ?? "").split("/listing/")[1]?.split(/[?#]/)[0];
    if (id && !out.some((o) => o.listingId === id)) out.push({ listingId: id, name: $(el).text().trim() });
  });
  return out;
}
