# New-owner onboarding demo (real run)

Run: 2026-10-22T12:40:44.849Z · mock sites and synthetic data only · in-memory database · the PIN is masked everywhere in this log.

## 1. Not logged in: nothing is reachable

- ✅ GET /api/state without a login → 401
- ✅ a wrong PIN gets one generic message

## 2. New owner enters details; the agent reads every listing on every site and scores it

Entered: **Green Leaf Cafe**, 8 Lotus Street, Baner, Pune, Maharashtra 411045, +91 90000 00031

| Site | Decision | Best listing | Score | Why (phone / address / name) |
|---|---|---|---|---|
| Listify (Site A) | AUTO | Green Leaf Cafe (LST-A-4001) | 100 | 40/40 · 35/35 · 25/25 |
| CityPages (Site B) | NONE | Green Leaf Cafe & Bakery (LST-B-4002, claimed by another account) | 30.6 | 0/40 · 8.2/35 · 22.4/25 |
| LocalLoop (Site C) | AUTO | Green Leaf Café (LST-C-4001) | 100 | 40/40 · 35/35 · 25/25 |
| NearbyNow (Site D) | CLAIMED | Green Leaf Cafe (LST-D-4001, claimed by another account) | 100 | 40/40 · 35/35 · 25/25 |
| ShopFront (Site E) | NONE | Sunrise Sweet House (LST-E-2002, claimed by another account) | 15.3 | 0/40 · 8.2/35 · 7.1/25 |

- ✅ strong matches on Listify and LocalLoop (formatting differences ignored)
- ✅ the look-alike on CityPages ("Green Leaf Cafe & Bakery", Kothrud) scores below the threshold → no listing found — look-alike scored 30.6
- ✅ NearbyNow's matching listing is claimed by another account → flagged, will not be linked
- ✅ nothing is linked or claimed yet

## 3. Owner confirms each match → business created → PIN shown once

PIN issued: `•••••-•••••` (masked here; shown to the owner exactly once, only its HMAC is stored)

- ✅ the same draft cannot be completed twice (no second PIN)
- ✅ the PIN is not in the database

## 4. Owner logs in with only the PIN

- ✅ login with the PIN works (no username, no password) — business biz_ab75cb006fb9
- ✅ first login claimed and linked the two confirmed listings — LST-A-4001, LST-C-4001
| Site | Status | Note |
|---|---|---|
| Listify (Site A) | listed | LST-A-4001 |
| CityPages (Site B) | missing | not listed here |
| LocalLoop (Site C) | listed | LST-C-4001 |
| NearbyNow (Site D) | flagged | a listing that looks like yours is claimed by another account — reclaim it on the site yourself |
| ShopFront (Site E) | missing | not listed here |


## 5. Add the business to the sites where it is not listed (needs approval)

- ✅ propose "add my business" on site_b
- ✅ propose "add my business" on site_e
- ✅ a flagged site cannot be offered (no duplicate of a claimed listing)
The approval card shows exactly what will be sent and where:

```
Create a new listing on CityPages (Site B)
Name: Green Leaf Cafe
Address: 8 Lotus Street, Baner, Pune, Maharashtra 411045
Phone: +91 90000 00031
Hours: Mon-Sun 08:00-22:00
```

- ✅ pressing Apply with no approval sends nothing
- ✅ CityPages: created, page reloaded, VERIFIED
- ✅ ShopFront (moderated): PENDING_MODERATION, never reported as created
- ✅ the public page of the pending listing does not exist yet
The site's moderator approved it in /mock/admin. Re-checking:

- ✅ ShopFront: after moderator approval and a reload → VERIFIED
- ✅ exactly one create per site (idempotent)

## 6. The report

| Platform | Field | Original value | Approval status | Verified status |
|---|---|---|---|---|
| CityPages (Site B) | New listing | (not listed on this site) | Approved | VERIFIED (page reloaded and checked) |
| ShopFront (Site E) | New listing | (not listed on this site) | Approved | VERIFIED (page reloaded and checked) |

| Site | Matched listing | Score | Owner confirmation | Created listing |
|---|---|---|---|---|
| Listify (Site A) | LST-A-4001 | 100 | Confirmed by owner | — |
| CityPages (Site B) | LST-B-5001 | — | Created by the agent after owner approval | VERIFIED |
| LocalLoop (Site C) | LST-C-4001 | 100 | Confirmed by owner | — |
| NearbyNow (Site D) | LST-D-4001 | 100 | Flagged: claimed by another account (not linked) | — |
| ShopFront (Site E) | LST-E-5001 | — | Created by the agent after owner approval | VERIFIED |

Agent trace for this business: 22 events (match_site×5, owner_confirm×2, create_business×1, claim_listing×2, login×1, done×3, summarise_report×3, apply_approved×2, reload_and_verify×3); every one labelled Deterministic.

- ✅ the PIN appears nowhere in the trace

## 7. Isolation: the seeded Sunrise business is untouched

- ✅ Sunrise logs in with its own PIN
- ✅ Sunrise sees only its own five listings and none of Green Leaf's data
- ✅ Sunrise cannot approve Green Leaf's field (404)
- ✅ the look-alike listings (…-2002) were never touched

## 8. The official test cases still pass (fresh reset each, date pinned)

| Test | Result | Actual |
|---|---|---|
| TC1 Holiday hours differ on one site | PASS | B holiday: MISMATCH → PROPOSED → APPROVED → APPLIED → VERIFIED; 1 write(s). |
| TC2 Phone formatted differently but identical | PASS | phone FORMAT_ONLY_EQUIVALENT, 0 proposals, 0 writes |
| TC3 Listing claimed by someone else | PASS | phone FLAGGED_NOT_OWNER; 0 write attempts |
| TC4 Edit pending moderation | PASS | site E hours: MISMATCH → PROPOSED → APPROVED → APPLIED → PENDING_MODERATION → VERIFIED |
| TC5 Plain-language closure flows through approval | PASS | a:VERIFIED b:VERIFIED c:VERIFIED d:FLAGGED_NOT_OWNER e:PENDING_MODERATION |
| TC6 Foresight alert for a holiday with no exception | PASS | Bhai Dooj (11 Nov 2026) is in 21 days and has no opening-hours exception on your record. Dates can shift — verify first. |


**All checks passed.**