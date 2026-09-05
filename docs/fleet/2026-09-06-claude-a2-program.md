# Claude a2 program — Sep 6 2026 (session `business-os-v1-a2`, owner-directed, GPT/Codex as director)

Base: `codex/business-os-reconcile` @ `9ab9fd7a` (production = `c999e909`). Work happens in isolated
worktrees `C:/Users/mrkl6/Downloads/bos-a2*` on `claude/a2-*` branches. Never dirty main, never
Codex's `business-os-v1-integration`. Every row below is OPEN until the STATUS column carries evidence.

Order of work (owner): **fixes → new features → logic consistency → UI/UX polish**, checkpoint + deploy
at each stage. Sonnet/Opus chosen per task; every lane verified by the lane, then by a verifier, then by a2.

## Owner asks — Sep 5 (first message)

| # | Ask | Lane | Status |
|---|---|---|---|
| O1 | Receipt 80×50 mm: download→print squeezes/overflows, direct print paginates to 2 pages. Both must yield ONE scaled page. | receipt | open |
| O2 | Storefront Products: remove "Showing X–Y of N"; compact per-page select; pager (back · page/total · next + per-page) centred, top AND bottom; vertical letter rail (hover/touch open, click letter jumps, click-away closes) replacing JUMP TO BRAND grid; page scroll fix. | storefront | open (scroll not reproducible in emulation at 375/1280 — ask owner device) |
| O3 | Stock Change: barcode placement, compact rows, branch shown on Sale rows. | ledger | open |
| O4 | "Newly assigned": configured split-payment rows; payment-method rename consistency; grouped pickers across transfer/remove/set. | pickers / payments | verify status first |
| O5 | "Still pending": system-wide 4dp migration; barcode merges; guarded imported-subtotal correction; Sep-4 shift closure. | status-check | Codex data-ops; a2 verifies, does NOT write production |
| O6 | Product pickers (add/remove/set/fast-stock-in/transfer/add-items-to-sale/returns): grouped child rows as ONE title row → POS-style option sheet; standalone opens the same sheet; show "Warehouse: n · Shop: n"; wholesale+selling on one row; drop units line; same design as POS. Transfer source = warehouse only. | pickers | open |
| O7 | Settings: low-quantity alert toggle + threshold. | lowstock | open |
| O8 | Shifts: only the same account sees its own shift; POS close-shift actually works end to end. | shifts | open |
| O9 | Reports (Sales): more side margin on large screens; label and value adjacent. | reports | open |
| O10 | Review the 89-file uncommitted lane on dirty main. | triage | in progress (read-only) |
| O11 | Whole-system multi-angle verification: frontend, backend, tests, D1, R2, architecture, layers, button sizing, bounds. | verify | open |

## Owner asks — Sep 6 (second message)

| # | Ask | Lane | Status |
|---|---|---|---|
| N1 | Product session: title "Add/Create Products Session"; explanatory text → InfoHint; Brand+Supplier one row; Branch+Date received one row; no footer Close (header X only). | product-session | open |
| N2 | MINIMIZE affordance on ALL sections/pages/modals with draft state: icon-only, large enough at the edge; lets the user park a draft instead of Discard-vs-Back. | minimize | open |
| N3 | Small screens: default removes bottom bar; follow reference images 1 & 2 (reference-images session doc). | mobile-nav | open — Codex owns compact navigation; coordinate |
| N4 | Small screens: buttons out of bounds/broken → fix (icon-only allowed). Delete "Open PDF" (redundant with Print). | mobile-buttons | open |
| N5 | Shift: compact, clean, clear; on close compare with expenses paid from shift money; clear breakdown, correct math. | shifts | open |
| N6 | Stats never show negative revenue/profit; returns scoped in; cancelled handled correctly. | stats | open |
| N7 | Products page sections reachable on small screens (main page or mini sections via bottom bar). | mobile-nav | open |
| N8 | Stock Change large screen: barcode placement still bad; "Edit reason"/"Revert" → professional consistent larger buttons. | ledger | open |
| N9 | Sales: show DRIVER in display column; receipt action row order mirrored (Back on the left, Print/Image on the right; drop Open PDF). | sales | open |
| N10 | Branches › Products: drop SKU column; add date range; more compact; highlighted column headers and numbers, consistent. | branches | open |
| N11 | POS glitch: total shown but no per-branch counts. POS / add-items / returns: POS-style click-to-choose options; warehouse option GREYED with qty for everyone incl. admin; click → prompt "Only allow Shop sale. Please transfer to Shop first." | pickers | open |
| N12 | POS label "Pick a lot / Batch" → "Received dates:". | pickers | open |
| N13 | Every history (stock change, transfer, sales, returns, write-off): show branch; actor = USERNAME not full name; reasons; consistent. | ledger | open |
| N14 | Stock-in sessions: group by day; date column shows time only; differentiate new vs existing products; supplier name and cost REQUIRED; Set: smarter + explain missing cost. | stock-in | open |
| N15 | Groups: barcodes differing only by a leading zero → strip and MERGE (no group); costs: mean of distinct costs (per Sep-4 ruling: similar costs only). | identity | open — production data op needs owner gate |
| N16 | Copy affordance: double-click (large) / long-press (small) copy float for product name, brand, supplier, barcode — everywhere. | copy | open |
| N17 | Global sweep for errors, inconsistencies, too-small/too-wide/not-compact. | verify | open |

