import type { BindParams, D1Compat } from './db'
import { getInventoryCheckAccess, InventoryCheckQueryError, projectInventoryCheckProduct, validateInventoryCheckQuery, type InventoryCheckAccess } from './inventoryCheckAccess'
import { buildInventoryCheckStockQuery, readInventoryCheckStock } from './inventoryCheckStock'
import { FAMILY_ROOT_KEY_SQL, paginateProductFamilies } from './familyPagination'
import { buildProductSalesLedgerSql } from './productSalesLedger'
import { identifiedCustomerExpr, recognizedExpr } from './salesAnalytics'
import { continuousReadWindowSql, parseContinuousReadWindow } from './continuousReadWindow'
import { localDateAtOrAfter, localDateAtOrBefore } from './businessDateWindow'
import { lowStockThresholdSql, type LowStockConfig } from './lowStockSettings'
import { stockVisibleProductSql } from './productStockGuard'
import { foldNativeDigits } from './searchMatch'
import type { PermissionUser } from './permissions'

export { getInventoryCheckAccess as getInventoryCheckProductsAccess } from './inventoryCheckAccess'

export type InventoryCheckProductsOptions = {
  lowStock: LowStockConfig
  rankingLimit?: number
  customerRanking?: 'sale_count'
  productIds?: readonly number[]
  costReviewKeyAvailable?: boolean
  observationFilter?: { organizationId: number | null; viewerId: number; sessionId?: string; state?: 'unstarted' | 'done' | 'issue'; reason?: string }
}

export class InventoryCheckProductsLimitError extends Error {
  readonly status = 413
  readonly code = 'inventory_check_family_page_too_large'
  readonly limit = 500
  constructor() { super('This complete family page exceeds 500 product rows. Choose a smaller page or narrower filters.') }
}

const invalid = (parameter: string): never => { throw new InventoryCheckQueryError(400, 'inventory_check_invalid_query', parameter) }
const denied = (parameter: string): never => { throw new InventoryCheckQueryError(403, 'inventory_check_field_hidden', parameter) }
const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
const integer = (value: string | undefined, fallback: number, maximum: number, key: string) => {
  if (value === undefined) return fallback
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > maximum) invalid(key)
  return Number(value)
}

function observationWhere(filter: NonNullable<InventoryCheckProductsOptions['observationFilter']>, params: Record<string, unknown>) {
  if (filter.organizationId !== null && (!Number.isSafeInteger(filter.organizationId) || filter.organizationId <= 0)) invalid('organizationId')
  if (!Number.isSafeInteger(filter.viewerId) || filter.viewerId <= 0) invalid('viewerId')
  if (filter.sessionId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(filter.sessionId)) invalid('sessionId')
  if (filter.state && !['unstarted', 'done', 'issue'].includes(filter.state)) invalid('state')
  if (['unstarted', 'done'].includes(filter.state || '') && !filter.sessionId) invalid('sessionId')
  if (filter.reason && (filter.reason.length > 500 || filter.state && filter.state !== 'issue')) invalid('reason')
  Object.assign(params, { observationOrganization: filter.organizationId, observationSession: filter.sessionId ?? null,
    observationState: filter.state ?? null, observationReason: filter.reason?.normalize('NFC').toLowerCase() || null, observationViewer: filter.viewerId })
  return `s.organization_id IS @observationOrganization AND i.branch_id=s.branch_id
    AND (@branchId IS NULL OR i.branch_id=@branchId)
    AND (@observationSession IS NULL OR s.id=@observationSession)
    AND (@observationState IS NULL OR i.state=@observationState)
    AND (@observationReason IS NULL OR i.state='issue' AND instr(lower(i.reason),@observationReason)>0)`
}

/** ic_simple: whose checks the status filter reads, and the one session a session view is restricted to. */
export type InventoryCheckSimpleScope = { organizationId: number | null; sessionId?: string }

// A product's check facts in one branch scope. Items of other organizations and items whose branch differs from their session's are never read.
const CHECK_SCOPE_SQL = 's.organization_id IS @checkOrg AND i.branch_id=s.branch_id AND (@branchId IS NULL OR i.branch_id=@branchId)'
const CHECK_ITEM_STATE = { in_check: 'unstarted', ok: 'done', issue: 'issue' } as const
const IN_OPEN_CHECK_SQL = (id: string) => `EXISTS (SELECT 1 FROM inventory_check_items i JOIN inventory_check_sessions s ON s.id=i.session_id
  WHERE i.product_id=${id} AND i.state='unstarted' AND s.status='open' AND ${CHECK_SCOPE_SQL})`
const LATEST_STATE_SQL = (id: string) => `(SELECT i.state FROM inventory_check_items i JOIN inventory_check_sessions s ON s.id=i.session_id
  WHERE i.product_id=${id} AND i.state IN ('done','issue') AND ${CHECK_SCOPE_SQL} ORDER BY i.updated_at DESC,i.session_id DESC LIMIT 1)`

function checkStateCondition(state: string, simple: InventoryCheckSimpleScope, params: Record<string, unknown>): string {
  if (simple.sessionId) {
    if (!Object.hasOwn(CHECK_ITEM_STATE, state)) invalid('checkState')
    params.checkItemState = CHECK_ITEM_STATE[state as keyof typeof CHECK_ITEM_STATE]
    return 'EXISTS (SELECT 1 FROM inventory_check_items it WHERE it.session_id=@checkSession AND it.product_id=p.id AND it.state=@checkItemState)'
  }
  if (state === 'in_check') return IN_OPEN_CHECK_SQL('p.id')
  if (state === 'ok' || state === 'issue') return `(NOT ${IN_OPEN_CHECK_SQL('p.id')} AND ${LATEST_STATE_SQL('p.id')}=${state === 'ok' ? "'done'" : "'issue'"})`
  if (state === 'not_checked') return `(NOT ${IN_OPEN_CHECK_SQL('p.id')} AND ${LATEST_STATE_SQL('p.id')} IS NULL)`
  return invalid('checkState')
}

