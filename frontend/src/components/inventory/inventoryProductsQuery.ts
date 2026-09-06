// The one place the Branches > Products list turns UI state into the query
// GET /api/inventory/products/search actually receives.
//
// Why it is its own pure module (N10): the Worker route has always scoped the
// per-product Net sold / Revenue / COGS / Profit columns by startDate/endDate
// (cloudflare/src/routes/inventory.ts -> attachInventoryProductMetrics reads
// query.startDate/start_date and query.endDate/end_date and applies them to
// BOTH the sold and the returned CTE). The frontend simply never sent them,
// so those four columns quietly answered "all time" while the Overview and
// Transfer tabs beside them answered the picked window. Wiring the hub's
// shared range through an inline object literal inside a 2000-line component
// would be untestable; as a function it gets a real behavioural test.
//
// Stock state (quantity, stock value and the summary cards above the table)
// is deliberately NOT part of this mapping -- stock is a "right now" fact and
// stays unscoped, which is also why /api/inventory/stats takes no dates.

export type InventoryProductsSearchRange = {
  startDate?: string
  endDate?: string
}

export type InventoryProductsSearchParams = {
  branchId?: number
  query?: string
  searchMode?: string
  page: number
  pageSize: number
  startDate?: string
  endDate?: string
}

export function buildInventoryProductsSearchParams({
  branchFilter,
  query,
  searchMode,
  page,
  pageSize,
  range,
}: {
  branchFilter: string
  query: string
  searchMode: string
  page: number
  pageSize: number
  range: InventoryProductsSearchRange
}): InventoryProductsSearchParams {
  const branchId = Number.parseInt(branchFilter, 10)
  const params: InventoryProductsSearchParams = {
    ...(branchFilter !== 'all' && Number.isFinite(branchId) ? { branchId } : {}),
    query: query || undefined,
    searchMode,
    page,
    pageSize,
  }
  // Each bound is sent on its own: a half-open range ("everything since the
  // 1st") is a real answer, and dropping it because the other end is blank
  // would silently widen the window back to all time.
  const startDate = String(range?.startDate || '').trim()
  const endDate = String(range?.endDate || '').trim()
  if (startDate) params.startDate = startDate
  if (endDate) params.endDate = endDate
  return params
}
