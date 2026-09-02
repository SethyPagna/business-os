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
