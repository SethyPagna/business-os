// Name suggestions for the CREATE product form.
//
// Owner report (2026-09-06): typing into Name offered nothing at all, so the
// operator had no way to notice they were about to re-create a product that
// already exists until the save-time verdict told them off.
//
// Root cause: the debounced server lookup this form already runs
// (searchProductsForMatch, min 2 characters, 350ms) fed ONLY the one-line
// identity hint under the field. Its rows -- the exact existing products the
// typed name matches -- were never offered as a picklist. Nothing new is
// fetched here; the same read now also renders as suggestions.
//
// Owner rule, deliberately preserved: a suggestion NEVER auto-picks. Choosing
// a row fills the NAME TEXT ONLY. It does not load that product, does not
// switch the form to editing it, and does not add a line to a create-products
// session -- it just types the name for you, at which point the form's own
// "this name already exists" affordance (classifyCreateMatches) fires exactly
// as it does for a hand-typed name.
//
// JSX-free so `node tests/productNameSuggestions.test.ts` runs the real logic.

import type { SuggestionOption } from '../../../utils/suggestionMatching.ts'
import type { CreateMatchCandidate } from './productCreateMatch.ts'

/** Characters that must be typed before the server is asked anything. */
export const PRODUCT_MATCH_MIN_CHARS = 2
/** Quiet period after the last keystroke before the lookup fires. */
export const PRODUCT_MATCH_DEBOUNCE_MS = 350

/**
 * Whether the live existing-product lookup should run at all. Typing one
 * letter must not fire a search that would match a third of the catalog,
 * and a barcode alone is a legitimate reason to search even with no name.
 */
export function shouldSearchProductMatches(name: unknown, barcode: unknown): boolean {
  const typedName = String(name ?? '').trim()
  const typedBarcode = String(barcode ?? '').trim()
  return typedName.length >= PRODUCT_MATCH_MIN_CHARS || typedBarcode.length >= PRODUCT_MATCH_MIN_CHARS
}

/** The queries the lookup sends for the currently typed name/barcode. */
export function productMatchQueries(name: unknown, barcode: unknown): string[] {
  return [String(name ?? '').trim(), String(barcode ?? '').trim()]
    .filter((query) => query.length >= PRODUCT_MATCH_MIN_CHARS)
}

/**
 * Turn matched existing products into suggestion rows. The secondary line
 * carries barcode and brand so the operator recognises WHICH "Serum" this is
 * -- name alone is exactly the ambiguity that produces duplicates.
 *
 * Rows are de-duplicated by product id (the same product can arrive from both
 * the name query and the barcode query), and the product currently being
 * edited is excluded: offering its own name back is noise.
 */
export function buildProductNameSuggestions(
  candidates: ReadonlyArray<CreateMatchCandidate & { brand?: unknown }> = [],
  options: { excludeId?: unknown; limit?: number } = {},
): SuggestionOption[] {
  const excludeKey = String(options.excludeId ?? '').trim()
  const limit = Number.isFinite(options.limit) ? Number(options.limit) : 8
  const seen = new Set<string>()
  const rows: SuggestionOption[] = []
  for (const candidate of candidates || []) {
    const name = String(candidate?.name ?? '').trim()
    if (!name) continue
    const id = String(candidate?.id ?? '').trim()
    if (!id || seen.has(id)) continue
    if (excludeKey && id === excludeKey) continue
    seen.add(id)
    const meta = [String(candidate?.barcode ?? '').trim(), String(candidate?.brand ?? '').trim()]
      .filter(Boolean)
      .join(' · ')
    rows.push({ value: name, key: `product-${id}`, meta: meta || undefined })
    if (rows.length >= limit) break
  }
  return rows
}
