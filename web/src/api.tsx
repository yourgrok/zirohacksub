export async function api<T = any>(path: string, body?: unknown, method?: string): Promise<T> {
  const r = await fetch(path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
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
