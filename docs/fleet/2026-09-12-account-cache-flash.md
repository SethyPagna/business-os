# Account cache, employee received dates, and reopened SaleDetail flashing

Base: previous live877893912fea, ledger-only successor4fd6883b. This follow-up is deployed as b935bf63b05b. Preserve earlier September11/12 registers and evidence; do not equate passing gates with all user incidents resolved.

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

## Integrated findings and corrections

- Core actor/session/server-scoped opaque read keys and delayed write fences cover HTTP/query/product caches; authenticated legacy unscoped mirror writes/fallbacks are suppressed while offline remains paused. Contacts and import-job private caches required separate fixes; supplier, shared shift and history caches are also now scoped. Legacy history read entries are ignored, not confused with work drafts. 401/403 fail closed.
- Raw import/image/avatar upload and error-download callers now check authority before dispatch. Already-dispatched results and partial-batch upload receipts are retained, not relabeled as never sent.
- POS tracking uses loading/ready/failed and actor/branch/page/request ownership. Even a ready-empty index requires fresh exact-product/branch no-lot proof before fast add. Independent review found and closed hidden-PageSlot late-add behavior. Exact target lot remains a real dated lot; no invented dates or production stock writes.
- Actual modal reproduction found two independent temporary loading blocks: amendment history82px and tracked-product status24px. Both are now accessible sr-only polite announcements with no visible layout height. Simultaneous900ms pending-to-empty/ready results keep Status827.046875, Records937.046875, footer991.046875 and scrollHeight975 identical. Meaningful error/retry and real history remain visible; actual Khmer320px has296px dialog/content widths and no horizontal overflow. Original85-frame video was inspected; changes in it were confined to the cursor, so the reproduction—not the video alone—is the proof.
- Cross-tab quarantine hides/inerts old UI and new portals without unmounting drafts; blocks hotkeys and new mutations, permits explicit safe recovery, and refuses Reload with registered unfinished work. Independent real Edge/Dexie/two-tab tests cover old keys, late committed writes, preserved drafts, and retry.
- Root and independent review reopened initial security PASS: auth cookies can change before a post-response marker, and a delayed ordinary response could renew the old cookie after new login. Pending auth phases now begin before cookie-changing requests and cover OTP/OAuth. Backend ordinary authenticated responses no longer issue Set-Cookie; explicit auth cookies use bounded399-day transport retention, while D1 chosen inactivity expiry/revocation remains authoritative. Existing cookies retain their old expiry until explicit reauthentication. Existing duration-inference drift, browser-close classification and Always browser-cap behavior are not claimed fixed.
- The deterministic simultaneous-admission race is fixed using origin-level Web Locks and separate durable pending ownership. Independent native Edge two-tab testing observed exactly one authentication dispatch; the loser was not dispatched. Unreadable storage or missing locks fail closed. Generic reset preserves coordination keys without snapshotting/restoring stale values. Final independent security verdict:37857866-e515-4a7c-ab7a-fd11d645ea16. Orphaned OAuth pending remains intentionally locked; automatic unsafe expiry/unlock was not added. Unobserved server-side permission changes are not instantaneously detectable.
- Final integration1922f6c9: frontend381/381 test files pass, plus standalone privateReadCaches.test.cjs. Both TypeScript checks pass; i18n5722 keys/599 source files resolves in EN/KM; production build1133 modules succeeds (circular/manual chunk and size advisories remain). Seven legacy partial-window storage fixtures were corrected without changing assertions after the new fail-closed behavior exposed them.
- Backend source unchanged since230e0d68: focused authentication10/10 and effective full356/356 scripts pass. Three first attempts failed in native tooling (two nested Wrangler ETIMEDOUT, one Windows0xC0000409); each isolated retry passed. Original failures and retry logs retained in cloudflare/output/backend-auth-cert-230e0d68. Native oldA/newB cookie race, expiry/revocation/CAS independently pass. No production data mutations or migrations are included.

## Deployment and remaining confirmation

### Blank-screen regression reopened September12

Owner reported blank screen after b935bf63b05b. Exact released production bundle reproduced ReferenceError Cannot access S before initialization in app-auth, where S is STORAGE_KEYS at AppContext module initialization. Actor scope was bundled with app-api-methods, introducing a reverse HTTP dependency. Earlier unit/build certification did not run the existing emitted-bundle cycle gate and was insufficient; a successful build was not startup proof.

Hotfix isolates constants, actorReadScope and permissions into neutral chunks (no business/auth logic changes). The rebuilt emitted graph passes all closure gates with252 chunks and zero cycles. Independent cold browser tests render Login with API401 and authenticated navigation/Notes with synthetic bootstrap, zero authenticated page errors; original TDZ absent. Existing non-blocking signed-out early-bootstrap rejection remains. No claim of full live employee workflow verification. This corrective release requires the same bundle gate and cold-browser checks before deployment.

Corrective release deployed clean02febdc976c5; Worker70bc5cfa-1f61-401a-94e2-fcb707d867e4, runtime hash8894e299950ed1e7, frontend hash1c1af423aad4d18d. Both live endpoints match. Typecheck, production build, emitted graph gate and independent final-stamped cold Login/authenticated tests pass. Live browser redirected to canonical domain Cloudflare403 challenge, so authenticated live shell remains unverified, not falsely passed. No migration/data mutation. Documentation successor is not a deployment.

Authorized follow-up deployed from clean b935bf63b05b with Wrangler4.116.0 using npm run deploy only, after production-coordination claim and successful dry run. Worker version23e118a9-089e-4c66-9e3f-4065fc461c5c; runtime hashb479cd831f711915; built2026-09-11T23:02:55.028Z. Live runtime endpoint independently and directly matches. Live frontend build revision also b935bf63b05b, hash06c606d69e75c910, built2026-09-11T22:58:08.820Z. Branch pushed. No migrations, secret sync, stock/payment/customer data writes, or cleanup of user drafts.

Post-deployment authenticated UI smoke was safely blocked: available computer inventory contained no browser or authenticated tab. No credentials were invented or login/logout performed. Exact employee-device received-date behavior and the owner's remaining flashing observation still require live confirmation; synthetic role/lot and actual mounted-browser tests are evidence of the specific fixes, not a substitute for that observation. Physical printer output remains separately unresolved. Durable smoke result: .git/agent-team/release-b935bf63-authenticated-smoke-20260912.json. This documentation successor does not represent another deployment.