## Process rules (owner, Sep 6)
- a2 is coordinator/director/manager: one writer per file set, no overlap, every lane verifies, a2 re-verifies, reconciles, chooses the best, ships ONE deploy per checkpoint.
- Model per task suitability (Sonnet for bounded mechanical slices, Opus for cross-layer/design/verification), effort matched.
- Don't lose track: this file is the registry; new owner notes are appended here and distributed.

## Ledger
- 2026-09-06 ~00:00 ICT: worktrees created (`bos-a2`, `bos-a2-{receipt,storefront,ledger,pickers,lowstock,shifts,reports}`), baseline gates green at `9ab9fd7a` (frontend tsc, i18n 4976 keys, cloudflare tsc). Claims posted to `team-state.mjs`. Chrome extension not connected → live ChatGPT handshake blocked; ledger message sent to `codex/main`.
- Live storefront probe (production, read-only): Products view scrolls at 1280 and at 375 emulation before/during/after a flyout; no body lock, no overlay. "Showing 1-50 of 3,552 products", "per page" (88 px button), "Jump to brand" and 4 pager buttons present.

### Ledger — 2026-09-06 16:40 UTC (a2)

- Round-1 investigation `wf_a238baad-751`: 11/12 subjects returned; refuters for receipt, ledger and shifts all confirmed the mechanisms with precision corrections (no refutation). Briefs saved per subject in the a2 scratchpad (`r1/<subject>-finding.json`, `<subject>-verdict*.json`).
- Round-2 investigation `wf_0be1601d-3f5` launched for N1–N16 (12 subjects; skeptics on shift-vs-expenses, negative stats, POS branch counts, leading-zero merge).
- Wave-1 implementation `wf_0a0c6182-f95` launched: lanes `receipt` (O1 + N9 action row + N4 icon-only, drop Open PDF), `storefront` (O2 + scroll-root lock), `lowstock` (O7), `reports` (O9). One writer per worktree, adversarial verifier, one repair round. Writers commit on `claude/a2-<lane>-2026-09-06`; a2 reconciles.
- Six more lane worktrees created at 9ab9fd7a with node_modules junctions: `bos-a2-{session,mobile,sales,branches,stats,identity}` on `claude/a2-<lane>-2026-09-06`. `minimize` (N2) and `copy` (N16) are sequenced AFTER the other lanes land because they touch the same render sites.
- Codex: integration tree still at 9ab9fd7a with `cloudflare/src/routes/fees.ts` + `frontend/src/api/feesTransport.ts` dirty. Ledger message sent (16:31 UTC): a2 will not edit fees.ts; asked for the paid-from-shift field name so N5 shift math reads it. No Codex reply since its 15:43 UTC deploy note.
- Chrome extension still not connected → ChatGPT live channel unavailable; coordination stays on `team-state.mjs`.

### Ledger — 2026-09-06 17:00 UTC (a2)