function population(rawQuery: Record<string, unknown>, access: InventoryCheckAccess, lowStock: LowStockConfig, productIds?: readonly number[], observationFilter?: InventoryCheckProductsOptions['observationFilter'], costReviewKeyAvailable = false, simple?: InventoryCheckSimpleScope) {
  if (productIds !== undefined && (!Array.isArray(productIds) || productIds.length > 500 || productIds.some(id => !Number.isSafeInteger(id) || id <= 0))) invalid('productIds')
  const query = validateInventoryCheckQuery(rawQuery, access, simple !== undefined)
  const page = integer(query.page, 1, 100000, 'page')
  const pageSize = integer(query.pageSize, 20, 100, 'pageSize')
  const branchId = query.branchId && query.branchId !== 'all' ? integer(query.branchId, 1, Number.MAX_SAFE_INTEGER, 'branchId') : undefined
  const stock = buildInventoryCheckStockQuery({ branchId, productIds })
  const params: Record<string, unknown> = { ...stock.params, branchId: branchId ?? null }
  const conditions = ['1=1']
  if (observationFilter) {
    const where = observationWhere(observationFilter, params)
    if (observationFilter.sessionId || observationFilter.state || observationFilter.reason) conditions.push(`EXISTS (
      SELECT 1 FROM inventory_check_items i JOIN inventory_check_sessions s ON s.id=i.session_id WHERE i.product_id=p.id AND ${where})`)
  }
  if (productIds !== undefined) { params.admittedIds = JSON.stringify([...new Set(productIds)]); conditions.push('p.id IN (SELECT value FROM json_each(@admittedIds))') }
  if (simple) {
    if (simple.sessionId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(simple.sessionId)) invalid('sessionId')
    if (simple.organizationId !== null && (!Number.isSafeInteger(simple.organizationId) || simple.organizationId <= 0)) invalid('organizationId')
    params.checkOrg = simple.organizationId
    if (simple.sessionId) { params.checkSession = simple.sessionId; conditions.push('p.id IN (SELECT product_id FROM inventory_check_items WHERE session_id=@checkSession)') }
    if (query.checkState) conditions.push(checkStateCondition(query.checkState, simple, params))
  }
  const saleClauses: string[] = []
  let receivedFrom = query.startDate || '', receivedTo = query.endDate || ''
  if (receivedFrom && !validDay(receivedFrom)) invalid('startDate')
  if (receivedTo && !validDay(receivedTo)) invalid('endDate')
  if (receivedFrom && receivedTo && receivedFrom > receivedTo) invalid('endDate')
  let window: ReturnType<typeof parseContinuousReadWindow> = null
  try { window = parseContinuousReadWindow(query) } catch { invalid('createdFrom') }
  if (window) {
    Object.assign(params, window)
    saleClauses.push(continuousReadWindowSql('s.created_at'))
    const localDay = (value: string, offset = 0) => new Date(Date.parse(`${value.replace(' ', 'T')}Z`) + 7 * 3600000 + offset).toISOString().slice(0, 10)
    receivedFrom = localDay(window.createdFrom)
    receivedTo = localDay(window.createdTo, -1)
  } else {
    if (receivedFrom) { params.startDate = receivedFrom; saleClauses.push(localDateAtOrAfter('s.created_at')) }
    if (receivedTo) { params.endDate = receivedTo; saleClauses.push(localDateAtOrBefore('s.created_at')) }
  }
  if (receivedFrom || receivedTo) {
    if (!access.fields.received) denied('startDate')
    params.receivedFrom = receivedFrom || null; params.receivedTo = receivedTo || null
    conditions.push(`EXISTS (SELECT 1 FROM product_batches receipt WHERE receipt.variant_product_id=p.id
      AND (@receivedFrom IS NULL OR date(receipt.received_at)>=@receivedFrom)
      AND (@receivedTo IS NULL OR date(receipt.received_at)<=@receivedTo))`)
  }
  if (query.query) {
    const text = query.query.normalize('NFC')
    params.nameQuery = text.toLowerCase()
    // A scanned code finds its product for everyone who can search. Without the barcode field only the whole code
    // matches, so a hidden barcode or SKU can never be reconstructed from a prefix. Codes are Latin digits: a scanner
    // on the Khmer keyboard layout types ៣ for 3, so the code parameters fold them; the name match keeps what was typed.
    const code = foldNativeDigits(text)
    params.codeNeedle = code.toLowerCase()
    if (!access.fields.barcode) params.codeQuery = code
    const codeMatch = access.fields.barcode ? 'instr(lower(p.__code_barcode),@codeNeedle)>0 OR instr(lower(p.__code_sku),@codeNeedle)>0'
      : 'p.__code_barcode=@codeQuery OR p.__code_sku=@codeQuery'
    conditions.push(`(instr(lower(p.name),@nameQuery)>0 OR instr(lower(p.parent_name),@nameQuery)>0 OR ${codeMatch})`)
  }
  for (const field of ['brand', 'category'] as const) {
    const values = (query[field] || '').normalize('NFC').split(',').map(value => value.trim().toLowerCase()).filter(value => value && value !== 'all')
    if (!values.length) continue
    params[field] = JSON.stringify([...new Set(values)])
    const plural = field === 'category' ? 'categories' : 'brands'
    conditions.push(`EXISTS (SELECT 1 FROM json_each(@${field}) choice WHERE lower(trim(COALESCE(p.${field},'')))=choice.value
      OR instr('||'||lower(COALESCE(p.${plural},p.${field},''))||'||','||'||choice.value||'||')>0)`)
  }
  if (query.barcode) { params.barcode = query.barcode; conditions.push('(p.barcode=@barcode OR p.sku=@barcode)') }
  if (query.initial && query.initial.toLowerCase() !== 'all') {
    params.initial = query.initial.normalize('NFC').toUpperCase(); conditions.push('upper(substr(trim(p.name),1,length(@initial)))=@initial')
  }
  if (query.groupState && query.groupState !== 'all') {
    if (['group', 'grouped'].includes(query.groupState)) conditions.push('(COALESCE(p.parent_id,0)>0 OR COALESCE(p.is_group,0)=1 OR COALESCE(p.is_grouped_cached,0)=1)')
    else if (['variant', 'parent'].includes(query.groupState)) conditions.push('COALESCE(p.parent_id,0)>0')
    else if (query.groupState === 'standalone') conditions.push('(COALESCE(p.parent_id,0)=0 AND COALESCE(p.is_group,0)=0 AND COALESCE(p.is_grouped_cached,0)=0)')
    else invalid('groupState')
  }
  const stockConditions: string[] = []
  if (query.stockState === 'in_stock') stockConditions.push('p.__quantity>p.__out')
  if (query.stockState === 'low_stock') stockConditions.push('p.__quantity>p.__out AND p.__quantity<=p.__low')
  if (query.stockState === 'out_of_stock') stockConditions.push('p.__quantity<=p.__out')
  // The __code_ columns only feed the search match; projectInventoryCheckProduct drops them from every row.
  const columns = ['p.id', 'p.name', 'p.image_path', 'p.unit', 'p.parent_id', 'p.is_group', 'p.is_grouped_cached', 'p.created_at', 'p.barcode AS __code_barcode', 'p.sku AS __code_sku']
  if (access.fields.barcode) columns.push('p.barcode', 'p.sku')
  if (access.fields.brand) columns.push('p.brand', 'p.brands')
  if (access.fields.category) columns.push('p.category', 'p.categories')
  // ic_simple carries neither price nor cost, and reads the latest received date for the page rows only (see readInventoryCheckProductsSimple).
  if (access.fields.price && !simple) columns.push('p.selling_price_usd', 'p.selling_price_khr')
  if (access.fields.cost && !simple) columns.push('p.cost_price_usd', 'p.cost_price_khr',
    `${costReviewKeyAvailable ? "(COALESCE(p.cost_review_key,'')<>'')" : '0'} AS cost_needs_review`)
  if (access.fields.received && !simple) columns.push('(SELECT MAX(received_at) FROM product_batches rb WHERE rb.variant_product_id=p.id) AS latest_received_at')
  // A product with children is a header, not a row. The list path asks "is this id a parent of another product" once, as a set: after ANALYZE the per-row form
  // below made SQLite scan the whole parent index for every product (8,652 x 8,652 rows in the P0.1 world); the set form reads the index once.
  const leafOnly = simple ? 'p.id NOT IN (SELECT child.parent_id FROM products child WHERE child.parent_id IS NOT NULL AND child.id<>child.parent_id)'
    : 'NOT EXISTS (SELECT 1 FROM products child WHERE child.parent_id=p.id AND child.id<>p.id)'
  // Stock-free ranking keeps the stock columns as NULL so the caller can fill them for the page rows only.
  // ic_simple builds the whole-catalogue ledger once (MATERIALIZED): a stock filter makes the LEFT JOIN an inner join, and after ANALYZE SQLite then flattened the ledger into
  // the cohort and scanned ordinary_totals once per product (8,652 x 8,394 rows, three times a request). The legacy path keeps its text byte for byte.
  const ctes = (withStock: boolean) => `${withStock ? `stock AS ${simple ? 'MATERIALIZED ' : ''}(${stock.rowsSql}), ` : ''}base AS (
    SELECT ${columns.join(',')}, ${FAMILY_ROOT_KEY_SQL} AS family_key, parent.name AS parent_name,
      COALESCE(p.out_of_stock_threshold,0) AS __out, ${lowStockThresholdSql(lowStock, 'p.low_stock_threshold')} AS __low,
      ${stockColumnsSql(withStock ? 'stock' : null)},
      CASE WHEN parent.id IS NOT NULL THEN json_object('id',parent.id,'name',parent.name,'image_path',parent.image_path,'unit',parent.unit,'is_group',1) END AS __header
    FROM products p LEFT JOIN products parent ON parent.id=p.parent_id${withStock ? ' LEFT JOIN stock ON stock.product_id=p.id' : ''}
    WHERE ${stockVisibleProductSql('p')} AND ${leafOnly}
      AND (@branchId IS NULL OR EXISTS (SELECT 1 FROM branches allowed WHERE allowed.id=@branchId AND allowed.is_active=1))
  ), cohort AS MATERIALIZED (SELECT * FROM base p WHERE ${[...conditions, ...withStock ? stockConditions : []].join(' AND ')}),
    requested_ids(product_id) AS (SELECT id FROM cohort)`
  return { query, page, pageSize, branchId, params, ctes, saleClauses, stockFiltered: stockConditions.length > 0 }
}
// Earliest expiry among the product's dated lots that still hold stock in the branch scope (every branch when none).
// Read only for the returned page rows (see __page), never per cohort row; it counts the same lots as the stock ledger.
const NEXT_EXPIRY_SQL = `(SELECT MIN(pb.expiry_date) FROM product_batches pb JOIN branch_batch_stock bs ON bs.batch_id=pb.id
  WHERE pb.variant_product_id=__page.id AND bs.quantity>0 AND trim(COALESCE(pb.expiry_date,''))<>''
  AND (@branchId IS NULL OR bs.branch_id=@branchId))`
