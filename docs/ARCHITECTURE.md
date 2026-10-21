# Architecture

One deployable Node service: Express API + built React console + five mock listing sites (`/mock/<site>/`) + SQLite.
All examples below use the real seeded data (fictional "Sunrise Sweets & Bakery", `biz_sunrise_001`).

## 1. Workflow

```mermaid
flowchart LR
  A[Collect: owner-approved record<br/>address · phone · hours · holiday exceptions] --> B[Plan: planner picks next tool]
  B --> C[Read: public page + dashboard<br/>raw values kept]
  C --> D[Normalise: E.164 · address tidy · hours/holiday parse]
  D --> E[Compare meaning per field]
  E -->|MATCH / FORMAT_ONLY| R[Report: no change]
  E -->|MISMATCH, we own it| F[Propose card per field/platform]
  E -->|MISMATCH, permission denied| X[FLAG: FLAGGED_NOT_OWNER<br/>no write attempted]
  F --> G{Owner approves?}
  G -->|reject| R
  G -->|approve| H[Apply approved only<br/>idempotent, read-before-write]
  H --> I[Reload public page + dashboard]
  I -->|shows approved value| V[VERIFIED]
  I -->|unchanged but queued| P[PENDING_MODERATION]
  I -->|unchanged, nothing queued| M[MISMATCH again]
  V --> R
  P --> R
  X --> R
```

## 2. Per-field state machine

```mermaid
stateDiagram-v2
  [*] --> MATCH
  [*] --> FORMAT_ONLY_EQUIVALENT
  [*] --> MISMATCH
  MISMATCH --> PROPOSED: planner (propose)
  MISMATCH --> FLAGGED_NOT_OWNER: permission denied
  PROPOSED --> APPROVED: owner only
  PROPOSED --> REJECTED: owner
  APPROVED --> REJECTED: owner (before send)
  APPROVED --> APPLIED: applier (write sent)
  APPROVED --> FLAGGED_NOT_OWNER: 403 / permission denied
  APPLIED --> VERIFIED: verifier only (page reloaded, values equal)
  APPLIED --> PENDING_MODERATION: verifier (queued, page unchanged)
  APPLIED --> MISMATCH: verifier (not applied)
  PENDING_MODERATION --> VERIFIED: verifier after moderator + reload
  PENDING_MODERATION --> MISMATCH: moderator rejected
  VERIFIED --> MISMATCH: drift found on re-scan
  REJECTED --> PROPOSED: owner changes their mind (then approves)
  FLAGGED_NOT_OWNER --> MISMATCH: ownership restored
```
Transitions live in `src/core/states.ts`; entering `APPROVED` requires actor `owner`, entering `VERIFIED` requires actor `verifier` (tests: `tests/states.test.ts`).

## 3. Planner + guardrail flow

```mermaid
sequenceDiagram
  participant L as Agent loop
  participant P as Planner (Gemini or Deterministic)
  participant G as Guardrail (code)
  participant T as Tool registry
  participant DB as SQLite
  L->>P: view = tool list + business record + platform states + last results
  alt Gemini ok
    P-->>L: decision {tool, platform, rationale} (Zod-validated) [badge Gemini]
  else 429 / timeout / bad JSON / schema fail
    P-->>L: deterministic decision [badge Fallback + reason]
  end
  L->>G: check(decision)
  alt unsafe (e.g. apply_approved with no APPROVED row)
    G-->>L: block / force flag_listing
    L->>DB: trace row [badge Blocked: reason]
    L->>P: deterministic planner picks the next step instead
  else allowed
    L->>T: run tool
    T->>DB: field states, audit log
    T-->>L: output summary
    L->>DB: trace row (tool, input, output, duration, badge)
  end
```
Guardrails (`src/agent/guard.ts`, `tools.ts`): `apply_approved` only for DB-`APPROVED` fields; permission denied ⇒ `flag_listing` forced; scan-phase tools cannot apply; `flag_listing` only when permission was denied; `reload_and_verify` only when something was applied; any listing ID other than the registered one is blocked; only the verifier moves a field to `VERIFIED`.

## 4. Normalisation examples (real data)

| Field | Raw on site | Normalised | vs. record | Result |
|---|---|---|---|---|
| Phone (site C) | `090000 00001` | `+919000000001` | `+919000000001` | FORMAT_ONLY_EQUIVALENT |
| Phone (site D) | `+91 90000 00099` | `+919000000099` | `+919000000001` | MISMATCH → FLAGGED (not owner) |
| Address (site C) | `42 Marigold Ln., Koregaon Park, Pune, MH - 411001` | `42 marigold lane koregaon park pune maharashtra 411001` | same string | FORMAT_ONLY_EQUIVALENT |
| Hours (site B) | `Mon–Sat: 09:00–21:00 / Sun: 10:00–14:00` | `Mon-Sat 09:00-21:00; Sun 10:00-14:00` | same | MATCH (24 h grouped) |
| Hours (site A) | `Monday: 9:00 AM – 9:00 PM …` (7 rows) | `Mon-Sat 09:00-21:00; Sun 10:00-14:00` | same | MATCH (12 h per-day table) |
| Hours (site E) | `Sun: Closed` | `…; Sun closed` | `Sun 10:00-14:00` | MISMATCH → PROPOSED → PENDING_MODERATION |
| Holiday (site B) | `2026-11-08 (Diwali) · Closed` | `2026-11-08..2026-11-08 closed` | `…special 10:00-14:00` | MISMATCH → VERIFIED after fix |

