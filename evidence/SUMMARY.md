# Test evidence summary

Generated: 2026-10-22T20:40:25.944Z  
Pinned test date: **2026-10-21** (Asia/Kolkata) · reader: **auto** · mock data only.

Every run starts from a fresh reset of the seeded demo data. The deterministic run uses `LLM_PROVIDER=none` so results cannot fail randomly because of rate limits or model changes.

## Results side by side

| Test | Deterministic | Gemini |
|---|---|---|
| TC1 — Holiday hours differ on one site | ✅ PASS | — not run (needs `GEMINI_API_KEY`; run `npm run test:tc:llm`) |
| TC2 — Phone formatted differently but identical | ✅ PASS | — not run (needs `GEMINI_API_KEY`; run `npm run test:tc:llm`) |
| TC3 — Listing claimed by someone else | ✅ PASS | — not run (needs `GEMINI_API_KEY`; run `npm run test:tc:llm`) |
| TC4 — Edit pending moderation | ✅ PASS | — not run (needs `GEMINI_API_KEY`; run `npm run test:tc:llm`) |
| TC5 — Plain-language closure flows through approval | ✅ PASS | — not run (needs `GEMINI_API_KEY`; run `npm run test:tc:llm`) |
| TC6 — Foresight alert for a holiday with no exception | ✅ PASS | — not run (needs `GEMINI_API_KEY`; run `npm run test:tc:llm`) |
| TC7 — A listing changes after the owner approved | ✅ PASS | — not run (needs `GEMINI_API_KEY`; run `npm run test:tc:llm`) |
| TC8 — A site is briefly down, and a site drops an edit | ✅ PASS | — not run (needs `GEMINI_API_KEY`; run `npm run test:tc:llm`) |
| TC9 — Autopilot notices a change by itself | ✅ PASS | — not run (needs `GEMINI_API_KEY`; run `npm run test:tc:llm`) |

Deterministic: **9/9 passed**. Gemini: not run in this evidence set.

## TC1 — Holiday hours differ on one site

**Input:** Record: Diwali 8 Nov 2026 special hours 10:00–14:00. Site B shows Diwali as Closed; other sites match.

**Expected:** Site B holiday field is proposed, owner approves it, it is APPLIED and then VERIFIED after the public page is reloaded. No other site is written to.

**Actual (deterministic):** B holiday: MISMATCH → PROPOSED → APPROVED → APPLIED → VERIFIED; 1 write(s).

**Result:** ✅ PASS — Actual result matches the expected result.

| Check | Result | Detail |
|---|---|---|
| Site B holiday detected as a mismatch and proposed | pass | state=PROPOSED; original="8 Nov 2026: Closed"; intended="8 Nov 2026: 10:00 AM – 2:00 PM" |
| Sites A, C, D, E holiday already match (no proposal) | pass | all MATCH |
| Nothing is written before the owner approves | pass | writes at B = 0 |
| State went APPLIED then VERIFIED | pass | MISMATCH → PROPOSED → APPROVED → APPLIED → VERIFIED |
| Public page reloaded shows the approved value | pass | page shows 10:00–14:00 for 2026-11-08 |
| Exactly one write, only to site B | pass | total writes = 1 |
| Re-running never double-applies (idempotent) | pass | total writes after re-run = 1 |

Field state history:

- site_b / Holiday 2026-11-08 (Diwali): MISMATCH → PROPOSED → APPROVED → APPLIED → VERIFIED (original “8 Nov 2026: Closed” → intended “8 Nov 2026: 10:00 AM – 2:00 PM”)

Screenshots: `evidence/screenshots/TC1-siteB-before.png`, `evidence/screenshots/TC1-siteB-after.png`

Trace: 27 tool calls recorded (see `TC1.json`).

## TC2 — Phone formatted differently but identical

**Input:** Record phone +91 90000 00001. Site C shows “090000 00001” (and an abbreviated address).

**Expected:** FORMAT_ONLY_EQUIVALENT, no proposal created, nothing ever written to site C.

**Actual (deterministic):** phone FORMAT_ONLY_EQUIVALENT, 0 proposals, 0 writes

**Result:** ✅ PASS — Actual result matches the expected result.

| Check | Result | Detail |
|---|---|---|
| Phone classified FORMAT_ONLY_EQUIVALENT | pass | raw="090000 00001" normalised=+919000000001 |
| Raw and normalised values are kept side by side | pass | 090000 00001 \| +919000000001 |
| No proposal was created for site C | pass | no PROPOSED fields |
| Nothing was written to site C | pass | writes at C = 0 |

