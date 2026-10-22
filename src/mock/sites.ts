import express, { type Request, type Response } from "express";
import { getDb } from "../core/db.js";
import { nowTs } from "../core/clock.js";
import { formatHolidayLine, formatHours } from "../core/normalise.js";
import { mockAccountOf } from "../auth/mockCreds.js";
import type { WeeklyHours } from "../core/types.js";
import { ChangeZ, summariseChange, type Change, type HolidayEntry } from "./changes.js";
import { SITE_CFG, type SiteCfg } from "./siteConfig.js";

interface MockListing {
  site: string; listing_id: string; display_name: string; address: string; phone: string;
  hours: WeeklyHours; holidays: HolidayEntry[]; owner_account: string; is_decoy: number;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function load(site: string, id: string): MockListing | undefined {
  const r = getDb().prepare("SELECT * FROM mock_listings WHERE site=? AND listing_id=?").get(`site_${site}`, id) as any;
  if (!r) return undefined;
  return { ...r, hours: JSON.parse(r.hours_json), holidays: JSON.parse(r.holidays_json) };
}
function save(l: MockListing) {
  getDb().prepare("UPDATE mock_listings SET address=?, phone=?, hours_json=?, holidays_json=? WHERE site=? AND listing_id=?")
    .run(l.address, l.phone, JSON.stringify(l.hours), JSON.stringify(l.holidays), l.site, l.listing_id);
}

/** Apply a change directly to the stored mock listing (used on approval or for non-moderated sites). */
export function applyChange(l: MockListing, c: Change) {
  switch (c.action) {
    case "set_phone": l.phone = c.value; break;
    case "set_address": l.address = c.value; break;
    case "set_hours": l.hours = c.hours; break;
    case "set_holiday":
      l.holidays = l.holidays.filter((h) => !(h.start === c.holiday.start && h.end === c.holiday.end));
      l.holidays.push(c.holiday);
      break;
    case "remove_holiday":
      l.holidays = l.holidays.filter((h) => !(h.start === c.start && h.end === c.end));
      break;
  }
}

/* ───────────── rendering ───────────── */

function hoursHtml(cfg: SiteCfg, h: WeeklyHours): string {
  const lines = formatHours(h, cfg.hoursStyle).split("\n");
  const cls = cfg.sel.hours.slice(1);
  switch (cfg.slug) {
    case "a": return `<table class="${cls}">${lines.map((l) => { const [d, t] = l.split(": "); return `<tr><td>${d}</td><td>${t}</td></tr>`; }).join("")}</table>`;
    case "b": return `<ul class="${cls}">${lines.map((l) => `<li>${l}</li>`).join("")}</ul>`;
    case "c": return `<dl class="${cls}">${lines.map((l) => { const i = l.indexOf(" "); return `<dt>${l.slice(0, i)}</dt><dd>${l.slice(i + 1)}</dd>`; }).join("")}</dl>`;
    case "d": return `<div class="${cls}">${lines.map((l) => { const [d, t] = l.split(": "); return `<div class="row"><b>${d}</b> <span>${t}</span></div>`; }).join("")}</div>`;
    default: return `<p class="${cls}">${lines.join("<br>")}</p>`;
  }
}

function holidaysHtml(cfg: SiteCfg, hs: HolidayEntry[]): string {
  const cls = cfg.sel.holidays.split(" ")[0].slice(1);
  const items = hs.map((h) => esc(formatHolidayLine({ ...h, reason: h.reason ?? null }, cfg.holidayStyle)));
  if (cfg.slug === "e") return `<div class="${cls}">${items.map((i) => `<p>${i}</p>`).join("")}</div>`;
  return `<ul class="${cls}">${items.map((i) => `<li>${i}</li>`).join("")}</ul>${hs.length ? "" : `<p class="none">No special days listed.</p>`}`;
}

const THEMES: Record<string, string> = {
  a: `body{font-family:system-ui,sans-serif;background:#f4f7fb;color:#1b2733;margin:0}header{background:#1f6feb;color:#fff;padding:14px 24px;font-weight:700;letter-spacing:.5px}main{max-width:640px;margin:24px auto;background:#fff;border-radius:10px;padding:24px;box-shadow:0 2px 8px #0002}td{padding:4px 16px 4px 0}h1{margin-top:0}`,
  b: `body{font-family:Georgia,serif;background:#16161d;color:#e9e4d4;margin:0}header{border-bottom:2px solid #d4a017;padding:16px 28px;color:#d4a017;font-size:22px}main{max-width:620px;margin:28px auto;padding:0 20px}h1{color:#d4a017}ul{padding-left:18px}a{color:#d4a017}`,
  c: `body{font-family:"Comic Sans MS",system-ui,sans-serif;background:#e8f7ec;color:#14532d;margin:0}header{background:#22c55e;color:#fff;padding:14px;text-align:center;font-size:24px;border-radius:0 0 24px 24px}main{max-width:560px;margin:20px auto;background:#fff;border:3px dashed #22c55e;border-radius:20px;padding:20px}dt{float:left;width:60px;font-weight:700}dd{margin-left:70px}`,
  d: `body{font-family:Arial,sans-serif;background:#e5e7eb;color:#111;margin:0;display:flex}nav{width:180px;background:#374151;color:#fff;min-height:100vh;padding:20px;box-sizing:border-box}main{flex:1;padding:28px;max-width:640px}.row b{display:inline-block;width:110px}h1{border-left:6px solid #374151;padding-left:10px}`,
  e: `body{font-family:"Times New Roman",serif;background:#fff3e0;color:#4e342e;margin:0}header{background:#e65100;color:#fff;padding:18px 30px;font-style:italic;font-size:26px}main{max-width:600px;margin:24px auto;border:1px solid #e65100;padding:22px;background:#fffaf2}h1{font-variant:small-caps}`,
};

function page(cfg: SiteCfg, title: string, body: string, attrs = ""): string {
  const nav = cfg.slug === "d" ? `<nav><b>${cfg.brand}</b><p>Directory</p><p>Claims</p></nav>` : "";
  const head = cfg.slug === "d" ? "" : `<header>${cfg.brand}</header>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — ${cfg.brand} (mock)</title><style>${THEMES[cfg.slug]}.mock-note{font-size:12px;opacity:.7;margin-top:18px}.banner{padding:8px 12px;border-radius:6px;margin:10px 0;font-weight:600}.ok{background:#d1fae5;color:#065f46}.deny{background:#fee2e2;color:#991b1b}.pend{background:#fef3c7;color:#92400e}</style></head>
<body ${attrs}>${nav}${head}<main>${body}<p class="mock-note">Mock listing site for a hackathon demo — fictional business, synthetic data.</p></main></body></html>`;
}

export function renderPublic(cfg: SiteCfg, l: MockListing): string {
  const s = cfg.sel;
  const cls = (x: string) => x.split(" ")[0].slice(1);
  const body = `<h1 class="${cls(s.name)}">${esc(l.display_name)}</h1>
<p>Listing ID: <code data-field="listing-id">${l.listing_id}</code></p>
<p>📍 <span class="${cls(s.address)}">${esc(l.address)}</span></p>
<p>☎ <span class="${cls(s.phone)}">${esc(l.phone)}</span></p>
<h2>Opening hours</h2>${hoursHtml(cfg, l.hours)}
<h2>Special days</h2>${holidaysHtml(cfg, l.holidays)}`;
  return page(cfg, l.display_name, `<div data-listing-id="${l.listing_id}" data-claim-state="${l.owner_account ? "claimed" : "unclaimed"}">${body}</div>`);
}

function renderDashboard(cfg: SiteCfg, l: MockListing, account: string | null): string {
  const canEdit = !!account && l.owner_account === account;
  const pending = getDb().prepare("SELECT * FROM mock_queue WHERE site=? AND listing_id=? AND status='pending'").all(l.site, l.listing_id) as any[];
  const banner = !account
    ? `<div class="banner deny claim-banner" data-claim="anon">Please sign in to manage this listing.</div>`
    : canEdit
      ? `<div class="banner ok claim-banner" data-claim="owner">You manage this listing (signed in as ${esc(account)}).</div>`
      : l.owner_account
        ? `<div class="banner deny claim-banner" data-claim="other">This listing is claimed by another account. You do not have permission to edit it.</div>`
        : `<div class="banner deny claim-banner" data-claim="unclaimed">This listing has not been claimed yet. You must claim it before you can edit it.</div>`;
  const pendHtml = pending.length
    ? `<h3>Pending changes (${pending.length})</h3>${pending.map((p) => `<div class="banner pend pending-change" data-change="${esc(p.change_json)}">${esc(p.summary)} — awaiting moderator review</div>`).join("")}`
    : "";
  const body = `<div data-listing-id="${l.listing_id}" data-can-edit="${canEdit}">
<h1>Owner dashboard</h1>${banner}
<p><b>${esc(l.display_name)}</b> · ${l.listing_id}</p>
<p>Address: ${esc(l.address)}<br>Phone: ${esc(l.phone)}</p>
<p>Edits are submitted through the dashboard API. ${cfg.moderation ? "This site reviews every edit before it goes live." : "Edits go live immediately."}</p>
${pendHtml}
<p><a href="/mock/${cfg.slug}/listing/${l.listing_id}">View public page</a></p></div>`;
  return page(cfg, `Dashboard ${l.listing_id}`, body, `data-can-edit="${canEdit}"`);
}

/* ───────────── router ───────────── */

export function mockRouter(): express.Router {
  const r = express.Router();
  r.use(express.json());
  r.use(express.urlencoded({ extended: false }));

  r.get("/", (_req, res) => {
    res.send(`<!doctype html><title>Mock listing sites</title><h1>Mock listing sites</h1><ul>${Object.values(SITE_CFG)
      .map((c) => `<li><a href="/mock/${c.slug}/">${c.brand}</a> (site ${c.slug.toUpperCase()})</li>`).join("")}</ul><p><a href="/mock/admin">Moderation admin</a></p>`);
  });

  /* moderation admin (site E queue) — registered before :slug routes */
  r.get("/admin", (_req, res) => {
    const rows = getDb().prepare("SELECT * FROM mock_queue ORDER BY id DESC").all() as any[];
    res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mock moderation admin</title>
<style>body{font-family:system-ui;margin:24px;max-width:800px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px;text-align:left}button{padding:4px 10px}</style></head><body>
<h1>Moderation queue (mock)</h1><p>Edits submitted to moderated sites wait here until approved. Public pages do not change until then.</p>
<table id="queue"><tr><th>#</th><th>Site</th><th>Listing</th><th>Change</th><th>Status</th><th></th></tr>
${rows.map((q) => `<tr data-status="${q.status}"><td>${q.id}</td><td>${q.site}</td><td>${q.listing_id}</td><td>${esc(q.summary)}</td><td>${q.status}</td><td>${q.status === "pending"
  ? `<form method="post" action="/mock/admin/queue/${q.id}/approve" style="display:inline"><button>Approve</button></form> <form method="post" action="/mock/admin/queue/${q.id}/reject" style="display:inline"><button>Reject</button></form>` : ""}</td></tr>`).join("")}
</table></body></html>`);
  });
  const decide = (approve: boolean) => (req: Request, res: Response) => {
    const q = getDb().prepare("SELECT * FROM mock_queue WHERE id=?").get(req.params.id) as any;
    if (!q || q.status !== "pending") return res.status(404).json({ error: "no pending item" });
    if (approve) {
      const slug = q.site.replace("site_", "");
      const l = load(slug, q.listing_id)!;
      applyChange(l, JSON.parse(q.change_json));
      save(l);
    }
    getDb().prepare("UPDATE mock_queue SET status=? WHERE id=?").run(approve ? "approved" : "rejected", q.id);
    if (req.accepts("html") && !req.is("json")) return res.redirect("/mock/admin");
    res.json({ ok: true });
  };
  r.post("/admin/queue/:id/approve", decide(true));
  r.post("/admin/queue/:id/reject", decide(false));

  /* per-site pages */
  r.param("slug", (req, res, next, slug) => {
    if (!SITE_CFG[slug]) return res.status(404).send("Unknown mock site");
    next();
  });

  r.get("/:slug/", (req, res) => {
    const cfg = SITE_CFG[req.params.slug];
    const q = String(req.query.q ?? "").toLowerCase();
    const rows = (getDb().prepare("SELECT * FROM mock_listings WHERE site=?").all(`site_${cfg.slug}`) as any[])
      .filter((x) => !q || x.display_name.toLowerCase().includes(q));
    res.send(page(cfg, "Search", `<h1>Search businesses</h1><form><input name="q" value="${esc(q)}" placeholder="name"><button>Search</button></form>
<ul>${rows.map((x) => `<li><a href="/mock/${cfg.slug}/listing/${x.listing_id}">${esc(x.display_name)}</a> — ${esc(x.address)} (${x.listing_id})</li>`).join("")}</ul>`));
  });

  r.get("/:slug/listing/:id", (req, res) => {
    const cfg = SITE_CFG[req.params.slug];
    const l = load(cfg.slug, req.params.id);
    if (!l) return res.status(404).send(page(cfg, "Not found", "<h1>Listing not found</h1>"));
    res.send(renderPublic(cfg, l));
  });

  r.get("/:slug/dashboard/:id", (req, res) => {
    const cfg = SITE_CFG[req.params.slug];
    const l = load(cfg.slug, req.params.id);
    if (!l) return res.status(404).send(page(cfg, "Not found", "<h1>Listing not found</h1>"));
    res.send(renderDashboard(cfg, l, mockAccountOf(req)));
  });

  /** Mock stand-in for "claim this business". Real sites verify ownership first (OTP, postcard, phone call) —
   *  that step is always a human's; nothing here automates or bypasses it. */
  r.post("/:slug/claim/:id", (req, res) => {
    const cfg = SITE_CFG[req.params.slug];
    const l = load(cfg.slug, req.params.id);
    const acct = mockAccountOf(req);
    const log = (code: number) =>
      getDb().prepare("INSERT INTO mock_writes (site,listing_id,at,account,action,result_code) VALUES (?,?,?,?,?,?)")
        .run(`site_${cfg.slug}`, req.params.id, nowTs(), acct ?? "anonymous", "claim", code);
    if (!acct) { log(401); return res.status(401).json({ error: "login_required" }); }
    if (!l) { log(404); return res.status(404).json({ error: "listing not found" }); }
    if (l.owner_account) { log(409); return res.status(409).json({ error: "already_claimed" }); }
    const info = getDb().prepare("UPDATE mock_listings SET owner_account=? WHERE site=? AND listing_id=? AND owner_account IS NULL").run(acct, l.site, l.listing_id);
    if (!Number(info.changes)) { log(409); return res.status(409).json({ error: "already_claimed" }); } // someone claimed it a moment ago
    log(200);
    res.json({ status: "claimed" });
  });

  r.post("/:slug/dashboard/:id/update", (req, res) => {
    const cfg = SITE_CFG[req.params.slug];
    const l = load(cfg.slug, req.params.id);
    const acct = mockAccountOf(req); // null = anonymous or a forged token
    const log = (action: string, code: number) =>
      getDb().prepare("INSERT INTO mock_writes (site,listing_id,at,account,action,result_code) VALUES (?,?,?,?,?,?)")
        .run(`site_${cfg.slug}`, req.params.id, nowTs(), acct ?? "anonymous", action, code);
    if (!l) { log("unknown", 404); return res.status(404).json({ error: "listing not found" }); }
    if (!acct) { log("unauthenticated", 401); return res.status(401).json({ error: "login_required" }); }
    const parsed = ChangeZ.safeParse(req.body);
    if (!parsed.success) { log("invalid", 400); return res.status(400).json({ error: "invalid change" }); }
    const change = parsed.data;
    if (l.owner_account !== acct) {
      log(change.action, 403);
      return res.status(403).json({ error: "permission_denied", message: "This listing is claimed by another account." });
    }
    if (cfg.moderation) {
      const info = getDb().prepare("INSERT INTO mock_queue (site,listing_id,change_json,summary,status,created_at) VALUES (?,?,?,?,?,?)")
        .run(l.site, l.listing_id, JSON.stringify(change), summariseChange(change), "pending", nowTs());
      log(change.action, 202);
      return res.status(202).json({ status: "pending_moderation", queueId: Number(info.lastInsertRowid) });
    }
    applyChange(l, change);
    save(l);
    log(change.action, 200);
    res.json({ status: "applied" });
  });

  return r;
}