```mermaid
flowchart LR
  raw["raw: 090000 00001"] --> strip[strip non-digits] --> trunk["10 digits? 0+10? 91+10?"] --> e164["+919000000001"]
  rec["record: +91 90000 00001"] --> e164b["+919000000001"]
  e164 --> eq{equal?}
  e164b --> eq
  eq -->|yes, text differs| FO[FORMAT_ONLY_EQUIVALENT — no proposal]
  eq -->|no| MM[MISMATCH]
```

## 5. Entity identity and decoy handling

```mermaid
flowchart TD
  REG[(platform_listings registry<br/>biz_sunrise_001 → LST-B-1001)] --> RD[read_listing fetches /mock/b/listing/LST-B-1001]
  RD --> ASSERT{page data-listing-id == registered?}
  ASSERT -->|no| ERR[IDENTITY_MISMATCH: platform skipped]
  ASSERT -->|yes| OK[parse fields]
  SEARCH["/mock/b/?q=sunrise lists LST-B-1001 and decoy LST-B-2002<br/>(Sunrise Sweet House, 17 Maple Road, +91 90000 00077)"] -. never used for discovery .-> RD
  GUARD[guard: decision naming any other listing id → blocked] --> OK
```
The decoy exists on all five sites with a different ID, address, phone and hours. Tests assert it is never written to (`LST-*-2002` has 0 entries in the mock write log).

## 6. Add-on flow: Holiday Foresight

```mermaid
flowchart TD
  H[data/holidays.json<br/>verified:false, region] --> W[next 90 days from today IST / DEMO_NOW]
  W --> C{exception on record covering the date?}
  C -->|no| N[chip: Not set]
  C -->|yes| S[read every site's special days]
  S -->|0 show it| RO[chip: Set on record only]
  S -->|all show it| OK[chip: Consistent everywhere]
  S -->|some| MM[chip: Mismatch on N sites]
  N --> AL[alert at 30 / 14 / 7 days]
  RO --> AL
  MM --> AL
  N --> DR[draft: Closed or Special hours]
  DR -->|owner accepts| EX[record exception, source foresight]
  EX --> PIPE[normal scan → approval → apply → verify]
```
Readiness (0-100) for the next holiday = 40 (exception on record) + 40 × (sites correct ÷ sites) + 20 (nothing flagged/pending; 10 if pending; 0 if flagged). Seeded Diwali: 40 + 32 + 20 = 92 (site B wrong).

## 7. Add-on flow: plain-language closures

```mermaid
flowchart TD
  T[owner types text] --> D300[debounce 300 ms]
  D300 --> DET[deterministic parser: chrono-node + keyword rules<br/>resolves against today IST]
  DET -->|ok| CH[live chips: action · resolved date · time · reason]
  DET -->|past / unclear / ambiguous| Q[exactly one clarifying question]
  CH --> GEM[Gemini fast model, strict JSON + Zod — only after parser result]
  GEM -->|agrees| CH
  GEM -->|disagrees| BOTH[show both readings; owner picks]
  GEM -->|fails| CH
  CH --> CONF{owner presses Confirm?}
  CONF -->|no| NOP[nothing saved]
  CONF -->|yes| EXC[record exception, source natural-language]
  EXC --> PIPE[scan → approval cards → apply → verify]
```
Example: "we are closed on 26th December" (today 2026-10-21) → Closed · Sat 26 Dec 2026 → Confirm → proposals on A, B, C, E, flag on D → approved sites VERIFIED, E PENDING_MODERATION (TC5).

## 8. Failure handling

| Failure | What happens | Where |
|---|---|---|
| No API key / `LLM_PROVIDER=none` | Deterministic planner and template summary; everything works | `service.ts` |
| Gemini 429 | One retry after back-off, then step falls back (badge Fallback) | `llm.ts` |
| Gemini timeout (8 s) | Step falls back | `llm.ts` |
| Gemini invalid JSON / Zod failure / unknown tool | Step falls back; nothing executed | `llm.ts`, `geminiPlanner.ts` |
| Model 404/unsupported | Try the other configured model, then fall back | `llm.ts` |
| Gemini suggests an unsafe action | Blocked or forced to flag; deterministic planner continues (badge Blocked) | `guard.ts`, `loop.ts` |
| Playwright cannot launch | `READER_MODE=auto` silently uses HTTP + cheerio | `reader.ts` |
| Page shows a different listing ID | `IDENTITY_MISMATCH`, platform skipped, no edit | `tools.ts` |
| Dashboard says permission denied / HTTP 403 on write | Field → `FLAGGED_NOT_OWNER` | `tools.ts` |
| Moderation queue | `PENDING_MODERATION` until reload shows the value | `tools.ts` |
| Edit sent but page never changes and nothing queued | Back to `MISMATCH` with a reason | `tools.ts` |
| Same step re-run | Read-before-write skips an already-correct value; only `APPROVED` rows are sent, so no double apply | `tools.ts` |
| Free host restarts, SQLite wiped | App reseeds on boot | `seed.ts`, `server/index.ts` |
| Another run in progress | API returns 409 | `app.ts` |
