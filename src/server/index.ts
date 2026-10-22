import "dotenv/config";
import fs from "node:fs";
import { createApp } from "./app.js";
import { seedIfEmpty } from "../core/seed.js";
import { plannerMode } from "../agent/service.js";
import { readerMode } from "../agent/reader.js";
import { today } from "../core/clock.js";
import { startAutopilot } from "../agent/autopilot.js";

if (!process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE && fs.existsSync("/opt/pw-browsers/chromium")) process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE = "/opt/pw-browsers/chromium";

const port = Number(process.env.PORT ?? 3000);
seedIfEmpty(); // SQLite on free hosts is temporary — the app reseeds on boot when empty
createApp().listen(port, "0.0.0.0", () => {
  process.env.BASE_URL = `http://127.0.0.1:${port}`;
  startAutopilot();
  console.log(`Listing Consistency Agent on http://localhost:${port}  | planner: ${plannerMode()} | reader: ${readerMode()} | today: ${today()} IST`);
});
