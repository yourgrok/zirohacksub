import { getDb } from "../core/db.js";
import { nowTs } from "../core/clock.js";
import { listFields, listPlatforms } from "../core/store.js";
import { getTrace, isRunning } from "./loop.js";
import { execute, scan } from "./service.js";

export interface AgentEvent { id: number; at: string; kind: string; platform_id: string | null; message: string; seen: number }

export const autopilotIntervalMs = () => Number(process.env.AUTOPILOT_INTERVAL_MS ?? 60000);

export function setAutopilot(bizId: string, on: boolean) {
  getDb().prepare("UPDATE business SET autopilot=? WHERE id=?").run(on ? 1 : 0, bizId);
  if (on) pushEvent(bizId, "autopilot", null, "Autopilot is on. I will check your listings on my own and only ask you when something needs a decision.");
}
export function autopilotInfo(bizId: string) {
  const r = getDb().prepare("SELECT autopilot, autopilot_checked_at FROM business WHERE id=?").get(bizId) as { autopilot: number; autopilot_checked_at: string | null } | undefined;
  return { on: !!r?.autopilot, lastCheckedAt: r?.autopilot_checked_at ?? null, everyMs: autopilotIntervalMs() };
}

export function pushEvent(bizId: string, kind: string, platformId: string | null, message: string) {
  getDb().prepare("INSERT INTO agent_events (business_id, at, kind, platform_id, message, seen) VALUES (?,?,?,?,?,0)").run(bizId, nowTs(), kind, platformId, message);
}
export function listEvents(bizId: string, limit = 12): AgentEvent[] {
  return getDb().prepare("SELECT id, at, kind, platform_id, message, seen FROM agent_events WHERE business_id=? ORDER BY id DESC LIMIT ?").all(bizId, limit) as AgentEvent[];
}
export function markEventsSeen(bizId: string) { getDb().prepare("UPDATE agent_events SET seen=1 WHERE business_id=?").run(bizId); }

const siteName = (id: string | null) => (listPlatforms().find((p) => p.id === id)?.name ?? id ?? "").replace(/ \(.*\)/, "");

/**
 * One autopilot pass for one business: apply what the owner already approved and re-check anything waiting, then look at every listing again.
 * It NEVER approves anything. What it found is turned into events the owner sees ("while you were away").
 */
export async function autopilotRun(bizId: string): Promise<{ ran: boolean; events: number }> {
  if (isRunning(bizId)) return { ran: false, events: 0 };
  const before = new Map(listFields(bizId).map((f) => [f.id, f.state]));
  const waiting = [...before.values()].some((s) => s === "APPROVED" || s === "APPLIED" || s === "PENDING_MODERATION");
  let events = 0;
  const say = (kind: string, p: string | null, m: string) => { pushEvent(bizId, kind, p, m); events++; };
  try {
    if (waiting) await execute(bizId);
    const mid = new Map(listFields(bizId).map((f) => [f.id, f]));
    for (const [id, f] of mid) {
      const was = before.get(id);
      if (f.state === "VERIFIED" && (was === "PENDING_MODERATION" || was === "APPLIED" || was === "APPROVED")) {
        say("fixed", f.platform_id, was === "PENDING_MODERATION" ? `${siteName(f.platform_id)} approved the edit. ${f.label} is now live and I checked it.` : `I applied the change you approved on ${siteName(f.platform_id)} (${f.label}) and checked it by reloading the page.`);
      }
    }
    const preScan = new Map(listFields(bizId).map((f) => [f.id, f.state]));
    const r = await scan(bizId);
    for (const f of listFields(bizId)) {
      const was = preScan.get(f.id);
      if (was && ["MATCH", "FORMAT_ONLY_EQUIVALENT", "VERIFIED"].includes(was) && ["MISMATCH", "PROPOSED"].includes(f.state)) {
        say("drift", f.platform_id, `${siteName(f.platform_id)} changed by itself: ${f.label} now shows "${f.current_raw}" instead of the correct value. I wrote a fix for you to approve.`);
      } else if (was !== "PROPOSED" && f.state === "PROPOSED" && !was) {
        say("proposal", f.platform_id, `I found a difference on ${siteName(f.platform_id)} (${f.label}) and wrote a fix for you to approve.`);
      }
    }
    for (const t of getTrace(r.runId)) {
      if (t.tool === "read_listing" && t.output_summary.startsWith("ERROR")) {
        const p = (JSON.parse(t.input || "{}") as { platform?: string }).platform ?? null;
        say("unreachable", p, `${siteName(p)} was not answering, so I could not check it. I'll try again on my next pass.`);
      }
    }
    return { ran: true, events };
  } catch {
    return { ran: false, events };
  } finally {
    getDb().prepare("UPDATE business SET autopilot_checked_at=? WHERE id=?").run(nowTs(), bizId);
  }
}

let timer: NodeJS.Timeout | null = null;
export function startAutopilot() {
  if (timer) return;
  timer = setInterval(async () => {
    const ids = (getDb().prepare("SELECT id FROM business WHERE autopilot=1 AND status='active'").all() as { id: string }[]).map((r) => r.id);
    for (const id of ids) await autopilotRun(id);
  }, autopilotIntervalMs());
  timer.unref();
}
export function stopAutopilot() { if (timer) clearInterval(timer); timer = null; }
