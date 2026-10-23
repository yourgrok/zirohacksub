# Jury deck: where every figure comes from

Deck: `docs/Business-Listing-Consistency-Agent-Jury-Deck.pptx` (PDF copy next to it). 18 slides with speaker notes.
Rebuild: `pip install python-pptx pillow` then `python scripts/build-deck.py`. Screenshots are in `docs/deck/img/` (cropped from the running app, fictional data).

| On the slides | Source |
|---|---|
| Five different public pages, the differences between them | Screenshots of `/mock/a..e/listing/LST-x-1001` before any fix (seeded test bed) |
| Full scan = 5 sites x 5 fields = 25 checks, about 150 ms | Measured: `POST /api/runs/scan` until idle, three runs: 156, 145 and 139 ms, local mock sites (no real network latency). Result of the scan: 20 MATCH, 2 FORMAT_ONLY_EQUIVALENT, 2 PROPOSED, 1 FLAGGED_NOT_OWNER |
| 3 clicks | The demo flow: Scan, Approve all, Apply (one more click to re-check a moderated site) |
| TC1-TC8 results and wording | `docs/SUBMISSION_NOTES.md` section 5; re-run on the `/tests` page ("8 of 8 run test(s) passed") |
| 295 tests, 24 files | `npx vitest run` on the delivered branch |
| 6 of 6 unsafe actions blocked, 0 writes | Guardrail demonstration in `docs/SUBMISSION_NOTES.md` section 4 (scripted rogue planner) |
| Look-alike scores 37.7, real listing 100; weights 40/35/25 | `docs/SUBMISSION_NOTES.md` section 5 and `src/onboarding/config.ts` |
| Eight tools, rules planner by default, Gemini optional, 12 mocked-client tests, no live Gemini run | `docs/SUBMISSION_NOTES.md` sections 2 and 3 |
| 27 tool calls for TC1 | `docs/SUBMISSION_NOTES.md` section 5 |
| Four hours layouts parsed into one schedule | `docs/SUBMISSION_NOTES.md` section 1 |
| Stack (TypeScript, Node 22, Express 5, React 19, Vite, SQLite with node:sqlite fallback, Zod 4, Playwright, cheerio, chrono-node, @google/genai) | `package.json`, `src/core/db.ts` |
| Limitations and next steps | `docs/SUBMISSION_NOTES.md` section 7 |

Deliberately left out: third-party statistics about how often listing errors cost customers. They could not be checked against the primary source from the build environment, so none is quoted. If you add one, cite the report and year on the slide.