const STOCK_ROW_COLUMNS = ['invalid_quantity', 'negative_quantity', 'lot_exceeds_ordinary', 'cache_mismatch', 'invalid_allocation', 'unallocated_damaged',
  'missing_branch_allocation', 'recorded_ordinary_quantity', 'recorded_lot_quantity', 'recorded_damaged_quantity', 'recorded_cache_quantity'] as const
const PAGE_STOCK_PREFIX = '__page_stock_'
const VERIFICATION_KEYS = ['stock_consistent', 'stock_diagnostics', 'recorded_ordinary_quantity', 'recorded_lot_quantity', 'recorded_damaged_quantity', 'recorded_cache_quantity'] as const
// The page rows' stock for a session, with no verification: the branch's ordinary units and its held units (a missing branch row is 0, as the ledger counts it).
const PLAIN_SESSION_STOCK_SQL = `SELECT __page.id AS product_id,
    COALESCE((SELECT SUM(s.quantity) FROM branch_stock s WHERE s.product_id=__page.id AND (@branchId IS NULL OR s.branch_id=@branchId)),0) AS ordinary,
    COALESCE((SELECT SUM(d.quantity_remaining) FROM damaged_stock_lots d WHERE d.product_id=__page.id AND (@branchId IS NULL OR d.branch_id=@branchId)),0) AS held
  FROM __page`
const stockColumnsSql = (source: string | null, prefix = '') => [['quantity', '__quantity'], ...STOCK_ROW_COLUMNS.map(column => [column, column]), ['consistent', 'stock_consistent']]
  .map(([from, to]) => `${source ? `${source}.${from}` : 'NULL'} AS ${prefix}${to}`).join(',')

