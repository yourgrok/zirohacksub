// Records the 2-minute demo video of the real app (mock data only).
//   npm run build && npm run demo:video          -> docs/demo/demo.mp4 (+ demo.srt, demo-script.md)
//   DRY=1 npm run demo:video                     -> no video; screenshots per scene in .scratch/dry/ and a timing report
// It starts its own server (in-memory database, no Gemini key, pinned date) and drives a real browser, so what you see is what runs.
import { chromium } from "playwright";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DRY = !!process.env.DRY;
const PORT = Number(process.env.DEMO_PORT || 3457);
const BASE = `http://localhost:${PORT}`;
const VW = 1440, VH = 810;        // what the browser lays out
const W = 1280, H = 720;          // the video (scaled down from the viewport)
const OUT = path.resolve("docs/demo");
const TMP = path.resolve(".scratch/video-tmp");
const SHOTS = path.resolve(".scratch/dry");
const TOTAL = 120; // seconds

if (!fs.existsSync("dist/web/index.html")) { console.error("Build the console first:  npm run build"); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true }); fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true });
if (DRY) { fs.rmSync(SHOTS, { recursive: true, force: true }); fs.mkdirSync(SHOTS, { recursive: true }); }

/* ───────────────────────── server ───────────────────────── */
// the /tests page writes evidence files on every run: send them to a throwaway folder so the repo's own evidence/ is never touched
const EVIDENCE_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "demo-evidence-"));
const server = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
  env: { ...process.env, PORT: String(PORT), DB_PATH: ":memory:", EVIDENCE_DIR: EVIDENCE_TMP, DEMO_NOW: "2026-10-21", LLM_PROVIDER: "none", GEMINI_API_KEY: "", READER_MODE: "http", NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = ""; server.stdout.on("data", (d) => (serverLog += d)); server.stderr.on("data", (d) => (serverLog += d));
const stopServer = () => { try { server.kill(); } catch { /* already gone */ } try { fs.rmSync(EVIDENCE_TMP, { recursive: true, force: true }); } catch { /* ignore */ } };
process.on("exit", stopServer);
for (let i = 0; ; i++) {
  try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* not up yet */ }
  if (i > 60) { console.error("Server did not start:\n" + serverLog); process.exit(1); }
  await new Promise((r) => setTimeout(r, 500));
}

/* ───────────────────────── browser ───────────────────────── */
const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"], timeout: 30000 });
const ctx = await browser.newContext({
  viewport: { width: VW, height: VH }, colorScheme: "light", deviceScaleFactor: 1, reducedMotion: "no-preference",
  ...(DRY ? {} : { recordVideo: { dir: TMP, size: { width: W, height: H } } }),
});
const page = await ctx.newPage();
const T0 = Date.now();
const now = () => (Date.now() - T0) / 1000;

