import type { NextFunction, Request, Response } from "express";
import { getDb } from "../core/db.js";
import { findBusiness, type BusinessRecord } from "../core/store.js";
import { LoginLimiter } from "../auth/limiter.js";
import { hashPin, normalisePin, safeEqualHex } from "../auth/pin.js";
import { clearSessionCookie, createSession, destroySession, sessionBusiness, setSessionCookie, tokenOf } from "../auth/sessions.js";
import { eventRun, logEvent } from "../auth/events.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { biz?: BusinessRecord } }
}

export let loginLimiter = new LoginLimiter();
/** Test hook: start with a fresh limiter. */
export function resetLoginLimiter() { loginLimiter = new LoginLimiter(); }
/** Hook so onboarding can activate a pending business on its first successful login. */
let activator: ((bizId: string) => Promise<boolean>) | null = null;
export function setActivator(fn: (bizId: string) => Promise<boolean>) { activator = fn; }

export const clientKey = (req: Request) => req.ip ?? req.socket.remoteAddress ?? "unknown";

/** Refuse cross-site state-changing requests (defence in depth on top of SameSite=Lax cookies). */
export function sameOrigin(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const origin = req.headers.origin;
  if (origin) {
    let host = "";
    try { host = new URL(origin).host; } catch { /* malformed */ }
    if (host !== req.headers.host) return res.status(403).json({ error: "Cross-site request refused." });
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const bizId = sessionBusiness(tokenOf(req));
  const biz = bizId ? findBusiness(bizId) : undefined;
  if (!biz || biz.status !== "active") return res.status(401).json({ error: "Please log in with your PIN." });
  req.biz = biz;
  next();
}

/** Global operations (reset, test runner, evidence) are only for the seeded demo business. */
export function requireDemo(req: Request, res: Response, next: NextFunction) {
  if (!req.biz?.isDemo) return res.status(403).json({ error: "Only the demo business can do this." });
  next();
}

export const bizOf = (req: Request): string => req.biz!.id;

export async function login(req: Request, res: Response) {
  const key = clientKey(req);
  const chk = loginLimiter.check(key);
  if (!chk.allowed) {
    res.setHeader("Retry-After", String(chk.retryAfterSec));
    return res.status(429).json({ error: `Too many attempts. Try again in ${chk.retryAfterSec} seconds.`, retryAfterSec: chk.retryAfterSec });
  }
  const fail = () => {
    const cooldown = loginLimiter.fail(key);
    logEvent(eventRun(null, "auth"), "login_failed", { method: "pin" }, cooldown ? `invalid PIN; this client is locked for ${cooldown}s` : "invalid PIN");
    return res.status(401).json({ error: "Invalid PIN." }); // one generic message for every failure
  };
  const pin = normalisePin(req.body?.pin);
  if (!pin) return fail();
  const h = hashPin(pin);
  const row = getDb().prepare("SELECT id, pin_hmac, status, created_at FROM business WHERE pin_hmac=?").get(h) as { id: string; pin_hmac: string; status: string; created_at: string } | undefined;
  if (!row || !safeEqualHex(row.pin_hmac, h)) return fail();
  if (row.status === "pending") {
    const ok = activator ? await activator(row.id) : false;
    if (!ok) return fail(); // expired or could not be activated
  }
  loginLimiter.success(key);
  const token = createSession(row.id);
  setSessionCookie(req, res, token);
  logEvent(eventRun(row.id, "auth"), "login", { method: "pin" }, "PIN accepted; session started");
  const b = findBusiness(row.id)!;
  res.json({ ok: true, business: { id: b.id, name: b.name, isDemo: b.isDemo } });
}

export function logout(req: Request, res: Response) {
  const token = tokenOf(req);
  const bizId = sessionBusiness(token);
  destroySession(token);
  clearSessionCookie(req, res);
  if (bizId) logEvent(eventRun(bizId, "auth"), "logout", {}, "session ended");
  res.json({ ok: true });
}

export function me(req: Request, res: Response) {
  const bizId = sessionBusiness(tokenOf(req));
  const b = bizId ? findBusiness(bizId) : undefined;
  if (!b || b.status !== "active") return res.json({ authenticated: false });
  res.json({ authenticated: true, business: { id: b.id, name: b.name, isDemo: b.isDemo } });
}
