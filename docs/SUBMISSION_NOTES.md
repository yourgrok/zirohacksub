# Submission notes — Business Listing Consistency Agent

*Agentic AI Hackathon 2026 (Ziro.Digital) · industry: Business & Productivity AI. This document is self-contained: it does not rely on any link being opened. All data is synthetic (fictional bakery, fictional addresses, phone numbers +91 90000 000xx).*

## 1. Problem fit

A local business must keep **address, phone and hours** identical across listing sites. This project is an agent that follows the brief's workflow end to end against five mock listing sites:

1. **Collect** the owner-approved record (address, phone, normal hours, holiday exceptions, stable business ID `biz_sunrise_001` and stable per-platform listing IDs `LST-A-1001` … `LST-E-1001`).
2. **Plan and compare field by field** — phone, address, regular hours, and each holiday exception are separate fields.
3. **Read** each owner dashboard and public page, keeping the **raw value and the normalised value side by side**.
4. **Propose** a correction per field and per platform; **the owner approves or rejects each card** (or "approve all for this platform").
5. **Apply only approved changes** (idempotent), then **reload the public page** and verify.
6. **Report** a before/after table with the brief's columns: platform, field, original value, intended value, approval status, verified status (CSV export + printable view).

Requirements from the brief and where they are met:

| Brief requirement | How it is met |
|---|---|
| Stable ID per business and per listing; look-alikes can't be mixed up | Registry table `platform_listings`; every read asserts the page's listing ID equals the registered one; every site hosts a decoy "Sunrise Sweet House" (`LST-x-2002`, different address/phone/hours) that is never read as ours or edited; the guardrail blocks any decision naming another listing. |
| Compare meaning, not formatting | Phones → E.164 (+91 default); addresses → case/punctuation/abbreviation-normalised; hours parsed from 4 different site formats into one canonical weekly schedule. Formatting-only differences become `FORMAT_ONLY_EQUIVALENT` and create **no** proposal (TC2). |
| Holiday hours separate from regular hours | Each holiday exception is its own field (`holiday:<id>`) with its own state; regular hours is the `hours` field. |
| Approve per platform; flag if claimed/no permission; never attempt the edit | Approval cards per field and per platform. Site D's dashboard reports "claimed by another account"; the field becomes `FLAGGED_NOT_OWNER` and the agent never sends a write (TC3 asserts zero write attempts in the mock site's own write log). |
| Reload and tell pending edits apart | After an edit the verifier reloads the public page; if it is unchanged but the dashboard lists our edit in its moderation queue the field is `PENDING_MODERATION`, never "corrected" (TC4). It becomes `VERIFIED` only after `/mock/admin` approves and a reload shows the value. |
| Ask approval before anything hard to undo; never bypass OTP/CAPTCHA | No tool can write without a DB-recorded owner approval (see §4). OTP/CAPTCHA are not automated; flagged listings show a manual step for the human. |

## 2. How the agent decides

Loop: **Collect → Plan → Read → Normalise → Compare → Propose → (owner approves) → Apply approved → Reload & verify → Report.** Two phases: *scan* (read-only up to proposals) and *execute* (apply approved + verify).

The agent has a **tool registry** of eight tools: `read_listing`, `normalise`, `compare`, `propose`, `apply_approved`, `reload_and_verify`, `flag_listing`, `ask_owner`. Two planners share it:

- **Rules-driven planner** — the default and the one the deployed demo uses; needs no API key and cannot be slowed down or rate-limited by a model.
- **Gemini planner** — optional (`AGENT_PLANNER=gemini` plus a key). Each step Gemini sees only the tool list, the business record, per-platform state and previous tool results (never secrets) and returns a Zod-validated JSON decision; any failure falls back to the rules.

Every tool call is written to a timestamped **agent trace** (tool, input, output summary, duration) with a badge saying who decided: **Gemini / Deterministic / Fallback / Blocked**.

**What the agent does on its own** (all inside the approval rules; none of it needs a click or a model):

