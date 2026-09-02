# Business OS consolidated release audit — 2026-09-02

This is the single release checklist for the changes accumulated across the related Business OS sessions. It records the requested behavior, the runtime paths included in this release, and the evidence used before deployment.

## Scope inventory

- [x] Reviewed the whole dirty worktree rather than selecting a small patch.
- [x] Current inventory after generated runtime files and final audit artifacts: 315 changed/untracked paths.
- [x] Runtime/release scope: 301 paths under `frontend/`, `cloudflare/`, and `ops/` (195 frontend, 95 Cloudflare, 11 operations/migration paths).
- [x] Ancillary root/docs/checkpoint/output files were identified separately; they are not part of the Worker asset bundle.
- [x] All new runtime source, tests, migrations, generated public-runtime files, and package-lock changes are present in the verified checkout.
- [x] Temporary receipt QA source files were removed before the production build.

## Consolidated requested behavior

### Products, details, names, images, and barcode

- [x] Product names do not use an ellipsis-only presentation; compact/default surfaces expose the complete name through horizontal scroll where needed.
- [x] Detail views show full names and allow natural multi-line wrapping.
- [x] Long details are not silently truncated; compact overflow is scrollable where a one-line layout is required.
- [x] Product-image clicks open the image/lightbox directly and do not route through View Details first.
- [x] Barcode is kept on one line and shown fully; it is not wrapped.
- [x] The neighboring tag/details input is compact so the barcode receives the available width.
- [x] Barcode scanning is wired to product and transfer entry surfaces, with camera/image states covered by regression tests.
- [x] Product default/detail surfaces, grouped rows, image-only view, forms, and responsive layouts share the same display contracts.

### Dashboard, sales, analytics, and reports

- [x] Dashboard sales summary is compact at phone widths (two summary values per row where appropriate).
- [x] Sales summary includes total, KHR, branch, customer, cashier, and item totals.
- [x] Revenue, COGS, profit, expenses, collected totals, delivery costs/margins, discounts, refunds, and pending revenue use the reconciled report kernels.
- [x] Dashboard, Sales, Branches, and report drill-downs use consistent UTC+7 business-date and time filtering.
- [x] Sales detail and reports remain reachable on narrow iPhone viewports and are not hidden behind the bottom/navigation shell.
- [x] Analytics legends are compact, including Khmer labels, and stay usable as one row or a controlled horizontal strip.
- [x] Sales list/stats share the same filters, paging, search, and status/return breakdown scope.

### Branches, inventory, transfers, and movements

- [x] Branches is organized under the Overview naming and contains the detailed Inventory breakdown.
- [x] Duplicate mini-summary sections were removed in favor of the shared compact statistics strip.
- [x] Inventory/stock movement history is separated from transfer history conceptually while exposed through one coherent Branches/Inventory navigation model.
- [x] Transfer history is server-paged, filterable by branch/date, and shares the movement history contract instead of maintaining a reverted local-only copy.
- [x] Transfer entry supports scanner/barcode lookup.
- [x] FIFO, batch identity, source/destination stock, strict decrement, and legacy untracked-stock conservation are enforced atomically.
- [x] Stock-in session receipts/history have indexed read paths and retain supplier, lot, cost, branch, and receipt attribution.

### Receipt, print, PDF, and image export

- [x] Receipt preview rows wrap long names and SKUs fully without ellipses.
- [x] Receipt export no longer uses the SVG `foreignObject` path that tainted the canvas in Chromium/Safari.
- [x] Export uses a sanitized `html2canvas` render with CORS-safe assets and `allowTaint: false`.
- [x] The print clone releases frozen computed heights so wrapped rows grow instead of overlapping.
- [x] Configured margins replace the screen shell padding; they are not applied twice.
- [x] Left/right margins are symmetric and all right-aligned totals remain inside the 80 mm page.
- [x] The redundant leading separator was removed to shorten the receipt top.
- [x] Open PDF, Image, and Print use the detailed receipt by default; the 80 × 50 card remains an explicit option.
- [x] Fixed 80 × 50 output keeps its physical page size; continuous 80 mm output uses one content-height page.
- [x] Visual artifact inspected: `tmp/pdfs/receipt-current-80mm.pdf` and its 150 DPI render.
- [x] PDF proof: valid PDF 1.4, 1 page, 226.77 pt (80 mm) wide, no encryption/JavaScript, complete long-name content.

### Confirmation, review, and layering

- [x] Destructive/edit actions use confirmation or the pending-review workflow as applicable.
- [x] Review Required actions queue rather than applying silently; approval performs the real mutation and rejection preserves the source record.
- [x] Reopen/resubmit behavior for rejected requests is retained.
- [x] Shared modals, dialogs, menus, filters, lightboxes, and confirmation layers use the centralized portal/modal stacking rules.
- [x] Nested modal integrity, floating-menu placement, date/time pickers, and image lightbox layering have dedicated frontend tests.
- [x] Mobile sheets/dialogs account for safe-area insets and remain scrollable without hiding their action rows.

