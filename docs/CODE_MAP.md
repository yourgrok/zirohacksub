# Code map

```
.
├── CLAUDE.md / PROGRESS.md        project rules, milestone log, decisions, known issues
├── Dockerfile / Dockerfile.playwright / render.yaml / .env.example
├── data/holidays.json             festival calendar (verified:false on every entry)
├── evidence/                      latest test evidence (SUMMARY.md, TC*.json, screenshots, guardrail-demo.json, llm/)
├── docs/                          ARCHITECTURE, CODE_MAP, TEST_CASES, SUBMISSION_NOTES, SLIDES, screenshots/
├── src/
│   ├── core/
│   │   ├── clock.ts               Asia/Kolkata "today", DEMO_NOW + test override, date helpers
│   │   ├── normalise.ts           phone→E.164, address, times, weekly hours + holiday line parsing/formatting
│   │   ├── types.ts               Zod types: hours, exceptions, field-state list
│   │   ├── states.ts              allowed transitions + who may enter APPROVED/VERIFIED
│   │   ├── db.ts                  SQLite schema, better-sqlite3 with node:sqlite fallback, wipe
│   │   ├── seed.ts                fictional business, 5 platforms, per-site conditions, decoys, resetAndSeed()
│   │   └── store.ts               business/exception/field-state access; transition() (single place state changes); audit log
│   ├── mock/
│   │   ├── siteConfig.ts          per-site formats + CSS selectors (shared contract with the readers)
│   │   ├── changes.ts             Zod schema for the dashboard write API
│   │   └── sites.ts               five visually different sites: public page, dashboard, 403 on site D, moderation queue on E, /mock/admin, write log
│   ├── agent/
│   │   ├── reader.ts              Playwright | HTTP | auto fetch + cheerio parsing of public pages and dashboards
│   │   ├── compare.ts             normalise a read, compare meaning per field, "does the page show the intended value?"
│   │   ├── tools.ts               the 8 tools (read_listing … ask_owner), identity check, idempotent apply, verifier
│   │   ├── guard.ts               hard guardrails (block / force flag) applied to every decision
│   │   ├── planners.ts            legal-step table, deterministic planner, scripted rogue decisions (demo only)
│   │   ├── geminiPlanner.ts       Gemini planner + report summary; falls back per step
│   │   ├── llm.ts                 @google/genai Interactions client, queue, cache, 429 retry, timeout, model fallback, Zod validation
│   │   ├── loop.ts                the agent loop, trace recording, run bookkeeping
│   │   ├── service.ts             scan/execute entry points, owner approvals, planner selection
│   │   └── report.ts              before/after rows, summary template, CSV
│   ├── foresight/index.ts         90-day holiday scan, chips, alerts 30/14/7, readiness, drafts
│   ├── nl/parse.ts                deterministic plain-language parser (chrono-node + rules)
│   ├── nl/index.ts                preview, Gemini cross-check (refine), confirm
│   ├── runner/                    tc.ts (TC1-TC6 + guardrail demo), evidence.ts (JSON + SUMMARY.md), cli.ts, docs.ts
│   └── server/                    app.ts (routes), index.ts (boot, reseed-if-empty)
├── web/src/                       React console: App.tsx, Tests.tsx, api.tsx, styles.css
└── tests/                         Vitest: normalise, states, mock sites, reader, agent (TC1-4), gemini (mocked), foresight, nl, nl-flow (TC5), api (+TC1-6 runner)
```

## Module responsibilities in one line each

- **Single place state changes:** `store.transition()` → `states.assertTransition()`.
- **Single place writes happen:** `tools.apply_approved` (and nowhere else POSTs to a dashboard).
- **Single place VERIFIED is set:** `tools.reload_and_verify` with actor `verifier`.
- **Single place the LLM is called:** `llm.llmJson()` (queue, cache, retry, timeout, redaction).
