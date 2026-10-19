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
import type { PermissionUser } from './permissions'

export { getInventoryCheckAccess as getInventoryCheckProductsAccess } from './inventoryCheckAccess'

export type InventoryCheckProductsOptions = {
  lowStock: LowStockConfig
  rankingLimit?: number
  customerRanking?: 'sale_count'
  productIds?: readonly number[]
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

function population(rawQuery: Record<string, unknown>, access: InventoryCheckAccess, lowStock: LowStockConfig, productIds?: readonly number[], observationFilter?: InventoryCheckProductsOptions['observationFilter']) {
  if (productIds !== undefined && (!Array.isArray(productIds) || productIds.length > 500 || productIds.some(id => !Number.isSafeInteger(id) || id <= 0))) invalid('productIds')
  const query = validateInventoryCheckQuery(rawQuery, access)
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
  if (query.query) { params.nameQuery = query.query.normalize('NFC').toLowerCase(); conditions.push('(instr(lower(p.name),@nameQuery)>0 OR instr(lower(p.parent_name),@nameQuery)>0)') }
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
  if (query.stockState === 'in_stock') conditions.push('p.__quantity>p.__out')
  if (query.stockState === 'low_stock') conditions.push('p.__quantity>p.__out AND p.__quantity<=p.__low')
  if (query.stockState === 'out_of_stock') conditions.push('p.__quantity<=p.__out')
  const columns = ['p.id', 'p.name', 'p.image_path', 'p.unit', 'p.parent_id', 'p.is_group', 'p.is_grouped_cached', 'p.created_at']
  if (access.fields.barcode) columns.push('p.barcode', 'p.sku')
  if (access.fields.brand) columns.push('p.brand', 'p.brands')
  if (access.fields.category) columns.push('p.category', 'p.categories')
  if (access.fields.price) columns.push('p.selling_price_usd', 'p.selling_price_khr')
  if (access.fields.cost) columns.push('p.cost_price_usd', 'p.cost_price_khr')
  if (access.fields.received) columns.push('(SELECT MAX(received_at) FROM product_batches rb WHERE rb.variant_product_id=p.id) AS latest_received_at')
  const ctes = `stock AS (${stock.rowsSql}), base AS (
    SELECT ${columns.join(',')}, ${FAMILY_ROOT_KEY_SQL} AS family_key, parent.name AS parent_name,
      stock.quantity AS __quantity, COALESCE(p.out_of_stock_threshold,0) AS __out,
      ${lowStockThresholdSql(lowStock, 'p.low_stock_threshold')} AS __low,
      stock.invalid_quantity,stock.negative_quantity,stock.lot_exceeds_ordinary,stock.cache_mismatch,
      stock.invalid_allocation,stock.unallocated_damaged,stock.missing_branch_allocation,
      stock.recorded_ordinary_quantity,stock.recorded_lot_quantity,stock.recorded_damaged_quantity,stock.recorded_cache_quantity,stock.consistent AS stock_consistent,
      CASE WHEN parent.id IS NOT NULL THEN json_object('id',parent.id,'name',parent.name,'image_path',parent.image_path,'unit',parent.unit,'is_group',1) END AS __header
    FROM products p LEFT JOIN products parent ON parent.id=p.parent_id LEFT JOIN stock ON stock.product_id=p.id
    WHERE ${stockVisibleProductSql('p')} AND NOT EXISTS (SELECT 1 FROM products child WHERE child.parent_id=p.id AND child.id<>p.id)
      AND (@branchId IS NULL OR EXISTS (SELECT 1 FROM branches allowed WHERE allowed.id=@branchId AND allowed.is_active=1))
  ), cohort AS (SELECT * FROM base p WHERE ${conditions.join(' AND ')}),
    requested_ids(product_id) AS (SELECT id FROM cohort)`
  return { query, page, pageSize, branchId, params, ctes, saleClauses }
}

export function buildInventoryCheckProductMembershipQuery(rawQuery: Record<string, unknown>, productIds: readonly number[], access: InventoryCheckAccess, lowStock: LowStockConfig) {
  if (!Array.isArray(productIds) || productIds.length > 500 || productIds.some(id => !Number.isSafeInteger(id) || id <= 0)) invalid('productIds')
  const plan = population(rawQuery, access, lowStock, productIds)
  return { rowsSql: `WITH ${plan.ctes} SELECT id FROM cohort WHERE id IN (SELECT value FROM json_each(@membershipIds)) ORDER BY id`,
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
  const plan = population(rawQuery, access, options.lowStock, options.productIds, options.observationFilter)
  const limit = options.rankingLimit ?? 0
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 50) invalid('rankingLimit')
  if (options.customerRanking && options.customerRanking !== 'sale_count') invalid('customerRanking')
  if (options.customerRanking && !access.canViewCustomerDetails) denied('customerRanking')
  const saleWhere = [recognizedExpr('s.'), ...plan.saleClauses, plan.branchId ? 'si.branch_id=@branchId' : ''].filter(Boolean).join(' AND ')
  const identity = identifiedCustomerExpr('s.')
  const ctes = `${plan.ctes}, ledger AS (${buildProductSalesLedgerSql({ requestedIds: true, branchScoped: !!plan.branchId, saleClauses: plan.saleClauses })}),
    buyers AS (SELECT DISTINCT si.product_id,${identity} AS customer_id,s.id AS sale_id
      FROM sale_items si JOIN sales s ON s.id=si.sale_id JOIN requested_ids wanted ON wanted.product_id=si.product_id
      WHERE ${saleWhere} AND ${identity} IS NOT NULL),
    product_metrics AS (SELECT c.*,COALESCE(l.qty_sold,0) AS qty_sold,
      (SELECT COUNT(DISTINCT customer_id) FROM buyers buyer WHERE buyer.product_id=c.id) AS customer_count
      FROM cohort c LEFT JOIN ledger l ON l.product_id=c.id),
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
  const summarySql = `WITH ${ctes} SELECT
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
  let summary: Record<string, unknown> = {}
  const paged = await paginateProductFamilies<Record<string, unknown>>({
    db: { batch: async statements => {
      const result = await schemaBatch(db, [...statements.map((statement, index) => ({ ...statement, sql: index === 1 ? `${statement.sql}\nLIMIT 501` : statement.sql })),
        { sql: summarySql, params: { ...plan.params, rankingLimit: limit } }])
      summary = (result[2].results?.[0] || {}) as Record<string, unknown>
      return result.slice(0, 2)
    } } as D1Compat,
    rankCteSql: ctes, selectColumns: 'c.*', joinSql: 'JOIN product_metrics c ON c.id=p.id JOIN family_metrics f ON f.family_key=c.family_key', whereSql: 'WHERE 1=1',
    params: plan.params, page: plan.page, pageSize: plan.pageSize,
    familyOrderSql: numeric ? `(family_num_sort IS NULL) ASC,family_num_sort ${direction},family_name ASC` : `family_name ${direction}`,
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
