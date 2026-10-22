import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { getDb } from "../core/db.js";

export const COOKIE = "sid";
export const SESSION_TTL_MS = 8 * 3600_000;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Random 256-bit session id. Only its SHA-256 is stored, so a leaked database cannot be used to hijack sessions. */
export function createSession(bizId: string): string {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  getDb().prepare("INSERT INTO sessions (id_hash,business_id,created_at,expires_at) VALUES (?,?,?,?)")
    .run(sha(token), bizId, new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString());
  return token;
}

export function sessionBusiness(token: string | undefined): string | null {
  if (!token || token.length < 20 || token.length > 100) return null;
  const r = getDb().prepare("SELECT business_id, expires_at FROM sessions WHERE id_hash=?").get(sha(token)) as { business_id: string; expires_at: string } | undefined;
  if (!r) return null;
  if (Date.parse(r.expires_at) <= Date.now()) { destroySession(token); return null; }
  return r.business_id;
}

export function destroySession(token: string | undefined) {
  if (token) getDb().prepare("DELETE FROM sessions WHERE id_hash=?").run(sha(token));
}

export function purgeExpiredSessions() {
  getDb().prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export const tokenOf = (req: Request) => parseCookies(req.headers.cookie)[COOKIE];

export function setSessionCookie(req: Request, res: Response, token: string) {
  const secure = req.secure ? "; Secure" : "";
  res.append("Set-Cookie", `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`);
}

export function clearSessionCookie(req: Request, res: Response) {
  const secure = req.secure ? "; Secure" : "";
  res.append("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}