| Behaviour | What it does | Proven by |
|---|---|---|
| **Notices change after approval** | Before writing it reloads the page; if the page is no longer what the owner approved against it sends nothing and asks again with the new facts. | TC7 |
| **Copes with a flaky world** | A site that is down is retried (each retry is a trace row); an edit the site said OK to but dropped is re-sent once (the same approved change) and verified. | TC8 |
| **Says why** | Every card has a plain sentence saying what differs and why it matters; each run ends with a short "what I did" briefing. Built from facts in code; Gemini may reword it in the background. | `tests/agentic.test.ts` |
| **Does the paperwork it is allowed to do** | For a listing claimed by someone else it drafts the claim request and lists the manual steps. It never touches OTP, CAPTCHA, calls or postcards. | `tests/agentic.test.ts` |

Per-field state machine (enforced in `src/core/states.ts`, unit-tested): `MATCH, FORMAT_ONLY_EQUIVALENT, MISMATCH, PROPOSED, APPROVED, REJECTED, APPLIED, VERIFIED, PENDING_MODERATION, FLAGGED_NOT_OWNER`. Only the owner can enter `APPROVED`; only the verifier can enter `VERIFIED`.

An **audit log** records who approved what and when, and the exact payload sent with the HTTP status.

## 3. How Gemini is used and constrained

- Official `@google/genai` SDK, **Interactions API** (`ai.interactions.create({ model, input, system_instruction, response_format })` and `output_text`). Not the legacy `generateContent`, and no Gemini managed agents — our own code owns the loop.
- Models from env: `GEMINI_MODEL` (default `gemini-3.5-flash-lite`) for the optional planner and the briefing wording; `GEMINI_FAST_MODEL` (default `gemini-3.5-flash-lite`) for the live closure-preview cross-check. If a model is unavailable (404/unsupported) the other is tried, then the deterministic path.
- Calls go through one queue (**one at a time**), identical calls are **cached**, a 429 is **retried once** after a back-off, and there is an **8 s timeout**. Invalid JSON, a Zod failure, a timeout or a 429 → that step falls back to the deterministic planner and the trace shows a **Fallback** badge with the reason.
- The plain-English headline and the "what I did" briefing are built from facts in code; with a key Gemini may reword them in the background (it is told to add no facts, the output is validated, and the built-in sentences stay if it fails).
- In plain-language closures Gemini's reading is **cross-checked** against the deterministic parser; if they disagree the owner sees both and chooses.
- **Honest status of the live evidence:** the build environment had no Gemini API key and could not reach Google's docs site, so the Gemini path was built against the installed SDK's type definitions and is verified by unit tests with a mocked client (12 tests: Gemini decisions, blocked decisions, forced flag, invalid JSON, 429 retry-then-fallback, timeout, model 404 fallback, caching/serialisation, key never leaked). **No live Gemini run is included in this evidence set.** Run `npm run test:tc:llm` with a key to produce `evidence/llm/`; `evidence/SUMMARY.md` then shows both runs side by side and lists every Gemini fallback or guardrail block.

## 4. Safety guarantees (enforced in code, not in prompts)

