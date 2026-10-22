// End-to-end demo of the new-owner journey, over real HTTP against an in-memory server.
// Prints a narrated log and writes evidence/onboarding-demo.md (the PIN is never printed or written: it is masked).
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.js";
import { seedIfEmpty, GREEN_LEAF } from "../core/seed.js";
import { DEMO_PIN } from "../auth/pin.js";
import { getDb } from "../core/db.js";
import { setClockOverride } from "../core/clock.js";
import { evidenceDir } from "./evidence.js";
import { runAllTcs } from "./tc.js";

process.env.DB_PATH ||= ":memory:";
process.env.LLM_PROVIDER = "none";
process.env.READER_MODE ||= "http";

class Http {
  cookie = "";
  constructor(public url: string) {}
  async call(method: string, p: string, json?: unknown) {
    const r = await fetch(this.url + p, { method, headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(this.cookie ? { cookie: this.cookie } : {}) }, body: json !== undefined ? JSON.stringify(json) : undefined });
    for (const c of r.headers.getSetCookie?.() ?? []) { const kv = c.split(";")[0]; if (kv.startsWith("sid=")) this.cookie = kv.endsWith("=") ? "" : kv; }
    const text = await r.text();
    let body: any = text; try { body = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, body };
  }
  get(p: string) { return this.call("GET", p); }
  post(p: string, j: unknown = {}) { return this.call("POST", p, j); }
}

const md: string[] = [];
const say = (s = "") => { console.log(s); };
const section = (title: string) => { say(`\n== ${title}`); md.push("", `## ${title}`, ""); };
const note = (s: string) => { say("   " + s); md.push(s, ""); };
const table = (head: string[], rows: (string | number)[][]) => {
  md.push(`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map((x) => String(x).replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`), "");
  for (const r of rows) say("   " + r.map((x) => String(x).replace(/\n/g, " ")).join("  |  "));
};
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => { say(`   ${ok ? "✔" : "✘"} ${label}${detail ? " — " + detail : ""}`); md.push(`- ${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`); if (!ok) failures++; };
const maskPin = (pin: string) => pin.replace(/[A-Z2-9]/g, "•");