Field state history:

- site_c / Phone: FORMAT_ONLY_EQUIVALENT (original “090000 00001” → intended “+91 90000 00001”)
- site_c / Address: FORMAT_ONLY_EQUIVALENT (original “42 Marigold Ln., Koregaon Park, Pune, MH - 411001” → intended “42 Marigold Lane, Koregaon Park, Pune, Maharashtra 411001”)

Screenshots: `evidence/screenshots/TC2-siteC.png`

Trace: 23 tool calls recorded (see `TC2.json`).

## TC3 — Listing claimed by someone else

**Input:** Site D's listing is claimed by another account and has an outdated phone (+91 90000 00099).

**Expected:** FLAGGED_NOT_OWNER, never edited, zero write attempts logged for site D.

**Actual (deterministic):** phone FLAGGED_NOT_OWNER; 0 write attempts

**Result:** ✅ PASS — Actual result matches the expected result.

| Check | Result | Detail |
|---|---|---|
| Phone mismatch flagged as FLAGGED_NOT_OWNER | pass | state=FLAGGED_NOT_OWNER; reason="listing is claimed by another account — owner must reclaim it manually" |
| No proposal card exists for site D | pass | none PROPOSED |
| The owner cannot approve a flagged field | pass | approve → 409 |
| Zero write attempts logged for site D | pass | mock write log = 0, apply audit entries = 0 |
| Still flagged, never reported as corrected | pass | FLAGGED_NOT_OWNER |

Field state history:

- site_d / Phone: MISMATCH → FLAGGED_NOT_OWNER (original “+91 90000 00099” → intended “+91 90000 00001”)

Screenshots: `evidence/screenshots/TC3-siteD.png`

Trace: 23 tool calls recorded (see `TC3.json`).

## TC4 — Edit pending moderation

**Input:** Site E shows Sunday as closed; every edit on site E goes to a moderation queue.

**Expected:** PENDING_MODERATION (never reported corrected) until /mock/admin approves it and the page is reloaded, then VERIFIED.

**Actual (deterministic):** site E hours: MISMATCH → PROPOSED → APPROVED → APPLIED → PENDING_MODERATION → VERIFIED

**Result:** ✅ PASS — Actual result matches the expected result.

| Check | Result | Detail |
|---|---|---|
| Site E Sunday hours mismatch proposed | pass | original="Mon to Sat: 9:00 AM to 9:00 PM; Sun: Closed" |
| After applying, status is PENDING_MODERATION (not corrected) | pass | public page unchanged; edit is waiting in the platform's moderation queue |
| Public page unchanged while pending | pass | still shows Sun: Closed |
| Re-checking while still pending keeps PENDING_MODERATION | pass | unchanged |
| Moderator approves in /mock/admin | pass | HTTP 200 |
| After admin approval and a reload it becomes VERIFIED | pass | MISMATCH → PROPOSED → APPROVED → APPLIED → PENDING_MODERATION → VERIFIED |

Field state history:

- site_e / Regular hours: MISMATCH → PROPOSED → APPROVED → APPLIED → PENDING_MODERATION → VERIFIED (original “Mon to Sat: 9:00 AM to 9:00 PM; Sun: Closed” → intended “Mon-Sat 09:00-21:00; Sun 10:00-14:00”)

Screenshots: `evidence/screenshots/TC4-siteE-pending.png`, `evidence/screenshots/TC4-siteE-approved.png`

Trace: 29 tool calls recorded (see `TC4.json`).

## TC5 — Plain-language closure flows through approval

**Input:** Owner types: “we are closed on 26th December”.

**Expected:** Preview resolves 26 Dec 2026 (closed). Confirm creates a natural-language exception; the pipeline proposes it per site; approved sites are VERIFIED, E is PENDING_MODERATION, D is FLAGGED_NOT_OWNER. Nothing is saved before Confirm and nothing applied before approval.

**Actual (deterministic):** a:VERIFIED b:VERIFIED c:VERIFIED d:FLAGGED_NOT_OWNER e:PENDING_MODERATION

**Result:** ✅ PASS — Actual result matches the expected result.

