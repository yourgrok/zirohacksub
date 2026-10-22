import { z } from "zod";
import { nowTs } from "../core/clock.js";
import { audit, createField, getBusiness, getFieldByKey, getPlatformListing, listExceptions, listFields, transition, type FieldRow } from "../core/store.js";
import { ChangeZ, type Change } from "../mock/changes.js";
import { mockAuthHeaders } from "../auth/mockCreds.js";
import { applyCreate, isCreateRow, verifyCreate } from "./createListing.js";
import { isCreate } from "../mock/changes.js";
import { changeKey, compareAll, normalisePublic, showsIntended, type Comparison } from "./compare.js";
import { baseUrl, fetchPage, parseDashboard, parsePublic } from "./reader.js";
import { recordTrace } from "./loop.js";
import { TOOL_NAMES, type RunState, type ToolName } from "./types.js";

export interface ToolResult { summary: string; data?: unknown; forced?: { reason: string } }

const slugOf = (platformId: string) => platformId.replace("site_", "");

const RETRIES = 3;
const retryMs = (n: number) => Number(process.env.AGENT_RETRY_MS ?? 300) * n;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A site that is briefly down is retried a few times (and each retry is visible in the trace) before the agent gives up on it. */
async function loadWithRetry(st: RunState, platformId: string, path: string, opts: Parameters<typeof fetchPage>[1] = {}) {
  let last = "";
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const page = await fetchPage(path, opts);
      if (page.status < 500) return page;
      last = `HTTP ${page.status}`;
    } catch (e) { last = (e as Error).message; }
    if (attempt < RETRIES) {
      recordTrace(st.runId, "read_listing", { platform: platformId, attempt }, `${platformId} did not answer (${last}); waiting, then trying again (${attempt}/${RETRIES - 1})`, 0, "Deterministic", "recovery: temporary outage");
      await sleep(retryMs(attempt));
    }
  }
  throw new Error(`${platformId} is not answering (${last}) after ${RETRIES} tries`);
}

async function ensureRead(st: RunState, platformId: string, fresh = false) {
  const existing = st.reads.get(platformId);
  if (existing && !fresh) return existing;
  const l = getPlatformListing(st.bizId, platformId);
  const slug = slugOf(platformId);
  const pubPage = await loadWithRetry(st, platformId, l.publicPath);
  // the dashboard is read with this business's delegated login for the site (the public page needs none)
  const dashPage = await loadWithRetry(st, platformId, l.dashboardPath, { headers: mockAuthHeaders(getBusiness(st.bizId).mockAccount) });
  if (pubPage.status !== 200) throw new Error(`Public page returned HTTP ${pubPage.status}`);
  const pub = parsePublic(slug, pubPage.html);
  const dash = parseDashboard(dashPage.html);
  // identity: never trust a page that is not the exact registered listing (look-alike protection)
  if (pub.listingId !== l.listingId || (dash.listingId && dash.listingId !== l.listingId)) {
    throw new Error(`IDENTITY_MISMATCH: expected ${l.listingId}, page shows ${pub.listingId}`);
  }
  const r = { pub, dash, via: pubPage.via };
  st.reads.set(platformId, r);
  st.canEdit.set(platformId, dash.canEdit);
  return r;
}

/** Upsert one comparison into field_states without disturbing in-flight work. */
function upsertComparison(bizId: string, platformId: string, c: Comparison) {
  const patch = {
    label: c.label, current_raw: c.currentRaw, current_norm: c.currentNorm,
    intended: c.change ? JSON.stringify(c.change) : null, intended_display: c.intendedDisplay, exception_id: c.exceptionId,
  };
  const ex = getFieldByKey(bizId, platformId, c.key);
  if (!ex) {
    createField({ business_id: bizId, platform_id: platformId, field_key: c.key, state: c.state, original_raw: c.currentRaw, original_norm: c.currentNorm, reason: c.note, ...patch });
    return;
  }
  switch (ex.state) {
    case "APPROVED": case "APPLIED": case "PENDING_MODERATION": return; // in flight
    case "FLAGGED_NOT_OWNER":
      if (c.state !== "MISMATCH") transition(ex.id, c.state, "comparator", c.note, { ...patch, original_raw: c.currentRaw, original_norm: c.currentNorm });
      return;
    case "VERIFIED":
      if (c.state === "MISMATCH") transition(ex.id, "MISMATCH", "comparator", "drifted after verification", { ...patch, original_raw: c.currentRaw, original_norm: c.currentNorm });
      return;
    case "PROPOSED": case "REJECTED":
      if (c.state === "MISMATCH") { transition(ex.id, ex.state, "comparator", c.note, patch); return; }
      transition(ex.id, c.state, "comparator", c.note, { ...patch, original_raw: c.currentRaw, original_norm: c.currentNorm });
      return;
    default:
      transition(ex.id, c.state, "comparator", c.note, { ...patch, original_raw: c.currentRaw, original_norm: c.currentNorm });
  }
}

