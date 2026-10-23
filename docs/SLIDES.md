# Slide outline (11 slides) — built from real run data

**1. Title** — Business Listing Consistency Agent · Agentic AI Hackathon 2026 · Business & Productivity AI. Tagline: "Same address, phone and hours everywhere — and nothing changes without your approval."

**2. The problem** — A local shop's details drift across listing sites; mismatches cost customers (wrong phone, wrong holiday hours). Doing it by hand is slow; letting a bot edit freely is unsafe.

**3. The agent loop** — Collect → Plan → Read → Normalise → Compare → Propose → Owner approves → Apply approved → Reload & verify → Report. Eight tools, one visible trace. (Diagram: docs/ARCHITECTURE.md workflow.)

**4. Meaning, not formatting** — "090000 00001" = "+91 90000 00001" → FORMAT_ONLY_EQUIVALENT, zero proposals (TC2). Raw and normalised values kept side by side. Holiday hours are separate fields from regular hours.

**5. Human approval and safety states** — Per-field state machine; only the owner approves, only the verifier verifies. Site D claimed by someone else → FLAGGED, 0 write attempts (TC3). Site E moderation → PENDING_MODERATION until /mock/admin approves + reload (TC4).

**6. Live demo flow** — Scan → cards → approve → apply → reload. Before/after table with the brief's six columns; CSV + print. Real result: TC1 "B holiday: MISMATCH → PROPOSED → APPROVED → APPLIED → VERIFIED; 1 write(s)."

**7. Gemini as planner, code as guard** — Interactions API; Zod-validated decisions; fallback on 429/timeout/invalid JSON. Trace badges: Gemini / Deterministic / Fallback / Blocked. (Live Gemini evidence is produced by `npm run test:tc:llm`; not fabricated here.)

**8. Guardrails you can see** — A simulated rogue planner made 6 unsafe attempts (apply without approval, unapproved fields, verify without apply, decoy listing, flag an editable listing): 6 blocked, 0 writes, 0 false VERIFIED.

**9. Add-ons: Foresight and plain English** — Holiday Foresight: 90-day scan, a Not set / Set on all sites status per holiday, alerts at 30/14/7 days, Closed / Special hours / Open as usual buttons that never auto-apply; TC6: "Bhai Dooj (11 Nov 2026) is in 21 days and has no opening-hours exception on your record. Dates can shift — verify first.". Plain English: "we are closed on 26th December" → live chips → Confirm → normal approval pipeline (TC5: a:VERIFIED b:VERIFIED c:VERIFIED d:FLAGGED_NOT_OWNER e:PENDING_MODERATION).

**10. New owner: PIN login + score matching** — no username; a view-once PIN; the agent scores every listing on every site (phone 40 · address 35 · name 25), look-alike *Sunrise Sweet House* scores 37.7 vs 100, a good match owned by someone else is flagged, the owner confirms each match, and missing sites are added only after approval and verified (`evidence/onboarding-demo.md`). Every business is isolated from the others.

**11. Results** — Deterministic TC1–TC8: 8/8 pass from a fresh reset. 293/293 automated tests pass. One deployable service (Docker, Render free tier, READER_MODE=http), /health, no key needed.

**12. Limitations (honest)** — Mock sites only · claiming a listing is a mock (no OTP) · a lost PIN means redoing onboarding · festival dates must be owner-confirmed · free-host DB resets (app reseeds on boot) · LLM is optional and guarded · live Gemini evidence needs the owner's key · Docker/Render not built in the build sandbox.