- Round-1 investigation complete (24 agents). New since last entry: the UI layering/button-size audit returned 12 items (product image lightbox renders BELOW the detail sheet that opened it; the kit Button height token is undeclared so Reports kit buttons collapse to ~16px; `.btn/.btn-ghost/.btn-sm` undefined in main.css; non-portalled dropdowns clipped inside modal bodies; eleven hand-rolled overlays below the 1000-series chips; three primary-button height families; duplicate footer Close next to header X). Scheduled as lane `ui-layers` AFTER wave 1 and wave 2 merge because it edits shared kit components.
- Storefront skeptic correction that matters for O2: the owner's "cannot scroll" has a code cause the diagnosis denied — the brand grid at CatalogProductsSection.tsx:489 is a `max-h-[min(18rem,calc(100vh-32rem))]` inner scroller that captures wheel/touch scrolling. Replacing the grid with the edge rail removes it; the verifier must confirm no other inner scroller remains.
- Local verification stack for a2 (private, no production access): the Sep-2 production snapshot (`bos-rc-workers/d1-snapshot-20260902-162733`) copied into `bos-a2/cloudflare/.wrangler/state` and migrated locally 0105→0127 with better-sqlite3 (0109 data-op recorded as skipped: its `ON CONFLICT(product_id, branch_id)` has no matching unique index in the snapshot); a verification session minted for user `admin` (token in the a2 scratchpad only); `.claude/launch.json` in main gained `a2-frontend` (5180, vite.lane.config.ts, `.lane-api-port`=8790) and `a2-worker` (8790, pinned wrangler 4.116.0 run via node, `--local`). `/health` OK; admin app renders at 5180 with the minted session.
- Peer `reference images [190187]` was told about the launch.json edit on the ledger (16:42 UTC); no reply yet. SendMessage is unavailable in this session, so the ledger is the only peer channel.

### Ledger — 2026-09-06 17:15 UTC (a2) — peer agreement with session "reference images" [190187]

- Peer lane: reports REDESIGN to the owner's 13 old-POS screenshots, worktree `C:/Users/mrkl6/Downloads/bos-ref-reports`, branch `claude/reports-redesign-2026-09-06`, based on 9ab9fd7a. Peer owns (binding): `sales/reports/{OverviewReport,GroupedReport,ReceiptSheet,ReportTable,PeriodReport}.tsx`, `reportTypes.ts` (layout only), `shared/statsStripPresets.ts` ('yesterday' preset only), `SalesDailyReport.tsx`, `FeesReportSection.tsx`, `ReturnsReportSection.tsx`, `utils/reportMoney.ts`; keys under the flat `rpt_*` prefix in both packs. Peer HOLDS `ReportsHub.tsx`, `reports/ReportFrame.tsx`, `reports/reports-surface.css` until a2 posts the `reports` lane sha, then merges it and takes those three.
- a2 owns all analytics math: `cloudflare/src/lib/salesAnalytics.ts`, report endpoints in `routes/sales.ts` + `routes/compat.ts`, `reportModel.ts` derivations. The peer's additive field list (grouped by product/customer/cashier/branch/courier, `cancelled_tx_count` on totals) is saved as the stats-lane brief and will be added in lane `stats` with tests; the peer draws them only after that commit.
- Correction to a stale claim: item-level discount reporting is LIVE in the lineage (salesAnalytics.ts:590/686 sum `product_discount_usd + manual_discount_usd`; buildTotals :761-762 sets `item_discount_usd` and `total_discount_usd`), landed as 4489b1df; 1d67e895 is not an ancestor but its effect is. progress.md's "stranded 1d67e895" handoff note is stale → fix in the session-end docs pass. Caveat for the stats lane: `itemDiscountUsd` is an optional buildTotals option; make every route pass it and pin with a test.
- Reference images #1/#2 (for lane `mobile`, N3) are the old POS HOME tiles: 2-column dark tile grid (Sale, Promotion, Items, Customer, Branch, Stock, Report, System); a tile expands INLINE into sub-tiles (Report → 6, Sale → 10) pushing the tiles below (accordion). Images exist only in the peer's conversation; the target is the description table in `docs/fleet/2026-09-05-report-reference-designs.md` (c18ef8a0 on main). Colours/branding ignored.