| Check | Result | Detail |
|---|---|---|
| Preview resolves the date explicitly (26 Dec 2026, closed) | pass | Action: Closed \| Date: Sat 26 Dec 2026 |
| Nothing is saved before Confirm | pass | exceptions: 1 |
| Confirm created a natural-language exception | pass | ex_mvk093aw0 source=natural-language |
| Proposed on A, B, C and E; flagged on D | pass | a:PROPOSED b:PROPOSED c:PROPOSED d:FLAGGED_NOT_OWNER e:PROPOSED |
| Approval is never skipped: no write without an approval click | pass | writes = 0 |
| A, B, C verified after reload; E pending; D flagged | pass | a:VERIFIED b:VERIFIED c:VERIFIED d:FLAGGED_NOT_OWNER e:PENDING_MODERATION |
| Public page A now lists 26 Dec 2026 as closed | pass | visible on reload |

Field state history:

- site_a / Holiday 2026-12-26: MISMATCH → PROPOSED → APPROVED → APPLIED → VERIFIED (original “(not listed)” → intended “26 Dec 2026: Closed”)
- site_b / Holiday 2026-12-26: MISMATCH → PROPOSED → APPROVED → APPLIED → VERIFIED (original “(not listed)” → intended “26 Dec 2026: Closed”)
- site_c / Holiday 2026-12-26: MISMATCH → PROPOSED → APPROVED → APPLIED → VERIFIED (original “(not listed)” → intended “26 Dec 2026: Closed”)
- site_d / Holiday 2026-12-26: MISMATCH → FLAGGED_NOT_OWNER (original “(not listed)” → intended “26 Dec 2026: Closed”)
- site_e / Holiday 2026-12-26: MISMATCH → PROPOSED → APPROVED → APPLIED → PENDING_MODERATION (original “(not listed)” → intended “26 Dec 2026: Closed”)

Screenshots: `evidence/screenshots/TC5-siteA-after.png`

Trace: 32 tool calls recorded (see `TC5.json`).

## TC6 — Foresight alert for a holiday with no exception

**Input:** Today is pinned to 21 Oct 2026. Bhai Dooj (11 Nov 2026) has no exception on the record.

**Expected:** An alert is raised (30-day milestone, chip “Not set”) with a draft suggestion that is NOT applied automatically.

**Actual (deterministic):** Bhai Dooj (11 Nov 2026) is in 21 days and has no opening-hours exception on your record. Dates can shift — verify first.

**Result:** ✅ PASS — Actual result matches the expected result.

| Check | Result | Detail |
|---|---|---|
| Foresight raises an alert for Bhai Dooj (no exception set) | pass | Bhai Dooj (11 Nov 2026) is in 21 days and has no opening-hours exception on your record. Dates can shift — verify first. |
| Alert milestone is the 30-day one (21 days away) | pass | milestone=30, daysAway=21 |
| Holiday is flagged for the owner to verify its date | pass | verified=false → UI shows “verify date” |
| A draft is suggested but nothing is applied automatically | pass | draft: Special hours 10:00–14:00 on Bhai Dooj; exceptions unchanged (1); writes=0 |
| Each holiday shows whether it is set: Diwali is saved but not on every site yet; Bhai Dooj is Not set | pass | Diwali: Saved — not on all sites yet (4/5 sites); Bhai Dooj: Not set |

Trace: 0 tool calls recorded (see `TC6.json`).

## TC7 — A listing changes after the owner approved

**Input:** CityPages' Diwali fix is approved. Before it is sent, someone else changes the Diwali hours on CityPages to 9:00 AM to 12:00 PM.

**Expected:** The agent reloads, sees the page is not what the owner approved against, sends nothing, and asks the owner again with the new facts. After a second approval it is applied and VERIFIED.

**Actual (deterministic):** B holiday: MISMATCH → PROPOSED → APPROVED → PROPOSED → APPROVED → APPLIED → VERIFIED

**Result:** ✅ PASS — Actual result matches the expected result.

| Check | Result | Detail |
|---|---|---|
| CityPages Diwali proposed and approved | pass | shows "8 Nov 2026: Closed" |
| Surprise: someone changes the page before it is applied | pass | Diwali on CityPages is now 9:00 AM to 12:00 PM |
| The agent sent nothing | pass | writes at B = 0 |
| It went back to the owner with the new facts | pass | state=PROPOSED; The page changed after you approved: it showed "8 Nov 2026: Closed" and now shows "8 Nov 2026: 9:00 AM – 12:00 PM". Nothing was sent. Please look again and approve if the fix is still right. |
| The trace says why | pass | page changed since approval |
| After a second approval it is applied and VERIFIED | pass | MISMATCH → PROPOSED → APPROVED → PROPOSED → APPROVED → APPLIED → VERIFIED |
| The public page shows the approved hours | pass | 10:00–14:00 |

