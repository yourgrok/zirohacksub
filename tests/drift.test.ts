import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../src/core/db.js";
import { BUSINESS_ID as B, resetAndSeed } from "../src/core/seed.js";
import { getFieldByKey } from "../src/core/store.js";
import { approveField, execute, scan } from "../src/agent/service.js";
import { startTestServer } from "./helpers.js";

let s: Awaited<ReturnType<typeof startTestServer>>;
beforeAll(async () => { s = await startTestServer(); });
afterAll(async () => { await s.close(); });
beforeEach(() => resetAndSeed());

describe("re-verifying across the listing sites any time after setup", () => {
  it("a verified field is re-checked on every scan; if a site later changes it, it is detected and proposed again", async () => {
    await scan(B);
    approveField(B, getFieldByKey(B, "site_b", "holiday:ex_seed_diwali")!.id);
    await execute(B);
    expect(getFieldByKey(B, "site_b", "holiday:ex_seed_diwali")!.state).toBe("VERIFIED");
    await scan(B); // nothing changed: still verified
    expect(getFieldByKey(B, "site_b", "holiday:ex_seed_diwali")!.state).toBe("VERIFIED");
    // someone edits the phone on site C (to a different number) and site B drops the holiday again
    getDb().prepare("UPDATE mock_listings SET phone='+91 90000 00055' WHERE listing_id='LST-C-1001'").run();
    getDb().prepare("UPDATE mock_listings SET holidays_json='[]' WHERE listing_id='LST-B-1001'").run();
    await scan(B);
    expect(getFieldByKey(B, "site_c", "phone")!.state).toBe("PROPOSED");
    expect(getFieldByKey(B, "site_b", "holiday:ex_seed_diwali")!.state).toBe("PROPOSED");
    const hist = getDb().prepare("SELECT to_state FROM state_history WHERE field_id=? ORDER BY id").all(getFieldByKey(B, "site_b", "holiday:ex_seed_diwali")!.id) as { to_state: string }[];
    expect(hist.map((h) => h.to_state)).toEqual(["MISMATCH", "PROPOSED", "APPROVED", "APPLIED", "VERIFIED", "MISMATCH", "PROPOSED"]); // verified, then drift noticed, then offered again
  });
});
