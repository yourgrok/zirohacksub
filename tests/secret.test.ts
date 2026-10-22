import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const saved = { db: process.env.DB_PATH, secret: process.env.PIN_SECRET, node: process.env.NODE_ENV };
afterEach(() => {
  vi.resetModules();
  process.env.DB_PATH = saved.db!;
  if (saved.secret === undefined) delete process.env.PIN_SECRET; else process.env.PIN_SECRET = saved.secret;
  process.env.NODE_ENV = saved.node!;
});

/** Simulates a fresh server process: new module instances, same environment. */
async function boot() {
  vi.resetModules();
  return (await import("../src/auth/secret.js")).appSecret;
}

describe("PIN secret survives restarts when it is not set in the environment", () => {
  it("file database: the generated secret is kept next to the database and reused after a restart", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-"));
    process.env.DB_PATH = path.join(dir, "app.db");
    delete process.env.PIN_SECRET;
    process.env.NODE_ENV = "production";
    const first = (await boot())();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.readFileSync(path.join(dir, ".pin_secret"), "utf8").trim()).toBe(first);
    if (process.platform !== "win32") expect(fs.statSync(path.join(dir, ".pin_secret")).mode & 0o077).toBe(0); // owner-only
    expect((await boot())()).toBe(first); // "restart"
    expect((await boot())()).toBe(first);
  });

  it("a PIN issued before a restart still verifies after it (the bug that was reproduced)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-"));
    process.env.DB_PATH = path.join(dir, "app.db");
    delete process.env.PIN_SECRET;
    process.env.NODE_ENV = "production";
    vi.resetModules();
    const before = (await import("../src/auth/pin.js")).hashPin("7KQ4XM9PHT");
    vi.resetModules();
    const after = (await import("../src/auth/pin.js")).hashPin("7KQ4XM9PHT");
    expect(after).toBe(before);
  });

  it("PIN_SECRET from the environment always wins and writes no file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-"));
    process.env.DB_PATH = path.join(dir, "app.db");
    process.env.PIN_SECRET = "from-the-environment";
    expect((await boot())()).toBe("from-the-environment");
    expect(fs.existsSync(path.join(dir, ".pin_secret"))).toBe(false);
  });

  it("in-memory database: nothing is written; production gets a random per-process secret", async () => {
    process.env.DB_PATH = ":memory:";
    delete process.env.PIN_SECRET;
    process.env.NODE_ENV = "production";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const a = (await boot())();
    const b = (await boot())();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("an unwritable data folder falls back instead of crashing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-"));
    fs.writeFileSync(path.join(dir, "afile"), "x"); // a regular file where a folder is needed: creating the secret file fails fast
    process.env.DB_PATH = path.join(dir, "afile", "app.db");
    delete process.env.PIN_SECRET;
    process.env.NODE_ENV = "test";
    expect((await boot())()).toBe("dev-only-secret-not-for-production");
  });
});
