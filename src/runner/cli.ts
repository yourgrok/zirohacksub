import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.js";
import { seedIfEmpty } from "../core/seed.js";
import { closeReader } from "../agent/reader.js";
import { geminiEnabled } from "../agent/llm.js";
import { runAllTcs, runConsistencyDemo, runGuardrailDemo, type TcMode } from "./tc.js";
import { evidenceDir, writeGuardrail, writeResults } from "./evidence.js";

const mode = (process.argv[2] === "llm" ? "llm" : "deterministic") as TcMode;
process.env.DB_PATH ||= ":memory:";
if (!process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE && fs.existsSync("/opt/pw-browsers/chromium")) process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE = "/opt/pw-browsers/chromium";

async function main() {
  if (mode === "llm" && !geminiEnabled() && !(process.env.GEMINI_API_KEY)) {
    console.error("GEMINI_API_KEY is not set. Put it in .env (see .env.example) and run again. Nothing was written.");
    process.exit(2);
  }
  seedIfEmpty();
  const server = await new Promise<import("node:http").Server>((resolve) => { const s = createApp().listen(0, "127.0.0.1", () => resolve(s)); });
  process.env.BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const sub = mode === "llm" ? "llm" : "";
  const shotDir = path.join(evidenceDir(), sub, "screenshots");
  console.log(`Running TC1-TC6 (${mode}) ...`);
  const results = await runAllTcs({ mode, screenshotDir: shotDir });
  writeResults(results, sub);
  if (mode === "deterministic") {
    writeGuardrail(await runGuardrailDemo());
    const t = await runConsistencyDemo();
    fs.writeFileSync(path.join(evidenceDir(), "consistency-before.csv"), t.before);
    fs.writeFileSync(path.join(evidenceDir(), "consistency-after.csv"), t.after);
  }
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id}  ${r.title}${r.pass ? "" : "\n      " + r.explanation}`);
  console.log(`Evidence written to ${path.join(evidenceDir(), sub)} and ${path.join(evidenceDir(), "SUMMARY.md")}`);
  await closeReader();
  server.close();
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}
main().catch((e) => { console.error(String(e?.message ?? e).replaceAll(process.env.GEMINI_API_KEY ?? "\u0000", "[redacted]")); process.exit(1); });
