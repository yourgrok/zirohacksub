# Test cases

Copied from the latest deterministic run (2026-10-22T15:21:23.285Z; date pinned to 2026-10-21 IST; fresh reset before every test). Full per-check evidence: `evidence/SUMMARY.md` and `evidence/TC*.json`.

| Test | Deterministic | Gemini | Tool calls (det.) | Actual result (deterministic run) |
|---|---|---|---|---|
| TC1 — Holiday hours differ on one site | PASS | not run (no API key in build environment) | 27 | B holiday: MISMATCH → PROPOSED → APPROVED → APPLIED → VERIFIED; 1 write(s). |
| TC2 — Phone formatted differently but identical | PASS | not run (no API key in build environment) | 23 | phone FORMAT_ONLY_EQUIVALENT, 0 proposals, 0 writes |
| TC3 — Listing claimed by someone else | PASS | not run (no API key in build environment) | 23 | phone FLAGGED_NOT_OWNER; 0 write attempts |
| TC4 — Edit pending moderation | PASS | not run (no API key in build environment) | 29 | site E hours: MISMATCH → PROPOSED → APPROVED → APPLIED → PENDING_MODERATION → VERIFIED |
| TC5 — Plain-language closure flows through approval | PASS | not run (no API key in build environment) | 32 | a:VERIFIED b:VERIFIED c:VERIFIED d:FLAGGED_NOT_OWNER e:PENDING_MODERATION |
| TC6 — Foresight alert for a holiday with no exception | PASS | not run (no API key in build environment) | 0 | Bhai Dooj (11 Nov 2026) is in 21 days and has no opening-hours exception on your record. Dates can shift — verify first. |

## TC1 — Holiday hours differ on one site

- **Input:** Record: Diwali 8 Nov 2026 special hours 10:00–14:00. Site B shows Diwali as Closed; other sites match.
- **Expected:** Site B holiday field is proposed, owner approves it, it is APPLIED and then VERIFIED after the public page is reloaded. No other site is written to.
- **Actual:** B holiday: MISMATCH → PROPOSED → APPROVED → APPLIED → VERIFIED; 1 write(s).
- **Result:** PASS — Actual result matches the expected result.

| Check | Result | Detail |
|---|---|---|
| Site B holiday detected as a mismatch and proposed | pass | state=PROPOSED; original="8 Nov 2026: Closed"; intended="8 Nov 2026: 10:00 AM – 2:00 PM" |
| Sites A, C, D, E holiday already match (no proposal) | pass | all MATCH |
| Nothing is written before the owner approves | pass | writes at B = 0 |
| State went APPLIED then VERIFIED | pass | MISMATCH → PROPOSED → APPROVED → APPLIED → VERIFIED |
| Public page reloaded shows the approved value | pass | page shows 10:00–14:00 for 2026-11-08 |
| Exactly one write, only to site B | pass | total writes = 1 |
| Re-running never double-applies (idempotent) | pass | total writes after re-run = 1 |

## TC2 — Phone formatted differently but identical

- **Input:** Record phone +91 90000 00001. Site C shows “090000 00001” (and an abbreviated address).
- **Expected:** FORMAT_ONLY_EQUIVALENT, no proposal created, nothing ever written to site C.
- **Actual:** phone FORMAT_ONLY_EQUIVALENT, 0 proposals, 0 writes
- **Result:** PASS — Actual result matches the expected result.

| Check | Result | Detail |
|---|---|---|
| Phone classified FORMAT_ONLY_EQUIVALENT | pass | raw="090000 00001" normalised=+919000000001 |
| Raw and normalised values are kept side by side | pass | 090000 00001 \| +919000000001 |
| No proposal was created for site C | pass | no PROPOSED fields |
| Nothing was written to site C | pass | writes at C = 0 |

## TC3 — Listing claimed by someone else

- **Input:** Site D's listing is claimed by another account and has an outdated phone (+91 90000 00099).
- **Expected:** FLAGGED_NOT_OWNER, never edited, zero write attempts logged for site D.
- **Actual:** phone FLAGGED_NOT_OWNER; 0 write attempts
- **Result:** PASS — Actual result matches the expected result.

| Check | Result | Detail |
|---|---|---|
| Phone mismatch flagged as FLAGGED_NOT_OWNER | pass | state=FLAGGED_NOT_OWNER; reason="listing is claimed by another account — owner must reclaim it manually" |
| No proposal card exists for site D | pass | none PROPOSED |
| The owner cannot approve a flagged field | pass | approve → 409 |
| Zero write attempts logged for site D | pass | mock write log = 0, apply audit entries = 0 |
| Still flagged, never reported as corrected | pass | FLAGGED_NOT_OWNER |