export function buildInventoryCheckProductMembershipQuery(rawQuery: Record<string, unknown>, productIds: readonly number[], access: InventoryCheckAccess, lowStock: LowStockConfig, simple?: InventoryCheckSimpleScope) {
  if (!Array.isArray(productIds) || productIds.length > 500 || productIds.some(id => !Number.isSafeInteger(id) || id <= 0)) invalid('productIds')
  const plan = population(rawQuery, access, lowStock, productIds, undefined, false, simple)
  return { rowsSql: `WITH ${plan.ctes(plan.stockFiltered)} SELECT id FROM cohort WHERE id IN (SELECT value FROM json_each(@membershipIds)) ORDER BY id`,
    params: { ...plan.params, membershipIds: JSON.stringify([...new Set(productIds)]) } }
}

async function schemaBatch(db: Pick<D1Compat, 'batch'>, statements: Array<{ sql: string; params?: BindParams }>) {
  let extra: D1Result[] = []
  let readFailure: unknown
  try {
    await readInventoryCheckStock({ batch: async probe => {
      try {
        const results = await db.batch([...probe, ...statements])
        extra = results.slice(probe.length)
        return results.slice(0, probe.length)
      } catch (error) { readFailure = error; throw error }
    } }, { productIds: [] })
  } catch (error) { throw readFailure || error }
  if (extra.length !== statements.length || extra.some(result => result.success !== true)) throw new Error('Inventory product read did not complete')
  return extra
}

export async function readInventoryCheckProductMembership(db: Pick<D1Compat, 'batch'>, user: PermissionUser, rawQuery: Record<string, unknown>, productIds: readonly number[], options: Pick<InventoryCheckProductsOptions, 'lowStock'>): Promise<number[]> {
  const plan = buildInventoryCheckProductMembershipQuery(rawQuery, productIds, getInventoryCheckAccess(user), options.lowStock)
  const result = await schemaBatch(db, [{ sql: plan.rowsSql, params: plan.params }])
  return (result[0].results || []).map(row => Number((row as { id: number }).id))
}

