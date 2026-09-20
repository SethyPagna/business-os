import { getDb } from './db'
import type { Env } from '../index'
import type { SessionUser } from './auth'
import { canViewAcquisitionCosts } from './acquisitionCostAccess'
import { returnExportWindow } from './returnExportWindow'
import { buildLikeAliasClause, tokenizeSearchTermGroups } from './searchMatch'

export class ReturnStatementError extends Error {
  constructor(message: string, readonly status: 400 | 409 | 413 | 503) { super(message) }
}

const KEYS = new Set(['startDate', 'endDate', 'createdFrom', 'createdTo', 'scope', 'search', 'q', 'searchMode', 'search_mode', 'type', 'returnType', 'branchId', 'status', 'saleId', 'limit', 'cursor', 'snapshotToken', 'verify'])
const textFields = ['return_number', 'created_at', 'receipt_number', 'customer_name', 'supplier_name', 'reason', 'return_type', 'supplier_settlement', 'status']

/** Summary-only statement; no unbounded nested items or private contact fields. */
export async function readReturnStatement(env: Env, user: SessionUser, query: Record<string, string>) {
  for (const key of Object.keys(query)) if (!KEYS.has(key)) throw new ReturnStatementError(`Unsupported statement filter: ${key}`, 400)
  let window: ReturnType<typeof returnExportWindow>
  try { window = returnExportWindow(query) } catch (error) { throw new ReturnStatementError((error as Error).message, 400) }
  const positiveId = (value: string | undefined, label: string): number | null => {
    if (value === undefined || value === '') return null
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new ReturnStatementError(`Invalid ${label}`, 400)
    return Number(value)
  }
  const cursor = positiveId(query.cursor, 'statement cursor')
  const limit = positiveId(query.limit, 'statement limit') ?? 500
  if (limit > 500) throw new ReturnStatementError('Statement pages may contain at most 500 rows', 400)
  const verify = query.verify === '1'
  if (query.verify !== undefined && !['0', '1'].includes(query.verify)) throw new ReturnStatementError('Invalid verification mode', 400)
  const suppliedToken = query.snapshotToken || null
  if ((suppliedToken && !/^[a-f0-9]{64}$/.test(suppliedToken)) || ((cursor !== null || verify) && !suppliedToken) || (verify && cursor !== null)) {
    throw new ReturnStatementError('Invalid statement snapshot token or cursor', 400)
  }
  const scope = query.scope || 'customer'
  if (!['customer', 'supplier', 'all'].includes(scope)) throw new ReturnStatementError('Invalid return scope', 400)
  const search = String(query.search || query.q || '').trim().toLowerCase()
  const mode = String(query.searchMode || query.search_mode || 'AND').toUpperCase()
  if (search.length > 1000 || !['AND', 'OR'].includes(mode)) throw new ReturnStatementError('Invalid statement search', 400)
  const types = [...new Set(String(query.type || query.returnType || '').split(',').map(value => value.trim().toLowerCase()).filter(value => value && value !== 'all'))].sort()
  if (types.length > 20 || types.some(value => value.length > 64)) throw new ReturnStatementError('Invalid statement types', 400)
  const branchId = positiveId(query.branchId, 'branch'), saleId = positiveId(query.saleId, 'sale')
  const status = String(query.status || '').trim().toLowerCase()
  if (status && !['all', 'completed', 'cancelled', 'pending'].includes(status)) throw new ReturnStatementError('Invalid return status', 400)
  const identity = { ...window, scope, search, mode, types, branchId, saleId, status: status === 'all' ? '' : status }
  const params: Record<string, unknown> = { ...window, cursor: cursor ?? 0, take: verify ? 0 : limit + 1 }
  const where = ['datetime(r.created_at) >= @createdFrom AND datetime(r.created_at) < @createdTo']
  if (scope !== 'all') { where.push("COALESCE(r.return_scope, 'customer') = @scope"); params.scope = scope }
  for (const [key, value, column] of [['branchId', branchId, 'branch_id'], ['saleId', saleId, 'sale_id']] as const) {
    if (value !== null) { where.push(`r.${column} = @${key}`); params[key] = value }
  }
  if (identity.status) { where.push('lower(r.status) = @status'); params.status = identity.status }
  if (types.length) {
    const keys = types.map((value, i) => { params[`type${i}`] = value; return `@type${i}` })
    where.push(`lower(COALESCE(r.${scope === 'supplier' ? 'supplier_settlement' : 'return_type'}, '${scope === 'supplier' ? 'refund' : 'manual'}')) IN (${keys.join(',')})`)
  }
  const flat = `(${['search_normalized', 'return_number', 'receipt_number', 'cashier_name', 'customer_name', 'supplier_name', 'reason', 'notes', 'return_type', 'supplier_settlement'].map(field => `COALESCE(r.${field}, '')`).join(" || ' ' || ")} || ' ' || CAST(r.id AS TEXT))`
  const item = `(COALESCE(rii.product_name,'') || ' ' || COALESCE(rip.sku,'') || ' ' || COALESCE(rip.barcode,'') || ' ' || COALESCE(rip.brand,'') || ' ' || COALESCE(rip.name_normalized,'') || ' ' || COALESCE(rip.brand_compact,''))`
  const groups = tokenizeSearchTermGroups(search).map((words, g) => '(' + words.map((word, w) => {
    const a = buildLikeAliasClause(word, [flat], params, `ex${g}_${w}f`, true)
    const b = buildLikeAliasClause(word, [item], params, `ex${g}_${w}i`, true)
    return `(${a} OR EXISTS (SELECT 1 FROM return_items rii LEFT JOIN products rip ON rip.id=rii.product_id WHERE rii.return_id=r.id AND ${b}))`
  }).join(' AND ') + ')')
  if (groups.length) where.push('(' + groups.join(` ${mode} `) + ')')
  const costView = canViewAcquisitionCosts(user)
  const fields = ["'id',r.id", "'return_scope',r.return_scope", ...textFields.map(field => `'${field}',${field === 'customer_name' ? 'CASE WHEN anonymous_customer THEN NULL ELSE r.customer_name END' : `r.${field}`}`),
    "'customer_is_anonymous',anonymous_customer", "'replacement_receipt_number',replacement_receipt_number", "'damaged_item_count',damaged_item_count",
    "'total_refund_usd',r.total_refund_usd", "'total_refund_khr',r.total_refund_khr",
    ...(costView ? ["'supplier_compensation_usd',r.supplier_compensation_usd", "'supplier_compensation_khr',r.supplier_compensation_khr", "'supplier_loss_usd',r.supplier_loss_usd", "'supplier_loss_khr',r.supplier_loss_khr"] : [])]
  // A row whose selected text exceeds 16K characters fails the whole page;
  // never truncate statement text or materialize arbitrary-size item arrays.
  const textSize = textFields.map(field => `length(COALESCE(r.${field},''))`).concat("length(COALESCE(replacement_receipt_number,''))").join('+')
  let snapshot: { generation: string | null; revision: string | null; maintenance: number; total: number; rows_json: string } | undefined
  try {
    snapshot = await getDb(env).prepare(`WITH
      metadata AS (SELECT
        (SELECT value FROM system_flags WHERE key='business_dataset_generation') AS generation,
        (SELECT value FROM system_flags WHERE key='returns_export_revision') AS revision,
        EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance') AS maintenance),
      cohort AS (SELECT r.* FROM returns r WHERE ${where.join(' AND ')}),
      page AS (SELECT r.*,
        EXISTS(SELECT 1 FROM customers c WHERE c.id=r.customer_id AND c.is_anonymous=1) AS anonymous_customer,
        (SELECT s.receipt_number FROM sales s WHERE s.id=r.replacement_sale_id) AS replacement_receipt_number,
        (SELECT COUNT(*) FROM return_items i WHERE i.return_id=r.id AND lower(COALESCE(i.stock_action,''))='damaged') AS damaged_item_count
        FROM cohort r WHERE r.id > @cursor ORDER BY r.id ASC LIMIT @take)
      SELECT metadata.*, (SELECT COUNT(*) FROM cohort) AS total,
        (SELECT json_group_array(json(CASE WHEN ${textSize} > 16384 THEN '{"oversize":true}' ELSE json_object(${fields.join(',')}) END)) FROM page r) AS rows_json
      FROM metadata`).get<typeof snapshot>(params)
  } catch { throw new ReturnStatementError('Return statement tracking is unavailable; no export was produced', 503) }
  if (!snapshot || snapshot.maintenance) throw new ReturnStatementError('Return statements are unavailable during dataset maintenance', 503)
  let generation: unknown, revision: unknown
  try { generation = JSON.parse(snapshot.generation || 'null')?.generation; revision = JSON.parse(snapshot.revision || 'null')?.revision } catch { /* denied below */ }
  if (typeof generation !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(generation)
    || !Number.isSafeInteger(revision) || (revision as number) < 0 || !Number.isSafeInteger(snapshot.total) || snapshot.total < 0) {
    throw new ReturnStatementError('Return statement tracking is invalid; no export was produced', 503)
  }
  if (!Number.isSafeInteger(user.id) || user.id <= 0) throw new ReturnStatementError('Invalid statement actor', 409)
  const authority = [user.id, user.organization_id, user.role_id, user.role_code, user.permissions, user.role_permissions, costView]
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([1, generation, revision, identity, authority, snapshot.total])))
  const snapshotToken = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  if (suppliedToken && suppliedToken !== snapshotToken) throw new ReturnStatementError('Return statement changed; restart the download', 409)
  const rows = JSON.parse(snapshot.rows_json) as Array<Record<string, unknown>>
  if (rows.some(row => row.oversize) || new TextEncoder().encode(snapshot.rows_json).byteLength > 2_000_000) throw new ReturnStatementError('Return statement page is too large; use a smaller page or range', 413)
  const hasMore = rows.length > limit
  if (hasMore) rows.pop()
  return { rows, total: snapshot.total, snapshotToken, nextCursor: hasMore ? String(rows[rows.length - 1].id) : null }
}