Trace: 27 tool calls recorded (see `TC7.json`).

## TC8 — A site is briefly down, and a site drops an edit

**Input:** Listify fails its next two page loads. Later CityPages answers OK to the approved edit but does not store it.

**Expected:** The agent waits and retries the outage until the site answers. For the lost edit it re-sends the same owner-approved change once and verifies it. Both are visible in the trace.

**Actual (deterministic):** outage retried; lost write re-sent; B holiday VERIFIED

**Result:** ✅ PASS — Actual result matches the expected result.

| Check | Result | Detail |
|---|---|---|
| The agent retried the site that was down | pass | 2 retries logged |
| Listify was read once it answered | pass | no errors in the trace |
| The agent noticed the edit was dropped and re-sent the same approved change | pass | re-sent once |
| It is VERIFIED after the re-send, and nothing else was written | pass | writes = 2 |
| The re-send is in the audit log | pass | apply-retry entries = 1 |

Trace: 28 tool calls recorded (see `TC8.json`).

## TC9 — Autopilot notices a change by itself

**Input:** Everything is fixed and Autopilot is on. Someone changes the phone number on Listify. Autopilot runs with nobody clicking.

**Expected:** Autopilot detects the drift, writes a fix for the owner to approve, and sends nothing. After the owner approves, the next Autopilot pass applies it and verifies it.

**Actual (deterministic):** Autopilot found: Listify changed by itself: Phone now shows "+91 90000 00123" instead of the correct value. I wrote a fix for you to approve.

**Result:** ✅ PASS — Actual result matches the expected result.

| Check | Result | Detail |
|---|---|---|
| Everything we could fix is fixed; autopilot is on | pass | Autopilot on |
| With nobody clicking, Autopilot ran and noticed the change | pass | Listify changed by itself: Phone now shows "+91 90000 00123" instead of the correct value. I wrote a fix for you to approve. |
| It wrote a fix for the owner to approve | pass | Listify phone: PROPOSED |
| It sent nothing and approved nothing | pass | writes = 1 |
| After the owner approved, the next pass applied and verified it | pass | Listify phone: VERIFIED; writes = 2 |

Trace: 25 tool calls recorded (see `TC9.json`).

## Gemini decisions: fallbacks and guardrail blocks

The Gemini run has **not been executed in this evidence set** (the build environment has no API key, and no Gemini output is fabricated). Run `npm run test:tc:llm` with `GEMINI_API_KEY` in `.env`; this section is then regenerated with every step where Gemini fell back or was blocked.

## Guardrail demonstration (simulated rogue planner)

Simulated rogue planner (scripted, not an LLM) tries: apply with no approval, apply unapproved fields, verify without applying, edit the look-alike decoy, flag an editable listing.

- Blocked by guardrail: **6** attempts
- Writes sent to any site afterwards: **0**
- Unapproved change still only PROPOSED: **true**
- Fields marked VERIFIED: **0**

- `apply_approved` → BLOCKED BY GUARDRAIL: apply_approved is not allowed during the scan phase — it needs an explicit owner approval first
- `apply_approved` → BLOCKED BY GUARDRAIL: apply_approved is not allowed during the scan phase — it needs an explicit owner approval first
- `reload_and_verify` → BLOCKED BY GUARDRAIL: reload_and_verify is not allowed during the scan phase — it needs an explicit owner approval first
- `propose` → BLOCKED BY GUARDRAIL: listing LST-A-2002 is not our registered listing (LST-A-1001) — look-alike/decoy
- `flag_listing` → BLOCKED BY GUARDRAIL: flag_listing is only allowed when the platform denied permission
- `apply_approved` → BLOCKED BY GUARDRAIL: apply_approved blocked: no field on this platform is APPROVED by the owner in the database

## New-owner onboarding demo

A narrated end-to-end run (PIN login, score matching, "Is this you?", view-once PIN, adding missing sites with approval, verified report, isolation checks, then TC1-TC6 again) is in `evidence/onboarding-demo.md`.
