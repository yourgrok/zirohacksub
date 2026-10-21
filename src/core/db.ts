import Database from "better-sqlite3";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

/** The small slice of the better-sqlite3 API this app uses. */
export interface DB {
  prepare(sql: string): { run(...a: any[]): { changes: number | bigint; lastInsertRowid: number | bigint }; get(...a: any[]): unknown; all(...a: any[]): unknown[] };
  exec(sql: string): unknown;
  pragma(s: string): unknown;
  transaction<T extends (...a: any[]) => any>(fn: T): T;
  close(): void;
}

/** Fallback driver (Node's built-in node:sqlite) in case better-sqlite3's native binary is unavailable, e.g. on some Windows setups. */
function nodeSqlite(file: string): DB {
  const d = new DatabaseSync(file);
  return {
    prepare: (sql) => d.prepare(sql) as any,
    exec: (sql) => d.exec(sql),
    pragma: (s) => d.exec(`PRAGMA ${s}`),
    transaction: (fn) => ((...a: any[]) => { d.exec("BEGIN"); try { const r = fn(...a); d.exec("COMMIT"); return r; } catch (e) { d.exec("ROLLBACK"); throw e; } }) as any,
    close: () => d.close(),
  };
}

export let driverName = "better-sqlite3";
function open(file: string): DB {
  if (process.env.SQLITE_DRIVER !== "node") {
    try { return new Database(file) as unknown as DB; } catch (e) {
      console.warn(`better-sqlite3 unavailable (${(e as Error).message.split("\n")[0]}); using node:sqlite`);
    }
  }
  driverName = "node:sqlite";
  return nodeSqlite(file);
}

let db: DB | null = null;

const SCHEMA = `
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

export function dbPath(): string {
  return process.env.DB_PATH || path.join(process.cwd(), "data", "app.db");
}

export function getDb(): DB {
  if (db) return db;
  const p = dbPath();
  if (p !== ":memory:") fs.mkdirSync(path.dirname(p), { recursive: true });
  db = open(p);
  db.pragma("journal_mode = MEMORY");
  db.exec(SCHEMA);
  return db;
}

export function closeDb() {
  db?.close();
  db = null;
}

const TABLES = [
  "business", "exceptions", "platforms", "platform_listings", "field_states", "state_history", "audit_log",
  "runs", "trace", "mock_listings", "mock_queue", "mock_writes",
];

export function wipeAll() {
  const d = getDb();
  for (const t of TABLES) d.exec(`DELETE FROM ${t}`);
  d.exec("DELETE FROM sqlite_sequence");
}

export function dbStatus(): "ok" | "error" {
  try {
    getDb().prepare("select 1").get();
    return "ok";
  } catch {
    return "error";
  }
}
