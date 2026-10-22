# PROGRESS

## Milestones
- [x] M1 Setup + docs skeleton
- [x] M2 DB, schema, seed, normalisers + tests
- [x] M3 Mock sites A-E, decoy, /mock/admin, reset
- [x] M4 Readers, comparator, state machine, deterministic planner, loop, approvals, apply, verifier, report (TC1-TC4)
- [x] M5 Gemini planner, guardrails, fallback, summary
- [x] M6 Holiday Foresight + TC6
- [x] M7 Plain-language parser + preview + cross-check + TC5
- [x] M8 React console, /tests page, runners, evidence, CSV/print
- [x] M9 Docker, /health, README, docs, slides, final run

## Decisions
- Gemini docs site (ai.google.dev) is unreachable from the build container; Interactions API call shape taken from the
  installed @google/genai 2.30.0 type definitions (`model`, `input`, `system_instruction`, `response_format{type:'text',mime_type,schema}`, `output_text`).
- better-sqlite3 installs fine on Node 22 (prebuilt); kept.
- Live Gemini runs cannot be executed in the build container (no key). Gemini path is unit-tested with a mocked client;
  evidence/llm/ is produced by the user via `npm run test:tc:llm`. No Gemini output is fabricated.

## Known issues (honest)
- **No live Gemini run exists.** The build container had no API key and could not reach ai.google.dev. The Gemini path (Interactions API call shape taken from the installed SDK types) is covered only by unit tests with a mocked client. First real call may need small adjustments (e.g. JSON-schema keywords accepted by `response_format`, or model names `gemini-3.8-flash` / `gemini-3.5-flash-lite`, which I could not verify). Any failure degrades safely to the deterministic planner and shows as "Fallback" in the trace. Run `npm run test:tc:llm` with the key to produce `evidence/llm/`.
- **Docker / Render not built or deployed here** (no Docker in the container; deployment needs the owner's accounts). Dockerfile, Dockerfile.playwright and render.yaml are unverified.
- Optional mock-OTP dashboard step not built (flagged listings show a manual step instead; the agent never automates OTP/CAPTCHA).
- Stale special-day entries that exist on a site but not on the owner's record are not detected (only record → site is checked).
- `data/holidays.json` dates are approximate and unverified (flagged `verified:false`, UI shows "verify date"); calendar covers 2026-11 → 2027-10.
- Tests/evidence pin the date to 2026-10-21; seeded Diwali (2026-11-08) conditions assume that date. The live UI uses the real date unless DEMO_NOW is set, so after early Nov 2026 the seeded Diwali exception becomes "past" and drops out of comparisons (use DEMO_NOW=2026-10-21 for a demo).
- `node:sqlite` fallback exists and the whole suite passes with `SQLITE_DRIVER=node`, but it was not exercised on Windows.
- Windows: not run on Windows at all (Linux container). PowerShell steps are in README.
- A finished run's page-read uses the real Playwright reader only when READER_MODE is playwright/auto; unit tests default to http, evidence screenshots (`npm run test:tc` with auto) use Playwright.

## Final verification (from fresh state)
- `npm run typecheck` ✔ · `npm test` 119/119 ✔ · `npm run build` ✔ · `npm run test:tc` TC1–TC6 6/6 PASS ✔ (evidence/SUMMARY.md generated) · `/tests` page Run all 6/6 ✔ (Playwright-driven) · `npm start` production boot from empty DB, /health ok ✔.

### Decisions (M4)
- Playwright 1.64 wants a newer Chromium than the container's pre-installed build; set `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium` (reader honours it). `READER_MODE=auto` falls back to HTTP+cheerio if launch fails.
- Seed fix: site C address reordered words ("Pune, MH - 411001") because word *order* changes are real differences, not formatting.


## Multi-business access, PIN login and onboarding (added after M9)

Done: tenant-scoped data layer (required `bizId`, in-place migration of old DBs), PIN-only login (HMAC, constant-time compare, per-IP throttling, httpOnly session cookie, logout), score-matching onboarding with look-alike protection, view-once PIN with pending-then-activate business, adding the business to missing sites through approve/apply/verify (incl. moderation), matching section in the report, trace events for login/matching, simple UI screens, `npm run demo:onboarding`.

### Decisions
- No destructive schema change was needed: old databases are migrated in place (rows copied into the new `field_states`, old rows assigned to `biz_sunrise_001`; `tests/migration.test.ts` proves it). "Reset demo data" still wipes everything, as before, and is now demo-business-only.
- `bizId` is a required parameter everywhere (no default) so forgetting it is a compile error.
- PIN: 10 chars from a 32-char alphabet (50 bits). Lookup key = HMAC-SHA256(PIN_SECRET, PIN). Demo PIN `7KQ4X-M9PHT` is re-hashed on every boot.
- A new business is created `pending` and only claims listings on its first login, so a PIN lost before first use costs nothing: it expires after 30 min and onboarding can be repeated.
- The mock sites now require a server-signed credential for dashboards/edits/claims/creates; the old unauthenticated `/mock/_reset` and `/mock/_writes` endpoints were removed (they were a hole on a public deploy).
- Address comparison for consistency stays strict (a listing that omits the state is a real difference and gets a proposal), while matching scores tolerate it.

### Known issues / limitations
- Claiming an unclaimed mock listing needs no OTP (mock). Real sites verify ownership (OTP/postcard); that step must stay human.
- Login/onboarding rate limiters are in memory: reset on restart, per instance.
- No screen to edit a business record after onboarding (hours default to Mon-Sat 9-6 when the owner enters none, and the owner is told).
- `/mock/admin` (the site's moderators) is intentionally open.
- Not run on Windows or deployed; Gemini path still only unit-tested with a mocked client.

### Fix: PIN invalid after a server restart
Reproduced: with a file database and `PIN_SECRET` empty (the `.env.example` default) every boot generated a new random secret, so a PIN whose business was still in the database no longer verified. Now an auto-generated secret is persisted once in `data/.pin_secret` (git-ignored, mode 600); `PIN_SECRET` still wins when set; `tests/secret.test.ts` covers restart, env-var priority, in-memory and unwritable-disk cases. On a free host the whole database (and this file) is wiped on restart, so onboarded businesses disappear there: documented in the README.

## Tabbed console, edit details, change log, smarter text box (added after the PIN work)

Done: 9-tab console with hash routing and keyboard navigation (sticky Scan / Review / Apply bar), compact consistency table with filters, Approvals tab with filters and approve-all, Listings & Sites table, My Details, Edit & Ask (text box + form + saved holidays), Change Log, Agent Trace with a hover "walker", Holidays, Add Business inside the console.
Backend: `PUT /api/business` (validated, resets stale approvals, writes the change log), business **name** is now a compared field (`set_name` change), `GET /api/changelog`, `POST /api/exceptions/:id/cancel`, text box intents (`src/nl/intent.ts`).

### Decisions
- Adding a business from inside the console creates a separate business with its own PIN and switches to it (activation needs that first login). There is no single login that owns several businesses yet.
- Editing the record never touches a listing site; it only makes the next scan propose fixes (all behind approvals). Approvals given for an old value are returned to review.
- Questions and record edits are handled locally and are never sent to Gemini; only date requests are cross-checked.
- The trace walker follows the pointer; after the pointer rests about a second it walks on by itself. With reduced-motion it only jumps to the step you point at.
- Fixed while building: `Reset demo data` did not clear `site_matches` / `onboarding_drafts` (an earlier edit had silently not applied); repeated scans no longer write identical "flagged" lines into the log.

### Known limitations
- No PIN recovery and no phone verification yet (discussed; not built).
- Editing the phone number does not verify ownership of the new number.
- The change log shows record edits and approval/apply/verify events; it does not store a full before/after copy of every listing page.

## Calmer UI (follow-up)

Request: drop the blue, use a gentler colour, remove the emojis, make the first visit less overwhelming.
Done: new palette in `web/src/styles.css` (warm off-white, deep teal-green accent; four status colours only: green = done, amber = needs you, teal = in progress, red = blocked; every text/background pair checked at 4.5:1 or better, light and dark). All emojis and symbol icons removed from the console and from the mock listing pages (Address / Phone labels instead); the only one left is the small robot in the Agent Trace walker. Header is the business name and Log out; demo links moved into a collapsed "Settings and demo tools" panel; a "Start here" card with one button shows until the first scan; step numbers are CSS circles; tabs are grouped (four everyday tabs, a thin divider, quieter secondary tabs); copy shortened; consistency table columns narrowed so the status labels fit. UI test updated for the new button/heading text (no assertion weakened).
Note: the mock listing sites keep their own themes (Site A is blue on purpose: it stands in for a third-party company site, not our console).
Observed once: `tests/ui.test.ts` (the long scan + edit + change-log test) timed out/failed in one full run right after `tsc`; not reproduced in three later runs (1 isolated, 2 full, 273/273). If it recurs, raise that test's 30 s limit; the failure message was not captured.

### Palette revision (beige)
Feedback: the teal-green still looked too close to blue. Replaced it in `web/src/styles.css`: beige page `#f4eee3`, cream cards, warm brown text; olive-sage `#54733f` for actions and focus; terracotta (`--clay`) for "needs you" and the waiting-count badge; sand for "in progress"; rose red only for blocked or errors; warm dark mode (brown, not grey). Chosen on purpose: primary buttons are not red/terracotta, because an action must not look like an error. All text/background pairs checked at 4.5:1 or better in both modes. Also fixed a leftover `a-blue` class (30-day holiday alert had no style) and renamed `amber` classes/variables to `clay`.

### Fix: beige never showed on dark-mode devices
The console followed the OS dark-mode setting, so a user whose device is in dark mode saw the dark palette and never the beige one (my review had forced light mode, which hid this). Removed the `prefers-color-scheme: dark` block and set `color-scheme: light`: the console is now beige on every device. Dark screenshots removed.
