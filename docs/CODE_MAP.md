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
│   ├── auth/                      pin.ts (CSPRNG PIN, HMAC, constant-time compare), limiter.ts (login throttling), sessions.ts (hashed session ids + cookies),
│   │                              mockCreds.ts (signed delegated credentials for the mock sites), secret.ts (PIN_SECRET), events.ts (login/onboarding -> agent trace)
│   ├── onboarding/                config.ts (ALL weights + thresholds), similarity.ts (phone/address/name), score.ts (scoring + decision rules),
│   │                              discover.ts (read every listing on every site), service.ts (start/confirm/PIN/activation), coverage.ts (listed / not listed on)
│   ├── agent/createListing.ts     "add my business to this site": propose, apply (duplicate re-check), verify
│   ├── foresight/index.ts         90-day holiday scan, set/not-set status, alerts 30/14/7, set-hours and clear
│   ├── nl/parse.ts                deterministic date parser (chrono-node + rules)
│   ├── nl/intent.ts               the text box brain: edit details, weekly hours, answer questions, or fall back to dates
│   ├── core/details.ts            validated edit of the owner-approved record (+ resets stale approvals), shared validators
│   ├── agent/briefing.ts          "what I did" sentences from facts; optional background Gemini rewording
│   ├── agent/why.ts, claimDraft.ts  one plain sentence per card; claim request + manual steps for flagged listings
│   ├── mock/simulate.ts           demo-only "world changes" switches (drift, outage, lost edit)
│   ├── agent/changelog.ts         merges record edits and audit events into one readable change log
│   ├── nl/index.ts                preview, Gemini cross-check (refine), confirm
│   ├── runner/                    tc.ts (TC1-TC8 + guardrail demo + before/after consistency export), evidence.ts (JSON + SUMMARY.md), cli.ts, docs.ts, demo-onboarding.ts (new-owner journey over HTTP)
│   └── server/                    app.ts (routes, all scoped to the logged-in business), auth.ts (login/logout/requireAuth/origin check), onboarding.ts (public routes), registry.ts, index.ts (boot, reseed-if-empty)
├── web/src/                       React: main.tsx (auth gate), Gate.tsx (PIN login, details, "Is this you?", view-once PIN), App.tsx (shell: header, sticky action bar, tabs, hash routing),
│   │                              shared.tsx (tab list, helpers), tabs/ (DetailsTab, SitesTab, ApprovalsTab, ConsistencyTab, EditTab, ChangeLogTab, TraceTab, HolidaysTab, AddBusinessTab), Tests.tsx, api.tsx, styles.css
└── tests/                         Vitest: normalise, states, mock sites, reader, agent (TC1-4), gemini (mocked), foresight, nl, nl-flow (TC5), api (+TC1-6 runner),
                                   pin, limiter, secret, auth (isolation/IDOR/rate limit), matching (scoring + look-alikes + thresholds), onboarding (e2e), addlisting, migration,
                                   edit (details, name field, change log), intent (text box), drift, ui (real browser: tabs, text box, trace walker, add business)
```

## Module responsibilities in one line each

- **Single place state changes:** `store.transition()` → `states.assertTransition()`.
- **Single place writes happen:** `tools.apply_approved` (and nowhere else POSTs to a dashboard).
- **Single place VERIFIED is set:** `tools.reload_and_verify` with actor `verifier`.
- **Single place the LLM is called:** `llm.llmJson()` (queue, cache, retry, timeout, redaction).