async function main() {
  seedIfEmpty();
  const server = await new Promise<import("node:http").Server>((resolve) => { const s = createApp().listen(0, "127.0.0.1", () => resolve(s)); });
  process.env.BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const owner = new Http(process.env.BASE_URL);
  md.push("# New-owner onboarding demo (real run)", "", `Run: ${new Date().toISOString()} · mock sites and synthetic data only · in-memory database · the PIN is masked everywhere in this log.`);

  section("1. Not logged in: nothing is reachable");
  check("GET /api/state without a login → 401", (await owner.get("/api/state")).status === 401);
  check("a wrong PIN gets one generic message", JSON.stringify((await owner.post("/api/auth/login", { pin: "WRONGPIN22" })).body) === '{"error":"Invalid PIN."}');

  section("2. New owner enters details; the agent reads every listing on every site and scores it");
  const details = { name: GREEN_LEAF.name, address: GREEN_LEAF.address, phone: GREEN_LEAF.phone, hours: "Mon-Sun 8am-10pm" };
  note(`Entered: **${details.name}**, ${details.address}, ${details.phone}`);
  const started = (await owner.post("/api/onboarding/start", details)).body;
  table(["Site", "Decision", "Best listing", "Score", "Why (phone / address / name)"],
    started.sites.map((m: any) => { const c = m.pick ?? m.candidates[0]; return [m.platformName, m.status.toUpperCase(), c ? `${c.name} (${c.listingId}${c.claimed ? ", claimed by another account" : ""})` : "—", c ? c.score : "—", c ? `${c.breakdown.phone.points}/${c.breakdown.phone.max} · ${c.breakdown.address.points}/${c.breakdown.address.max} · ${c.breakdown.name.points}/${c.breakdown.name.max}` : "—"]; }));
  const by = Object.fromEntries(started.sites.map((m: any) => [m.platformId, m]));
  check("strong matches on Listify and LocalLoop (formatting differences ignored)", by.site_a.status === "auto" && by.site_c.status === "auto");
  check("the look-alike on CityPages (\"Green Leaf Cafe & Bakery\", Kothrud) scores below the threshold → no listing found", by.site_b.status === "none", `look-alike scored ${by.site_b.candidates[0]?.score}`);
  check("NearbyNow's matching listing is claimed by another account → flagged, will not be linked", by.site_d.status === "claimed");
  check("nothing is linked or claimed yet", (getDb().prepare("SELECT COUNT(*) c FROM mock_listings WHERE listing_id IN ('LST-A-4001','LST-C-4001') AND owner_account IS NOT NULL").get() as any).c === 0);

  section("3. Owner confirms each match → business created → PIN shown once");
  const created = (await owner.post(`/api/onboarding/${started.draftId}/confirm`, { decisions: { site_a: { action: "confirm", listingId: "LST-A-4001" }, site_c: { action: "confirm", listingId: "LST-C-4001" } } })).body;
  const pin: string = created.pin;
  note(`PIN issued: \`${maskPin(pin)}\` (masked here; shown to the owner exactly once, only its HMAC is stored)`);
  check("the same draft cannot be completed twice (no second PIN)", (await owner.post(`/api/onboarding/${started.draftId}/confirm`, { decisions: {} })).status === 404);
  check("the PIN is not in the database", !JSON.stringify(getDb().prepare("SELECT * FROM business").all()).includes(pin.replace("-", "")));

  section("4. Owner logs in with only the PIN");
  const login = await owner.post("/api/auth/login", { pin });
  check("login with the PIN works (no username, no password)", login.status === 200, `business ${login.body.business.id}`);
  let st = (await owner.get("/api/state")).body;
  check("first login claimed and linked the two confirmed listings", st.platforms.length === 2, st.platforms.map((p: any) => p.listing.listingId).join(", "));
  table(["Site", "Status", "Note"], st.coverage.map((c: any) => [c.name, c.status, c.listingId ?? c.note]));

  section("5. Add the business to the sites where it is not listed (needs approval)");
  for (const site of ["site_b", "site_e"]) {
    const r = await owner.post(`/api/listings/${site}/propose`);
    check(`propose "add my business" on ${site}`, r.status === 200);
  }
  check("a flagged site cannot be offered (no duplicate of a claimed listing)", (await owner.post("/api/listings/site_d/propose")).status === 409);
  st = (await owner.get("/api/state")).body;
  const cards = st.rows.filter((r: any) => r.fieldKey === "listing:create");
  note("The approval card shows exactly what will be sent and where:");
  md.push("```", cards[0].intended, "```", "");
  say(cards[0].intended.split("\n").map((l: string) => "      " + l).join("\n"));
  await owner.post("/api/runs/execute?wait=1");
  check("pressing Apply with no approval sends nothing", (getDb().prepare("SELECT COUNT(*) c FROM mock_writes WHERE action='create_listing'").get() as any).c === 0);
  for (const c of cards) await owner.post(`/api/fields/${c.fieldId}/approve`);
  st = (await owner.post("/api/runs/execute?wait=1")).body;
  const state = (site: string) => st.rows.find((r: any) => r.platformId === site && r.fieldKey === "listing:create").state;
  check("CityPages: created, page reloaded, VERIFIED", state("site_b") === "VERIFIED");
  check("ShopFront (moderated): PENDING_MODERATION, never reported as created", state("site_e") === "PENDING_MODERATION");
  check("the public page of the pending listing does not exist yet", (await fetch(`${process.env.BASE_URL}/mock/e/listing/LST-E-5001`)).status === 404);
  const q = getDb().prepare("SELECT id FROM mock_queue WHERE status='pending'").get() as { id: number };
  await fetch(`${process.env.BASE_URL}/mock/admin/queue/${q.id}/approve`, { method: "POST", headers: { "content-type": "application/json" } });
  note("The site's moderator approved it in /mock/admin. Re-checking:");
  st = (await owner.post("/api/runs/execute?wait=1")).body;
  check("ShopFront: after moderator approval and a reload → VERIFIED", state("site_e") === "VERIFIED");
  check("exactly one create per site (idempotent)", (getDb().prepare("SELECT COUNT(*) c FROM mock_writes WHERE action='create_listing' AND result_code IN (200,202)").get() as any).c === 2);

  section("6. The report");
  table(["Platform", "Field", "Original value", "Approval status", "Verified status"], st.rows.map((r: any) => [r.platform, r.field, r.original, r.approval, r.verified]));
  table(["Site", "Matched listing", "Score", "Owner confirmation", "Created listing"], st.matches.map((m: any) => [m.platform, m.listingId, m.score ?? "—", m.confirmation, m.created ? `${m.created.state}` : "—"]));
  const trace = (await owner.get("/api/trace?all=1")).body.rows as any[];
  const tools = new Map<string, number>(); for (const t of trace) tools.set(t.tool, (tools.get(t.tool) ?? 0) + 1);
  note(`Agent trace for this business: ${trace.length} events (${[...tools].map(([k, v]) => `${k}×${v}`).join(", ")}); every one labelled ${[...new Set(trace.map((t) => t.decider))].join("/")}.`);
  check("the PIN appears nowhere in the trace", !JSON.stringify(trace).includes(pin));

  section("7. Isolation: the seeded Sunrise business is untouched");
  const sun = new Http(process.env.BASE_URL);
  check("Sunrise logs in with its own PIN", (await sun.post("/api/auth/login", { pin: DEMO_PIN })).status === 200);
  const sst = (await sun.get("/api/state")).body;
  check("Sunrise sees only its own five listings and none of Green Leaf's data", sst.platforms.length === 5 && !JSON.stringify(sst).includes("Green Leaf"));
  const fieldId = st.rows[0].fieldId;
  check("Sunrise cannot approve Green Leaf's field (404)", (await sun.post(`/api/fields/${fieldId}/approve`)).status === 404);
  check("the look-alike listings (…-2002) were never touched", (getDb().prepare("SELECT COUNT(*) c FROM mock_writes WHERE listing_id LIKE '%-2002'").get() as any).c === 0);

  section("8. The official test cases still pass (fresh reset each, date pinned)");
  const tcs = await runAllTcs({ mode: "deterministic" });
  setClockOverride(null);
  table(["Test", "Result", "Actual"], tcs.map((t) => [`${t.id} ${t.title}`, t.pass ? "PASS" : "FAIL", t.actual]));
  for (const t of tcs) if (!t.pass) failures++;

  md.push("", failures ? `**${failures} check(s) failed.**` : "**All checks passed.**");
  fs.mkdirSync(evidenceDir(), { recursive: true });
  fs.writeFileSync(path.join(evidenceDir(), "onboarding-demo.md"), md.join("\n"));
  say(`\n${failures ? `${failures} check(s) FAILED` : "All checks passed"} — written to ${path.join(evidenceDir(), "onboarding-demo.md")}`);
  server.close();
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
