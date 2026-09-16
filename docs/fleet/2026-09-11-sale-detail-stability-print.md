# Sale detail stability, compact editing, and receipt sizing follow-up

Status: deployed70c81aa0ec1e with scoped verification passed. Base8840379a; prior deployment3c002325. Work stays in isolated codex/sale-detail-stability-print-20260911, preserving the dirty shared checkout. This adds to, and does not replace, earlier task registers.

## User requirements (September11 latest)

- Product name must remain readable before Edit. Compact smaller typography; two lines, then horizontal access if too long. Keep Qty/Price/Total as column headers. Edit action is a final column after Total.
- Desktop editing: quantity, price, discount and compact fit-sized inputs in one row; preserve POS discount semantics and automatic total. Existing Apply/Cancel/Remove/Replace must remain correctly wired and permission protected.
- Stop repeated flashing/refresh/layout movement in the lower sale detail during actions. Inspect supplied2.92-second screen recording, not just source assertions. Preserve drafts, focus, scroll, current record ownership, errors and genuine refresh.
- Investigate renewed 'No active payment methods are configured' message. Distinguish temporarily unavailable settings from genuinely empty configuration; never invent configured methods or weaken backend enforcement.
- Correct80mm receipt content width with safe margins/no overflow; independently inspect80mmx50mm option. Verify actual generated print dimensions, long names, Khmer, QR and totals; physical printer-driver scaling remains separately observable, not proven by browser preview.
- Added later: printer physically80mm but browser offers98x148mm. New98x148 preview screenshot shows receipt/date/cashier/phone/address overlaps and clipped values. Fix reflow corruption independently of hardware media mismatch; website cannot force unavailable driver paper support.
- Reports added later: remove Info button, vertical ellipsis menu, consistent-width report-option selector across short/long names,40px consistent Filter, screen text/numbers slightly larger. Keep print geometry unchanged. Ownerreports_followup investigates separate isolated slice.

## Plan and ownership

1. Parallel read-only evidence: urgent_status_frontend traces settings/loading lifecycle; sale_editor_audit examines editor layout; product_scope_audit examines receipt rendering/print dimensions. Root reviews video and coordinates.
2. Consolidate reproducible causes, then assign isolated non-overlapping writes. SaleDetailModal overlap must be serialized or split only after extracting a safe boundary.
3. Regression tests at actual handlers/components, affected sibling routes and permission paths. Independent review after integration; real browser geometry and print/PDF dimensions, not only source regex checks.
4. Build/typecheck/i18n plus affected broad gates. Record deployment separately with exact provenance if promoted; never call an untested change complete.

## Evidence sources

- User video: C:/Users/mrkl6/Videos/Captures/Business OS - Google Chrome 2026-09-11 20-48-19.mp4,2464x1440,2.92seconds. Read-only extraction under output/video-review/.
- Editor screenshot: codex-clipboard-4f9c703f-f174-4de5-9888-779bc745bf1f.png.
- Physical receipt screenshot: codex-clipboard-a4dfed8b-fbd7-4545-8423-2adf6203be73.png.
- Previous complete release record: docs/fleet/2026-09-11-sales-layout-lot-selection.md.

## Investigation findings

- Root inspected quarter-second and12fps lower-panel video frames. The2.92-second recording shows repeated lower-detail spacing movement, consistent with the reproduced loading-state churn; video alone cannot identify a JS cause.
- Actual production-effect harness at8840379a: mount same sale with settings{} then supply valid Cash/ABA settings => settlement configuration remains[]; changing sale ID refreshes it. Snapshot effect only depends on saleId. Five equivalent new amendment-loader callback identities cause five reads and ten true/false loading transitions, changing lower-panel height. Existing tests failed to detect these cases.
- Live read-only D1 query2026-09-11 confirms configured methods ABA,Cash,ABA+Cash,ACLEDA,FCB. No database configuration disappearance: client frozen-empty state is a reproduced cause. No settings writes performed.
- Print investigation at8840379a: actual Chromium continuous80mm root79.999mm/content72.004mm; PDF width80.095mm. Fixed80x50 root79.999x49.998mm and PDF80.095x50.123mm, onepage. Five focused print suites pass. Physical photograph appears narrower than those results.
- Live saved receipt_print_settings: paperSize80mm, margins4mm on all sides, scale100%, customWidth80/customHeight297. Thus excessive current saved margins hypothesis is refuted. Printer/Chrome scaling remains unverified; root requested print-dialog screenshot while code work continues. Do not claim physical80mm output fixed from browser geometry alone.
- Lifecycle writer urgent_status_frontend owns SaleDetailModal/Sales+focused tests first. Editor layout waits until lifecycle commit integrated; print investigator continues read-only actual receipt-path trace. This serializes overlapping SaleDetail edits.
- Lifecycle14795244+security5eefc193 integrated, independent re-review pending. Configuration fetched authoritatively with readiness/failure/retry, tender preserved, callback-based reload churn removed; same-ID meaningful auth/permission changes invalidate deferred work without draft reset for profile-only refresh. Editor now owns onlySaleDetail layout sections in isolated writer.
- NEW receipt root cause reproduced: cloned computed grid-template-rows froze16.5px tracks. Narrower reflow requires50px but remains16.5px, overlapping following rows. Clearing gridTemplateRows lets row grow49.5px. Print writer now owns print normalizer/Receipt/settings+focused tests; actual structured-value/Khmer reflow checks required before claiming corrected.

