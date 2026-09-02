import type { D1Compat } from './db'

// Additive alias-barcode support (P2-3, Phase 2 RC). Codex/legacy
// re-verification finds a real barcode for a product that already carries a
// DIFFERENT real barcode (not missing/"0"/short) -- the old-system value is
// then correct, but the app must never silently overwrite what's already on
// `products.barcode` (barcode is a deliberately shared, non-unique scalar
// column; see productIdentity.ts and migrations/0001_init.sql:419,776).
// Instead the alternative code is recorded here as a searchable alias --
// migrations/0105_barcode_aliases.sql adds the table this file writes to and
// reads from. Nothing here ever touches `products.barcode` itself.
//
// MIN_REAL_BARCODE_LENGTH mirrors cloudflare/src/lib/productIdentity.ts:173
// (`const MIN_REAL_BARCODE_LENGTH = 4`) -- the old system stamped '0' (and
// blank) on products without a real barcode; anything shorter than 4 chars
// is a placeholder, not an identity. That constant is NOT exported there,
// and productIdentity.ts is outside this section's ownership (P2-3 owns
// this file, the alias migration, and importEngine.ts's barcode section
// only) -- duplicated intentionally rather than widening this section's
// edit surface into a file another lane may also be touching. Both values
// must be kept at 4 in lockstep; a test in
// cloudflare/scripts/test-codex-contract-pure.cjs pins this literal against
// a fresh read of productIdentity.ts's own source text so the two can never
// silently drift apart.
export const MIN_REAL_BARCODE_LENGTH = 4

/**
 * Canonical comparable form of a barcode: trimmed, lower-cased. Mirrors the
 * `lower(record.barcode)` key importEngine.ts's own `byBarcode` maps already
 * use (see importEngine.ts:1226 and its neighbours), so an alias and a
 * primary barcode agree on what "the same code" means. Does NOT strip
 * leading zeros or punctuation -- the very bug this contract exists to
 * catch is a dropped leading zero (old_barcode=8011003845132 vs
 * template_barcode=08011003845132, Migration from old
 * system/businessos-migration-aug28/reference/product_mapping.csv row 1),
 * so normalization must not itself erase that distinction.
 */
export function normalizeBarcode(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

/**
 * Whether a barcode value is real (an actual identity) rather than a
 * placeholder. The old system stamped '0' (and blank) on products without a
 * real barcode -- 238 such live products share the literal "0"
 * (productIdentity.ts:170-171) -- so anything shorter than
 * MIN_REAL_BARCODE_LENGTH is never treated as identifying a product, alias
 * or primary.
 */
export function isRealBarcode(value: unknown): boolean {
  return String(value ?? '').trim().length >= MIN_REAL_BARCODE_LENGTH
}

/**
 * Builds an exact-match SQL fragment (and mutates `bindings` with its named
 * parameter) that P2-2's search tail can OR into its own exact-barcode
 * check -- an alias hit should highlight the same way a primary-barcode hit
 * does, per the user's decision 9 (scan/search select-then-confirm, never
 * auto-pick): this is an EXACT clause only, no substring/fuzzy alias
 * matching. Assumes the outer query's products table is aliased/named
 * `products` (matching every existing route in
 * cloudflare/src/routes/products.ts and inventory.ts); if a caller's query
 * uses a different alias, wrap this fragment or adjust the alias -- flagged
 * for P2-2 in docs/plans/codex-data-contract.md.
 *
 * Returns '' (and leaves `bindings` untouched) for a blank/placeholder
 * alias -- there is nothing real to match on, and building a clause that
 * would match every non-null barcode against an empty string is exactly the
 * kind of accidental "everything matches" bug placeholders exist to avoid.
 */
export function buildAliasExactClause(alias: string, bindings: Record<string, unknown>): string {
  const normalized = normalizeBarcode(alias)
  if (!isRealBarcode(normalized)) return ''
  const key = `barcode_alias_${Object.keys(bindings).length}`
  bindings[key] = normalized
  return `EXISTS (SELECT 1 FROM barcode_aliases ba WHERE ba.product_id = products.id AND ba.barcode_normalized = @${key})`
}

export type BarcodeAlias = {
  id: number
  productId: number
  barcode: string
  barcodeNormalized: string
  source: string
  addedAt: string
}

/** Every alias recorded for one product, oldest first. Read-only. */
export async function listAliases(db: D1Compat, productId: number): Promise<BarcodeAlias[]> {
  const rows = await db.prepare(`
    SELECT id, product_id, barcode, barcode_normalized, source, added_at
    FROM barcode_aliases
    WHERE product_id = @productId
    ORDER BY id ASC
  `).all<{ id: number; product_id: number; barcode: string; barcode_normalized: string; source: string; added_at: string }>({ productId })
  return rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    barcode: row.barcode,
    barcodeNormalized: row.barcode_normalized,
    source: row.source,
    addedAt: row.added_at,
  }))
}

/**
 * Records one or more alias barcodes for a product. Idempotent: a value
 * already on file for this product (same `barcode_normalized`) is silently
 * skipped via the migration's `UNIQUE(product_id, barcode_normalized)`
 * index (`ON CONFLICT ... DO NOTHING`) -- calling this twice with the same
 * inputs never duplicates a row and never throws. Placeholder/blank values
 * are dropped, never stored (an alias must be a real barcode, same rule as
 * the primary column). Returns the number of rows actually inserted (not
 * the number of values passed in -- duplicates/placeholders don't count).
 */
export async function addAliases(db: D1Compat, productId: number, values: readonly unknown[], source: string): Promise<number> {
  let inserted = 0
  const seen = new Set<string>()
  for (const raw of values) {
    const normalized = normalizeBarcode(raw)
    if (!isRealBarcode(normalized) || seen.has(normalized)) continue
    seen.add(normalized)
    const result = await db.prepare(`
      INSERT INTO barcode_aliases (product_id, barcode, barcode_normalized, source, added_at)
      VALUES (@productId, @barcode, @normalized, @source, datetime('now'))
      ON CONFLICT(product_id, barcode_normalized) DO NOTHING
    `).run({ productId, barcode: String(raw ?? '').trim(), normalized, source })
    inserted += result.changes
  }
  return inserted
}
