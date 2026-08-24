export function buildProductSearchTerms(search: unknown): string[] {
  const raw = String(search || '').trim()
  if (!raw) return []
  return raw.split(',').map((term) => term.trim().toLowerCase()).filter(Boolean)
}

// "Searchable filter for special stock states" (progress.md backlog item
// #2): lets someone type e.g. `stock:0` or `out of stock` as one of the
// comma-separated search terms instead of having to open the Filter menu
// and pick the "Out of stock" pill separately. Recognizes a small,
// deliberately explicit set of synonyms rather than trying to parse
// arbitrary "stock < 5" expressions -- this is a convenience shortcut for
// the one specific edge case the user asked about (stock is 0), not a
// general query language.
const ZERO_STOCK_SEARCH_TOKEN = /^(stock\s*[:=]?\s*0|zero\s*stock|out\s*of\s*stock|stockzero)$/i

export interface ParsedProductSearch {
  /** The comma-separated search text with any recognized stock token removed, ready for buildProductSearchTerms / the server `query` param. */
  cleanedQuery: string
  /** True when one of the comma-separated terms matched a "stock is 0" synonym. */
  hasZeroStockToken: boolean
}

export function parseProductSearchStockToken(search: unknown): ParsedProductSearch {
  const raw = String(search || '')
  const rawTerms = raw.split(',')
  let hasZeroStockToken = false
  const keptTerms = rawTerms.filter((term) => {
    if (ZERO_STOCK_SEARCH_TOKEN.test(term.trim())) {
      hasZeroStockToken = true
      return false
    }
    return true
  })
  return { cleanedQuery: keptTerms.join(',').trim(), hasZeroStockToken }
}