const PlatformIn = z.object({ platform: z.string() });

export interface ToolDef {
  name: ToolName;
  description: string;
  schema: z.ZodType<any>;
  run(st: RunState, input: any): Promise<ToolResult>;
}

export const TOOLS: Record<ToolName, ToolDef> = {
  read_listing: {
    name: "read_listing",
    description: "Read the public listing page and the owner dashboard of one platform. Returns raw values and whether we are allowed to edit.",
    schema: PlatformIn,
    async run(st, { platform }) {
      const r = await ensureRead(st, platform, true);
      return { summary: `${r.pub.name} [${r.pub.listingId}] via ${r.via}; phone="${r.pub.phone}"; ${r.pub.holidayLines.length} special day(s); canEdit=${r.dash.canEdit}${r.dash.pending.length ? `; ${r.dash.pending.length} pending` : ""}` };
    },
  },
  normalise: {
    name: "normalise",
    description: "Normalise the values read from a platform (phone to E.164 +91, address tidy-up, hours and holiday parsing). Raw values are kept.",
    schema: PlatformIn,
    async run(st, { platform }) {
      const r = await ensureRead(st, platform);
      const n = normalisePublic(r.pub);
      st.norms.set(platform, n);
      return { summary: `phone ${r.pub.phone} -> ${n.phone}; hours ${n.hoursCanon}; ${n.holidays.length} holiday entr${n.holidays.length === 1 ? "y" : "ies"}${n.unparsed.length ? `; ${n.unparsed.length} unparsed` : ""}` };
    },
  },
  compare: {
    name: "compare",
    description: "Compare each field's meaning with the owner-approved record (formatting-only differences are not mismatches).",
    schema: PlatformIn,
    async run(st, { platform }) {
      const r = await ensureRead(st, platform);
      const n = st.norms.get(platform) ?? normalisePublic(r.pub);
      const comps = compareAll(getBusiness(st.bizId), listExceptions(st.bizId), r.pub, n);
      st.comps.set(platform, comps);
      for (const c of comps) upsertComparison(st.bizId, platform, c);
      // fields that no longer exist in the comparison (exception cancelled or past) must not stay actionable
      const keys = new Set(comps.map((c) => c.key));
      for (const f of listFields(st.bizId, platform)) {
        if (!keys.has(f.field_key) && !isCreateRow(f) && ["MISMATCH", "PROPOSED", "REJECTED"].includes(f.state)) {
          transition(f.id, "MATCH", "comparator", "no longer relevant (cancelled or past); nothing to change");
        }
      }
      const tally = (s: string) => comps.filter((c) => c.state === s).length;
      return { summary: `${comps.length} fields: ${tally("MATCH")} match, ${tally("FORMAT_ONLY_EQUIVALENT")} formatting-only, ${tally("MISMATCH")} mismatch` };
    },
  },
  propose: {
    name: "propose",
    description: "Turn each mismatch into a proposal card for the owner. Nothing is written to the platform.",
    schema: PlatformIn,
    async run(st, { platform }) {
      let n = 0;
      for (const f of listFields(st.bizId, platform)) {
        if (f.state === "MISMATCH" && f.intended) { transition(f.id, "PROPOSED", "planner", "proposed to owner for approval"); n++; }
      }
      audit(st.bizId, "agent", "propose", platform, null, { proposals: n });
      return { summary: `${n} proposal(s) created; waiting for owner approval` };
    },
  },
  flag_listing: {
    name: "flag_listing",
    description: "Flag a listing we may not edit (claimed by someone else / no permission). Never attempts an edit.",
    schema: z.object({ platform: z.string(), reason: z.string().optional() }),
    async run(st, { platform, reason }) {
      let n = 0;
      for (const f of listFields(st.bizId, platform)) {
        if (["MISMATCH", "PROPOSED", "APPROVED"].includes(f.state)) {
          transition(f.id, "FLAGGED_NOT_OWNER", "system", reason ?? "listing is claimed by another account — owner must reclaim it manually");
          n++;
        }
      }
      if (n > 0) audit(st.bizId, "agent", "flag", platform, null, { flagged: n, reason: reason ?? "permission denied" }); // a repeat scan that flags nothing new is not an event
      return { summary: `${n} field(s) flagged: not the listing owner; no edit attempted` };
    },
  },
  apply_approved: {
    name: "apply_approved",
    description: "Send ONLY owner-approved fields (state APPROVED in the database) to the platform dashboard.",
    schema: z.object({ platform: z.string(), fields: z.array(z.string()).optional() }),
    async run(st, { platform }) {
      const account = getBusiness(st.bizId).mockAccount;
      const approved = listFields(st.bizId, platform).filter((f) => f.state === "APPROVED");
      if (!approved.length) return { summary: "no approved fields; nothing sent" };
      const out: string[] = [];
      // "add my business to this site" cards (nothing is linked on that site yet, so there is no listing to read first)
      for (const f of approved.filter(isCreateRow)) out.push(await applyCreate(st, platform, f));
      const rows = approved.filter((f) => !isCreateRow(f));
      if (!rows.length) return { summary: out.join("; ") };
      const l = getPlatformListing(st.bizId, platform);
      const r = await ensureRead(st, platform, true);
      if (!r.dash.canEdit) {
        for (const f of rows) transition(f.id, "FLAGGED_NOT_OWNER", "system", "permission denied on dashboard — flagged, no edit attempted");
        audit(st.bizId, "agent", "flag", platform, null, { reason: "permission denied before apply", fields: rows.length });
        return { summary: `permission denied: ${rows.length} approved field(s) flagged, 0 writes attempted`, forced: { reason: "permission denied" } };
      }
      for (const f of rows) {
        const change = ChangeZ.parse(JSON.parse(f.intended!));
        // idempotence: re-read; if the page already shows the value, do not write again
        const fresh = await ensureRead(st, platform, true);
        const freshNorm = normalisePublic(fresh.pub);
        if (showsIntended(f.field_key, change, freshNorm)) {
          transition(f.id, "APPLIED", "applier", "page already showed the approved value; no write sent");
          out.push(`${f.field_key}: already correct`);
          continue;
        }
        // the page is not what the owner looked at when approving: do not write on stale information, ask again with the new facts
        const now = compareAll(getBusiness(st.bizId), listExceptions(st.bizId), fresh.pub, freshNorm).find((c) => c.key === f.field_key);
        if (now && f.current_norm != null && now.currentNorm !== f.current_norm) {
          const was = f.current_raw ?? "";
          transition(f.id, "PROPOSED", "planner", `The page changed after you approved: it showed "${was}" and now shows "${now.currentRaw}". Nothing was sent. Please look again and approve if the fix is still right.`,
            { current_raw: now.currentRaw, current_norm: now.currentNorm, original_raw: now.currentRaw, original_norm: now.currentNorm });
          audit(st.bizId, "agent", "replan", platform, f.field_key, { was, now: now.currentRaw });
          out.push(`${f.field_key}: page changed since approval (was "${was}", now "${now.currentRaw}") — sent nothing, asked the owner again`);
          continue;
        }
        const resp = await fetch(baseUrl() + l.dashboardPath + "/update", {
          method: "POST", headers: { "content-type": "application/json", ...mockAuthHeaders(account) }, body: JSON.stringify(change),
        });
        audit(st.bizId, "owner-approved", "apply", platform, f.field_key, { sent: change, http: resp.status, at: nowTs() });
        if (resp.status === 200 || resp.status === 202) {
          transition(f.id, "APPLIED", "applier", resp.status === 202 ? "sent; platform queued it for moderation" : "sent to platform dashboard");
          out.push(`${f.field_key}: sent (${resp.status})`);
        } else if (resp.status === 403) {
          transition(f.id, "FLAGGED_NOT_OWNER", "system", "platform denied permission");
          out.push(`${f.field_key}: 403 flagged`);
        } else {
          out.push(`${f.field_key}: HTTP ${resp.status} (stays approved)`);
        }
      }
      return { summary: out.join("; ") };
    },
  },
  reload_and_verify: {
    name: "reload_and_verify",
    description: "Reload the public page and dashboard and verify applied edits. Only this tool can mark a field VERIFIED.",
    schema: PlatformIn,
    async run(st, { platform }) {
      const inflight = listFields(st.bizId, platform).filter((f) => f.state === "APPLIED" || f.state === "PENDING_MODERATION");
      if (!inflight.length) return { summary: "nothing to verify" };
      const created: string[] = [];
      for (const f of inflight.filter(isCreateRow)) created.push(await verifyCreate(st, platform, f));
      const rows = inflight.filter((f) => !isCreateRow(f));
      if (!rows.length) return { summary: created.join("; ") };
      const r = await ensureRead(st, platform, true); // fresh reload
      const n = normalisePublic(r.pub);
      const comps = compareAll(getBusiness(st.bizId), listExceptions(st.bizId), r.pub, n);
      const res: string[] = [];
      for (const f of rows) {
        const change = ChangeZ.parse(JSON.parse(f.intended!)) as Change;
        const cmp = comps.find((c) => c.key === f.field_key);
        const patch = { current_raw: cmp?.currentRaw ?? f.current_raw, current_norm: cmp?.currentNorm ?? f.current_norm };
        if (showsIntended(f.field_key, change, n)) {
          transition(f.id, "VERIFIED", "verifier", `reloaded public page shows the approved value`, patch);
          res.push(`${f.field_key}: VERIFIED`);
        } else if (r.dash.pending.some((p) => p.change && !isCreate(p.change) && changeKey(p.change) === changeKey(change))) {
          transition(f.id, "PENDING_MODERATION", "verifier", "public page unchanged; edit is waiting in the platform's moderation queue", patch);
          res.push(`${f.field_key}: PENDING_MODERATION`);
        } else {
          // The site said OK but the page did not change and nothing is waiting in a queue: the edit was lost. Send the SAME owner-approved
          // change once more, then look again. Nothing new is sent and nothing the owner did not approve.
          const l = getPlatformListing(st.bizId, platform);
          const resp = await fetch(baseUrl() + l.dashboardPath + "/update", { method: "POST", headers: { "content-type": "application/json", ...mockAuthHeaders(getBusiness(st.bizId).mockAccount) }, body: JSON.stringify(change) });
          audit(st.bizId, "owner-approved", "apply-retry", platform, f.field_key, { sent: change, http: resp.status, at: nowTs() });
          recordTrace(st.runId, "reload_and_verify", { platform, field: f.field_key }, `${f.field_key}: the page did not change and nothing is pending, so the edit was lost. Re-sent the same approved change (HTTP ${resp.status}) and looking again`, 0, "Deterministic", "recovery: lost write");
          const again = await ensureRead(st, platform, true);
          const n2 = normalisePublic(again.pub);
          const cmp2 = compareAll(getBusiness(st.bizId), listExceptions(st.bizId), again.pub, n2).find((c) => c.key === f.field_key);
          const patch2 = { current_raw: cmp2?.currentRaw ?? patch.current_raw, current_norm: cmp2?.currentNorm ?? patch.current_norm };
          if (showsIntended(f.field_key, change, n2)) {
            transition(f.id, "VERIFIED", "verifier", "reloaded public page shows the approved value (after one re-send)", patch2);
            res.push(`${f.field_key}: VERIFIED after one re-send`);
          } else if (again.dash.pending.some((p) => p.change && !isCreate(p.change) && changeKey(p.change) === changeKey(change))) {
            transition(f.id, "PENDING_MODERATION", "verifier", "public page unchanged; edit is waiting in the platform's moderation queue", patch2);
            res.push(`${f.field_key}: PENDING_MODERATION`);
          } else {
            transition(f.id, "MISMATCH", "verifier", "the site said OK twice but the page still does not show the update; needs your attention", patch2);
            res.push(`${f.field_key}: NOT APPLIED (re-sent once, still not shown)`);
          }
        }
        audit(st.bizId, "verifier", "verify", platform, f.field_key, { result: getFieldByKey(st.bizId, platform, f.field_key)?.state });
      }
      return { summary: [...created, ...res].join("; ") };
    },
  },
  ask_owner: {
    name: "ask_owner",
    description: "Pause and ask the human owner to act (approve/reject cards, or take a manual step). The agent never automates OTP/CAPTCHA.",
    schema: z.object({ question: z.string() }),
    async run(st, { question }) {
      st.asked = true;
      return { summary: `asked owner: ${question}` };
    },
  },
};

export function toolCatalogue() {
  return TOOL_NAMES.map((n) => ({ name: n, description: TOOLS[n].description }));
}

export function countStates(bizId: string, platformId: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of listFields(bizId, platformId) as FieldRow[]) out[f.state] = (out[f.state] ?? 0) + 1;
  return out;
}

