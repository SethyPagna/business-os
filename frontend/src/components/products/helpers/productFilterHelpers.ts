import { toMultiFilterSet, type MultiFilterValue } from '../../../utils/recordFilters.ts'
import { matchesSearchTermGroups } from '../../../utils/searchMatch.ts'
export { buildProductSearchTerms } from '../../../utils/searchTerms.ts'

interface BranchStockRecord {
  branch_id?: unknown
  branch_name?: unknown
  quantity?: unknown
}

interface ProductRecord {
  id?: unknown
  name?: unknown
  sku?: unknown
  barcode?: unknown
  category?: unknown
  brand?: unknown
  unit?: unknown
  supplier?: unknown
  description?: unknown
  created_at?: unknown
  stock_quantity?: unknown
  low_stock_threshold?: unknown
  out_of_stock_threshold?: unknown
  branch_stock?: BranchStockRecord[]
  parent_id?: unknown
  is_group?: unknown
  [key: string]: unknown
}

interface ProductFilterState {
  brandFilter?: MultiFilterValue
  branchFilter?: unknown
  catFilter?: MultiFilterValue
  groupFilter?: unknown
  issueFilter?: unknown
  parentProductIds?: Set<unknown>
  searchMode?: unknown
  searchTerms?: unknown[]
  stockFilter?: unknown
  supplierFilter?: MultiFilterValue
}

// Mirrors cloudflare/src/lib/searchMatch.ts's ISSUE_STATE_KEYS/
// buildIssueStateClauses exactly -- see that file's own comment for the
// full scoping reasoning. Kept as a separate small client-side check
// (rather than importing the server helper, which builds SQL) so this
// same-page instant re-filter agrees with what the server already
// returned, same "don't second-guess the server's answer with a stricter
// client check" principle as every other filter in this function.
function productHasIssue(product: ProductRecord, issueKey: string): boolean {
  switch (issueKey) {
    case 'out_of_stock': {
      const qty = toNumber(product.stock_quantity)
      return qty <= toNumber(product.out_of_stock_threshold)
    }
    case 'no_image':
      return !String(product.image_path || '').trim()
    case 'no_barcode':
      return !String(product.barcode || '').trim()
    case 'no_category':
      return !String(product.category || '').trim()
    case 'no_price': {
      const priceUsd = toNumber(product.selling_price_usd)
      const priceKhr = toNumber(product.selling_price_khr)
      return priceUsd <= 0 && priceKhr <= 0
    }
    default:
      return false
  }
}