## Integrated certification checkpoint

- Candidate90e5f227 includes authoritative settlement readiness and stable effects14795244; security generations5eefc193; list/aggregate publication fencing21f7838c; compact editor54c7852d; receipt print/PDF3c5db0e6 plus narrow reflow90e5f227; Reports29b6feba plus square mobile Filterc23b0fc5. Test maintenance95257a87/0e32208c preserves semantic assertions after derived options and scoped queue refactors.
- Root full frontend gate:369/369 files pass,0 red. Both package typechecks pass; frontend i18n5713 keys/594 sources and production build1128 modules pass. Initial broad gate found two stale source-shape assertions, corrected then entire gate rerun. Existing circular chunk warning remains.
- Root seven backend suites pass: payment-method registry, payment settlement, payment-method real route/SQLite, bulk sale status, skip-stock status, shift lifecycle, shift reconciliation. Backend source is byte-identical to prior deployed3c002325; no migrations/data changes in this follow-up. These focused reruns supplement, not replace, the previous full353-file backend checkpoint.
- Independent Astra lifecycle review: eight focused suites and actual React/Chromium mounted production-hook experiment pass. Typed USD/KHR survives12 profile/parent refreshes; no repeated history loading, pending requests/configuration remain frozen, same-ID revocation/regrant and reauthentication invalidate old replies. Follow-up list/aggregate publication guard independently passes actual deferred callback tests. Full modal DOM/network/device certification is not claimed from the mounted-hook harness.
- Independent editor review: existing handlers/calculations preserved; full names and local overflow, fifth Edit column, one-row Qty/Price/Discount confirmed. Writer EN/KM320/360/390/768/1280 matrix plus independent320/1280 checks pass. During editing row Total previews the draft while footer remains committed until Apply; this pre-existing behavior is not represented as synchronized draft-footer totals.
- Reports actual mounted component EN/KM320/390/768/1280: stable short/long picker widths, zero page overflow, no Info, actual rotated vertical dots,40px heights. Mobile Filter was independently found18px wide and corrected to40x40 with browser verification. Report body/meta/heading screen tokens increase2px (Khmer multiplier preserved); fixed hardcoded control text and print typography remain unchanged.
- Receipt independent review rejected initial whole-value nowrap because supported58mm overflowed81px and80mm intruded into margins. Corrected90e5f227 uses safe text wrapping while keeping automatic grid rows. EN/KM/both across58/default,58/zero,80,98,80x50 now have zero root/row/value/label overflow, zero label intersections and no text outside paper. Complete date, phone, membership, large USD/KHR and long product names preserved. Frozen-row positive control overlaps29px; normalization produces4px gap. Fixed80x50 PDF MediaBox226.77x141.73pt verified.
- Receipt Download PDF reuses existing exact-size renderer; numeric zero margins survive normalization; settings show effective paper/content widths and driver guidance. Website code cannot force a printer driver to advertise80mm or prevent driver scaling when98x148mm is selected. Physical thermal-printer result remains a hardware verification item, not certified from browser/PDF tests.
- Independent durable results: lifecycle read fence via urgent_status_backend; receipt a2232c46-1503-4468-a283-a02cf73c949d; editor21085400-fef9-4e5d-b925-7d2994ec3a91. Root used orchestrate-team for isolated ownership and independent checks, Playwright skill for browser-verification workflow, and Wrangler skill for production provenance/deployment mechanics.

## Deployment and live smoke check (September12 local time)

- LIVE source70c81aa0ec1e; Worker version3e4ffb3c-1879-4e27-b1a6-3c17af37a52c. Worker hashb27cb8bde999183c/built2026-09-11T16:02:12.077Z. Frontend hash2e962087d187950e/built2026-09-11T16:00:33.442Z. Both runtime/version and business-os-build.json independently fetched after deployment and match70c81aa0ec1e.
- Confirmed prior live3c002325 before promoting; pushed isolated branch, clean tracked tree, no source-revision override. Canonical admin domain challenges shell HTTP; configured legacy admin domain returned provenance. Normal authenticated in-app browser redirected to canonical admin successfully. No challenge bypass attempted.
- Live authenticated smoke after update: Reports selected title/Filter/Show row, vertical dots, larger report figures and no header Info visibly confirmed. Sales opens19 business-day rows. Outstanding sale20260911-082702 shows all five configured methods ABA/Cash/ABA+Cash/ACLEDA/FCB and4065 rate, without false empty configuration. No payment submitted; Back and Cancel return normally.
- Same live sale has complete two-line product names and Qty/Price/Total/Edit headers. Edit exposes stored1/$30/$2 inputs; actual boxes are40.656x28px and all have identical y393.094px. Cancel restores text-only values. No Apply, Update, Remove, Return or stock action was submitted. Temporary browser tab closed after modal dismissal.
- Physical80mm printer/driver media mismatch is still not certified: exact PDF and safe reflow are fixed, but driver only offering98x148mm requires correct80mm/custom-paper driver configuration/Actual size. No production settings, stock, dates, customers or financial records were changed during this follow-up verification.
