# Business Listing Consistency Agent — CLAUDE.md

Hackathon project (Agentic AI Hackathon 2026, Ziro.Digital, Business & Productivity AI).
An agent keeps a local business's address, phone and hours consistent across (mock) listing sites.
Human approval is required before any edit. **Mock/synthetic data only.**
Business: "Sunrise Sweets & Bakery" (fictional, Pune). Decoy look-alike: "Sunrise Sweet House".

If you lose context: re-read this file and PROGRESS.md first.

## Stack
TypeScript, Node 22, Express 5, React + Vite (console, served by Express from dist/web), SQLite (better-sqlite3),
Zod, Vitest, Playwright (optional reader) + fetch/cheerio fallback, chrono-node, @google/genai (Interactions API).

## Hard rules
- Timezone Asia/Kolkata. `DEMO_NOW` (ISO date) overrides today. Tests always set it (vitest.config.ts: 2026-10-21).
- Never print/log/commit the Gemini key. `.env` is git-ignored. /health never shows it.
- Everything works with NO key (`LLM_PROVIDER=none` or no key => deterministic planner).
- Gemini uses `ai.interactions.create` (NOT generateContent, NOT managed agents). Our code owns the loop.
- Guardrails are in code: apply only runs for DB-APPROVED fields; flag is forced when permission denied;
  only the verifier may set VERIFIED (and only after reload + visible values equal approved values).
- Never weaken a test to pass it.
- Decoy listings are never read as ours or edited.

## Field states
MATCH, FORMAT_ONLY_EQUIVALENT, MISMATCH, PROPOSED, APPROVED, REJECTED, APPLIED, VERIFIED, PENDING_MODERATION, FLAGGED_NOT_OWNER
(transitions enforced in src/core/states.ts).

## Commands (PowerShell-friendly, cross-platform)
- `npm run dev` — server (3000) + Vite (5173)
- `npm run build` — build console; `npm start` — production server
- `npm run typecheck` / `npm test`
- `npm run test:tc` — TC1-TC6 deterministic -> evidence/
- `npm run test:tc:llm` — TC1-TC6 with Gemini -> evidence/llm/ (needs GEMINI_API_KEY in .env)

## Layout
See docs/CODE_MAP.md. Architecture: docs/ARCHITECTURE.md.