function toNumber(value: unknown, fallback = 0): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function normalizeFilterValue(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function getProductBranchQuantity(product: ProductRecord, branchId: unknown): unknown {
  return (product?.branch_stock || [])
    .find((stock) => String(stock.branch_id) === String(branchId))?.quantity ?? 0
}

export function filterProductsForPage(products: ProductRecord[] = [], filters: ProductFilterState = {}): ProductRecord[] {
  const {
    brandFilter = 'all',
    branchFilter = 'all',
    catFilter = 'all',
    groupFilter = 'all',
    issueFilter = 'all',
    parentProductIds = new Set(),
    searchMode = 'AND',
    searchTerms = [],
    stockFilter = 'all',
    supplierFilter = 'all',
  } = filters

  // Hoisted out of the per-product .filter() callback below -- these all
  // depend only on `filters`, not on the product being tested, so
  // rebuilding them once per product (as this used to do) redid the same
  // work on every one of the ~20 rows on a page for no reason. Genuinely
  // harmless at that size (flagged wasteful-but-not-O(n²) in the app-wide
  // Big-O sweep, progress.md), but a free cleanup while touching this file.
  const searchTermList = searchTerms.map((term) => String(term || '')).filter(Boolean)
  const normalizeSet = (set: Set<string> | null): Set<string> | null => set ? new Set([...set].map(normalizeFilterValue)) : null
  const catSet = normalizeSet(toMultiFilterSet(catFilter))
  const brandSet = normalizeSet(toMultiFilterSet(brandFilter))
  const supplierSet = normalizeSet(toMultiFilterSet(supplierFilter))
  // issueFilter is the same comma-joined 'all'|"key,key" shape as
  // utils/multiSelect.ts's other multi-select filters (see
  // IssuesFilterOptions.tsx) -- parsed once here rather than per product.
  const issueKeys = String(issueFilter || 'all') === 'all'
    ? []
    : String(issueFilter).split(',').map((v) => v.trim()).filter(Boolean)

  return products.filter((product) => {
    // Search haystack mirrors the server's own /api/products/search MATCH
    // scope (PRODUCT_SEARCH_COLUMNS, cloudflare/src/lib/searchMatch.ts) --
    // name, sku, barcode only. Narrowed from the old wider set (which also
    // checked brand/category/supplier/description/unit) per an explicit
    // request: product names already carry the brand in this catalog, and
    // brand/category/supplier are already reachable via their own filter
    // dropdowns rather than free-text search. The unit-review handoff
    // (handleLookupReviewSelection in Products.tsx) no longer relies on the
    // search box at all -- it now sets a dedicated unitFilter instead of
    // stuffing the unit's name into `search` -- so dropping unit here no
    // longer risks the "server matched, client re-filter silently emptied
    // the page" bug this comment used to warn about for that flow.
    //
    // Routed through matchesSearchTermGroups (searchMatch.ts) instead of a
    // plain `haystack.includes(term)` check -- typo/joiner/word-order/
    // diacritic tolerant, matching what the server's own search already
    // does since part 66, so this instant-feedback re-filter doesn't
    // narrow back down to a stricter match than the page it's re-filtering
    // just came from.
    const matchSearch = matchesSearchTermGroups(
      // tag_label (P4): the operator's own word for a product belongs in
      // the search haystack on every client-side pass.
      [product?.name, product?.sku, product?.barcode, (product as Record<string, unknown>)?.tag_label as string | undefined],
      searchTermList,
      searchMode as 'AND' | 'OR',
    )
    const matchCat = !catSet || catSet.has(normalizeFilterValue(product.category))
    const matchBrand = !brandSet || brandSet.has(normalizeFilterValue(product.brand))
    const matchBranch = branchFilter === 'all' || (product.branch_stock || []).some((stock) => String(stock.branch_id) === String(branchFilter))
    const matchSupplier = !supplierSet || supplierSet.has(normalizeFilterValue(product.supplier))
    // "Created" is now a real server-side batch-date filter (see
    // routes/products.ts's buildSearchFilters and
    // CreatedDateFilterOptions.tsx) rather than a client-only
    // created_at re-filter, so there's no matchCreated check here anymore
    // -- re-applying one against this page-only data would risk the same
    // "server's answer gets second-guessed by a narrower client check"
    // bug already fixed for stock/category/groupFilter/search above.
    // groupFilter/parentProductIds are accepted (and still exported in the
    // filter-state type) but intentionally NOT applied as an exclusionary
    // check here. `products` is always just the current server page (~20
    // rows), and the server's own /api/products/search groupState filter
    // already scopes "grouped" across the *whole* active catalog -- an
    // explicit is_group/parent_id link, OR simply sharing a (trimmed,
    // case-insensitive) name with any other active product anywhere in the
    // table (see buildSearchFilters in cloudflare/src/routes/products.ts).
    // Most real groups in this catalog are the latter: same-name rows with
    // neither flag set. A client-side recheck using only parentProductIds
    // (built from this same single page, see buildParentProductIdSet) can't
    // see that broader relationship, so it would see a "group" of one and
    // incorrectly drop rows the server had already confirmed were grouped --
    // sometimes emptying the page entirely. Same root cause, and same fix,
    // as POS.tsx's visibleProductCards (see its comment for the original
    // "Groups filter -> no matching product" incident). The server's answer
    // is trusted as-is. groupFilter/parentProductIds stay accepted params so
    // this stays a non-breaking signature change for Products.tsx's one call
    // site; buildProductGroupSections (a separate, same-page-safe concern:
    // clustering rows already on this page into cards for display) still
    // reads parentProductIds directly from Products.tsx, unrelated to this
    // function's filtering.
    const qty = branchFilter !== 'all' ? getProductBranchQuantity(product, branchFilter) : product.stock_quantity
    const outOfStockThreshold = toNumber(product.out_of_stock_threshold)
    const lowStockThreshold = toNumber(product.low_stock_threshold, 10)

    // Used to unconditionally drop out-of-stock rows here whenever a
    // branch was selected, regardless of stockFilter -- so picking a
    // branch silently turned "all" into "in-stock + low-stock only" with
    // no way to actually see (or filter for) an out-of-stock product in
    // that branch except via the 'out' pill specifically. matchStock
    // below already implements the correct behavior for every stockFilter
    // value, 'all' included, so this extra exclusion was redundant with
    // (and, for 'all', directly contradicted) it.

    // 'in_stock' is positive stock (includes both low and healthy);
    // 'healthy' is the stricter subset above the low-stock threshold --
    // see matching comment/fix in Inventory.tsx's filteredSummary and the
    // backend (routes/products.ts, routes/branches.ts). 'in_stock' used
    // to incorrectly require qty above lowStockThreshold, i.e. it silently
    // meant what 'healthy' now means.
    const matchStock =
      stockFilter === 'all' ? true
        : stockFilter === 'out' ? toNumber(qty) <= outOfStockThreshold
          : stockFilter === 'low' ? toNumber(qty) > outOfStockThreshold && toNumber(qty) <= lowStockThreshold
            : stockFilter === 'in_stock' ? toNumber(qty) > outOfStockThreshold
              : stockFilter === 'healthy' ? toNumber(qty) > lowStockThreshold
                : true
    // "Issues" -- surfaced when the product trips ANY of the selected
    // issue keys (same OR semantics as the server's own
    // buildIssueStateClauses), not every one of them.
    const matchIssue = !issueKeys.length || issueKeys.some((key) => productHasIssue(product, key))
    return matchSearch && matchCat && matchBrand && matchBranch && matchSupplier && matchStock && matchIssue
  })
}