export async function readInventoryCheckProducts(db: Pick<D1Compat, 'batch'>, user: PermissionUser, rawQuery: Record<string, unknown>, options: InventoryCheckProductsOptions) {
  const access = getInventoryCheckAccess(user)
  const plan = population(rawQuery, access, options.lowStock, options.productIds, options.observationFilter, options.costReviewKeyAvailable === true)
  const limit = options.rankingLimit ?? 0
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 50) invalid('rankingLimit')
  if (options.customerRanking && options.customerRanking !== 'sale_count') invalid('customerRanking')
  if (options.customerRanking && !access.canViewCustomerDetails) denied('customerRanking')
  const saleWhere = [recognizedExpr('s.'), ...plan.saleClauses, plan.branchId ? 'si.branch_id=@branchId' : ''].filter(Boolean).join(' AND ')
  const identity = identifiedCustomerExpr('s.')
  const financialCtes = `ledger AS (${buildProductSalesLedgerSql({ requestedIds: true, branchScoped: !!plan.branchId, saleClauses: plan.saleClauses })}),
    buyers AS (SELECT DISTINCT si.product_id,${identity} AS customer_id,s.id AS sale_id
      FROM sale_items si JOIN sales s ON s.id=si.sale_id JOIN requested_ids wanted ON wanted.product_id=si.product_id
      WHERE ${saleWhere} AND ${identity} IS NOT NULL)`
  const customerCountsSql = 'SELECT product_id,COUNT(DISTINCT customer_id) AS customer_count FROM buyers GROUP BY product_id'
  const rankCtes = (withStock: boolean) => `${plan.ctes(withStock)}, ${financialCtes},
    product_metrics AS (SELECT c.*,COALESCE(l.qty_sold,0) AS qty_sold,
      COALESCE(bc.customer_count,0) AS customer_count
      FROM cohort c LEFT JOIN ledger l ON l.product_id=c.id
      LEFT JOIN (${customerCountsSql}) bc ON bc.product_id=c.id),
    family_buyers AS (SELECT c.family_key,COUNT(DISTINCT buyer.customer_id) AS customer_count FROM cohort c
      LEFT JOIN buyers buyer ON buyer.product_id=c.id GROUP BY c.family_key),
    family_metrics AS (SELECT c.family_key,MIN(COALESCE(c.parent_name,c.name)) AS name,SUM(c.qty_sold) AS qty_sold,MAX(fb.customer_count) AS customer_count,
      SUM(CASE WHEN c.__quantity IS NULL THEN 1 ELSE 0 END) AS unknown_count,SUM(c.__quantity) AS known_quantity,
      CASE WHEN COUNT(c.__quantity)=COUNT(*) THEN SUM(c.__quantity) END AS stock_quantity,
      MAX(CASE WHEN c.__quantity>c.__out AND c.__quantity>c.__low THEN 1 ELSE 0 END) AS healthy,
      MAX(CASE WHEN c.__quantity>c.__out AND c.__quantity<=c.__low THEN 1 ELSE 0 END) AS low,
      ${access.fields.price ? 'MAX(c.selling_price_usd)' : 'NULL'} AS price,
      ${access.fields.cost ? 'MAX(c.cost_price_usd)' : 'NULL'} AS cost,
      ${access.fields.received ? 'MAX(julianday(c.latest_received_at))' : 'NULL'} AS received_sort
      FROM product_metrics c LEFT JOIN family_buyers fb ON fb.family_key=c.family_key GROUP BY c.family_key)`
  const direction = plan.query.sortDirection === 'desc' ? 'DESC' : 'ASC'
  const sort = plan.query.sortBy || 'name'
  const numeric = { stock: 'stock_quantity', qty_sold: 'qty_sold', customer_count: 'customer_count', received_date: 'received_sort', price: 'price', cost: 'cost' }[sort]
  const productRanking = limit && access.fields.sales ? `(SELECT json_group_array(json(item)) FROM (SELECT json_object('family_key',family_key,'name',name,'qty_sold',qty_sold) AS item FROM family_metrics ORDER BY qty_sold DESC,family_key ASC LIMIT @rankingLimit))` : "'[]'"
  const customerRanking = limit && options.customerRanking ? `(SELECT json_group_array(json(item)) FROM (SELECT json_object('customer_id',buyer.customer_id,'name',COALESCE(customer.name,''),'sale_count',COUNT(DISTINCT buyer.sale_id)) AS item
    FROM buyers buyer LEFT JOIN customers customer ON customer.id=buyer.customer_id GROUP BY buyer.customer_id ORDER BY COUNT(DISTINCT buyer.sale_id) DESC,buyer.customer_id ASC LIMIT @rankingLimit))` : "'[]'"
  const facets = (field: 'brand' | 'category') => access.fields[field] ? `(SELECT json_group_array(value) FROM (SELECT DISTINCT trim(choice.value) AS value
    FROM cohort c,json_each(replace(json_array(COALESCE(c.${field},'')||'||'||COALESCE(c.${field === 'brand' ? 'brands' : 'categories'},'')),'||','","')) choice
    WHERE trim(choice.value)<>'' ORDER BY value COLLATE NOCASE,value LIMIT 201))` : "'[]'"
  const reasonFacets = options.observationFilter ? `(SELECT json_group_array(reason) FROM (SELECT DISTINCT i.reason FROM cohort c
    JOIN inventory_check_items i ON i.product_id=c.id JOIN inventory_check_sessions s ON s.id=i.session_id
    WHERE i.state='issue' AND ${observationWhere(options.observationFilter, plan.params)} ORDER BY i.reason COLLATE NOCASE,i.reason LIMIT 201))` : "'[]'"
  const summarySql = `WITH ${rankCtes(access.fields.stock)} SELECT
    (SELECT COUNT(*) FROM cohort) AS total_variants,
    (SELECT CASE WHEN COUNT(__quantity)=COUNT(*) THEN COALESCE(SUM(__quantity),0) END FROM cohort) AS stock_quantity,
    (SELECT COALESCE(SUM(__quantity),0) FROM cohort) AS known_stock_quantity,
    COALESCE(SUM(CASE WHEN unknown_count>0 THEN 1 ELSE 0 END),0) AS unknown_stock,
    COALESCE(SUM(CASE WHEN healthy=1 OR low=1 THEN 1 ELSE 0 END),0) AS in_stock,
    COALESCE(SUM(CASE WHEN healthy=1 THEN 1 ELSE 0 END),0) AS healthy,
    COALESCE(SUM(CASE WHEN healthy=0 AND unknown_count=0 AND low=1 THEN 1 ELSE 0 END),0) AS low_stock,
    COALESCE(SUM(CASE WHEN healthy=0 AND low=0 AND unknown_count=0 THEN 1 ELSE 0 END),0) AS out_of_stock,
    COALESCE(SUM(qty_sold),0) AS qty_sold,(SELECT COUNT(DISTINCT customer_id) FROM buyers) AS unique_customer_count,
    (SELECT json_group_array(json_object('id',id,'name',name)) FROM branches WHERE is_active=1) AS branches,
    (SELECT COUNT(*) FROM branches WHERE id=@branchId AND is_active=1) AS selected_branch_exists,
    ${productRanking} AS product_ranking,${customerRanking} AS customer_ranking,
    ${facets('brand')} AS brand_facets,${facets('category')} AS category_facets,${reasonFacets} AS reason_facets FROM family_metrics`
  const familyOrder = (name: string, number: string) => numeric ? `(${number} IS NULL) ASC,${number} ${direction},${name} ASC` : `${name} ${direction}`
  // Ranking by name, price, cost, date or sales needs no stock: rank stock-free, then read stock for the page rows only.
  const rankWithStock = plan.stockFiltered || sort === 'stock'
  const namePage = sort === 'name' && !plan.stockFiltered
  const namePageCtes = () => `${plan.ctes(false)}, product_metrics AS (SELECT * FROM cohort),
    family_metrics AS (SELECT DISTINCT family_key FROM cohort)`
  const pageStock = access.fields.stock && !rankWithStock ? buildInventoryCheckStockQuery({ branchId: plan.branchId }, 'SELECT id FROM __page') : null
  // A dated lot with stock shows stock exists, so the expiry follows the stock field as well as the received field.
  const showNextExpiry = access.fields.received && access.fields.stock
  let summary: Record<string, unknown> = {}
  const paged = await paginateProductFamilies<Record<string, unknown>>({
    db: { batch: async statements => {
      const pageSql = `${statements[1].sql}\nLIMIT 501`
      // Same snapshot, same order: a page family is complete on its page, so its window aggregates equal the ranking's
      // family aggregates, and family_root_id then id are the helper's own terminal keys.
      const wrappedPageSql = (pageStock || showNextExpiry || namePage) && `WITH __page AS MATERIALIZED (${pageSql})${pageStock ? `, stock AS (${pageStock.rowsSql})` : ''}${namePage ? `,
        requested_ids(product_id) AS (SELECT DISTINCT id FROM __page), ${financialCtes}` : ''}
        SELECT __page.*${pageStock ? `,${stockColumnsSql('stock', PAGE_STOCK_PREFIX)}` : ''}${showNextExpiry ? `,${NEXT_EXPIRY_SQL} AS next_expiry_date` : ''}${namePage ? ',COALESCE(l.qty_sold,0) AS qty_sold,COALESCE(bc.customer_count,0) AS customer_count' : ''}
        FROM __page${pageStock ? ' LEFT JOIN stock ON stock.product_id=__page.id' : ''}${namePage ? ` LEFT JOIN ledger l ON l.product_id=__page.id
        LEFT JOIN (${customerCountsSql}) bc ON bc.product_id=__page.id` : ''}
        WINDOW family AS (PARTITION BY __page.__family_root_id)
        ORDER BY ${familyOrder('MIN(__page.__family_name) OVER family', 'MAX(__page.__family_num) OVER family')},__page.__family_root_id ASC,__page.id ASC`
      const result = await schemaBatch(db, [statements[0], { ...statements[1], sql: wrappedPageSql || pageSql },
        { sql: summarySql, params: { ...plan.params, rankingLimit: limit } }])
      summary = (result[2].results?.[0] || {}) as Record<string, unknown>
      if (pageStock) for (const row of (result[1].results || []) as Array<Record<string, unknown>>) {
        for (const key of Object.keys(row)) if (key.startsWith(PAGE_STOCK_PREFIX)) { row[key.slice(PAGE_STOCK_PREFIX.length)] = row[key]; delete row[key] }
      }
      return result.slice(0, 2)
    } } as D1Compat,
    rankCteSql: namePage ? namePageCtes() : rankCtes(rankWithStock), selectColumns: 'c.*', joinSql: 'JOIN product_metrics c ON c.id=p.id JOIN family_metrics f ON f.family_key=c.family_key', whereSql: 'WHERE 1=1',
    params: plan.params, page: plan.page, pageSize: plan.pageSize,
    familyOrderSql: familyOrder('family_name', 'family_num_sort'),
    familyNumericSortSql: numeric ? `f.${numeric}` : undefined, intraFamilyOrderSql: 'id ASC',
  })
  if (plan.branchId && Number(summary.selected_branch_exists) !== 1) invalid('branchId')
  if (paged.items.length > 500) throw new InventoryCheckProductsLimitError()
  const items: Array<Record<string, unknown>> = [], diagnostics: Array<Record<string, unknown>> = []
  const headers = new Set<number>()
  for (const row of paged.items) {
    if (row.__header) {
      const header = JSON.parse(String(row.__header)) as Record<string, unknown>
      if (!headers.has(Number(header.id))) { headers.add(Number(header.id)); items.push({ ...projectInventoryCheckProduct(header, access), checkable: false, matches_filters: false }) }
    }
    const flags = ['invalid_quantity', 'negative_quantity', 'lot_exceeds_ordinary', 'cache_mismatch', 'invalid_allocation', 'unallocated_damaged', 'missing_branch_allocation'].filter(key => Number(row[key]) > 0)
    const projected = projectInventoryCheckProduct({ ...row, quantity: row.__quantity, display_quantity: row.__quantity,
      ...(access.fields.cost ? { cost_needs_review: Number(row.cost_needs_review) === 1 } : {}),
      damaged_quantity: row.recorded_damaged_quantity, stock_consistent: Number(row.stock_consistent) === 1, stock_diagnostics: flags.join(',') }, access)
    items.push({ ...projected, checkable: true, matches_filters: true })
    if (access.fields.stock) diagnostics.push({ product_id: row.id, stock_diagnostics: flags.join(',') })
  }
  if (items.length > 500) throw new InventoryCheckProductsLimitError()
  const stats: Record<string, unknown> = { total_products: paged.total, total_variants: Number(summary.total_variants) }
  if (access.fields.stock) for (const key of ['stock_quantity', 'known_stock_quantity', 'unknown_stock', 'in_stock', 'healthy', 'low_stock', 'out_of_stock']) stats[key] = summary[key]
  if (access.fields.sales) stats.qty_sold = Number(summary.qty_sold)
  if (access.fields.customers) stats.unique_customer_count = Number(summary.unique_customer_count)
  let issues: Array<Record<string, unknown>> | undefined
  if (options.observationFilter) {
    const params = { ...plan.params, issueProductIds: JSON.stringify(items.filter(item => item.checkable).map(item => item.id)) }
    const where = observationWhere(options.observationFilter, params)
    const result = await db.batch([{ sql: `SELECT i.product_id,i.branch_id,s.id AS session_id,s.title AS session_title,s.created_by,
      i.reason,i.revision,i.state,CASE WHEN @showIssueCounts=1 OR s.created_by=@observationViewer THEN i.counted_quantity END AS counted_quantity,
      CASE WHEN @showIssueCounts=1 OR s.created_by=@observationViewer THEN 1 ELSE 0 END AS __show_count
      FROM inventory_check_items i JOIN inventory_check_sessions s ON s.id=i.session_id
      WHERE i.product_id IN (SELECT value FROM json_each(@issueProductIds)) AND i.state='issue' AND ${where}
      ORDER BY i.product_id,s.updated_at DESC,s.id LIMIT 501`, params: { ...params, showIssueCounts: Number(access.fields.stock) } }])
    if (result[0]?.success !== true) throw new Error('Inventory issue read did not complete')
    issues = (result[0].results || []).map(value => {
      const row = value as Record<string, unknown>, { __show_count, counted_quantity, ...identity } = row
      return { ...identity, ...(Number(__show_count) === 1 ? { counted_quantity } : {}) }
    })
    if (issues.length > 500) throw new InventoryCheckProductsLimitError()
  }
  const facetValues = Object.fromEntries([['brands','brand_facets'],['categories','category_facets'],['reasons','reason_facets']].map(([key, column]) => [key, JSON.parse(String(summary[column] || '[]')) as string[]]))
  return { ...paged, items, stats, branches: JSON.parse(String(summary.branches || '[]')) as Array<{ id: number; name: string }>,
    facets: { ...(access.fields.brand ? { brands: facetValues.brands.slice(0,200) } : {}), ...(access.fields.category ? { categories: facetValues.categories.slice(0,200) } : {}), reasons: facetValues.reasons.slice(0,200) },
    facetsLimited: Object.fromEntries(Object.entries(facetValues).map(([key, values]) => [key, values.length > 200])),
    ...(issues ? { issues } : {}),
    ...(access.fields.stock ? { stockDiagnostics: diagnostics } : {}),
    ...(limit ? { rankings: { ...(access.fields.sales ? { products: JSON.parse(String(summary.product_ranking || '[]')) as unknown[] } : {}),
      ...(options.customerRanking ? { customers: JSON.parse(String(summary.customer_ranking || '[]')) as unknown[] } : {}) } } : {}) }
}

