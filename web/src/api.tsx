import React from "react";

export class ApiError extends Error {
  constructor(message: string, public status: number, public data?: any) { super(message); }
}

export async function api<T = any>(path: string, body?: unknown, method?: string): Promise<T> {
  const r = await fetch(path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    // a 401 anywhere except the login/onboarding calls means the session ended: send the person back to the PIN screen
    if (r.status === 401 && !path.startsWith("/api/auth/") && !path.startsWith("/api/onboarding/")) window.dispatchEvent(new Event("session-expired"));
    throw new ApiError(data?.error ?? `HTTP ${r.status}`, r.status, data);
  }
  return data as T;
}

export const STATE_LABEL: Record<string, string> = {
  MATCH: "Matches", FORMAT_ONLY_EQUIVALENT: "Same, formatted differently", MISMATCH: "Different", PROPOSED: "Needs your approval",
  APPROVED: "Approved", REJECTED: "Rejected", APPLIED: "Sent — not yet verified", VERIFIED: "Verified", PENDING_MODERATION: "Pending moderation",
  FLAGGED_NOT_OWNER: "Flagged — not your listing",
};

export function Pill({ state }: { state: string }) {
  return <span className={`pill s-${state}`}>{STATE_LABEL[state] ?? state}</span>;
}

export type Me = { authenticated: boolean; business?: { id: string; name: string; isDemo: boolean } };
