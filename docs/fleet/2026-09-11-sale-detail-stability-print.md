# Sale detail stability, compact editing, and receipt sizing follow-up

Status: investigation, not fixed/certified. Base8840379a; current prior deployment3c002325. Work stays in isolated codex/sale-detail-stability-print-20260911, preserving the dirty shared checkout. This adds to, and does not replace, earlier task registers.

## User requirements (September11 latest)

- Product name must remain readable before Edit. Compact smaller typography; two lines, then horizontal access if too long. Keep Qty/Price/Total as column headers. Edit action is a final column after Total.
- Desktop editing: quantity, price, discount and compact fit-sized inputs in one row; preserve POS discount semantics and automatic total. Existing Apply/Cancel/Remove/Replace must remain correctly wired and permission protected.
- Stop repeated flashing/refresh/layout movement in the lower sale detail during actions. Inspect supplied2.92-second screen recording, not just source assertions. Preserve drafts, focus, scroll, current record ownership, errors and genuine refresh.
- Investigate renewed 'No active payment methods are configured' message. Distinguish temporarily unavailable settings from genuinely empty configuration; never invent configured methods or weaken backend enforcement.
- Correct80mm receipt content width with safe margins/no overflow; independently inspect80mmx50mm option. Verify actual generated print dimensions, long names, Khmer, QR and totals; physical printer-driver scaling remains separately observable, not proven by browser preview.

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