## TC4 — Edit pending moderation

- **Input:** Site E shows Sunday as closed; every edit on site E goes to a moderation queue.
- **Expected:** PENDING_MODERATION (never reported corrected) until /mock/admin approves it and the page is reloaded, then VERIFIED.
- **Actual:** site E hours: MISMATCH → PROPOSED → APPROVED → APPLIED → PENDING_MODERATION → VERIFIED
- **Result:** PASS — Actual result matches the expected result.

| Check | Result | Detail |
|---|---|---|
| Site E Sunday hours mismatch proposed | pass | original="Mon to Sat: 9:00 AM to 9:00 PM; Sun: Closed" |
| After applying, status is PENDING_MODERATION (not corrected) | pass | public page unchanged; edit is waiting in the platform's moderation queue |
| Public page unchanged while pending | pass | still shows Sun: Closed |
| Re-checking while still pending keeps PENDING_MODERATION | pass | unchanged |
| Moderator approves in /mock/admin | pass | HTTP 200 |
| After admin approval and a reload it becomes VERIFIED | pass | MISMATCH → PROPOSED → APPROVED → APPLIED → PENDING_MODERATION → VERIFIED |

## TC5 — Plain-language closure flows through approval

- **Input:** Owner types: “we are closed on 26th December”.
- **Expected:** Preview resolves 26 Dec 2026 (closed). Confirm creates a natural-language exception; the pipeline proposes it per site; approved sites are VERIFIED, E is PENDING_MODERATION, D is FLAGGED_NOT_OWNER. Nothing is saved before Confirm and nothing applied before approval.
- **Actual:** a:VERIFIED b:VERIFIED c:VERIFIED d:FLAGGED_NOT_OWNER e:PENDING_MODERATION
- **Result:** PASS — Actual result matches the expected result.

| Check | Result | Detail |
|---|---|---|
| Preview resolves the date explicitly (26 Dec 2026, closed) | pass | Action: Closed \| Date: Sat 26 Dec 2026 |
| Nothing is saved before Confirm | pass | exceptions: 1 |
| Confirm created a natural-language exception | pass | ex_mvjovbnp0 source=natural-language |
| Proposed on A, B, C and E; flagged on D | pass | a:PROPOSED b:PROPOSED c:PROPOSED d:FLAGGED_NOT_OWNER e:PROPOSED |
| Approval is never skipped: no write without an approval click | pass | writes = 0 |
| A, B, C verified after reload; E pending; D flagged | pass | a:VERIFIED b:VERIFIED c:VERIFIED d:FLAGGED_NOT_OWNER e:PENDING_MODERATION |
| Public page A now lists 26 Dec 2026 as closed | pass | visible on reload |

## TC6 — Foresight alert for a holiday with no exception

- **Input:** Today is pinned to 21 Oct 2026. Bhai Dooj (11 Nov 2026) has no exception on the record.
- **Expected:** An alert is raised (30-day milestone, chip “Not set”) with a draft suggestion that is NOT applied automatically.
- **Actual:** Bhai Dooj (11 Nov 2026) is in 21 days and has no opening-hours exception on your record. Dates can shift — verify first.
- **Result:** PASS — Actual result matches the expected result.

| Check | Result | Detail |
|---|---|---|
| Foresight raises an alert for Bhai Dooj (no exception set) | pass | Bhai Dooj (11 Nov 2026) is in 21 days and has no opening-hours exception on your record. Dates can shift — verify first. |
| Alert milestone is the 30-day one (21 days away) | pass | milestone=30, daysAway=21 |
| Holiday is flagged for the owner to verify its date | pass | verified=false → UI shows “verify date” |
| A draft is suggested but nothing is applied automatically | pass | draft: Special hours 10:00–14:00 on Bhai Dooj; exceptions unchanged (1); writes=0 |
| Each holiday shows whether it is set: Diwali is saved but not on every site yet; Bhai Dooj is Not set | pass | Diwali: Saved — not on all sites yet (4/5 sites); Bhai Dooj: Not set |

## How to run

- Browser: open `/tests`, press **Run** on one case or **Run all** (running a test resets the demo data).
- Deterministic, no LLM: `npm run test:tc` (writes `evidence/`).
- With Gemini: put `GEMINI_API_KEY` in `.env`, then `npm run test:tc:llm` (writes `evidence/llm/` and refreshes `evidence/SUMMARY.md` side by side).
- Unit/integration suite: `npm test`.