### PWA, iOS, Android, and desktop updates

- [x] The app shell uses `viewport-fit=cover`, `100dvh` fallbacks, and top/bottom safe-area padding.
- [x] iOS standalone metadata, Apple touch icons, and admin/public manifest switching are present.
- [x] Android and iOS manifests/icons resolve to the intended Business OS or public Leang branding.
- [x] HTML, manifests, service worker, and app-shell entry points are served with revalidation/no-cache headers.
- [x] Hashed assets are immutable; the service worker caches by injected build hash and removes stale caches on activation.
- [x] Navigations and non-hashed shell files are network-first, preventing an installed PWA from remaining pinned to the old HTML.
- [x] API/uploads/user media are not substituted with stale service-worker responses.
- [x] Responsive contracts cover 320–767 px phone layouts, iOS safe areas, landscape-height constraints, scroll roots, compact toolbars, tables/cards, filters, reports, and bottom navigation.
- [x] Desktop also receives the same new build; the prior old-version symptom was traced to an incomplete curated deployment rather than a desktop-only code path.

### Other accumulated cross-session work included

- [x] Product import/replace/merge, stock-action imports, dated counts, import approvals, warnings, cancellation, continuation, and idempotency.
- [x] Sales import historical cost/cashier identity, sale cancellation, returns/replacements/damaged lots, fees, promotions, and report currency snapshots.
- [x] Contact duplicate review/merge/repointing, rename cascades, reference-data atomicity, categories/units uniqueness, suppliers, and delivery contacts.
- [x] User aliases, password management, OTP/TOTP, login identifiers/lockout, session renewal/revocation, permissions, and admin review controls.
- [x] Backup/restore streaming, Drive OAuth/PKCE, Drive backup queue/staging, R2 asset continuation, Telegram test/summary/webhook audit coverage, and error sanitization.
- [x] Public portal catalog/search/stock redaction, customer accounts, FAQ/content translations, social links/QR, and branding.

## Verification evidence before production write

- [x] Node.js v24.15.0 release runtime.
- [x] Fresh `npm ci` completed for frontend and Worker.
- [x] Frontend TypeScript check passed.
- [x] Cloudflare Worker TypeScript check passed.
- [x] Frontend test suite: 160/160 passed, 0 ignored and 0 unexpected.
- [x] Worker standalone regression sweep: 159/159 scripts passed.
- [x] Full migration chain: 104 migrations applied to a clean database; integrity, foreign keys, and negative-stock constraints passed.
- [x] Production Vite bundle completed successfully (969 modules).
- [x] Verified pre-deploy build: revision `10dcd40ef583`, asset hash `a3d5da623eb49f92`, built `2026-09-02T07:25:18.208Z`.
- [x] Remote D1 preflight: categories 0, units 0, normalized duplicate keys 0, and no pending production migrations.
- [x] Wrangler authenticated to the intended `business-os` account and database.
- [x] Runtime JSON/package manifests parse successfully.
- [x] `git diff --check` has no release-source error; it only reports two pre-existing trailing-whitespace lines in the root `progress.md` journal.
- [x] Vite reports existing chunk-cycle/size advisories, but they are non-fatal and the production bundle completes.

## Production completion

- [x] Deployed the complete verified frontend/Worker snapshot (not a curated subset).
- [x] Confirmed Wrangler Worker version `d9d8f869-abe4-4ef8-89a2-373ac78ae663` and green production health at `2026-09-02T08:55:00.204Z`.
- [x] Confirmed production revision `10dcd40ef583`, asset hash `e9a27f89ef3db0a1`, and build time `2026-09-02T08:53:49.580Z`.
- [x] Confirmed `/`, `/business-os-build.json`, `/sw.js`, and `/manifest.json` return HTTP 200 with `public, must-revalidate, max-age=0`; `/sw.js` is served as JavaScript.
- [x] Confirmed the live service worker embeds `BUILD_HASH = 'e9a27f89ef3db0a1'`, exactly matching the production build manifest, so installed clients can replace the previous shell.
- [x] Confirmed live public-shell bounds with no horizontal overflow at the in-app browser's smallest supported portrait viewport (480 x 844), phone landscape (844 x 390), and desktop (1280 x 800).
- [x] Confirmed narrower 320/360 phone and iOS-safe-area contracts through the complete 160/160 frontend regression suite. The available in-app browser enforces a 480-CSS-pixel minimum; earlier 320/360 command-line Chrome images were bitmap crops of a larger layout viewport and were not treated as valid mobile evidence.
- [x] Confirmed coordinated task handoffs were incorporated and frozen before the final uninterrupted gate and deployment.

Final production Worker version: `d9d8f869-abe4-4ef8-89a2-373ac78ae663`

Final production asset hash: `e9a27f89ef3db0a1`

Final production verification time: `2026-09-02T08:55:00.204Z`
