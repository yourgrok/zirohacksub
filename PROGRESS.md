# PROGRESS

## Milestones
- [x] M1 Setup + docs skeleton
- [x] M2 DB, schema, seed, normalisers + tests
- [x] M3 Mock sites A-E, decoy, /mock/admin, reset
- [x] M4 Readers, comparator, state machine, deterministic planner, loop, approvals, apply, verifier, report (TC1-TC4)
- [x] M5 Gemini planner, guardrails, fallback, summary
- [ ] M6 Holiday Foresight + TC6
- [ ] M7 Plain-language parser + preview + cross-check + TC5
- [ ] M8 React console, /tests page, runners, evidence, CSV/print
- [ ] M9 Docker, /health, README, docs, slides, final run

## Decisions
- Gemini docs site (ai.google.dev) is unreachable from the build container; Interactions API call shape taken from the
  installed @google/genai 2.30.0 type definitions (`model`, `input`, `system_instruction`, `response_format{type:'text',mime_type,schema}`, `output_text`).
- better-sqlite3 installs fine on Node 22 (prebuilt); kept.
- Live Gemini runs cannot be executed in the build container (no key). Gemini path is unit-tested with a mocked client;
  evidence/llm/ is produced by the user via `npm run test:tc:llm`. No Gemini output is fabricated.

## Known issues
(none yet)

### Decisions (M4)
- Playwright 1.64 wants a newer Chromium than the container's pre-installed build; set `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium` (reader honours it). `READER_MODE=auto` falls back to HTTP+cheerio if launch fails.
- Seed fix: site C address reordered words ("Pune, MH - 411001") because word *order* changes are real differences, not formatting.
