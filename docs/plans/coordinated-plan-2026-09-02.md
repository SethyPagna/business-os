# Coordinated plan — 2026-09-02 (isolated release candidate)

Coordinator: session `business-os-v1-6f` (Claude Fable 5.1). Workers: Sonnet 5 sessions, one per
section, each in its own git worktree. This file is the plan of record; every worker reads it
top-to-bottom before touching code. Treat every claim here as reference to re-verify against source.

## 0. Isolation protocol (non-negotiable)

- **Integration branch:** `rc/coordinated-2026-09-02`, checked out at
  `C:\Users\mrkl6\Downloads\bos-rc` (worktree of the main repo, base commit `57d8f1a2`).
  `node_modules` in `bos-rc/frontend` and `bos-rc/cloudflare` are junctions to the main
  checkout's installed modules. **Never run `npm ci`/`npm install` in any worktree** (it would
  rewrite the shared modules through the junction and break peers).
- **Worker branches:** each section gets `rc/sec-<n>-<slug>` branched from the current tip of
  `rc/coordinated-2026-09-02`, checked out at `C:\Users\mrkl6\Downloads\bos-rc-workers\sec-<n>`.
  Junction node_modules the same way. Workers commit only to their own branch.
- **The main checkout `C:\Users\mrkl6\Downloads\business-os-v1` and `origin/main` are READ-ONLY
  for this effort.** No worker or the coordinator writes there, commits there, pushes, merges,
  rebases, cherry-picks, deploys, applies migrations to remote D1, or runs wrangler against the
  shared `.wrangler/state`. Outside commits are *observed and recorded* (section 9), never pulled in.
- **No dev servers on the shared 8787 port.** A worker that needs a live worker uses
  `npx wrangler dev --local --port <free port> --persist-to <its own dir>` inside its worktree and
  shuts it down when done. Vite previews only via the Browser pane preview tool on a free port.
- **Commits:** one commit per logical change, exact-path staging only (`git add <path>` or
  `git commit -m ... -- <paths>`), dependency order (backend/shared helpers before consumers,
  lang packs with the feature that needs them). Diff every file right before committing it.
  Commit message style follows the repo: `feat(scope): ...`, `fix(scope): ...`, `test(scope): ...`.
