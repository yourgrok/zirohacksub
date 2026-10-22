import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../src/core/db.js";

// The schema exactly as it was before multi-business support (commit 8a79d3f).
const OLD_SCHEMA = `
CREATE TABLE IF NOT EXISTS business (id TEXT PRIMARY KEY, name TEXT, address TEXT, phone TEXT, hours_json TEXT);
CREATE TABLE IF NOT EXISTS exceptions (
  id TEXT PRIMARY KEY, business_id TEXT, start_date TEXT, end_date TEXT, kind TEXT, open TEXT, close TEXT,
  reason TEXT, source TEXT, status TEXT DEFAULT 'active', created_at TEXT);
CREATE TABLE IF NOT EXISTS platforms (id TEXT PRIMARY KEY, name TEXT, slug TEXT);
CREATE TABLE IF NOT EXISTS platform_listings (
  platform_id TEXT, business_id TEXT, listing_id TEXT, public_path TEXT, dashboard_path TEXT,
  PRIMARY KEY (platform_id, business_id));
CREATE TABLE IF NOT EXISTS field_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT, platform_id TEXT, field_key TEXT, label TEXT, state TEXT,
  original_raw TEXT, original_norm TEXT, current_raw TEXT, current_norm TEXT,
  intended TEXT, intended_display TEXT, reason TEXT, exception_id TEXT, updated_at TEXT,
  UNIQUE(platform_id, field_key));
CREATE TABLE IF NOT EXISTS state_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, field_id INTEGER, from_state TEXT, to_state TEXT, actor TEXT, at TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, actor TEXT, action TEXT, platform_id TEXT, field_key TEXT, detail TEXT);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, kind TEXT, status TEXT, planner_mode TEXT, started_at TEXT, finished_at TEXT, summary TEXT);
CREATE TABLE IF NOT EXISTS trace (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, at TEXT, tool TEXT, input TEXT, output_summary TEXT,
  duration_ms INTEGER, decider TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS mock_listings (
  site TEXT, listing_id TEXT, display_name TEXT, address TEXT, phone TEXT, hours_json TEXT, holidays_json TEXT,
  owner_account TEXT, is_decoy INTEGER DEFAULT 0, PRIMARY KEY (site, listing_id));
CREATE TABLE IF NOT EXISTS mock_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT, listing_id TEXT, change_json TEXT, summary TEXT,
  status TEXT DEFAULT 'pending', created_at TEXT);
CREATE TABLE IF NOT EXISTS mock_writes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT, listing_id TEXT, at TEXT, account TEXT, action TEXT, result_code INTEGER);
`;

afterEach(() => { closeDb(); delete process.env.DB_PATH; process.env.DB_PATH = ":memory:"; });

describe("in-place schema migration (no data is dropped)", () => {
  it("copies old rows, assigns them to the original business, and adds the new columns/tables", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mig-")), "old.db");
    const old = new Database(file);
    old.exec(OLD_SCHEMA);
    old.prepare("INSERT INTO business VALUES (?,?,?,?,?)").run("biz_sunrise_001", "Sunrise Sweets & Bakery", "addr", "+91 90000 00001", "{}");
    old.prepare("INSERT INTO field_states (platform_id,field_key,label,state,original_raw,intended,updated_at) VALUES (?,?,?,?,?,?,?)")
      .run("site_b", "phone", "Phone", "PROPOSED", "old value", "{}", "2026-10-21T00:00:00Z");
    old.prepare("INSERT INTO runs (id,kind,status,planner_mode,started_at) VALUES (?,?,?,?,?)").run("run_1", "scan", "done", "deterministic", "2026-10-21T00:00:00Z");
    old.prepare("INSERT INTO trace (run_id,at,tool,input,output_summary,duration_ms,decider) VALUES (?,?,?,?,?,?,?)").run("run_1", "t", "read_listing", "{}", "ok", 3, "Deterministic");
    old.close();

    process.env.DB_PATH = file;
    const db = getDb();
    const f = db.prepare("SELECT * FROM field_states").get() as any;
    expect(f).toMatchObject({ business_id: "biz_sunrise_001", platform_id: "site_b", field_key: "phone", state: "PROPOSED", original_raw: "old value" });
    expect((db.prepare("SELECT COUNT(*) c FROM business").get() as any).c).toBe(1);
    expect((db.prepare("SELECT business_id FROM runs").get() as any).business_id).toBe("biz_sunrise_001");
    expect((db.prepare("SELECT business_id FROM trace").get() as any).business_id).toBe("biz_sunrise_001");
    const bizCols = (db.prepare("PRAGMA table_info(business)").all() as any[]).map((c) => c.name);
    for (const c of ["pin_hmac", "mock_account", "status", "is_demo"]) expect(bizCols).toContain(c);
    for (const t of ["sessions", "site_matches", "onboarding_drafts"]) expect(db.prepare(`SELECT COUNT(*) c FROM ${t}`).get()).toBeTruthy();
    // uniqueness is now per business
    const ins = db.prepare("INSERT INTO field_states (business_id,platform_id,field_key,label,state,updated_at) VALUES (?,?,?,?,?,?)");
    ins.run("biz_other", "site_b", "phone", "Phone", "MISMATCH", "t");
    expect(() => ins.run("biz_other", "site_b", "phone", "Phone", "MISMATCH", "t")).toThrow();
  });
  it("opening an already-migrated database again is a no-op", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mig-")), "new.db");
    process.env.DB_PATH = file;
    getDb().prepare("INSERT INTO field_states (business_id,platform_id,field_key,label,state,updated_at) VALUES (?,?,?,?,?,?)").run("b1", "site_a", "phone", "Phone", "MATCH", "t");
    closeDb();
    expect((getDb().prepare("SELECT COUNT(*) c FROM field_states").get() as any).c).toBe(1);
  });
});
