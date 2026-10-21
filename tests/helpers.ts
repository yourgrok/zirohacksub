import type { AddressInfo } from "node:net";
import { closeDb } from "../src/core/db.js";
import { resetAndSeed } from "../src/core/seed.js";
import { createApp } from "../src/server/app.js";

export async function startTestServer() {
  resetAndSeed();
  const app = createApp();
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.BASE_URL = url;
  return {
    url,
    close: () => new Promise<void>((r) => server.close(() => { closeDb(); r(); })),
  };
}