| Guarantee | Enforced in | Proven by |
|---|---|---|
| No correction applies without an explicit approval click, even if Gemini asks | `guard.ts` (blocks `apply_approved` unless the DB row is `APPROVED`, rejects unapproved field names) and `tools.ts` (applies only `APPROVED` rows) | `tests/gemini.test.ts` (Gemini says "apply" with no approval → blocked, 0 writes); guardrail demo below |
| Permission denied ⇒ flag, never edit | `guard.ts` forces `flag_listing`; `apply_approved` re-checks the dashboard before any write | TC3; `tests/gemini.test.ts` forced-flag test |
| Only the verifier can mark VERIFIED, only after a reload shows the approved value | `states.ts` (entry-actor rule) and `tools.ts` `reload_and_verify` | `tests/states.test.ts`, TC1, TC4 |
| Pending moderation is never reported as corrected | verifier checks the dashboard queue | TC4 |
| Formatting-only differences never create a change | `compare.ts` | TC2 |
| Decoy listing is never read as ours or edited | identity assertion in `read_listing`; guard blocks other listing IDs | `tests/agent.test.ts` (decoys unchanged, 0 writes to `*-2002`) |
| Re-running never double-applies | read-before-write check + state machine | TC1 re-run check |
| API key never in git, logs, `/health`, trace or evidence | `.gitignore`, redaction in `llm.ts`, `/health` has no key field | `tests/api.test.ts`, `tests/gemini.test.ts` |
| One business can never read or change another's data | every query takes a required business id taken only from the session; foreign ids answer 404 | `tests/auth.test.ts` (IDOR attempts on approve/reject/trace/report/audit) |
| Login PINs are never stored, are hard to guess, and brute force is slowed | HMAC-SHA256 with a server secret as lookup key, constant-time compare, CSPRNG 50-bit PINs, 5 failures then a doubling cool-down, one generic error | `tests/pin.test.ts`, `tests/limiter.test.ts`, `tests/auth.test.ts` (PIN absent from every table and trace) |
| A look-alike or someone else's listing can never be linked or duplicated | score matching + claimed-by-another-account flag; create-listing re-checks the site right before sending | `tests/matching.test.ts`, `tests/onboarding.test.ts`, `tests/addlisting.test.ts` |
| A new listing is never created without an approval click and is never reported verified while pending | create goes through the same approve/apply/verify states | `tests/addlisting.test.ts`, `evidence/onboarding-demo.md` |
| Nothing from plain-language input is saved before Confirm; Confirm still goes through approval | `nl/index.ts` (`preview` is read-only; `confirmIntent` only creates a *record* exception) | TC5 |

### Guardrail demonstration (simulated rogue planner — scripted, not an LLM)
The rogue planner tried to apply with no approval, apply fields nobody approved, verify without applying, touch the look-alike decoy listing and flag an editable listing. **6 attempts were blocked by guardrail; 0 writes reached any site; the unapproved change stayed PROPOSED (true); 0 fields were marked VERIFIED.**

- `apply_approved` → BLOCKED BY GUARDRAIL: apply_approved is not allowed during the scan phase — it needs an explicit owner approval first
- `apply_approved` → BLOCKED BY GUARDRAIL: apply_approved is not allowed during the scan phase — it needs an explicit owner approval first
- `reload_and_verify` → BLOCKED BY GUARDRAIL: reload_and_verify is not allowed during the scan phase — it needs an explicit owner approval first
- `propose` → BLOCKED BY GUARDRAIL: listing LST-A-2002 is not our registered listing (LST-A-1001) — look-alike/decoy
- `flag_listing` → BLOCKED BY GUARDRAIL: flag_listing is only allowed when the platform denied permission
- `apply_approved` → BLOCKED BY GUARDRAIL: apply_approved blocked: no field on this platform is APPROVED by the owner in the database

## 5. Test results (copied from the latest run)

Run: 2026-10-23T13:03:51.640Z, date pinned to 2026-10-21 IST, every test starts from a fresh reset, reader mode auto.

| Test | Deterministic | Gemini | Tool calls (det.) | Actual result (deterministic run) |
|---|---|---|---|---|
| TC1 — Holiday hours differ on one site | PASS | not run (no API key in build environment) | 27 | B holiday: MISMATCH → PROPOSED → APPROVED → APPLIED → VERIFIED; 1 write(s). |
| TC2 — Phone formatted differently but identical | PASS | not run (no API key in build environment) | 23 | phone FORMAT_ONLY_EQUIVALENT, 0 proposals, 0 writes |
| TC3 — Listing claimed by someone else | PASS | not run (no API key in build environment) | 23 | phone FLAGGED_NOT_OWNER; 0 write attempts |
| TC4 — Edit pending moderation | PASS | not run (no API key in build environment) | 29 | site E hours: MISMATCH → PROPOSED → APPROVED → APPLIED → PENDING_MODERATION → VERIFIED |
| TC5 — Plain-language closure flows through approval | PASS | not run (no API key in build environment) | 32 | a:VERIFIED b:VERIFIED c:VERIFIED d:FLAGGED_NOT_OWNER e:PENDING_MODERATION |
| TC6 — Foresight alert for a holiday with no exception | PASS | not run (no API key in build environment) | 0 | Bhai Dooj (11 Nov 2026) is in 21 days and has no opening-hours exception on your record. Dates can shift — verify first. |
| TC7 — A listing changes after the owner approved | PASS | not run (no API key in build environment) | 27 | B holiday: MISMATCH → PROPOSED → APPROVED → PROPOSED → APPROVED → APPLIED → VERIFIED |
| TC8 — A site is briefly down, and a site drops an edit | PASS | not run (no API key in build environment) | 28 | outage retried; lost write re-sent; B holiday VERIFIED |

