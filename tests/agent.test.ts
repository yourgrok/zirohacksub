import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetAndSeed } from "../src/core/seed.js";
import { getFieldByKey, listFields } from "../src/core/store.js";
import { getTrace } from "../src/agent/loop.js";
import { approveAllForPlatform, approveField, execute, scan } from "../src/agent/service.js";
import { startTestServer } from "./helpers.js";
import { getDb } from "../src/core/db.js";

let s: Awaited<ReturnType<typeof startTestServer>>;
beforeAll(async () => { s = await startTestServer(); });
afterAll(async () => { await s.close(); });
beforeEach(async () => { resetAndSeed(); });

const writes = (site: string) => (getDb().prepare("SELECT * FROM mock_writes WHERE site=?").all(site) as unknown[]);
const holidayKey = "holiday:ex_seed_diwali";

describe("TC1 holiday hours differ on one site", () => {
  it("is corrected: APPLIED then VERIFIED after reload, only after approval", async () => {
    await scan();
    const f = getFieldByKey("site_b", holidayKey)!;
    expect(f.state).toBe("PROPOSED");
    expect(f.original_raw).toContain("Closed");
    // nothing approved -> executing sends nothing
    await execute();
    expect(writes("site_b")).toHaveLength(0);
    expect(getFieldByKey("site_b", holidayKey)!.state).toBe("PROPOSED");
    approveField(f.id);
    await execute();
    expect(getFieldByKey("site_b", holidayKey)!.state).toBe("VERIFIED");
    expect(writes("site_b")).toHaveLength(1);
    const page = await (await fetch(`${s.url}/mock/b/listing/LST-B-1001`)).text();
    expect(page).toContain("2026-11-08");
    expect(page).toContain("10:00–14:00");
  });
  it("is idempotent: running execute again never double-applies", async () => {
    await scan();
    approveField(getFieldByKey("site_b", holidayKey)!.id);
    await execute();
    await execute();
    await scan();
    await execute();
    expect(writes("site_b")).toHaveLength(1);
    expect(getFieldByKey("site_b", holidayKey)!.state).toBe("VERIFIED");
  });
});

describe("TC2 phone formatted differently", () => {
  it("is FORMAT_ONLY_EQUIVALENT and creates no proposal", async () => {
    await scan();
    const phone = getFieldByKey("site_c", "phone")!;
    expect(phone.state).toBe("FORMAT_ONLY_EQUIVALENT");
    expect(phone.original_raw).toBe("090000 00001");
    expect(phone.current_norm).toBe("+919000000001");
    expect(phone.intended).toBeNull();
    expect(getFieldByKey("site_c", "address")!.state).toBe("FORMAT_ONLY_EQUIVALENT");
    expect(listFields("site_c").filter((f) => f.state === "PROPOSED")).toHaveLength(0);
    approveAllForPlatform("site_c");
    await execute();
    expect(writes("site_c")).toHaveLength(0);
  });
});

describe("TC3 listing claimed by someone else", () => {
  it("is flagged, never edited, zero write attempts", async () => {
    await scan();
    const phone = getFieldByKey("site_d", "phone")!;
    expect(phone.state).toBe("FLAGGED_NOT_OWNER");
    expect(listFields("site_d").some((f) => f.state === "PROPOSED")).toBe(false);
    expect(() => approveField(phone.id)).toThrow();
    await execute();
    expect(writes("site_d")).toHaveLength(0);
    expect(getFieldByKey("site_d", "phone")!.state).toBe("FLAGGED_NOT_OWNER");
  });
});

describe("TC4 edit pending moderation", () => {
  it("is PENDING_MODERATION until admin approves and the page is reloaded", async () => {
    await scan();
    const hours = getFieldByKey("site_e", "hours")!;
    expect(hours.state).toBe("PROPOSED");
    approveField(hours.id);
    await execute();
    expect(getFieldByKey("site_e", "hours")!.state).toBe("PENDING_MODERATION");
    const page = await (await fetch(`${s.url}/mock/e/listing/LST-E-1001`)).text();
    expect(page).toContain("Sun: Closed"); // public page unchanged
    // re-verifying while still pending must not mark it corrected
    await execute();
    expect(getFieldByKey("site_e", "hours")!.state).toBe("PENDING_MODERATION");
    const q = getDb().prepare("SELECT id FROM mock_queue WHERE status='pending'").get() as { id: number };
    await fetch(`${s.url}/mock/admin/queue/${q.id}/approve`, { method: "POST", headers: { "content-type": "application/json" } });
    await execute();
    expect(getFieldByKey("site_e", "hours")!.state).toBe("VERIFIED");
  });
});

describe("safety", () => {
  it("decoy listings are never edited", async () => {
    await scan();
    for (const p of ["site_a", "site_b", "site_c", "site_d", "site_e"]) approveAllForPlatform(p);
    await execute();
    const decoys = getDb().prepare("SELECT * FROM mock_listings WHERE is_decoy=1").all() as any[];
    for (const d of decoys) {
      expect(d.phone).toBe("+91 90000 00077");
      expect(d.address).toBe("17 Maple Road, Camp, Pune, Maharashtra 411001");
    }
    expect((getDb().prepare("SELECT COUNT(*) c FROM mock_writes WHERE listing_id LIKE '%-2002'").get() as any).c).toBe(0);
  });
  it("control site A has nothing to change", async () => {
    await scan();
    expect(listFields("site_a").every((f) => f.state === "MATCH")).toBe(true);
  });
  it("trace records tool, input, output and duration", async () => {
    const r = await scan();
    const t = getTrace(r.runId);
    expect(t.length).toBeGreaterThan(15);
    expect(t.find((x) => x.tool === "read_listing")).toMatchObject({ decider: "Deterministic" });
    expect(t.every((x) => typeof x.duration_ms === "number")).toBe(true);
  });
});
