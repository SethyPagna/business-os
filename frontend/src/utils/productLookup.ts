// productLookup.ts -- P2-2 (search + barcode scan core). Pure, side-effect-free
// helpers shared by `hooks/useProductLookup.ts` and any page that adopts it
// (Promotions now; POS/Products/Inventory/Branches/Transfer/StockAdjust/
// FastStockIn/Returns/Catalog per P2-4/P2-5 -- see
// docs/plans/search-scan-contract.md).
//
// `findExactBarcodeHit` is a client-side mirror of the backend's
// `computeExactBarcodeHitId` (cloudflare/src/lib/searchMatch.ts): same three
// gates (digits-only, length >= MIN_REAL_BARCODE_LENGTH, not the shared "0"
// placeholder barcode) and the same "exactly one candidate matches" rule.
// `resolveExactBarcodeHit` prefers whatever the server already computed
// (`exact_barcode_hit_id` on the response -- every adopted endpoint now
// returns this, see products.ts/portal.ts/branches.ts and the prepared
// inventory.ts patch) and only falls back to the client computation when the
// server didn't provide one (e.g. an endpoint not yet migrated, or a locally
// cached/offline page of results).
//
// Kept in lockstep with MIN_REAL_BARCODE_LENGTH in both searchMatch.ts
// copies -- if that constant changes there, change it here too (parity
// covered by frontend/tests/productLookup.test.ts, not searchMatchParity.test.ts,
// since this file is intentionally NOT a mirror of searchMatch.ts itself).
export const MIN_REAL_BARCODE_LENGTH = 4

export interface ProductLookupCandidate {
  id: number
  barcode?: string | null
}

const DIGITS_ONLY_RE = /^\d+$/

export function normalizeLookupQuery(raw: unknown): string {
  return String(raw ?? '').trim()
}

export function isDigitsOnlyLookupQuery(raw: unknown): boolean {
  const trimmed = normalizeLookupQuery(raw)
  return trimmed.length > 0 && DIGITS_ONLY_RE.test(trimmed)
}

// True only when `raw` looks like it could plausibly BE a real scanned
// barcode value (not a 1-3 digit fragment someone is typing, and not the
// shared "0" placeholder several legacy/migrated products carry).
export function looksLikeRealBarcodeQuery(raw: unknown): boolean {
  const trimmed = normalizeLookupQuery(raw)
  if (!isDigitsOnlyLookupQuery(trimmed)) return false
  if (trimmed.length < MIN_REAL_BARCODE_LENGTH) return false
  if (trimmed === '0') return false
  return true
}

// Client-side mirror of computeExactBarcodeHitId: given the candidates on
// the CURRENT page of results and the raw typed/scanned query, returns the
// single candidate id whose barcode equals the query -- or null when the
// query doesn't look like a real barcode, or when zero or more-than-one
// candidate matches (an ambiguous/duplicate-barcode situation must never be
// treated as a confident single hit).
export function findExactBarcodeHit(
  candidates: readonly ProductLookupCandidate[],
  rawQuery: unknown,
): number | null {
  if (!looksLikeRealBarcodeQuery(rawQuery)) return null
  const query = normalizeLookupQuery(rawQuery)
  let hit: number | null = null
  for (const candidate of candidates || []) {
    const barcode = String(candidate?.barcode ?? '').trim()
    if (barcode !== query) continue
    if (hit !== null) return null // more than one match -- ambiguous, not confident
    hit = Number(candidate.id)
  }
  return hit
}

// Prefer the server's own `exact_barcode_hit_id` (already computed against
// the full matched set server-side, not just the current page) when present;
// fall back to the client computation only when the server didn't supply one
// (older/unmigrated endpoint, or a locally-cached/offline response shape).
export function resolveExactBarcodeHit(
  serverExactHitId: unknown,
  candidates: readonly ProductLookupCandidate[],
  rawQuery: unknown,
): number | null {
  // `null` is a real, computed answer ("no confident single hit" -- the
  // server already checked, possibly against a broader scope than just this
  // page, e.g. portal.ts's dedicated exact-barcode query) and must be
  // trusted as-is, NOT treated as "absent" and re-guessed client-side --
  // re-guessing from only the current page could disagree with a
  // broader-scoped server answer. Only `undefined` (the field is genuinely
  // missing from the response, e.g. an endpoint that hasn't adopted
  // exact_barcode_hit_id yet) falls back to the client computation.
  if (serverExactHitId === null) return null
  if (typeof serverExactHitId === 'number' && Number.isFinite(serverExactHitId)) {
    return serverExactHitId
  }
  if (serverExactHitId !== undefined) {
    // Server sent something else present (e.g. a numeric string) -- coerce
    // rather than silently falling through to the client guess.
    const coerced = Number(serverExactHitId)
    if (Number.isFinite(coerced)) return coerced
  }
  return findExactBarcodeHit(candidates, rawQuery)
}