Unit/integration suite: **293/293 tests passed** across 23 files.

Per-check detail with raw and normalised values, state histories and screenshots: `evidence/SUMMARY.md`.

### New-owner onboarding with PIN login (added after the first submission pack)

- **PIN-only login:** no username or password. A system-generated PIN (10 characters from an alphabet without 0/O/1/I, CSPRNG) maps to the business uid; only an HMAC of it is stored; wrong guesses are throttled; a session cookie is httpOnly. After login every record, listing, approval, report and trace is scoped to that uid.
- **Score matching:** the agent reads every listing (look-alikes included) on all five sites and scores each against the details the owner typed: phone 40 + address 35 + name 25 (all weights/thresholds in one config file). Strong and clear matches are proposed, unclear ones are put to the owner, weak ones are ignored, and good matches **owned by another account are flagged and never linked** (TC3 behaviour). Real scores: the look-alike *Sunrise Sweet House* gets 37.7 against the true listing's 100.
- **"Is this you?" and a view-once PIN:** nothing is linked without the owner's confirmation; the PIN is shown once and cannot be recovered.
- **Adding the business where it is not listed:** an approval card shows the exact fields and destination; after approval the agent creates the listing, reloads the page and reports VERIFIED, or PENDING_MODERATION on a moderated site; it refuses to create duplicates.
- **Tabbed console:** My Details, Listings & Sites, Approvals, Consistency (compact, filterable), Edit & Ask, Change Log, Agent Trace, Holidays, Add Business. The text box edits details, changes weekly hours, sets closures and answers questions from the owner's own data; edits go through approval cards like everything else, and the Change Log records what changed, who did it and when. The Agent Trace has a small walking agent that follows the pointer from step to step.
- The whole journey is reproducible with `npm run demo:onboarding` (evidence in `evidence/onboarding-demo.md`).

## 6. Innovation

- **Holiday Foresight:** scans 90 days ahead from the bundled festival calendar (all dates flagged `verified:false` → the tab warns that festival dates shift and asks the owner to confirm the date, or enter the right one if the calendar is wrong, before saving), a status per holiday (Not set / Saved — not on all sites yet / Set on all sites), alerts at 30/14/7 days, and one-click Closed all day / Special hours (editable opening and closing time) / Open as usual buttons. Choosing hours only saves them on the owner's record; every site change still goes through the normal approval cards, and field-level mismatches stay in the scan and Approvals.
- **Plain-language closures:** one text box; a 300 ms-debounced live preview resolves "tomorrow", "next Monday", "24 to 26 Dec", "open 10 to 2 on Diwali" against today (Asia/Kolkata) and shows the resolved date; unclear/past/ambiguous input gets exactly one clarifying question; 23 unit tests on the parser.
- **Visible guardrails:** blocked actions appear in the trace with a red "Blocked" badge.

## 7. Limitations (honest)

- Mock listing sites only; real platforms need their own integrations/APIs and consent flows.
- Festival dates must be confirmed by the owner; the bundled calendar is approximate and covers about 12 months from the build date.
- On free hosts SQLite is temporary; the app reseeds on boot.
- The LLM is optional and always guarded; the deterministic path is the reference behaviour.
- Docker images and the Render deployment were written but not built in the build environment; see README for what to check.
- The optional mock-OTP dashboard step was not built; instead flagged listings show a manual step and the agent never automates OTP/CAPTCHA.
- Stale special-day entries on a site that are *not* on the owner's record are not detected (only record → site consistency is checked).
- Claiming an unclaimed mock listing needs no OTP (a mock); on a real site that verification must stay human. Login rate limiting is in memory (per instance, resets on restart). A lost PIN cannot be recovered (only its HMAC is stored); onboarding is redone. There is no screen to edit a business record after onboarding. `/mock/admin` (the site's own moderators) is intentionally open.