- **Verification floor for every section (run inside the worker's worktree, report real output):**
  ```
  cd cloudflare && npx tsc --noEmit
  cd frontend  && npx tsc --noEmit
  cd frontend  && npm run build                      # real vite build
  cd cloudflare/scripts && node test-<relevant>.cjs  # every backend test the section touches, plus any that fail
  cd frontend  && node --import tsx tests/<relevant>.test.ts   # run touched frontend tests individually
  ```
  Frontend tests run individually (the chained `npm run test:utils` stops at the first failure).
  A section is not done until it adds/updates tests that pin its behaviour.
- **Report format (final message from each worker):** Ask · What changed (per file, with why) ·
  What was found · Verified (exact commands + real results, expected vs actual) · Not done.
  Include the branch name and the list of commit hashes.
- **Merge:** only the coordinator merges a worker branch into `rc/coordinated-2026-09-02`, after
  independent diff review and re-running the floor on the merged tree. No fast-forward assumptions:
  the coordinator re-verifies after every merge.
- **Do not touch:** `progress.md`, `docs/history/session-log.md`, `CHECKPOINT*`, `run-log.txt`,
  anything under `tmp/`, `outputs/`, `Migration from old system/`. Section 9 owns hygiene.

## 1. Platform facts (verified 2026-09-02 from Cloudflare docs; re-verify before relying on them)

| Feature | Workers Free | Workers Paid ($5/mo) |
|---|---|---|
| Requests | 100,000/day | unlimited (10M included) |
| CPU per invocation | 10 ms | default 30 s, max 5 min via `[limits] cpu_ms` |
| Subrequests | 50 external / 1,000 to CF services | 10,000 default, up to 10M via `[limits] subrequests` |
| Worker bundle size | 3 MB | 10 MB |
| Memory | 128 MB | 128 MB |
| Cron triggers | 5/account | 250 |
| Env vars | 64 | 128 |
| D1 | 5M rows read/day, 100k rows written/day, 5 GB. **Hard-enforced since Sept 1 2026: queries error once exceeded until 00:00 UTC** | 25B reads/mo, 50M writes/mo included |
| KV | 100k reads/day, 1,000 writes/day, 1 write/s/key | 10M reads, 1M writes/day |
| R2 | 10 GB, 1M class A, 10M class B / month, no egress | same free allowance, then metered |
| Durable Objects | available (SQLite-backed only) | available |
| Queues | available since Feb 2026: 10,000 ops/day, 24 h retention | 1M ops/mo, 14-day retention |
| Images transforms | 5,000 unique/month | metered |

Current `cloudflare/wrangler.toml` is Paid-shaped: `[limits] cpu_ms = 300000`, `subrequests = 10_000`
(both Paid-only; Free deploy fails with error 100328 on `cpu_ms`), two D1 databases, R2, KV,
Analytics Engine, Images, three queue producers + consumers (import, dlq, media, backup), DO
`BROADCAST_HUB`. `lib/quotaGuard.ts` already counts KV/R2/Images usage against free ceilings.

## 2. Gates and ownership

| Gate | Section | Worker branch | Depends on | Coordinator verification |
|---|---|---|---|---|
| 1 | Architecture/history audit + ownership map | (coordinator, read-only) | — | file `bos-rc-workers/gate1-audit.md` |
| 2 | Products search fuzzy fallback | `rc/sec-2-products-search` | 1 | search matrix, perf, tests |
| 3 | Branches → Inventory workspace restore | `rc/sec-3-branch-inventory` | 1 | render + API + tests |
| 4 | Receipt text contrast (Normal / Maximum black) | `rc/sec-4-receipt-contrast` | 1 | print CSS audit, tests |
| 5 | Permission-aware Excel business workbook | `rc/sec-5-business-workbook` | 1 | admin vs non-admin sheets |
| 6 | Mobile three-layer navigation + desktop section clarity | `rc/sec-6-mobile-layers` | 1, ideally after 3 | mobile/desktop browser QA |
| 7 | Product web-verification workflow (name + barcode) | `rc/sec-7-product-verification` | 1 | sample verification run |
| 8a | Public storefront: sign-in/up, wishlist, cart, details, empty sections, image deterrence | `rc/sec-8-storefront` | 1 | live portal QA |
| 8b | Free vs Paid plan variants + PWA/iOS safeguards | `rc/sec-8b-plan-variants-pwa` | 1 | both configs typecheck/build; SW audit |
| 9 | Outside-diff comparison, full QA, repo hygiene, RC prep (no deploy) | coordinator + `rc/sec-9-hygiene` | all | final certification |

Sections 2, 3, 4, 5, 7, 8a, 8b are file-disjoint enough to run in parallel; section 6 touches every
hub page's section switcher and must merge **after** 3 (Inventory section) and before the final QA.
Shared files that more than one section may touch — `frontend/src/lang/en.json`, `km.json`,
`frontend/src/types/*`, `Sidebar.tsx`, `SectionSwitcher.tsx`, `Products.tsx`, `Inventory.tsx`,
`portal.ts` — are listed per section; a worker adds lang keys **only for its own feature** and
never reorders or reformats those files (append near related keys, keep both packs in sync).

## 3. Section briefs

Each brief states the goal, the constraints, the acceptance criteria, likely files (from the
Gate 1 audit — verify), tests to add, and what is explicitly out of scope. The coordinator adds
the audit's file/line findings under "Audit notes" before dispatching.

### Section 2 — Products page search: typo-tolerant like Transfer

**Goal.** In the admin Products page search, `Elixe` and `Elixer` must surface `Elixir` products,
the same way the branch Transfer modal's product search already does. Exact and barcode matches
must keep ranking first; existing filters (branch, brand, category, supplier, stock state, group
state, created-date), pagination, the A-Z rail, Khmer text, and performance must be preserved.

**Constraints.**
- Reuse the existing shared matcher (`cloudflare/src/lib/searchMatch.ts` `runFuzzyFallbackMatch`
  and friends, the same code path `routes/portal.ts` uses); do not write a second fuzzy algorithm.
- The fallback only runs when the SQL `LIKE`/token search returns fewer than a page of results; it
  must be bounded (candidate cap, same as the portal's) so it never scans the whole catalogue.
- Barcode / SKU / receipt-style numeric queries stay exact-only (no fuzzy on digits).
- Response shape unchanged; add a `match_mode: 'exact' | 'fuzzy'` (or the existing equivalent) only
  if the portal already exposes one, so the UI can show "showing close matches".
- Khmer: fuzzy must not corrupt Khmer clusters; if the matcher is Latin-only today, gate it to
  Latin tokens and say so.

**Acceptance.** Backend test (new `cloudflare/scripts/test-products-search-fuzzy-pure.cjs` or an
extension of the existing search test) proving: `Elixe`→Elixir, `Elixer`→Elixir, exact `Elixir`
ranks first, a barcode query returns only the exact product, Khmer query unchanged, results respect
an active brand filter, page 2 of a fuzzy result set is stable. Frontend: if any UI change,
a test under `frontend/tests`. Manual: matrix of 10 queries with expected vs actual counts.

**Out of scope.** POS search, portal search (already fuzzy), inventory search — unless they share
the same helper and the change is one-line.

### Section 3 — Restore Branches → Inventory as the product-stock workspace

**Goal.** The Branches hub's **Inventory** section must again be the per-branch product-stock
workspace (product rows with per-branch stock, batch/lot views, adjust/receive/transfer entry
points) that lived in `Inventory.tsx` before commit `b6f3ef7a` removed it. Today the section
renders something indistinguishable from the Branches overview.

**Constraints.**
- Do not `git revert b6f3ef7a`. Read the pre-`b6f3ef7a` slice (`git show b6f3ef7a^:frontend/src/
  components/inventory/Inventory.tsx`) as a *specification*, then rebuild it against the current
  helpers, current API routes (`/api/inventory/*`, `/api/batches`), current shared components
  (`StatsStrip`, `FilterMenu`, `ColumnChooser`, `TruncatedText`, `SectionSwitcher`), and current
  permission keys (`can('inventory', ...)`).
- Keep the stock's batch/lot **and** branch identity end to end (the batch-identity invariant).
- Keep the movements/RFID/stats sub-surfaces that were kept in `b6f3ef7a`; the restored product
  slice is an additional section body, not a replacement.
- Large screens: excel-style table with a column chooser; the sticky search row and sticky
  date-range row conventions apply. Expansions float, they do not push content.
- Both lang packs get every new label.

**Acceptance.** Branches hub → Inventory renders the product-stock table (not the branch cards);
the per-branch stock numbers equal `/api/inventory` responses (assert with a test against the pure
helpers or a fixture); adjust/receive open the shared modals; the `inventoryRfidSection.test.ts`
and `performanceLoadingUx.test.ts` suites are updated to the restored shape and pass; typecheck +
build green.

### Section 4 — Receipt text contrast

**Goal.** Receipt settings gain **Text contrast: Normal | Maximum black**. Maximum renders every
receipt text node (header, lines, totals, footer, QR captions) in pure `#000000` on white — no
greys, no coloured text, no opacity — **without** changing font weight or size. Applies to the
on-screen preview, the printed receipt (print CSS), and the PDF/share path if one exists.

**Constraints.**
- Persist in the existing receipt settings record (same load/save path as the other fields;
  backend settings route validates the enum). Default `normal` so existing receipts are unchanged.
- Implement as one class/CSS-variable switch at the receipt root, not per-element edits.
- Customer-facing receipt views must not gain any admin data. Dark mode of the *admin UI* must not
  leak into the receipt (receipts are always light).
- Both lang packs.

**Acceptance.** Test that with `maximum` every colour token used by the receipt renderer resolves to
`#000`; screenshot pair (normal vs maximum) from the preview; print preview verified in the
Browser pane; settings round-trip (save, reload, still `maximum`).

### Section 5 — Permission-aware Excel business workbook

**Goal.** One "Business summary" workbook (`.xlsx`, built with the `xlsx` package already used by
`frontend/src/utils/xlsxExport.ts`) for a Start→End range, with sheets: **Summary** (per business
day, UTC+7: sales count, gross sales, discounts, tax, delivery, refunds, net revenue, pending
credit, collected), **Sales**, **Returns**, **Expenses**, **Reconciliation** (revenue − expenses,
day by day, month totals), and — admin only — **COGS & Gross profit** (cost basis per sold line
from batch/product cost, gross profit per day, margin %). Non-admin exports **omit** the profit
sheet and every cost/profit column entirely (not blank, not hidden).

**Constraints.**
- Revenue uses the canonical definition (net sales: subtotal − discounts, excl. tax and delivery,
  refunds subtracted, `awaiting_payment` as pending) — the same kernel `salesAnalytics.ts` uses.
  Do not invent a second revenue formula; if numbers can only come from the kernel, add a server
  endpoint that returns them and page it.
- Data comes through the existing paginated export contract (snapshot/cursor), never one giant
  request; the Worker must never load a whole table (128 MB).
- Permission: admin check must be server-side (the profit data must not be in the payload for
  non-admin), mirrored client-side for the UI.
- Entry point: Sales hub → Reports (where existing report exports live) via the shared export
  dialog; date row conventions apply.

**Acceptance.** Fixture-based test that builds the workbook for a seeded range and asserts sheet
names/columns for admin vs non-admin, and that Summary totals reconcile to the Sales + Returns +
Expenses sheets. Manual: export from the UI, open in Excel, numbers match the Sales page stats
header for the same range.

### Section 6 — Mobile three-layer navigation, desktop section clarity

**Goal.** On small screens (< 768 px) each hub page becomes three layers: **layer 1** the main
menu (sidebar / bottom bar) → **layer 2** the hub page showing its sections as option cards →
**layer 3** the selected section full-screen with a back affordance. Mini-sections that are
attached to a section stay inside that section (they are not promoted to layer 2). A Settings
toggle **"Mobile navigation: Pages (default) | Sections"** switches back to today's chip view; the
preference is per device (localStorage under the `bos:` prefix) and mirrored to user settings if
the settings API already stores UI preferences. Desktop (≥ 1024 px) keeps the section-chip design,
but the switcher gets a clearer visual treatment (labelled "Sections", stronger divider, active
state) so new users recognise it.

**Constraints.**
- Implement once in the shared `SectionSwitcher` / hub-page pattern, not per page. Every hub page
  (Products, Sales, Branches, Contacts, Settings, Files, Review, … — enumerate from source) must go
  through it; verify mechanically that no hub page bypasses the shared component.
- Browser back button must go layer 3 → 2 → 1 (use history state, not only component state).
- Permission-gated sections must be absent from layer 2 exactly as they are absent from the chips.
- Both lang packs; the Settings toggle is modelled in the permission editor if Settings sections are.

**Acceptance.** Browser-pane QA at 375×812 and 1280×800 for at least three hub pages; a test that
walks the hub-page registry and asserts every page uses the shared switcher; the settings toggle
round-trips.

### Section 7 — Cautious product web-verification workflow

**Goal.** A repeatable, documented workflow (script + review output) that verifies each product's
official name from the web using the **name as primary evidence and the barcode as
corroboration**, searching both and reconciling; handles products with multiple barcodes, shared
barcodes across variants, junk barcodes ("0"), and barcode changes (a product whose barcode was
updated since the last verification). Output is a review sheet (CSV/XLSX) with confidence, sources,
and a proposed official name — never an automatic write to the catalogue.

**Constraints.**
- Build on the existing official-name artifacts under `outputs/official-name-*` and existing
  scripts (find them first; do not duplicate). Node only.
- Rate-limit and cache web lookups; never exceed the free Images/AI quotas; no secrets in the repo.
- Multi-angle: at least two independent sources must agree before confidence ≥ high.

**Acceptance.** Run on a 30-product sample including ≥5 multi-barcode and ≥3 changed-barcode cases;
the review sheet shows the evidence per product; a test covers the reconciliation logic (name vs
barcode agreement/disagreement matrix).

### Section 8a — Public storefront

**Goal.** Verify and fix: sign-up, sign-in, sign-out, session persistence, wishlist add/remove/
persist, cart add/update/remove/persist, product details. Product details must render every
prepared description section — brand, category, features & benefits, who it's for, ingredients,
caution/warnings, how to use, and "need more details" — **even when empty** (wired placeholders, so
the structure is visible), with the caution section clearly styled. All images (product, avatar,
cover) get browser deterrence: no drag, no context menu, no long-press callout, no "open image in
new tab" via a plain `<img src>` (serve through a wrapper / CSS background or a transparent
overlay), and the same on admin avatar/cover views.

**Constraints.**
- Customer-facing surfaces never expose supplier, cost, internal facets, or admin chrome.
- Image deterrence is honest browser deterrence; document that it is not DRM.
- Sign-in/up errors are specific (wrong password vs unknown account vs locked) without leaking
  whether an email exists beyond what the current API already does.

**Acceptance.** Live QA against a local worker with its own persisted state: matrix of
sign-up → sign-in → wishlist → cart → reload → sign-out → sign-in with expected vs actual for each;
DB rows asserted with better-sqlite3; tests for the empty-section rendering and the image wrapper.

### Section 8b — Free vs Paid plan variants; PWA/iOS safeguards

**Goal.** Two deployable configurations of the same code: `wrangler.toml` (Paid, current) and
`wrangler.free.toml` (Free), selected by `--config`, plus a runtime `PLAN_TIER` var (`free|paid`)
read once at startup. On `free`: no `[limits]` block; import/backup/media chunk sizes and batch
constants sized to 10 ms CPU and 50 subrequests; queue batch size 1; quota guard thresholds for
D1's hard-enforced daily limits (reads/writes) added and surfaced in the admin Server page; features
that cannot work on Free (long AI/image passes, large backups) stay **visible but inert with a
notice**. R2 and D1 access paths must be identical on both tiers — users feel no difference for
normal POS/catalogue/stock work. Worker bundle must fit 3 MB on Free (measure it).

PWA/iOS: audit `sw.js`, both manifests, `index.html` meta, `clientRuntime.ts`; add
`navigator.storage.persist()` request, standalone-mode link handling, safe-area insets,
service-worker update prompt (no silent reload mid-sale), offline fallback page, cache versioning
and eviction safety, iOS 7-day storage-purge mitigation (re-hydrate session from server on resume),
install guidance for iOS (Share → Add to Home Screen), and `apple-touch-icon` / splash coverage.

**Acceptance.** Both configs pass `wrangler deploy --dry-run --outdir` (no deploy); bundle size
recorded; a test pins the tier constants; the responsive-PWA audit checklist run in the Browser
pane at iPhone viewport with results recorded.

### Section 9 — Outside diffs, full QA, hygiene, RC (no deploy)

- Record every commit that lands on `origin/main` or the main checkout after base `57d8f1a2`
  (`git log 57d8f1a2..origin/main`, `git status` of the main checkout) into
  `docs/plans/outside-diffs-2026-09-02.md` with per-file overlap against the RC branch. Do not merge.
- Full floor + full suites on the merged RC branch; live QA recipe from the fleet skill.
- `progress.md` hygiene: keep the control sections (how-to, Golden Rules, standards, QA method,
  decisions, environment), fold the stale "Status snapshot" and "Current status" into one dated
  status block, move finished items into the archive, move the Part-record prose into
  `docs/history/`, and cut duplicated blocks — with a table of what moved where. Root files:
  `CHECKPOINT.md`, `CHECKPOINT_CHANGES.patch`, `CHECKPOINT_GIT_STATUS.txt`, `run-log.txt` are
  untracked sandbox leftovers → move to `docs/history/checkpoints/` or delete after the coordinator
  confirms they are captured; `tmp/`, `outputs/`, `Migration from old system/` stay untouched (user
  data) but get `.gitignore` entries if missing.
- Output: RC branch tip hash, certification report, and the list of user decisions still needed.
  **No deploy, no push to main, no migration apply.**

## 4. Phase 2 — ceiling pass (added 2026-09-02 21:10 after the user's scope expansion)

The user's Phase 2 ask, restated as testable requirements. Every Phase 2 section inherits §0
(isolation), the Golden Rules, and the Phase 1 acceptance style (Ask · What changed · Found ·
Verified expected-vs-actual · Not done). Phase 2 starts only after every Phase 1 section is merged
and the RC tip is certified green (layers 1–4).

### 4.0 Requirements (from the user, restated)
- R1 **Ceiling quality** — "absolute ceiling" on UI/UX, architecture, capabilities; verified from
  many angles (static, tests, browser at 375/768/1280, dark+light, both plans, offline+online).
- R2 **Core logic is sacred** — product standalone vs group-with-child-rows, compact designs,
  POS sell options, permission gating, filters, sticky search+date rows, FilterMenu-only selected
  state, one close affordance per modal, InfoHint tooltips, Start→End ranges, batch identity —
  nothing changes semantically. A redesign that changes a number, a row count, or a permission
  outcome is a regression.
- R3 **Layering everywhere** — each page and each button follows the user's layering model:
  level 0 = summary/stats + a single compact control row; level 1 = the list/table; level 2 =
  fold/expand ("view details") revealing the record's details and its multilayer actions inside
  the fold; level 3 = the deep action (modal/drawer). Folds float over content, never push it.
- R4 **Compact, professional, classic/luxury** — no useless space, no control forced to the next
  row when it could share one, not text-heavy; controls (search, date range, filters, buttons)
  must never take "half of the page". Feel: classic, expensive, clean, neat.
- R5 **Both plans maximised** — one codebase, `PLAN=free|paid`; Free stays fully functional
  inside the enforced daily limits with graceful degradation; Paid uses the headroom (batches,
  CPU, subrequests, bundle). R2 and D1 identical in behaviour on both.
- R6 **Search + barcode consistency** — every product-related search (POS, promotions, transfer,
  inventory, products page, sales, returns, storefront) uses one matcher contract and one scan
  path: exact barcode first, digits-only exact, typo-tolerant fallback, fast, paginated, Khmer.
- R7 **Codex re-verification is protected** — Codex's barcode/official-name data re-verification
  (old-system barcodes are correct where ours are missing) must keep working: the CSV headers,
  columns, and scripts it depends on stay stable; our search reads any alias barcodes it produces.
- R8 **Scrollability** — every section scrolls correctly horizontally and vertically in both the
  desktop sections view and the mobile layered navigation; no nested double scroll, no clipped
  wide tables, no page-level horizontal scroll.
- R9 **De-bloat** — remove dead/old/duplicated code and split bloated files without changing
  behaviour, guards, quotas, offline logic, or efficiencies; every removal proven by zero
  importers + tests + build.
- R10 **PWA / mobile / iOS fully working** — install (Add-to-Home-Screen guidance; optional
  `.mobileconfig` WebClip if the Gate-2C audit finds it appropriate), update flow without
  mid-sale reloads, storage persistence, offline shell, safe areas, keyboard/viewport hazards.
- R11 **Verification loops** — every worker runs the loop (typecheck → tests → build → browser
  at three viewports → expected-vs-actual table) after EACH commit, not once at the end; the
  coordinator re-runs it on the merged tree and does layer 4 (live worker + D1 copy) at the end.

### 4.1 Gate 2 audits (read-only, running)
- Gate 2A design/layering/scroll audit → `bos-rc-workers/gate2a-design-audit.md`
- Gate 2B search/barcode consistency + Codex reconciliation → `gate2b-search-barcode-codex-audit.md`
- Gate 2C code-bloat map + PWA/iOS install options → `gate2c-bloat-pwa-audit.md`
Their findings become the file:line specifics of the section briefs below (the coordinator
rewrites each brief with those references before dispatch; workers never plan from memory).

### 4.2 Sections, dependency order, ownership
| # | Section | Depends on | Owns (files) | Must not touch |
|---|---|---|---|---|
| P2-1 | Design kit: tokens + at most 12 shared primitives (Button, IconButton, SectionHeader, ControlRow, StatStrip, Fold/Expander, DetailFlyout, Chip, EmptyState, Skeleton, DenseTable wrapper, Toolbar) + a gallery page under Settings → Appearance (admin-only) | Gate 2A | `frontend/src/styles/tokens.css`, `frontend/src/components/shared/kit/*`, `frontend/src/lang/*` (append) | any page file |
| P2-2 | Search/scan core: one client hook `useProductLookup` + one scan handler + backend contract parity | Gate 2B, Sec 2 merged | `frontend/src/utils/productLookup*.ts`, `frontend/src/hooks/*`, `cloudflare/src/lib/searchMatch.ts`, `routes/products.ts` (search only) | page files (migration is P2-4/5) |
| P2-3 | Codex reconciliation: alias-barcode ingestion (additive), CSV contract test, import path keeps old-system barcode precedence | Gate 2B | `cloudflare/migrations/*` (new, additive only), `cloudflare/src/lib/importEngine.ts` (barcode section), `ops/scripts/migration/*` (compat tests) | anything Codex's scripts read (headers/columns) |
| P2-4 | Page adoption A: Products, POS, Sales hub (sales/returns/expenses/reports) onto the kit + layering + P2-2 lookup | P2-1, P2-2 | those page folders | logic helpers listed as do-not-touch in Gate 2A |
| P2-5 | Page adoption B: Branches hub (overview/inventory/movements/rfid), Contacts, Promotions+Loyalty, Dashboard, Settings hub, Notes, Files, Review/Import, Catalog editor, Backup | P2-1, P2-2, Sec 3 + Sec 6 merged | those page folders | same |
| P2-6 | Scrollability + responsive certification: every page × {375, 768, 1280} × {sections view, layered view} × {light, dark}; fixes only in scroll/sticky wrappers | P2-4, P2-5 | scroll/sticky wrappers, `pageScrollRoots.test.ts` | logic |
| P2-7 | De-bloat: safe-to-remove list from Gate 2C, then file splits (hooks/helpers extraction only), shape-test updates | Gate 2C, after P2-4/5 land | listed files | guards, quotas, offline queue, permissions |
| P2-8 | Plans maximised: extend Sec 8b — Paid uses headroom (bigger batches, longer CPU windows, Analytics Engine sampling), Free degrades gracefully with user-visible notices; matrix test for every limit | Sec 8b merged | the plan-limits module Sec 8b introduces and its consumers | wrangler bindings |
| P2-9 | PWA/iOS: install guidance + optional WebClip `.mobileconfig` route (per Gate 2C verdict), viewport/keyboard/safe-area hazard fixes, offline fallback, update toast; responsive-pwa-audit skill run on the built app | Sec 8b merged, Gate 2C | `frontend/index.html`, `public-runtime/*`, `Sidebar.tsx` (update region), `cloudflare/src/routes/system.ts` (webclip route) | page layouts |
| P2-10 | Final: outside-diff sweep 2, committed-HEAD certification in a fresh worktree, layer-4 live QA, RC report + user decisions | all | docs only | — |

Workers per section: one Sonnet worker per section (P2-4 and P2-5 may be split by page group into
two workers each once the kit is stable), always on its own `rc/p2-<n>` branch worktree branched
from the RC tip at dispatch time; merge order = table order.

### 4.3 Brief template every Phase 2 worker receives (coordinator fills the specifics)
1. Ask (verbatim) · 2. Files you own / must not touch (from §4.2 + audit) · 3. Invariants (R2 list
+ the audit's do-not-touch helpers) · 4. Exact design spec (tokens, spacing scale, control-row
composition at each breakpoint, fold behaviour, copy limits) · 5. Step list in dependency order,
one commit each, exact-path staging · 6. Verification loop after every commit (commands + what
to screenshot + expected vs actual) · 7. Report format + path.

### 4.4 Acceptance for Phase 2 as a whole
- Every page renders with the kit; a grep finds zero hand-rolled chip rows / buttons / stat strips
  outside `shared/kit`; shape tests updated deliberately, not deleted.
- Control rows: at most 1 row at 1280, 2 rows at 768, 2 rows at 375 (search + date), everything
  else inside FilterMenu / an overflow menu; measured in the browser, not asserted from code.
- Search/scan matrix from Gate 2B: every cell passes on the RC tip.
- Codex contract test green; alias barcodes searchable; old-system barcode precedence on import.
- Scroll matrix (P2-6) all passing, no page-level horizontal scroll at any viewport.
- De-bloat: net negative lines with tests/build green and no behaviour diff on the QA script.
- Free and Paid: `PLAN` matrix test green; a Free run of the QA script completes within daily budgets.
- PWA: install/update/offline checklist + responsive-pwa-audit report attached; iOS hazard list closed.

### 4.5 User decisions for Phase 2 (2026-09-02, plan approved ~21:40) — binding for every P2 brief

1. Branches → Inventory = branch-stock workspace distinct from Products.
2. iOS install = guidance only (Add-to-Home-Screen hint, update toast, persistence, offline). No `.mobileconfig` WebClip. Gate 2C reached the same verdict independently.
3. De-bloat = proven-dead removals + hook/helper splits; test-only exports stay.
4. Phase 2 lands on the same RC branch.
5. Look = ivory + charcoal + muted gold, serif display headings over a clean sans body, hairline borders, soft shadows. Dark variant (charcoal ground, ivory text, same gold) only via the manual `.dark` toggle; light stays the default; the app must not auto-honour OS dark (fix the `index.html` pre-paint shell).
6. Fold container = floating panel on desktop, bottom sheet on mobile; deep actions are level-3 modals.
7. Scope = admin app only; the storefront keeps its design (Section 8a fixes only).
8. Density = compact: 13 px body text, 32 px rows; 36–40 px touch targets on mobile only. iOS exception: form inputs ≥16 px below 768 px so Safari does not auto-zoom; desktop inputs stay 13 px.
9. Barcode scan = select, then confirm, on every surface including POS. Camera auto-closes on read; value fills the search box; list narrows; an exact single hit is highlighted/scrolled into view but never auto-added, auto-picked, or auto-opened (products fold into groups, batches, and options the user must choose). Keyboard-wedge scans land in the focused search box the same way.
10. Codex/legacy re-verified data reaches the app by both paths (CSV through the import hub AND ops scripts against D1); the RC hardens the import path and pins the script/CSV contract with tests.
11. Deeper verification of the latest data folder (`tmp/latest-data-input-20260902/latest data/`, pipeline `tmp/latest-data-reconcile/`, workbook `outputs/…/latest-data-zero-error-reconciliation-20260902.xlsx`) against the system = section P2-3b, read-only against production.
12. App logic consistency is global: every page follows every rule fully (search, scan, date range, filters, grouping, permissions, stats); P2-6 certifies a consistency matrix.
13. Fonts = self-hosted woff2 (offline-safe via the SW), legibility first: Source Serif 4 medium/semibold for headings ≥16 px only, Inter body at 13 px, Noto Sans Khmer / Noto Serif Khmer, real fallback stacks. No thin display serifs.
14. Plan packaging = two toml files: `cloudflare/wrangler.toml` (Paid, unchanged default) and `cloudflare/wrangler.free.toml` (Free) selected via `--config`; runtime reads one `PLAN` var.
15. P2-3b = full re-verify + prepared guarded SQL, nothing applied; waits until Codex has finished so its output is a second independent source. Step 0 runs now: keep a read-only copy of production D1 (SELECT-only) under `bos-rc-workers/d1-snapshot-<timestamp>/` with a row-count manifest. The user says when Codex is done and where its output lives.
16. Timing = start disjoint Phase-2 work now (P2-1, P2-2, P2-3, P2-3b step 0) in parallel with the Phase-1 close-out; page adoption waits for the certified Phase-1 tip; the `inventory.ts` search tail is sequenced after Section 3 merges.
17. Mobile navigation default = pages (layered): hub → section list → full-screen section with back header; OS back collapses one layer; switchable in Settings → Appearance.
18. Visual checkpoint on Products: after kit + gallery + restyled Products, the coordinator sends screenshots (375/768/1280, light/dark) and waits for the user's approval before P2-4/P2-5 restyle the remaining pages.

Standing policies (no further questions): shape-pinning tests are updated to the new markup with the invariant kept, never deleted; all 56 `window.confirm` sites move to `ConfirmDialog`; `dateHelpers.toLocalDateString` is exported and its 8 copies import it; the five uncertain zero-importer symbols from Gate 2C (`readAllQuotas`, `emptySalesTotals`, `samePhone`, `getSupplierRenameImpact`, `parseCSV`) are not removed; outside diffs are swept before every merge and never absorbed.

Section additions: **P2-3b Latest-data deep verification** (owns `bos-rc-workers/d1-snapshot-*`, `docs/reports/latest-data-verification-*.md`, a scripts folder under `ops/scripts/latest-data/`; must not write to production, `products`, or any tracked data file) and the Products-first checkpoint inside P2-4.

19. (added 2026-09-02 ~22:40, from the user's old-system mobile screenshot — structure only, colours explicitly NOT a reference) Mobile three-layer navigation shape: **Layer 1 = home grid of hub tiles** — two columns, large tiles (≈ 44–48 % width, ≈ 110 px tall), one icon (≈ 40 px) centred above one short label, the whole tile is the tap target, order = Sales, Promotions, Products, Contacts, Branches, Stock/Inventory, Reports, Settings (final order/labels follow the app's real hubs and permissions; tiles the user cannot access are hidden, not disabled), optional unread badge on a tile; top bar = menu button · page title · search · notification bell with badge. **Layer 2 = the tapped hub's section list** (full-screen list of that hub's sections, back header). **Layer 3 = the section itself, full screen with a back header**; OS/browser back collapses exactly one layer. Applies to the admin app below 768 px in the default "pages" mode (decision 17); desktop keeps the sidebar + section chip row.
