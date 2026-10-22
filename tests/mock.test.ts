import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as cheerio from "cheerio";
import { startTestServer } from "./helpers.js";
import { mockAuthHeaders } from "../src/auth/mockCreds.js";
import { OTHER_ACCOUNT, OWNER_ACCOUNT } from "../src/core/seed.js";

let s: Awaited<ReturnType<typeof startTestServer>>;
beforeAll(async () => { s = await startTestServer(); });
afterAll(async () => { await s.close(); });

const post = (path: string, body: unknown, acct: string | null = OWNER_ACCOUNT) =>
  fetch(s.url + path, { method: "POST", headers: { "content-type": "application/json", ...(acct ? mockAuthHeaders(acct) : {}) }, body: JSON.stringify(body) });

describe("mock site credentials (delegated login stand-in)", () => {
  it("an anonymous write is refused with 401 and logged", async () => {
    const r = await post("/mock/a/dashboard/LST-A-1001/update", { action: "set_phone", value: "+91 90000 00005" }, null);
    expect(r.status).toBe(401);
  });
  it("a forged account header without the server-signed token is refused", async () => {
    const r = await fetch(`${s.url}/mock/a/dashboard/LST-A-1001/update`, { method: "POST", headers: { "content-type": "application/json", "x-mock-account": OWNER_ACCOUNT, "x-mock-token": "00".repeat(32) }, body: JSON.stringify({ action: "set_phone", value: "+91 90000 00005" }) });
    expect(r.status).toBe(401);
    const bare = await fetch(`${s.url}/mock/a/dashboard/LST-A-1001/update`, { method: "POST", headers: { "content-type": "application/json", "x-mock-account": OWNER_ACCOUNT }, body: JSON.stringify({ action: "set_phone", value: "+91 90000 00005" }) });
    expect(bare.status).toBe(401);
    expect(await (await fetch(`${s.url}/mock/a/listing/LST-A-1001`)).text()).not.toContain("00005");
  });
  it("another valid account cannot edit our listing (403)", async () => {
    expect((await post("/mock/a/dashboard/LST-A-1001/update", { action: "set_phone", value: "+91 90000 00005" }, OTHER_ACCOUNT)).status).toBe(403);
  });
  it("the debug reset/writes endpoints no longer exist on the public mock router", async () => {
    expect((await fetch(`${s.url}/mock/_reset`, { method: "POST" })).status).toBe(404);
    expect((await fetch(`${s.url}/mock/_writes`)).status).toBe(404);
  });
});

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
    const dash = await (await fetch(`${s.url}/mock/d/dashboard/LST-D-1001`, { headers: mockAuthHeaders(OWNER_ACCOUNT) })).text();
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
