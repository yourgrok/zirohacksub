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
  C -->|no| N[status: Not set]
  C -->|yes| S[read every site's special days]
  S -->|all show it| OK[status: Set on all sites]
  S -->|not all| PA[status: Saved, not on all sites yet]
  N --> AL[alert at 30 / 14 / 7 days]
  PA --> AL
  N --> BTN[owner picks: Closed all day / Special hours with own times / Open as usual]
  PA --> BTN
  OK --> BTN
  BTN -->|Closed or Special hours| EX[record exception, source foresight<br/>updates the one already set for that day]
  BTN -->|Open as usual| RM[cancel that day's exception]
  EX --> PIPE[normal scan → approval → apply → verify]
  RM --> PIPE
```
Field-level mismatches (which site shows what) are not shown on the Holidays tab: they live in the scan, Approvals and Consistency tabs. Days inside a longer closure typed in Edit & Ask are read-only here.

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

---

# Multi-business access, onboarding and PIN login

## 9. Login and tenant isolation

```mermaid
sequenceDiagram
  participant B as Browser
  participant S as Server
  participant DB as SQLite
  B->>S: POST /api/auth/login {pin}
  S->>S: rate-limit check (5 failures per IP, then cool-down)
  S->>S: normalise PIN, HMAC-SHA256(PIN_SECRET, PIN)
  S->>DB: SELECT business WHERE pin_hmac = hmac
  S->>S: constant-time compare, one generic "Invalid PIN." on any failure
  alt pending business (first login)
    S->>S: activate: claim + link the confirmed listings
  end
  S->>DB: store sha256(random session id) -> business uid
  S-->>B: Set-Cookie sid (httpOnly, SameSite=Lax, Secure over https)
  B->>S: any /api/... request with the cookie
  S->>S: requireAuth -> req.biz (uid); every query takes that uid
```

- Every store/agent/report function takes the business id as a **required argument** (no "current business" default), so a missing uid is a compile error, not a data leak. Rows in `field_states`, `exceptions`, `platform_listings`, `runs`, `trace`, `audit_log`, `site_matches` carry `business_id`.
- Looking up someone else's field id answers **404** exactly like a missing one (`getOwnedField`).
- Global operations (reset, `/tests`, evidence) require the demo business.
- The mock listing sites accept dashboard reads/edits only with a **server-signed delegated credential** (`x-mock-account` + HMAC token), simulating the owner's login on a real platform.

## 10. New-owner onboarding

```mermaid
flowchart TD
  D[owner enters name, address, phone, hours?] --> R[read every listing on every site<br/>index page + each listing page, look-alikes included]
  R --> S[score each listing 0-100<br/>phone 40 + address 35 + name 25]
  S --> P{per site: top listing}
  P -->|claimed by another account| F[FLAGGED: never linked, manual step]
  P -->|score below LOW 45| N[no listing found here]
  P -->|HIGH 75+ and MARGIN 15+ ahead| A[proposed: owner must still confirm]
  P -->|in between / too close| Q[owner picks one of top 3, or none]
  A --> C{owner: Yes, that's me?}
  Q --> C
  C -->|yes| K[confirmed]
  C -->|no| X[rejected]
  K --> B[create PENDING business + PIN<br/>PIN shown once, only HMAC stored]
  X --> B
  F --> B
  N --> B
  B --> L[first login with the PIN]
  L --> M[claim confirmed listings on the sites, link them, business becomes ACTIVE]
  B -.->|PIN never used for 30 min| E[discarded; nothing was ever claimed]
```

Score examples (real, from the seeded data):

| Entered | Listing | phone | address | name | Score | Decision |
|---|---|---|---|---|---|---|
| Sunrise Sweets & Bakery … +91 90000 00001 | the true Sunrise listing | 40 | 35 | 25 | **100** | claimed by another account → flagged |
| same | look-alike *Sunrise Sweet House* (17 Maple Road, +91 90000 00077) | 0 | 18 | 19.7 | **37.7** | below LOW → no match |
| same | Sunrise listing with an old phone | 0 | 35 | 25 | **60** | between LOW and HIGH → owner chooses |
| Green Leaf Cafe … +91 90000 00031 | *Green Leaf Café*, `8 Lotus St., Baner, Pune, MH - 411045`, `090000 00031` | 40 | 35 | 25 | **100** | strong match |
| same | look-alike *Green Leaf Cafe & Bakery*, Kothrud, +91 90000 00032 | 0 | 8.2 | 22.4 | **30.6** | below LOW → no match |

## 11. Add my business to a site where it is not listed

```mermaid
stateDiagram-v2
  [*] --> PROPOSED: owner presses "Add my business here"<br/>(re-checks the site for a matching listing first)
  PROPOSED --> APPROVED: owner approves the exact fields + destination
  PROPOSED --> REJECTED: owner rejects
  APPROVED --> PROPOSED: a matching listing appeared meanwhile - blocked, nothing created
  APPROVED --> APPLIED: site created it (200) or queued it (202)
  APPLIED --> VERIFIED: public page reloaded and shows the owner's values
  APPLIED --> PENDING_MODERATION: page does not exist yet, but it is in the site's queue
  PENDING_MODERATION --> VERIFIED: moderator approves, page reloaded
  PENDING_MODERATION --> MISMATCH: moderator rejects
  VERIFIED --> [*]: listing linked, now part of every later scan
```

## 12. Added failure handling

| Failure | What happens | Where |
|---|---|---|
| Wrong, malformed or empty PIN | same generic "Invalid PIN."; counted toward the lock-out | `server/auth.ts` |
| 5 wrong PINs from one client | 429 with Retry-After; even the right PIN is refused during the cool-down | `auth/limiter.ts` |
| Browser sends a business's field id belonging to another business | 404, nothing changes | `core/store.ts` `getOwnedField` |
| Another origin posts to the API | 403 | `server/auth.ts` `sameOrigin` |
| Site cannot be read during matching | reported, nothing matched or created there | `onboarding/discover.ts` |
| Best match is claimed by another account | flagged, cannot be confirmed, no duplicate may be created | `onboarding/score.ts`, `agent/createListing.ts` |
| Two owners confirm the same listing | the first login claims it; the second is told it was taken and it is not linked | `onboarding/service.ts` |
| PIN page refreshed before it was saved | the business was still pending: it expires unused and onboarding can be redone | `onboarding/service.ts` |
| A matching listing appears after "Add my business" was approved | blocked right before sending; nothing created | `agent/createListing.ts` |
| Moderator rejects a created listing | card goes back to a failed state (never "verified"); the owner may ask again | `agent/createListing.ts` |


---

# Console tabs and the text box

## 13. Text box routing

```mermaid
flowchart TD
  T[owner types a sentence] --> Q{starts like a question?<br/>what / which / when / is / show ...}
  Q -->|yes| A[answer from the owner's own data<br/>record, per-site checks, coverage, pending, change log, holidays]
  Q -->|no| E{has a new value for<br/>phone / address / name / weekly hours?}
  E -->|yes| D[preview old -> new, Save this change<br/>updateBusinessDetails + change log]
  E -->|no| X{a date, closure or special hours?}
  X -->|yes| C[date parser chrono + rules<br/>Gemini double-checks if a key is set]
  X -->|no| H[one question: what I can do]
  D --> P[stale approvals for the old value go back to review]
  P --> S[scan: every site compared with the new record]
  C --> S
  S --> AP[approval cards in the Approvals tab]
```
Questions and detail edits never leave the server (only date requests may be cross-checked by a model).

## 14. What each tab reads

| Tab | Data it uses |
|---|---|
| My Details, Listings & Sites, Approvals, Consistency | `GET /api/state` (record, coverage, matches, report rows), approvals via `/api/fields/:id/approve|reject`, `/api/platforms/:id/approve-all` |
| Edit & Ask | `POST /api/nl/preview|refine|confirm`, `GET/PUT /api/business`, `POST /api/exceptions/:id/cancel` |
| Change Log | `GET /api/changelog` (change_log table + audit_log, newest first) |
| Agent Trace | `GET /api/trace` (latest run, or `?all=1` incl. login and older runs) |
| Holidays | `GET /api/foresight`, `POST /api/foresight/:id/accept` |
| Add Business | the public `/api/onboarding/*` routes, then `/api/auth/login` with the new PIN (switches business) |

Every endpoint is scoped to the logged-in business; the tab never sends a business id.
