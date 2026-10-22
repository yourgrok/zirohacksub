import fs from "node:fs";
import path from "node:path";
import { TC_IDS, listTests, type GuardrailDemo, type TcResult } from "./tc.js";

export const evidenceDir = () => path.resolve(process.env.EVIDENCE_DIR ?? "evidence");

function read<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return null; }
}

export function writeResults(results: TcResult[], sub: "" | "llm") {
  const dir = path.join(evidenceDir(), sub);
  fs.mkdirSync(dir, { recursive: true });
  for (const r of results) fs.writeFileSync(path.join(dir, `${r.id}.json`), JSON.stringify(r, null, 2));
  writeSummary();
}

export function writeGuardrail(g: GuardrailDemo) {
  fs.mkdirSync(evidenceDir(), { recursive: true });
  fs.writeFileSync(path.join(evidenceDir(), "guardrail-demo.json"), JSON.stringify(g, null, 2));
  writeSummary();
}

const mark = (r: TcResult | null) => (r ? (r.pass ? "✅ PASS" : "❌ FAIL") : "— not run");
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** Regenerates evidence/SUMMARY.md from whatever result files are on disk (deterministic + Gemini side by side). */
export function writeSummary() {
  const dir = evidenceDir();
  const det = TC_IDS.map((id) => read<TcResult>(path.join(dir, `${id}.json`)));
  const llm = TC_IDS.map((id) => read<TcResult>(path.join(dir, "llm", `${id}.json`)));
  const guard = read<GuardrailDemo>(path.join(dir, "guardrail-demo.json"));
  const meta = listTests();
  const L: string[] = [];
  L.push("# Test evidence summary", "");
  const ref = det.find(Boolean) ?? llm.find(Boolean);
  L.push(`Generated: ${new Date().toISOString()}  `);
  if (ref) L.push(`Pinned test date: **${ref.testDate}** (Asia/Kolkata) · reader: **${ref.readerMode}** · mock data only.`);
  L.push("", "Every run starts from a fresh reset of the seeded demo data. The deterministic run uses `LLM_PROVIDER=none` so results cannot fail randomly because of rate limits or model changes.", "");
  L.push("## Results side by side", "", "| Test | Deterministic | Gemini |", "|---|---|---|");
  meta.forEach((m, i) => L.push(`| ${m.id} — ${m.title} | ${mark(det[i])} | ${llm[i] ? mark(llm[i]) : "— not run (needs `GEMINI_API_KEY`; run `npm run test:tc:llm`)"} |`));
  const dp = det.filter((r) => r?.pass).length, lp = llm.filter((r) => r?.pass).length;
  L.push("", `Deterministic: **${dp}/${TC_IDS.length} passed**. Gemini: ${llm.some(Boolean) ? `**${lp}/${llm.filter(Boolean).length} passed**` : "not run in this evidence set"}.`, "");

  meta.forEach((m, i) => {
    const d = det[i], g = llm[i];
    L.push(`## ${m.id} — ${m.title}`, "", `**Input:** ${m.input}`, "", `**Expected:** ${m.expected}`, "");
    if (d) {
      L.push(`**Actual (deterministic):** ${d.actual}`, "", `**Result:** ${mark(d)} — ${d.explanation}`, "", "| Check | Result | Detail |", "|---|---|---|");
      d.checks.forEach((c) => L.push(`| ${esc(c.name)} | ${c.pass ? "pass" : "FAIL"} | ${esc(c.detail)} |`));
      if (d.states.length) {
        L.push("", "Field state history:", "");
        d.states.forEach((s) => L.push(`- ${s.platform} / ${s.field}: ${s.history.join(" → ")} (original “${s.original ?? ""}” → intended “${s.intended ?? ""}”)`));
      }
      if (d.screenshots.length) L.push("", "Screenshots: " + d.screenshots.map((s) => `\`${s}\``).join(", "));
      L.push("", `Trace: ${d.trace.length} tool calls recorded (see \`${m.id}.json\`).`);
    } else L.push("_Deterministic run not found._");
    if (g) {
      L.push("", `**Actual (Gemini):** ${g.actual}`, "", `**Result:** ${mark(g)} — ${g.explanation}`);
      if (d && d.actual !== g.actual) L.push("", `Difference from the deterministic run: deterministic “${d.actual}” vs Gemini “${g.actual}”.`);
    }
    L.push("");
  });

  L.push("## Gemini decisions: fallbacks and guardrail blocks", "");
  if (!llm.some(Boolean)) {
    L.push("The Gemini run has **not been executed in this evidence set** (the build environment has no API key, and no Gemini output is fabricated). Run `npm run test:tc:llm` with `GEMINI_API_KEY` in `.env`; this section is then regenerated with every step where Gemini fell back or was blocked.", "");
  } else {
    const rows = llm.flatMap((r) => (r ? [...r.fallbacks, ...r.blocked].map((t) => ({ tc: r.id, t })) : []));
    if (!rows.length) L.push("Gemini made every planning decision with no fallbacks and no guardrail blocks in this run.", "");
    else {
      L.push("| Test | Time | Badge | Tool | Detail |", "|---|---|---|---|---|");
      rows.forEach(({ tc, t }) => L.push(`| ${tc} | ${t.at} | ${t.decider} | ${t.tool} | ${esc((t.output_summary || "") + (t.note ? " — " + t.note : ""))} |`));
      L.push("");
    }
  }

  L.push("## Guardrail demonstration (simulated rogue planner)", "");
  if (guard) {
    L.push(guard.note, "", `- Blocked by guardrail: **${guard.attempts}** attempts`, `- Writes sent to any site afterwards: **${guard.writesAfter}**`, `- Unapproved change still only PROPOSED: **${guard.unapprovedStillProposed}**`, `- Fields marked VERIFIED: **${guard.verifiedCount}**`, "");
    guard.blocked.forEach((b) => L.push(`- \`${b.tool}\` → ${b.output_summary}`));
    L.push("");
  } else L.push("_Not run yet — `npm run test:tc` includes it._", "");
  L.push("## New-owner onboarding demo", "");
  L.push(fs.existsSync(path.join(dir, "onboarding-demo.md"))
    ? "A narrated end-to-end run (PIN login, score matching, \"Is this you?\", view-once PIN, adding missing sites with approval, verified report, isolation checks, then TC1-TC6 again) is in `evidence/onboarding-demo.md`."
    : "_Not run yet — `npm run demo:onboarding` writes `evidence/onboarding-demo.md`._", "");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SUMMARY.md"), L.join("\n"));
}