export type InventoryCheckSimpleOptions = {
  lowStock: LowStockConfig
  /** Whose checks are read: the viewer's organization and id, the session when a session is open, and the staff-name rule. */
  check: InventoryCheckSimpleScope & { viewerId: number; canSeeStaffIdentity: (accountId: number) => boolean }
}

// The latest done/issue observation and the open-session flag for the page rows only (ids come from the __page CTE of the enclosing statement).
const PAGE_CHECK_CTES = `latest AS (SELECT product_id,state,counted_quantity,reason,updated_by,updated_at,session_id,branch_id,created_by,by_name FROM (
    SELECT i.product_id,i.state,i.counted_quantity,i.reason,i.updated_by,i.updated_at,i.session_id,i.branch_id,s.created_by,u.username AS by_name,
      ROW_NUMBER() OVER (PARTITION BY i.product_id ORDER BY i.updated_at DESC,i.session_id DESC) AS rn
    FROM inventory_check_items i JOIN inventory_check_sessions s ON s.id=i.session_id LEFT JOIN users u ON u.id=i.updated_by
    WHERE i.state IN ('done','issue') AND i.product_id IN (SELECT id FROM __page) AND ${CHECK_SCOPE_SQL}) WHERE rn=1),
  open_check AS (SELECT DISTINCT i.product_id FROM inventory_check_items i JOIN inventory_check_sessions s ON s.id=i.session_id
    WHERE i.state='unstarted' AND s.status='open' AND i.product_id IN (SELECT id FROM __page) AND ${CHECK_SCOPE_SQL})`
