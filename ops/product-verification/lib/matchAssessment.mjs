// Turns a raw search result (url/title/snippet -- what any real search API
// returns) into the matchesBrand/matchesProduct/matchesVariant judgment
// reconcile.mjs needs, using plain token-overlap heuristics. This is the
// ONE place that guesses; everything downstream (reconcile.mjs) is exact
// given its inputs. Providers that already know the answer with certainty
// (the mock provider, replaying hand-reviewed prior evidence) skip this and
// set the match fields directly -- this module exists for the real HTTP
// provider, where nothing hands you a verdict, only text.
//
// Deliberately conservative: when in doubt this returns `false`, because a
// false "matches" inflates confidence and this whole workflow exists to
// avoid overconfident automatic catalogue writes (see README.md).

const SIZE_UNIT_RE = /^\d+(\.\d+)?(ml|g|kg|oz|l|pcs|pc|ct|fl)$/i
const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'set'])

function tokenize(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.]/gu, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
}

function significantTokens(value) {
  return tokenize(value).filter((token) => token.length >= 3 && !STOPWORDS.has(token) && !SIZE_UNIT_RE.test(token))
}

function overlapRatio(aTokens, bTokens) {
  if (!aTokens.length) return 0
  const bSet = new Set(bTokens)
  const hits = aTokens.filter((token) => bSet.has(token)).length
  return hits / aTokens.length
}

/**
 * @param {{name: string, brand?: string}} product
 * @param {{title: string, snippet?: string, url: string}} hit
 * @returns {{matchesBrand: boolean, matchesProduct: boolean, matchesVariant: boolean, proposedName: string}}
 */
export function assessHit(product, hit) {
  const haystack = `${hit.title || ''} ${hit.snippet || ''}`
  const haystackTokens = tokenize(haystack)

  const brand = String(product.brand || '').trim()
  const brandTokens = significantTokens(brand)
  // No brand on record to check against -- don't penalize for something we
  // cannot assess; matchesBrand only ever gates confidence UP when true, so
  // a permissive default here does not create false-high results on its
  // own (matchesProduct still has to pass too).
  const matchesBrand = brandTokens.length === 0 || brandTokens.every((token) => haystackTokens.includes(token))

  const nameTokens = significantTokens(product.name)
  const ratio = overlapRatio(nameTokens, haystackTokens)
  const matchesProduct = matchesBrand && ratio >= 0.6

  // Variant match is the stricter bar: essentially every significant token
  // in the current name (including size/shade codes the product-line ratio
  // above intentionally ignores) has to show up in the source text.
  const allNameTokens = tokenize(product.name).filter((token) => token.length >= 2)
  const variantRatio = overlapRatio(allNameTokens, haystackTokens)
  const matchesVariant = matchesProduct && variantRatio >= 0.85

  return {
    matchesBrand,
    matchesProduct,
    matchesVariant,
    proposedName: String(hit.title || '').trim(),
  }
}
