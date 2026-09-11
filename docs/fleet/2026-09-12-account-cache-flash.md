# Account cache, employee received dates, and reopened SaleDetail flashing

Base: live 877893912fea, ledger-only successor 4fd6883b. This follow-up is not deployed. Preserve earlier September 11/12 registers and evidence; do not equate passing gates with all user incidents resolved.

## Latest owner report and acceptance

- Multiple accounts share a device. Admin received-date fix appears effective, employees still fail; Update/Refresh did not resolve it. Cache confusion is a hypothesis, not established incident attribution.
- SaleDetail lower-half/action flashing still occurs. Reopen despite earlier lifecycle fixes. Original evidence: `C:/Users/mrkl6/Videos/Captures/Business OS - Google Chrome 2026-09-11 20-48-19.mp4` (exists locally).
- Account changes must not publish or persist previous-user responses, including delayed writes, async imports, logout/login same identity, and another tab. A 401/403 must never become successful cached business data. Preserve pending writes, drafts and audit/undo state; do not blanket-clear storage.
- POS must distinguish loading, ready and failed tracking information. Unknown data cannot bypass required received-date selection. Test actor and branch transitions and fresh server responses.
- Flash fix requires observed video and actual mounted-modal reproduction, not source-only assertions.

## Confirmed findings before implementation

Client reviewer executed actual delayed product-cache callback and route fallback: a prior-account timer can repopulate unscoped six-hour query data after logout clears the mirror; route can return it after HTTP403. This is a confirmed synthetic isolation defect, not proof of the employee's exact request.

POS actual openProductCard callback with initial empty tracking Set and failed=false allows fast add while tracking is pending; failed=true correctly opens the sheet. Fresh lot picker itself uses direct no-store nonce requests, deadline and stale-publication guards.

Native backend fixture for target product3263 / barcode03474637319687 / batch56957 / received2026-09-02 / Shop quantity3 returns identical lots to Admin, POS-only and Sales-only roles. Twelve product-surface tests pass. No employee-specific server lot-filter defect reproduced; actual employee grant/branch/request evidence remains outstanding.

Update currently updates/reloads application shell, not persistent business caches. Service worker excludes API caching; do not blame its asset cache for a proven business-query cache defect.

## Earlier request reconciliation

| Request family | Recorded state / remaining boundary |
|---|---|
| Consistent controls, compact rows, dates and centered pagers | Deployed scoped changes; EN/KM Chromium and targeted live checks, not every physical device. |
| Reports four-control header and complete names | Deployed; automated/mounted checks, latest postdeploy visual comparison not recorded. |
| POS-like customer reassignment and name-only permission | Deployed with backend/native balance, return, retry and undo checks; no production reassignment submitted during QA. |
| General customer / no membership identity | Prior deployed identity safeguards; retain anonymous regression tests. |
| Status, payment methods and uncertain-write recovery | Prior deployed atomic/status/configuration fixes; no live financial QA mutation; do not infer every operator retry resolved. |
| Shift close and transfers/undo | Prior deployed native reconciliation/atomic tests; physical uncertain-network retry remains unverified. |
| Product search and received dates | Employee end-to-end explicitly REOPENED. Admin target-lot smoke and synthetic role tests are not employee-device proof. |
| SaleDetail fields, compact editor and customer section | Deployed; latest flashing explicitly REOPENED. Unsaved line drafts do not change committed footer until Apply. |
| Ordinary-text long-press copy | Deployed code and focused tests; whole-app physical long-press audit incomplete. |
| Continuous 80mm receipt, separate80x50 | Deployed measured output verified at1/10/25 items; physical printer/forced98x148 media unresolved, raster QR-caption advisory retained. |
| Permissions, responsive UI and localization | Targeted enforcement and EN/KM tests; no claim of exhaustive manual audit of every page/action. |

## Ownership and release gates

Root owns this register and integration only. Isolated client-cache owner owns API/cache helpers and auth lifecycle; isolated POS owner owns tracking readiness; flash investigator remains read-only pending evidence. No overlapping shared-worktree edits. Before promotion: independent adversarial reviews, focused reproductions, integrated frontend/type/i18n/build gates and affected backend parity checks. No production data repair inferred from screenshots.

## Integrated findings and corrections (release still held)

- Core actor/session/server-scoped opaque read keys and delayed write fences cover HTTP/query/product caches; authenticated legacy unscoped mirror writes/fallbacks are suppressed while offline remains paused. Contacts and import-job private caches required separate fixes; supplier, shared shift and history caches are also now scoped. Legacy history read entries are ignored, not confused with work drafts. 401/403 fail closed.
- Raw import/image/avatar upload and error-download callers now check authority before dispatch. Already-dispatched results and partial-batch upload receipts are retained, not relabeled as never sent.
- POS tracking uses loading/ready/failed and actor/branch/page/request ownership. Even a ready-empty index requires fresh exact-product/branch no-lot proof before fast add. Independent review found and closed hidden-PageSlot late-add behavior. Exact target lot remains a real dated lot; no invented dates or production stock writes.
- Actual modal reproduction found two independent temporary loading blocks: amendment history82px and tracked-product status24px. Both are now accessible sr-only polite announcements with no visible layout height. Simultaneous900ms pending-to-empty/ready results keep Status827.046875, Records937.046875, footer991.046875 and scrollHeight975 identical. Meaningful error/retry and real history remain visible; actual Khmer320px has296px dialog/content widths and no horizontal overflow. Original85-frame video was inspected; changes in it were confined to the cursor, so the reproduction—not the video alone—is the proof.
- Cross-tab quarantine hides/inerts old UI and new portals without unmounting drafts; blocks hotkeys and new mutations, permits explicit safe recovery, and refuses Reload with registered unfinished work. Independent real Edge/Dexie/two-tab tests cover old keys, late committed writes, preserved drafts, and retry.
- Root and independent review reopened initial security PASS: auth cookies can change before a post-response marker, and a delayed ordinary response could renew the old cookie after new login. Pending auth phases now begin before cookie-changing requests and cover OTP/OAuth. Backend ordinary authenticated responses no longer issue Set-Cookie; explicit auth cookies use bounded399-day transport retention, while D1 chosen inactivity expiry/revocation remains authoritative. Existing cookies retain their old expiry until explicit reauthentication. Existing duration-inference drift, browser-close classification and Always browser-cap behavior are not claimed fixed.
- A further deterministic two-tab simultaneous-admission race requires origin-level atomic admission (Web Locks) plus separate durable pending ownership; final implementation/review pending. Generic reset must neither erase nor asynchronously restore stale marker/pending keys. No deployment until this is certified.
- Integrated gate at230e0d68: frontend380/380 test files pass. Dedicated privateReadCaches.test.cjs also passed independently. Final atomic-admission changes still require another integrated gate. Backend native oldA/newB cookie race, expiry/revocation/CAS checks independently pass; full backend sweep pending.