const PAGE_CHECK_COLUMNS = `CASE WHEN __page.id IN (SELECT product_id FROM open_check) THEN 'in_check' WHEN latest.state='issue' THEN 'issue'
    WHEN latest.state='done' THEN 'ok' ELSE 'not_checked' END AS check_status,
  latest.counted_quantity AS __check_count,latest.reason AS check_note,latest.updated_by AS __check_by_id,latest.by_name AS __check_by_name,
  latest.updated_at AS check_at,latest.session_id AS check_session_id,latest.branch_id AS check_branch_id,latest.created_by AS __check_creator`

/**
 * The owner's Inventory Check list (ic_simple): the same cohort as readInventoryCheckProducts without its financial CTEs, a closed query,
 * the page rows' check facts, and (page 1 and filter changes) the four check counts plus the brand/category facets.
 * Nothing here reads sales, customers, price or cost, and nothing is written.
 */
export async function readInventoryCheckProductsSimple(db: Pick<D1Compat, 'batch'>, user: PermissionUser, rawQuery: Record<string, unknown>, options: InventoryCheckSimpleOptions) {
  const access = getInventoryCheckAccess(user), { check } = options
  if (!Number.isSafeInteger(check.viewerId) || check.viewerId <= 0) invalid('viewerId')
  const plan = population(rawQuery, access, options.lowStock, undefined, undefined, false, { organizationId: check.organizationId, sessionId: check.sessionId })
  const direction = plan.query.sortDirection === 'desc' ? 'DESC' : 'ASC'
  const byStock = (plan.query.sortBy || 'name') === 'stock'
  const familyOrder = (name: string, number: string) => byStock ? `(${number} IS NULL) ASC,${number} ${direction},${name} ASC` : `${name} ${direction}`
  const rankWithStock = plan.stockFiltered || byStock
  const inSession = !!check.sessionId
  const wantFacets = plan.query.summary !== '0'
  const wantCounts = wantFacets && !inSession
  // A session's rows show the stock Products shows: the branch's units plus its held units, read plainly for the page rows. The stock-verification ledger (every lot, the cache, the diagnostics) is not built for
  // them: the owner retired that check on 4 Nov ("no stock reread or system verification"). Drift stays the health pack's and Conflicts' job; the write-side guards are untouched.
  const plainSessionStock = inSession && access.fields.stock && !rankWithStock
  const pageStock = access.fields.stock && !rankWithStock && !inSession ? buildInventoryCheckStockQuery({ branchId: plan.branchId }, 'SELECT id FROM __page') : null
  const showNextExpiry = access.fields.received && access.fields.stock
  const facets = (field: 'brand' | 'category') => access.fields[field] ? `(SELECT json_group_array(value) FROM (SELECT DISTINCT trim(choice.value) AS value
    FROM cohort c,json_each(replace(json_array(COALESCE(c.${field},'')||'||'||COALESCE(c.${field === 'brand' ? 'brands' : 'categories'},'')),'||','","')) choice
    WHERE trim(choice.value)<>'' ORDER BY value COLLATE NOCASE,value LIMIT 201))` : "'[]'"
  const summarySql = `WITH ${plan.ctes(plan.stockFiltered)}${wantCounts ? `,
    obs AS MATERIALIZED (SELECT i.product_id,i.state,i.updated_at,i.session_id,s.status AS session_status FROM inventory_check_items i
      JOIN inventory_check_sessions s ON s.id=i.session_id WHERE i.product_id IN (SELECT id FROM cohort) AND ${CHECK_SCOPE_SQL}),
    open_check AS (SELECT DISTINCT product_id FROM obs WHERE state='unstarted' AND session_status='open'),
    latest AS (SELECT product_id,state FROM (SELECT product_id,state,ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY updated_at DESC,session_id DESC) AS rn
      FROM obs WHERE state IN ('done','issue')) WHERE rn=1)` : ''}
    SELECT (SELECT COUNT(*) FROM cohort) AS total_variants,
    ${wantCounts ? `(SELECT COUNT(*) FROM open_check) AS in_check,
    (SELECT COUNT(*) FROM latest WHERE state='done' AND product_id NOT IN (SELECT product_id FROM open_check)) AS ok,
    (SELECT COUNT(*) FROM latest WHERE state='issue' AND product_id NOT IN (SELECT product_id FROM open_check)) AS issue,` : ''}
    ${facets('brand')} AS brand_facets,${facets('category')} AS category_facets`
  const branchesSql = `SELECT (SELECT json_group_array(json_object('id',id,'name',name)) FROM branches WHERE is_active=1) AS branches,
    (SELECT COUNT(*) FROM branches WHERE id=@branchId AND is_active=1) AS selected_branch_exists`
  let branchRow: Record<string, unknown> = {}, summary: Record<string, unknown> = {}
  const paged = await paginateProductFamilies<Record<string, unknown>>({
    db: { batch: async statements => {
      const pageSql = `${statements[1].sql}\nLIMIT 501`
      const wrappedPageSql = `WITH __page AS MATERIALIZED (${pageSql})${pageStock ? `, stock AS (${pageStock.rowsSql})` : plainSessionStock ? `, stock AS (${PLAIN_SESSION_STOCK_SQL})` : ''}${inSession ? '' : `, ${PAGE_CHECK_CTES}`}
        SELECT __page.*${pageStock ? `,${stockColumnsSql('stock', PAGE_STOCK_PREFIX)}` : plainSessionStock ? ',stock.ordinary+stock.held AS __quantity,stock.held AS recorded_damaged_quantity' : ''}${showNextExpiry ? `,${NEXT_EXPIRY_SQL} AS next_expiry_date` : ''}${access.fields.received ? ',(SELECT MAX(received_at) FROM product_batches rb WHERE rb.variant_product_id=__page.id) AS latest_received_at' : ''}${inSession ? '' : `,${PAGE_CHECK_COLUMNS}`}
        FROM __page${pageStock || plainSessionStock ? ' LEFT JOIN stock ON stock.product_id=__page.id' : ''}${inSession ? '' : ' LEFT JOIN latest ON latest.product_id=__page.id'}
        WINDOW family AS (PARTITION BY __page.__family_root_id)
        ORDER BY ${familyOrder('MIN(__page.__family_name) OVER family', 'MAX(__page.__family_num) OVER family')},__page.__family_root_id ASC,__page.id ASC`
      const result = await schemaBatch(db, [statements[0], { ...statements[1], sql: wrappedPageSql }, { sql: branchesSql, params: { branchId: plan.branchId ?? null } },
        ...wantFacets ? [{ sql: summarySql, params: plan.params }] : []])
      branchRow = (result[2].results?.[0] || {}) as Record<string, unknown>
      summary = (result[3]?.results?.[0] || {}) as Record<string, unknown>
      if (pageStock) for (const row of (result[1].results || []) as Array<Record<string, unknown>>) {
        for (const key of Object.keys(row)) if (key.startsWith(PAGE_STOCK_PREFIX)) { row[key.slice(PAGE_STOCK_PREFIX.length)] = row[key]; delete row[key] }
      }
      return result.slice(0, 2)
    } } as D1Compat,
    // Ranking by name needs no stock: rank stock-free and read stock for the page rows only. A stock sort or stock filter ranks over every row's stock.
    rankCteSql: rankWithStock ? `${plan.ctes(true)}, product_metrics AS (SELECT * FROM cohort),
      family_metrics AS (SELECT c.family_key,CASE WHEN COUNT(c.__quantity)=COUNT(*) THEN SUM(c.__quantity) END AS stock_quantity FROM cohort c GROUP BY c.family_key)`
      : `${plan.ctes(false)}, product_metrics AS (SELECT * FROM cohort), family_metrics AS (SELECT DISTINCT family_key FROM cohort)`,
    selectColumns: 'c.*', joinSql: 'JOIN product_metrics c ON c.id=p.id JOIN family_metrics f ON f.family_key=c.family_key', whereSql: 'WHERE 1=1',
    params: plan.params, page: plan.page, pageSize: plan.pageSize,
    familyOrderSql: familyOrder('family_name', 'family_num_sort'),
    familyNumericSortSql: byStock ? 'f.stock_quantity' : undefined, intraFamilyOrderSql: 'id ASC',
  })
  if (plan.branchId && Number(branchRow.selected_branch_exists) !== 1) invalid('branchId')
  if (paged.items.length > 500) throw new InventoryCheckProductsLimitError()
  const items: Array<Record<string, unknown>> = [], diagnostics: Array<Record<string, unknown>> = []
  const headers = new Set<number>()
  for (const row of paged.items) {
    if (row.__header) {
      const header = JSON.parse(String(row.__header)) as Record<string, unknown>
      if (!headers.has(Number(header.id))) { headers.add(Number(header.id)); items.push({ ...projectInventoryCheckProduct(header, access, true), checkable: false, matches_filters: false }) }
    }
    const flags = ['invalid_quantity', 'negative_quantity', 'lot_exceeds_ordinary', 'cache_mismatch', 'invalid_allocation', 'unallocated_damaged', 'missing_branch_allocation'].filter(key => Number(row[key]) > 0)
    const byId = row.__check_by_id == null ? null : Number(row.__check_by_id)
    const facts = inSession ? {} : { check_status: row.check_status, check_note: row.check_note ?? null, check_at: row.check_at ?? null,
      check_session_id: row.check_session_id ?? null, check_branch_id: row.check_branch_id ?? null,
      // Counted quantities follow the stock field or the session's creator (as the Issues list always did); names follow the staff-identity rule.
      ...(row.__check_count != null && (access.fields.stock || Number(row.__check_creator) === check.viewerId) ? { check_counted_quantity: Number(row.__check_count) } : {}),
      ...(byId !== null && row.__check_by_name != null && check.canSeeStaffIdentity(byId) ? { check_by: String(row.__check_by_name) } : {}) }
    const projected = projectInventoryCheckProduct({ ...row, ...facts, quantity: row.__quantity, display_quantity: row.__quantity,
      damaged_quantity: row.recorded_damaged_quantity, ...inSession ? {} : { stock_consistent: Number(row.stock_consistent) === 1, stock_diagnostics: flags.join(',') } }, access, true)
    // The cohort carries these as NULL placeholders; a session row must not announce a verification it did not run.
    if (inSession) for (const key of VERIFICATION_KEYS) delete projected[key]
    items.push({ ...projected, checkable: true, matches_filters: true })
    if (access.fields.stock && !inSession) diagnostics.push({ product_id: row.id, stock_diagnostics: flags.join(',') })
  }
  if (items.length > 500) throw new InventoryCheckProductsLimitError()
  const known = (key: string) => Number(summary[key]) || 0
  const total = Number(summary.total_variants) || 0
  const checkCounts = wantCounts ? { in_check: known('in_check'), ok: known('ok'), issue: known('issue') } : null
  const facetValues = (column: string) => JSON.parse(String(summary[column] || '[]')) as string[]
  const brands = access.fields.brand ? facetValues('brand_facets') : [], categories = access.fields.category ? facetValues('category_facets') : []
  return { ...paged, items, simple: true, branches: JSON.parse(String(branchRow.branches || '[]')) as Array<{ id: number; name: string }>,
    ...(checkCounts ? { summary: { ...checkCounts, not_checked: Math.max(0, total - checkCounts.in_check - checkCounts.ok - checkCounts.issue), total } } : {}),
    ...(wantFacets ? { facets: { ...(access.fields.brand ? { brands: brands.slice(0, 200) } : {}), ...(access.fields.category ? { categories: categories.slice(0, 200) } : {}) },
      facetsLimited: { brands: brands.length > 200, categories: categories.length > 200 } } : {}),
    ...(access.fields.stock && !inSession ? { stockDiagnostics: diagnostics } : {}) }
}
