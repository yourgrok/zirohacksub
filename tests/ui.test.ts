import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { startTestServer } from "./helpers.js";

// Real-browser check of the tabbed console. Skipped (not failed) when the console has not been built (npm run build)
// or no Chromium can be launched on this machine.
const built = fs.existsSync("dist/web/index.html");
const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

let s: Awaited<ReturnType<typeof startTestServer>>;
let browser: Browser | null = null;
let page: Page;

beforeAll(async () => {
  s = await startTestServer();
  if (!built) return;
  try { browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"], timeout: 20000 }); } catch { browser = null; }
  if (browser) page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
}, 60000);
afterAll(async () => { await browser?.close(); await s.close(); });

const run = built ? it : it.skip;
const idle = async () => { await page.waitForTimeout(400); await page.waitForFunction(() => !document.body.innerText.includes("Agent is working"), null, { timeout: 30000 }); await page.waitForTimeout(400); };

describe("tabbed console (browser)", () => {
  run("logs in, shows 9 tabs, deep links and navigates by click and keyboard", async () => {
    if (!browser) return;
    await page.goto(s.url + "/#/approvals");
    await page.fill("#pin", "7KQ4X-M9PHT"); await page.click("button:has-text('Log in')");
    await page.waitForSelector("[role=tablist]");
    expect(await page.locator("#tab-approvals[aria-selected=true]").count()).toBe(1);
    expect(await page.locator("[role=tablist][aria-label=Sections] [role=tab]").count()).toBe(9);
    for (const id of ["details", "sites", "approvals", "consistency", "edit", "changelog", "trace", "holidays", "add"]) {
      await page.click(`#tab-${id}`);
      expect(await page.evaluate(() => location.hash)).toBe(`#/${id}`);
      expect(await page.locator(`#panel-${id}`).count()).toBe(1);
    }
    await page.focus("#tab-add"); await page.keyboard.press("ArrowRight");
    expect(await page.locator("#tab-details[aria-selected=true]").count()).toBe(1);
  }, 90000);

  run("the text box answers a question, previews an edit and still understands dates", async () => {
    if (!browser) return;
    await page.click("#tab-edit");
    await page.fill("#nl", "what are my hours?");
    await page.waitForSelector(".answer");
    expect(await page.locator(".answer").innerText()).toContain("Mon-Sat 09:00-21:00");
    await page.fill("#nl", "change my phone to 98765 43210");
    await page.waitForSelector("text=Phone new");
    expect(await page.locator(".chips").innerText()).toContain("+91 98765 43210");
    await page.fill("#nl", "closed on 26th December");
    await page.waitForSelector("text=Sat 26 Dec 2026");
    await page.fill("#nl", "");
  }, 60000);

  run("scan fills Approvals; the consistency table is compact; the change log records an edit", async () => {
    if (!browser) return;
    await page.click("button:has-text('① Scan listings')"); await idle();
    expect(await page.locator("#tab-approvals .tabcount").count()).toBe(1);
    await page.click("#tab-consistency");
    const h = await page.locator("table.compact tbody tr").first().evaluate((e) => e.getBoundingClientRect().height);
    expect(h).toBeLessThan(34);
    await page.click("#tab-edit");
    await page.fill("#e-name", "Sunrise Sweets"); await page.click("button:has-text('Save changes')");
    await page.waitForSelector("text=Saved: business name"); await idle();
    await page.click("#tab-changelog"); await page.waitForSelector("table.log");
    const log = await page.locator("table.log").innerText();
    expect(log).toContain("Business name");
    expect(log).toContain("Sunrise Sweets");
  }, 90000);

  run("agent trace: the walker follows the pointer and then walks on by itself", async () => {
    if (!browser) return;
    await page.click("#tab-trace"); await page.waitForSelector(".trace-scroll .tstep");
    expect(await page.locator(".walker").count()).toBe(0); // nothing until you hover
    const box = (await page.locator(".trace-scroll").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 30); await page.waitForTimeout(300);
    expect(await page.locator(".walker-emoji").innerText()).toBe("🤖");
    const t0 = await page.locator(".walker").evaluate((e) => (e as HTMLElement).style.top);
    await page.waitForTimeout(2200); // the pointer rests: the agent walks on
    const t1 = await page.locator(".walker").evaluate((e) => (e as HTMLElement).style.top);
    await page.waitForTimeout(1400);
    const t2 = await page.locator(".walker").evaluate((e) => (e as HTMLElement).style.top);
    expect(t1).not.toBe(t0);
    expect(t2).not.toBe(t1);
    const now = await page.locator(".tstep").evaluateAll((els) => els.findIndex((e) => e.classList.contains("now")));
    expect(now).toBeGreaterThan(0);
    expect(await page.locator(".tstep.passed").count()).toBe(now); // steps already walked are marked
  }, 60000);

  run("adding a business from the console switches to it and the old business keeps its data", async () => {
    if (!browser) return;
    await page.click("#tab-add"); await page.click("button:has-text('Start')");
    await page.fill("#n", "Green Leaf Cafe"); await page.fill("#a", "8 Lotus Street, Baner, Pune, Maharashtra 411045"); await page.fill("#p", "+91 90000 00031");
    await page.click("text=Find my listings"); await page.waitForSelector("text=Is this you?");
    const yes = page.locator("button:has-text(\"Yes, that's me\")");
    await yes.nth(0).click(); await yes.nth(1).click();
    await page.click("button:has-text('Continue')"); await page.waitForSelector("text=This PIN will not be shown again");
    await page.check("input[type=checkbox]"); await page.click("button:has-text('Open Green Leaf Cafe')");
    await page.waitForSelector("#tab-details[aria-selected=true]");
    expect(await page.locator(".sub").innerText()).toContain("Green Leaf Cafe");
    await page.click("button:has-text('Log out')"); await page.waitForSelector("text=Your PIN");
    await page.fill("#pin", "7KQ4X-M9PHT"); await page.click("button:has-text('Log in')"); await page.waitForSelector("[role=tablist]");
    expect(await page.locator("#panel-details").innerText()).toContain("Sunrise Sweets");
  }, 90000);
});
