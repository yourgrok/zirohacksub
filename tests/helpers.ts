import type { AddressInfo } from "node:net";
import { closeDb, getDb } from "../src/core/db.js";
import { DEMO_PIN, hashPin } from "../src/auth/pin.js";
import { resetAndSeed } from "../src/core/seed.js";
import { createApp } from "../src/server/app.js";
import { resetLoginLimiter } from "../src/server/auth.js";

export async function startTestServer() {
  resetAndSeed();
  resetLoginLimiter();
  const app = createApp();
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.BASE_URL = url;
  return {
    url,
    close: () => new Promise<void>((r) => server.close(() => { closeDb(); r(); })),
  };
}

/** A tiny fetch wrapper that keeps the session cookie, like a browser tab. */
export class Client {
  cookie = "";
  constructor(public url: string) {}
  async req(path: string, init: RequestInit & { json?: unknown; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (this.cookie) headers.cookie = this.cookie;
    if (init.json !== undefined) { headers["content-type"] = "application/json"; init.body = JSON.stringify(init.json); }
    const r = await fetch(this.url + path, { ...init, headers, redirect: "manual" });
    const set = r.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const [kv] = c.split(";");
      if (kv.startsWith("sid=")) this.cookie = kv.endsWith("=") ? "" : kv;
    }
    const text = await r.text();
    let body: any = text;
    try { body = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, body, headers: r.headers, setCookie: set };
  }
  get(path: string) { return this.req(path); }
  post(path: string, json: unknown = {}, headers?: Record<string, string>) { return this.req(path, { method: "POST", json, headers }); }
  async login(pin: string = DEMO_PIN) { return this.post("/api/auth/login", { pin }); }
}

/** Insert a second, active business directly (for isolation tests). */
export function insertBusiness(id: string, name: string, pin: string, opts: { demo?: boolean } = {}) {
  getDb().prepare("INSERT INTO business (id,name,address,phone,hours_json,pin_hmac,mock_account,status,is_demo,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(id, name, "1 Test Road, Pune 411001", "+91 90000 09999", JSON.stringify({ mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null }), hashPin(pin), `acct_${id}`, "active", opts.demo ? 1 : 0, new Date().toISOString());
}
