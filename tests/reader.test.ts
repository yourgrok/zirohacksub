import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeReader, fetchPage, parsePublic, playwrightAvailable } from "../src/agent/reader.js";
import { startTestServer } from "./helpers.js";

let s: Awaited<ReturnType<typeof startTestServer>>;
beforeAll(async () => { s = await startTestServer(); });
afterAll(async () => { await closeReader(); await s.close(); });

describe("reader", () => {
  it("http reader parses each site layout", async () => {
    for (const x of ["a", "b", "c", "d", "e"]) {
      const p = await fetchPage(`/mock/${x}/listing/LST-${x.toUpperCase()}-1001`);
      const r = parsePublic(x, p.html);
      expect(r.listingId).toBe(`LST-${x.toUpperCase()}-1001`);
      expect(r.hoursLines.length).toBeGreaterThanOrEqual(2);
      expect(r.holidayLines.length).toBe(1);
      expect(r.phone).toBeTruthy();
    }
  });
  it("playwright reader (when Chromium is available) reads the same values as http", async () => {
    if (!process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE && fs.existsSync("/opt/pw-browsers/chromium")) process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE = "/opt/pw-browsers/chromium";
    process.env.READER_MODE = "auto";
    const ok = await playwrightAvailable();
    if (!ok) return; // the http fallback path is covered above
    const viaPw = await fetchPage("/mock/b/listing/LST-B-1001");
    expect(viaPw.via).toBe("playwright");
    process.env.READER_MODE = "http";
    const viaHttp = await fetchPage("/mock/b/listing/LST-B-1001");
    expect(parsePublic("b", viaPw.html)).toEqual(parsePublic("b", viaHttp.html));
  }, 60000);
});
