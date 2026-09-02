# Codex / legacy-data contract (P2-3)

Codex (an external ChatGPT/Codex surface) re-verifies product barcodes and official names
against the old system: an old-system barcode is correct where ours is missing/"0"/short.
Re-verified data reaches the app by two paths (decision 10): CSV through the import hub, and
ops scripts against D1 directly. This section pins the contract both paths depend on.

## barcode_aliases table (additive, new)

`cloudflare/migrations/0105_barcode_aliases.sql` — `barcode_aliases(id, product_id, barcode,
barcode_normalized, source, added_at)`, `UNIQUE(product_id, barcode_normalized)`, non-unique
index on `barcode_normalized` (one alias barcode CAN legitimately belong to several products,
mirroring `products.barcode` itself), `ON DELETE CASCADE`. `cloudflare/src/lib/barcodeAliases.ts`
owns `MIN_REAL_BARCODE_LENGTH=4` (mirrors `productIdentity.ts:173`, not exported there — kept in
sync via a test that reads that file's source, `scripts/test-barcode-aliases-pure.cjs`),
`isRealBarcode`/`normalizeBarcode` (the placeholder rule: "0" and anything under 4 chars is not
real), `addAliases`/`listAliases` (idempotent insert/read), and `buildAliasExactClause` — a plain
indexed `EXISTS` SQL fragment for P2-2's search tail to OR in (exact match only, no
substring/fuzzy — `products_fts_code`, `migrations/0019_products_fts_code.sql`, is an FTS5
external-content table keyed 1:1 to `products.id` and cannot hold a variable alias count without
becoming a different table type; this is the documented fallback instead).

## CSV/import-hub path

`classifyProducts` (`cloudflare/src/lib/importEngine.ts`) gained two exported pieces:

- **`applyBarcodeImportPrecedence`** (`:3033-3071`) — (a) incoming real barcode fills a
  missing/placeholder existing one; (b) an incoming real barcode that DIFFERS from an existing
  real one never overwrites it — kept as-is, incoming queued as a pending `barcode_aliases` row
  (`source: 'import'`), a new `barcode_alias_recorded` warning raised; (c) incoming
  placeholder/blank never clears a real barcode; (d) neither side real — blank keeps the existing
  placeholder, a non-blank placeholder wins. Runs unconditionally across every job-level mode; the
  one escape hatch is row-level `_action=override_replace` (`:1701-1711`), same as
  `preserveExistingMoneyOnBlankCells`.
- **`parseBarcodeAliasColumn`** (`:3080-3091`) — optional `barcode_aliases` CSV column,
  `|`-separated, placeholders dropped, deduped, ingested at `:1356-1367` regardless of
  match/create outcome.
- `runImportApply` (`:5778-5814`) writes pending aliases into `barcode_aliases` (`ON CONFLICT ...
  DO NOTHING`) in the same atomic per-chunk D1 batch as the row's own INSERT/UPDATE.

### PINNED FINDING — barcode precedence is reachable only in the trivial (already-agreeing) case

`productDetailSignature` = barcode + cost (`cloudflare/src/lib/productDetailRule.ts:110-116`,
"THE product identity rule", shared by duplicate-merge/branch-transfer/the manual form too) gates
**every** path that can set `match` in `classifyProducts`: `isExactIdentity` on
`skuMatch`/`sameNameBarcodeCandidates` (`:1550-1551`), the `costWasBlank`/`sameNameSameBarcode`
fallback (`:1556-1560`, filtered by `lower(candidate.barcode) === lower(barcode)` — INCOMING
barcode), `sameBatchCandidate` (`:1563-1583`), and the final `byName` fallback (`:1657-1662`) —
all require the existing candidate's barcode to already equal the incoming row's barcode before
`match` can be non-null. **A row whose only difference from an existing product is its barcode —
the exact Codex-reconciliation scenario — never reaches `match`; it becomes `action: 'create'`**
(a new sibling child-row, per `productDetailRule.ts`'s "a different barcode is a different
physical article"), not `update`. So `applyBarcodeImportPrecedence`'s rules (a)–(d) fire, through
the real pipeline, only in the already-agreeing (no-op) case — proven with 4 end-to-end tests, not
assumed (`test-barcode-import-precedence-pure.cjs`, the "PINNED: ..." cases). **Not fixed here**:
that means reworking the shared identity rule, outside this section's ownership. Recommendation:
steer Codex's CSV exports toward the additive `barcode_aliases` column (unaffected, works today)
instead of overwriting the plain `barcode` cell; a `classifyProducts` match-resolution follow-up,
if wanted, belongs to `productDetailRule.ts`'s owner.

## Ops-script path (unaffected by the finding above)

`ops/scripts/migration/official-name-recertification.mjs` targets `products.id` directly
(`buildGuardedSql`, `:155-178`) — never goes through `classifyProducts`' identity gate.
`REVIEW_HEADERS` (`:6-27`, 20 columns, pinned verbatim in
`cloudflare/scripts/test-codex-contract-pure.cjs`) already carries a `barcode_aliases` column,
validated digits-only/pipe-separated (`:127-128`) — **but `buildGuardedSql` does not yet emit any
SQL for it**, only for `description` (pinned as a known gap, same test file). Migration 0105 now
gives that column somewhere to land; wiring `buildGuardedSql` to also emit guarded
`INSERT INTO barcode_aliases ...` is a natural follow-up for that script's owner (out of scope
here — read/import-only for this section). The `"Official Product Name:\n<name>"` description
convention is shared byte-for-byte between this script's writer (`:155-178`) and
`cloudflare/src/lib/productDescriptionSections.ts`'s reader (`sanitizeImportedDescription`,
`:128-203`, canonical label `official_name`, `SECTION_ORDER` at `:34`) — round-tripped in
`test-codex-contract-pure.cjs`.

## Other pinned discrepancies (vs. the brief's assumptions, not silently changed)

- **No `id`-based product-CSV matching exists.** Precedence is SKU exact → barcode (name-filtered)
  → name+cost+barcode fallback (`grep -n "row\.id\b"` only hits an unrelated
  `import_job_files.id` read at `:453`).
- `MIN_REAL_BARCODE_LENGTH` is duplicated, not exported from `productIdentity.ts:173`, to avoid
  widening this section's edit surface into a file outside its ownership — flagged for a later
  one-line `export const` if a shared constant is preferred.

## For P2-2 (search) / P2-4 (import review UI)

- `buildAliasExactClause(alias, bindings)` (`barcodeAliases.ts`) returns a plain `EXISTS (SELECT 1
  FROM barcode_aliases WHERE product_id = products.id AND barcode_normalized = @paramN)` — assumes
  the caller's query aliases the products table as `products`; OR it into the existing
  exact-barcode check, exact match only.
- The optional `barcode_aliases` CSV column already reaches the backend unfiltered (no frontend
  allow-list gate — `productImportPlanner.ts`/`csvImport.ts`), but `BulkImportModal.tsx` has no
  display for it or for the new `barcode_alias_recorded` warning; the product fold has no
  alias-list display yet either.
