import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as cheerio from "cheerio";
import { startTestServer } from "./helpers.js";

let s: Awaited<ReturnType<typeof startTestServer>>;
beforeAll(async () => { s = await startTestServer(); });
afterAll(async () => { await s.close(); });

const post = (path: string, body: unknown, acct?: string) =>
  fetch(s.url + path, { method: "POST", headers: { "content-type": "application/json", ...(acct ? { "x-mock-account": acct } : {}) }, body: JSON.stringify(body) });

describe("mock sites", () => {
  it("all five public pages render with the listing id", async () => {
    for (const x of ["a", "b", "c", "d", "e"]) {
      const html = await (await fetch(`${s.url}/mock/${x}/listing/LST-${x.toUpperCase()}-1001`)).text();
      expect(cheerio.load(html)("[data-listing-id]").attr("data-listing-id")).toBe(`LST-${x.toUpperCase()}-1001`);
    }
  });
  it("search shows both the real listing and the look-alike decoy", async () => {
    const html = await (await fetch(`${s.url}/mock/a/?q=sunrise`)).text();
    expect(html).toContain("LST-A-1001");
    expect(html).toContain("LST-A-2002");
  });
  it("site D denies edits from our account and logs the attempt as 403", async () => {
    const r = await post("/mock/d/dashboard/LST-D-1001/update", { action: "set_phone", value: "+91 90000 00001" });
    expect(r.status).toBe(403);
    const dash = await (await fetch(`${s.url}/mock/d/dashboard/LST-D-1001`)).text();
    expect(cheerio.load(dash)("body").attr("data-can-edit")).toBe("false");
  });
  it("site E queues edits; public page unchanged until admin approves", async () => {
    const before = await (await fetch(`${s.url}/mock/e/listing/LST-E-1001`)).text();
    const r = await post("/mock/e/dashboard/LST-E-1001/update", { action: "set_phone", value: "+91 90000 00001" });
    expect(r.status).toBe(202);
    expect(await (await fetch(`${s.url}/mock/e/listing/LST-E-1001`)).text()).toBe(before);
    const q = (await r.json()) as { queueId: number };
    const ap = await fetch(`${s.url}/mock/admin/queue/${q.queueId}/approve`, { method: "POST", headers: { "content-type": "application/json" } });
    expect(ap.status).toBe(200);
  });
  it("site A applies immediately", async () => {
    const r = await post("/mock/a/dashboard/LST-A-1001/update", { action: "set_phone", value: "+91 90000 00005" });
    expect(r.status).toBe(200);
    expect(await (await fetch(`${s.url}/mock/a/listing/LST-A-1001`)).text()).toContain("+91 90000 00005");
  });
});