// captions + a visible mouse pointer (screen recordings do not show the real one)
await ctx.addInitScript(() => {
  const boot = () => {
    if (document.getElementById("__demo")) return;
    const root = document.createElement("div"); root.id = "__demo";
    root.innerHTML = `<style>
html.__band{overflow:hidden!important;height:100%!important;background:#2f2721!important}
html.__band body{height:calc(100vh - 88px)!important;min-height:0!important;overflow-y:auto!important;overflow-x:hidden!important;margin:0!important;scrollbar-width:none}
html.__band body::-webkit-scrollbar{display:none}
html.__band body{background-color:#f4eee3}
#__cap{position:fixed;left:0;right:0;bottom:0;height:88px;background:#2f2721;color:#fbf8f1;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 48px;z-index:2147483646;pointer-events:none}
html.__band #__cap{display:flex}
#__cap .t{font:600 26px/1.3 system-ui,"Segoe UI",Roboto,sans-serif;opacity:0;transition:opacity .25s}
#__cap.on .t{opacity:1}
#__cap small{display:block;font:600 14px/1.2 system-ui,"Segoe UI",Roboto,sans-serif;color:#e0b98f;margin-bottom:4px;letter-spacing:.09em;text-transform:uppercase}
#__cur{position:fixed;left:0;top:0;width:28px;height:28px;z-index:2147483647;pointer-events:none}
.__rip{position:fixed;width:38px;height:38px;margin:-19px 0 0 -19px;border-radius:50%;border:3px solid #b8561f;z-index:2147483646;pointer-events:none;animation:__r .55s ease-out forwards}
@keyframes __r{from{transform:scale(.3);opacity:1}to{transform:scale(1.7);opacity:0}}
</style><div id="__cap"><div class="t"></div></div><svg id="__cur" viewBox="0 0 24 24"><path d="M4 2l0 18 5-5 3.5 7.5 3-1.4-3.5-7.3 7-.3z" fill="#fff" stroke="#2b2420" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
    document.documentElement.appendChild(root);
    if (location.protocol.startsWith("http")) document.documentElement.classList.add("__band");
    const cur = document.getElementById("__cur"), cap = document.getElementById("__cap"), capText = cap.querySelector(".t");
    const place = (x, y) => { cur.style.transform = `translate(${x - 4}px,${y - 2}px)`; try { sessionStorage.setItem("__pos", x + "," + y); } catch { /* ignore */ } };
    try { const p = (sessionStorage.getItem("__pos") || "-100,-100").split(",").map(Number); place(p[0], p[1]); } catch { place(-100, -100); }
    addEventListener("mousemove", (e) => place(e.clientX, e.clientY), true);
    addEventListener("mousedown", (e) => { const r = document.createElement("div"); r.className = "__rip"; r.style.left = e.clientX + "px"; r.style.top = e.clientY + "px"; document.documentElement.appendChild(r); setTimeout(() => r.remove(), 600); }, true);
    window.__cap = (label, text) => { if (!text) { cap.classList.remove("on"); try { sessionStorage.removeItem("__capv"); } catch { /* ignore */ } return; } capText.innerHTML = (label ? `<small>${label}</small>` : "") + text; cap.classList.add("on"); try { sessionStorage.setItem("__capv", JSON.stringify([label, text])); } catch { /* ignore */ } };
    try { const v = JSON.parse(sessionStorage.getItem("__capv") || "null"); if (v) window.__cap(v[0], v[1]); } catch { /* ignore */ }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
});

/* ───────────────────────── helpers ───────────────────────── */
const captions = []; // for the .srt
let capOpen = null;
const closeCap = () => { if (capOpen) { captions.push({ ...capOpen, end: now() }); capOpen = null; } };
async function cap(label, text) {
  closeCap();
  if (text) capOpen = { start: now(), label, text };
  await page.evaluate(([l, t]) => window.__cap && window.__cap(l, t), [label, text]).catch(() => {});
}
async function at(sec) { if (DRY) return; const d = sec - now(); if (d > 0) await page.waitForTimeout(d * 1000); else if (d < -0.8) console.warn(`  ! ${(-d).toFixed(1)}s late at ${sec}s`); }
let mx = VW / 2, my = VH / 2;
async function glide(x, y, ms = 550) {
  const n = Math.max(8, Math.round(ms / 16)), sx = mx, sy = my;
  for (let i = 1; i <= n; i++) { const t = i / n, e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; await page.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e); await page.waitForTimeout(16); }
  mx = x; my = y;
}
async function click(target, ms = 550) {
  const loc = typeof target === "string" ? page.locator(target).first() : target;
  await loc.waitFor({ state: "visible", timeout: 20000 });
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  await glide(b.x + b.width / 2, b.y + b.height / 2, ms);
  await page.waitForTimeout(100); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(120);
}
async function type(selector, text, delay = 38) { await click(selector, 450); await page.locator(selector).pressSequentially(text, { delay }); }
// the mock moderator page is unstyled; make it readable on video (recording only)
const bigAdmin = () => page.addStyleTag({ content: "html.__band.__band{background:#f4eee3!important}body{max-width:none!important;color:#3a312a;font-size:22px;margin:30px 44px}h1{font-size:40px}table{font-size:22px}td,th{padding:10px 16px}button{font-size:20px;padding:7px 20px;border-radius:8px;cursor:pointer}" });
async function idleAgent(ms = 60000) { await page.waitForFunction(() => !document.body.innerText.includes("Agent is working") && !document.body.innerText.includes("Working…"), null, { timeout: ms }); }
let snapN = 0;
const snap = async (name) => { if (DRY) await page.screenshot({ path: path.join(SHOTS, `s${String(++snapN).padStart(2, "0")}-${name}.png`) }); };
const report = [];
async function scene(name, start, end, fn) {
  await at(start);
  const t = Date.now();
  await fn();
  const took = (Date.now() - t) / 1000;
  report.push({ name, budget: end - start, took });
  if (DRY) await page.screenshot({ path: path.join(SHOTS, `${String(report.length).padStart(2, "0")}-${name}.png`) });
  if (took > end - start) console.warn(`  ! scene "${name}" needs ${took.toFixed(1)}s but has ${(end - start).toFixed(1)}s`);
  await at(end);
}

/* ───────────────────────── cards ───────────────────────── */
const card = (inner) => `<!doctype html><meta charset="utf-8"><style>
html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#f4eee3;color:#3a312a;font-family:system-ui,"Segoe UI",Roboto,sans-serif}
.c{max-width:920px;padding:0 40px;text-align:center}h1{font-size:50px;line-height:1.15;margin:0 0 14px;font-weight:700}p{font-size:23px;line-height:1.5;margin:0 0 10px;color:#5a4d42}
.k{display:inline-block;background:#54733f;color:#fff;border-radius:999px;padding:4px 16px;font-size:16px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:22px}
ul{list-style:none;padding:0;margin:20px auto 0;display:grid;grid-template-columns:1fr 1fr;gap:10px 28px;text-align:left;max-width:800px}li{font-size:19px;padding-left:22px;position:relative;color:#3a312a}li:before{content:"";position:absolute;left:0;top:.55em;width:9px;height:9px;border-radius:50%;background:#b8561f}
.s{font-size:17px;color:#6a5e51;margin-top:26px}</style><div class="c">${inner}</div>`;
const TITLE = card(`<div class="k">Agentic AI Hackathon 2026 · Business &amp; Productivity AI</div><h1>Business Listing<br>Consistency Agent</h1><p>Keeps a local business's address, phone and hours the same on every listing site.</p><p><b>You approve every change before anything is edited.</b></p>`);
const END = card(`<div class="k">What you saw</div><h1>An agent that asks first</h1>
<ul><li>PIN-only login, score-matched onboarding, add to missing sites</li><li>Scan, review, apply, then verify by reload</li><li>Flags listings it does not own; never edits them</li><li>Waits for site moderators, then verifies</li><li>Plain-language edits, closures and questions</li><li>Holiday foresight alerts</li><li>Full trace, change log and CSV evidence</li><li>Test cases TC1-TC8 with guardrails in code</li></ul>
<p class="s">Mock sites and synthetic data only. Works with or without Gemini (rules-based fallback).</p>`);

/* ───────────────────────── the film ───────────────────────── */
let ok = false;
try {
  // 0:00 title
  await page.setContent(TITLE);

  await scene("login", 4, 11, async () => {
    await page.goto(BASE + "/");
    await page.waitForSelector("#pin");
    await cap("Log in", "PIN-only login: no passwords, one PIN per business.");
    await click("button:has-text('Access the Demo PIN')", 650);
    await page.waitForTimeout(500);
    await snap("login-demo-pin");
    await click("button:has-text('Use this PIN')", 500);
    await page.waitForTimeout(900);
    await cap("Log in", "A fictional demo business: Sunrise Sweets &amp; Bakery, Pune. Mock data only.");
    await click("button.primary:has-text('Log in')", 450);
    await page.waitForSelector("[role=tablist]");
  });

  await scene("details", 11, 19, async () => {
    await cap("My Details", "Your record is the source of truth. The agent compares every listing with it.");
    await page.waitForSelector("text=Start here");
    await glide(760, 300, 800);
    await page.waitForTimeout(1500);
    await click("#tab-sites", 700);
    await cap("Listings &amp; Sites", "Five mock listing sites. Look-alike businesses are never read or edited.");
  });

  await scene("scan", 19, 28, async () => {
    await cap("Step 1 · Scan", "The agent reads each site and compares meaning, not formatting.");
    await click("button.stepbtn:has-text('Scan listings')", 800);
    await page.waitForSelector(".nudge", { timeout: 60000 });
    await cap("Step 1 · Scan", "It reports what it found. Nothing has been changed yet.");
    await snap("scan-popup");
    await page.waitForTimeout(2500);
  });

  await scene("approvals", 28, 39, async () => {
    await click(".nudge button.primary", 600);
    await page.waitForSelector("#tab-approvals[aria-selected=true]");
    await cap("Step 2 · Review", "Every proposed fix is yours to approve or reject.");
    await glide(760, 470, 700);
    await page.waitForTimeout(1700);
    await click(".fchip:has-text('Not yours')", 700);
    await cap("Safety rule", "NearbyNow belongs to someone else: zero edits, and a claim request is drafted for you.");
    await snap("not-yours");
    await page.waitForTimeout(2400);
    await click(".fchip:has-text('Needs my approval')", 700);
  });

  await scene("apply", 39, 46, async () => {
    await cap("Step 3 · Apply", "Approve, and only approved changes are sent. Then every page is reloaded to verify.");
    await click(".btn.primary:has-text('Approve all')", 700);
    await page.waitForSelector(".nudge", { timeout: 20000 });
    await snap("apply-reminder");
    await page.waitForTimeout(1000);
    await click(".nudge button.primary", 600);
    await page.waitForSelector("#tab-trace[aria-selected=true]");
  });

  await scene("trace", 46, 55, async () => {
    await cap("Agent Trace", "Every step the agent took, who decided it, and what it found.");
    await idleAgent(15000).catch(() => {});
    await page.waitForTimeout(600);
    await glide(820, 420, 800);
    await page.waitForTimeout(2200);
    await glide(900, 520, 900);
    await snap("trace");
    await page.waitForTimeout(1200);
  });

  await scene("moderation", 55, 62, async () => {
    await cap("Moderated site", "ShopFront queues edits for a moderator. The agent waits and does not claim success.");
    await page.goto(BASE + "/mock/admin");
    await page.waitForSelector("#queue");
    await bigAdmin();
    await snap("moderator-queue");
    await page.waitForTimeout(1300);
    await click("#queue button:has-text('Approve')", 700);
    await page.waitForSelector("#queue [data-status=approved]");
    await bigAdmin();
    await page.waitForTimeout(900);
    await page.goto(BASE + "/#/approvals");
    await page.waitForSelector("[role=tablist]");
    await cap("Moderated site", "After approval, one click re-reads the page. VERIFIED only if it really changed.");
    await snap("recheck-ready");
    await click("button.stepbtn:has-text('Re-check pending sites')", 700);
    await idleAgent(20000).catch(() => {});
  });

  await scene("consistency", 62, 71, async () => {
    await click("#tab-consistency", 700);
    await cap("Before / after", "Per site and field: the original value, the intended value, and whether it is verified.");
    await page.waitForSelector("table.compact");
    await page.waitForTimeout(1000);
    await click(".fchip:has-text('Verified')", 650);
    await snap("consistency-verified");
    await page.waitForTimeout(1500);
    await cap("Before / after", "Formatting-only differences are ignored. Export the table as CSV for evidence.");
    await click(".fchip:has-text('All')", 600);
    await page.mouse.move(700, 520); mx = 700; my = 520;
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 60); await page.waitForTimeout(240); }
    await snap("consistency-all");
  });

  await scene("edit", 71, 82, async () => {
    await click("#tab-edit", 700);
    await cap("Edit &amp; Ask", "Type it in plain words. Questions are answered from your record.");
    await type("#nl", "what are my hours?", 40);
    await page.waitForSelector(".answer");
    await page.waitForTimeout(1500);
    await page.fill("#nl", "");
    await cap("Edit &amp; Ask", "Closures and edits get a preview first. Nothing is saved until you confirm.");
    await page.locator("#nl").pressSequentially("closed on 26th December", { delay: 40 });
    await page.waitForSelector("text=Sat 26 Dec 2026");
    await snap("edit-preview");
    await page.waitForTimeout(2200);
  });

  await scene("holidays", 82, 87, async () => {
    await click("#tab-holidays", 700);
    await cap("Holiday Foresight", "Upcoming festivals are flagged early, so closures are never forgotten.");
    await page.waitForTimeout(2800);
  });

  await scene("changelog", 87, 91.5, async () => {
    await click("#tab-changelog", 700);
    await cap("Change Log", "Who changed what and when, including what was verified on each site.");
    await page.waitForSelector("table.log");
    await page.waitForTimeout(1800);
  });

  await scene("tests", 91.5, 97.5, async () => {
    await cap("Proof", "Test cases TC1 to TC8 run from one page, with input, expected and actual.");
    await page.goto(BASE + "/tests");
    await page.waitForSelector("text=Test cases TC1");
    await click("button:has-text('Run all')", 700);
    await page.waitForFunction(() => /\d+ of \d+ run test\(s\) passed/.test(document.body.innerText), null, { timeout: 90000 });
    await page.mouse.move(700, 520); mx = 700; my = 520;
    for (let i = 0; i < 2; i++) { await page.mouse.wheel(0, 50); await page.waitForTimeout(300); }
    await snap("tests");
  });

  await scene("onboarding", 97.5, 114, async () => {
    await cap("New owner", "A new owner finds their listings by score: phone, address and name.");
    await page.goto(BASE + "/");
    await click("button:has-text('Log out')", 500);
    await page.waitForSelector("text=Set up my business");
    await click("button:has-text('Set up my business')", 600);
    await page.waitForSelector("#n");
    await type("#n", "Green Leaf Cafe", 14);
    await type("#a", "8 Lotus Street, Baner, Pune, Maharashtra 411045", 8);
    await type("#p", "+91 90000 00031", 14);
    await click("text=Find my listings", 450);
    await page.waitForSelector("text=Is this you?");
    await snap("is-this-you");
    await cap("New owner", "Matches are scored on phone, address and name. Nothing is linked until you say yes.");
    await page.waitForTimeout(2400);
    const yes = page.locator("button:has-text(\"Yes, that's me\")");
    await click(yes.nth(0), 450); await click(yes.nth(1), 350);
    await click("button:has-text('Continue')", 400);
    await page.waitForSelector("text=This PIN will not be shown again");
    await cap("New owner", "The PIN is shown once. Only a keyed hash of it is stored.");
    await snap("pin-once");
    await page.waitForTimeout(1500);
  });

  // 1:54 end card
  await at(114);
  await cap(null, null);
  await page.setContent(END);
  await at(TOTAL);
  ok = true;
} catch (e) {
  console.error("Recording failed:", e.message);
  if (DRY) await page.screenshot({ path: path.join(SHOTS, "zz-failure.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  closeCap();
  const video = page.video();
  await ctx.close();
  await browser.close();
  stopServer();
  console.log("\nScene timing (natural duration vs budget):");
  for (const r of report) console.log(`  ${r.name.padEnd(12)} ${r.took.toFixed(1).padStart(5)}s / ${r.budget}s ${r.took > r.budget ? "  <-- too long" : ""}`);
  if (ok && !DRY) await finish(video);
}

/* ───────────────────────── encode + extras ───────────────────────── */
function findFfmpeg() {
  const tryRun = (p) => { try { return spawnSync(p, ["-version"], { stdio: "ignore" }).status === 0; } catch { return false; } };
  if (tryRun("ffmpeg")) return "ffmpeg";
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(os.homedir(), ".cache", "ms-playwright"), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "ms-playwright"), "/opt/pw-browsers"].filter(Boolean);
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    for (const d of fs.readdirSync(r).filter((n) => n.startsWith("ffmpeg"))) {
      for (const f of fs.readdirSync(path.join(r, d))) if (/^ffmpeg/.test(f) && !/\.(txt|md)$/i.test(f) && !/COPYING/.test(f) && tryRun(path.join(r, d, f))) return path.join(r, d, f);
    }
  }
  return null;
}
function srtTime(s) { const ms = Math.round(s * 1000); const p = (n, l = 2) => String(n).padStart(l, "0"); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`; }
function plain(s) { return s.replace(/&amp;/g, "&"); }

async function finish(video) {
  const webm = await video.path();
  const ff = findFfmpeg();
  const mp4 = path.join(OUT, "demo.mp4");
  if (ff) {
    const r = spawnSync(ff, ["-y", "-i", webm, "-t", String(TOTAL), "-vf", "fps=30,scale=1280:720:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-movflags", "+faststart", "-an", mp4], { stdio: "ignore" });
    if (r.status !== 0) { console.error("ffmpeg failed; keeping the webm"); fs.copyFileSync(webm, path.join(OUT, "demo.webm")); }
    else console.log("Video:", mp4);
  } else { fs.copyFileSync(webm, path.join(OUT, "demo.webm")); console.log("ffmpeg not found; saved demo.webm (convert it to mp4 with any converter)."); }

  fs.writeFileSync(path.join(OUT, "demo.srt"), captions.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(Math.min(c.end, TOTAL))}\n${plain(c.text)}\n`).join("\n"));
  const lines = captions.map((c) => `| ${Math.floor(c.start / 60)}:${String(Math.floor(c.start % 60)).padStart(2, "0")} | ${plain(c.label || "")} | ${plain(c.text)} |`);
  fs.writeFileSync(path.join(OUT, "demo-script.md"), `# Demo video: timeline and captions\n\nThe video has on-screen captions and no voice-over. Read the third column aloud if you want to add narration.\n\n| Time | Part | Caption |\n|---|---|---|\n| 0:00 | Title | Business Listing Consistency Agent: keeps address, phone and hours the same on every listing site. You approve every change. |\n${lines.join("\n")}\n| 1:54 | End card | What you saw (feature list). Mock sites and synthetic data only. |\n`);
  fs.rmSync(TMP, { recursive: true, force: true });
}
