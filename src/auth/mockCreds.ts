import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { appSecret } from "./secret.js";

/**
 * Stand-in for the owner's delegated login on a listing site (OAuth in real life).
 * Only this server can mint a valid token for an account, so nobody can edit a mock listing just by typing an account name.
 */
export function mockToken(account: string): string {
  return createHmac("sha256", appSecret()).update(`mock-account:v1:${account}`).digest("hex");
}

export function mockAuthHeaders(account: string): Record<string, string> {
  return { "x-mock-account": account, "x-mock-token": mockToken(account) };
}

/** Returns the authenticated mock account of a request, or null (anonymous). */
export function mockAccountOf(req: Request): string | null {
  const acct = req.header("x-mock-account");
  const tok = req.header("x-mock-token");
  if (!acct || !tok) return null;
  const want = Buffer.from(mockToken(acct), "hex");
  const got = Buffer.from(tok, "hex");
  return want.length === got.length && timingSafeEqual(want, got) ? acct : null;
}
