import type { D1Compat } from './db'

export const SALE_INCIDENT_RECOVERY_TARGET = 'sale-zero-items-20260909-v1' as const
export const SALE_INCIDENT_RECOVERY_CONFIRMATION = 'RECOVER SALES 16951 16952 16953' as const
export const SALE_INCIDENT_RECOVERY_BACKUP_TABLES = Object.freeze([
  'products', 'product_batches', 'branch_stock', 'branch_batch_stock',
  'sales', 'sale_items', 'sale_item_batch_allocations', 'inventory_movements',
  'action_history', 'sale_write_revisions', 'sale_incident_recovery_receipts',
  'sale_incident_recovery_members', 'audit_logs',
] as const)

type Statement = { sql: string; params?: Record<string, unknown> }
type Actor = { id?: unknown; name?: unknown }

type LineSpec = {
  product_id: number
  product_name: string
  quantity: number
  applied_price_usd: number
  applied_price_khr: number
  cost_price_usd: number
  cost_price_khr: number
  total_usd: number
  total_khr: number
  batch_id: number
  batch_label: string
  batch_stock_id: number
  allocation_released: boolean
}

type TargetSpec = {
  id: number
  receipt_number: string
  status: 'completed' | 'awaiting_payment'
  expected_revision: number
  expected_updated_at: string
  expected_amendments: number
  expected_mutation_receipts: number
  lines: LineSpec[]
  restore_money?: { subtotal_usd: number; subtotal_khr: number; total_usd: number; total_khr: number }
}

const TARGETS: readonly TargetSpec[] = Object.freeze([
  {
    id: 16951, receipt_number: '20260909-101913', status: 'completed', expected_revision: 1,
    expected_updated_at: '2026-09-09 03:19:13', expected_amendments: 0, expected_mutation_receipts: 0,
    lines: [{
      product_id: 4208, product_name: 'Maybelline Loose Powder 05', quantity: 36,
      applied_price_usd: 9.5, applied_price_khr: 38618, cost_price_usd: 9.55,
      cost_price_khr: 0, total_usd: 342, total_khr: 1390230,
      batch_id: 61143, batch_label: '09082026', batch_stock_id: 77975,
      allocation_released: false,
    }],
  },
  {
    id: 16952, receipt_number: '20260909-104116', status: 'awaiting_payment', expected_revision: 6,
    expected_updated_at: '2026-09-09T03:55:19.857Z', expected_amendments: 2, expected_mutation_receipts: 2,
    restore_money: { subtotal_usd: 299, subtotal_khr: 1215435, total_usd: 299, total_khr: 1215435 },
    lines: [{
      product_id: 859, product_name: 'Chanel Set Limited', quantity: 1,
      applied_price_usd: 299, applied_price_khr: 1215435, cost_price_usd: 280,
      cost_price_khr: 0, total_usd: 299, total_khr: 1215435,
      batch_id: 53462, batch_label: 'ADJ09/02/2026', batch_stock_id: 62711,
      allocation_released: true,
    }],
  },
  {
    id: 16953, receipt_number: '20260909-111455', status: 'awaiting_payment', expected_revision: 1,
    expected_updated_at: '2026-09-09 04:14:55', expected_amendments: 0, expected_mutation_receipts: 0,
    lines: [
      {
        product_id: 409, product_name: 'Canmake Eyeliner Dark Brown 03', quantity: 1,
        applied_price_usd: 13, applied_price_khr: 52845, cost_price_usd: 6.5,
        cost_price_khr: 0, total_usd: 13, total_khr: 52845,
        batch_id: 51466, batch_label: 'ADJ09/02/2026', batch_stock_id: 58719,
        allocation_released: true,
      },
      {
        product_id: 3490, product_name: 'Lancôme Idole Mascara 8ml', quantity: 1,
        applied_price_usd: 27, applied_price_khr: 109755, cost_price_usd: 18,
        cost_price_khr: 0, total_usd: 27, total_khr: 109755,
        batch_id: 51280, batch_label: 'ADJ09/02/2026', batch_stock_id: 58347,
        allocation_released: true,
      },
    ],
  },
])

const PRODUCT_FINGERPRINTS = Object.freeze({
  409: { updated_at: '2026-09-08 08:45:26', stock_quantity: 9, branch_quantity: 3, cost_price_usd: 6.5, cost_price_khr: 0, batch_quantity: 3 },
  859: { updated_at: '2026-09-02T15:30:00.000Z', stock_quantity: 1, branch_quantity: 1, cost_price_usd: 280, cost_price_khr: 0, batch_quantity: 1 },
  3490: { updated_at: '2026-09-02T15:30:00.000Z', stock_quantity: 3, branch_quantity: 3, cost_price_usd: 18, cost_price_khr: 0, batch_quantity: 3 },
  4208: { updated_at: '2026-09-08T15:19:49.111Z', stock_quantity: 288, branch_quantity: 96, cost_price_usd: 9.55, cost_price_khr: 0, batch_quantity: 96 },
} as const)

const REQUEST_KEYS = Object.freeze(['target', 'confirmation', 'manifest_sha256'])
const SALE_COLUMNS = Object.freeze([
  'id', 'receipt_number', 'client_request_id', 'cashier_id', 'branch_id', 'customer_id',
  'payment_method', 'payment_details', 'payment_currency', 'exchange_rate',
  'subtotal_usd', 'subtotal_khr', 'discount_usd', 'discount_khr', 'tax_usd', 'tax_khr',
  'total_usd', 'total_khr', 'amount_paid_usd', 'amount_paid_khr', 'change_usd', 'change_khr',
  'change_is_actual', 'change_exchange_rate', 'membership_discount_usd', 'membership_discount_khr',
  'membership_points_redeemed', 'is_delivery', 'delivery_contact_id', 'delivery_fee_usd',
  'delivery_fee_khr', 'delivery_fee_paid_by', 'delivery_actual_cost_usd', 'delivery_actual_cost_khr',
  'loyalty_accrual', 'sale_status', 'stock_skipped', 'created_at', 'updated_at', 'creation_snapshot_json',
] as const)

export type SaleIncidentRecoveryRequest = {
  target: typeof SALE_INCIDENT_RECOVERY_TARGET
  confirmation: typeof SALE_INCIDENT_RECOVERY_CONFIRMATION
  manifest_sha256: string
}

export class SaleIncidentRecoveryValidationError extends Error {}
export class SaleIncidentRecoveryConflictError extends Error {}
export class SaleIncidentRecoveryUncertainError extends Error {
  constructor(public readonly operationId: string, public readonly manifestSha256: string) {
    super('The recovery request may have committed, but its durable receipt could not be read. Retry the exact held request before taking any other action.')
  }
}

function validation(message: string): never { throw new SaleIncidentRecoveryValidationError(message) }
function conflict(message: string): never { throw new SaleIncidentRecoveryConflictError(message) }

function exactRequest(raw: unknown): SaleIncidentRecoveryRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) validation('request must be an object')
  const value = raw as Record<string, unknown>
  const actual = Object.keys(value).sort()
  const expected = [...REQUEST_KEYS].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    validation(`request must contain exactly: ${REQUEST_KEYS.join(', ')}`)
  }
  if (value.target !== SALE_INCIDENT_RECOVERY_TARGET) validation('invalid recovery target')
  if (value.confirmation !== SALE_INCIDENT_RECOVERY_CONFIRMATION) validation('invalid confirmation phrase')
  if (typeof value.manifest_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.manifest_sha256)) {
    validation('manifest_sha256 must be a lowercase SHA-256 digest')
  }
  return value as SaleIncidentRecoveryRequest
}

function actorIdentity(actor: Actor) {
  if (!Number.isSafeInteger(actor.id) || Number(actor.id) < 1) validation('authenticated actor id is required')
  if (typeof actor.name !== 'string' || !actor.name.trim() || actor.name.length > 120) validation('authenticated actor name is required')
  return { id: Number(actor.id), name: actor.name }
}

async function sha256(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function readReceipt(db: Pick<D1Compat, 'prepare'>) {
  try {
    return await db.prepare(`SELECT id,request_digest,response_json,after_json FROM sale_incident_recovery_receipts
      WHERE incident_key=@incident`).get<{ id: string; request_digest: string; response_json: string; after_json: string }>({ incident: SALE_INCIDENT_RECOVERY_TARGET })
  } catch (error) {
    if (/no such table/i.test(error instanceof Error ? error.message : String(error))) {
      conflict('Migration 0145 is not applied. No data was changed.')
    }
    throw error
  }
}

function expectedRevisionAfter(target: TargetSpec): number {
  return target.expected_revision + target.lines.length * 2 + (target.restore_money ? 1 : 0)
}

async function readCanonicalManifest(db: Pick<D1Compat, 'prepare'>) {
  const ids = TARGETS.map((target) => target.id).join(',')
  const productIds = TARGETS.flatMap((target) => target.lines.map((line) => line.product_id)).sort((a, b) => a - b)
  const batchIds = TARGETS.flatMap((target) => target.lines.map((line) => line.batch_id)).sort((a, b) => a - b)
  const [sales, products, positiveLots, effects, amendments] = await Promise.all([
    db.prepare(`SELECT ${SALE_COLUMNS.map((column) => `s.${column}`).join(',')},r.revision
      FROM sales s LEFT JOIN sale_write_revisions r ON r.sale_id=s.id
      WHERE s.id IN (${ids}) ORDER BY s.id`).all<Record<string, unknown>>(),
    db.prepare(`SELECT p.id,p.name,p.is_active,p.cost_price_usd,p.cost_price_khr,p.stock_quantity,p.updated_at,
      bs.id AS branch_stock_id,bs.quantity AS branch_quantity,bs.rfid_confirmed_qty
      FROM products p LEFT JOIN branch_stock bs ON bs.product_id=p.id AND bs.branch_id=2
      WHERE p.id IN (${productIds.join(',')}) ORDER BY p.id`).all<Record<string, unknown>>(),
    db.prepare(`SELECT pb.id,pb.variant_product_id,pb.is_active,pb.received_at,pb.created_at,pb.updated_at,
      pb.batch_number,pb.lot_code,pb.expiry_date,pb.unit_cost_usd,pb.received_quantity,
      bbs.id AS branch_batch_stock_id,bbs.quantity AS branch_quantity,bbs.updated_at AS branch_updated_at
      FROM product_batches pb JOIN branch_batch_stock bbs ON bbs.batch_id=pb.id AND bbs.branch_id=2
      WHERE pb.variant_product_id IN (${productIds.join(',')}) AND pb.is_active=1 AND bbs.quantity>0
      ORDER BY pb.variant_product_id,pb.id`).all<Record<string, unknown>>(),
    db.prepare(`SELECT s.id,
      (SELECT COUNT(*) FROM sale_items WHERE sale_id=s.id) AS item_count,
      (SELECT COUNT(*) FROM sale_item_batch_allocations a JOIN sale_items si ON si.id=a.sale_item_id WHERE si.sale_id=s.id) AS allocation_count,
      (SELECT COUNT(*) FROM inventory_movements WHERE reference_id=s.id AND movement_type IN ('sale','sale_from_damaged')) AS movement_count,
      (SELECT COUNT(*) FROM returns WHERE sale_id=s.id) AS return_count,
      (SELECT COUNT(*) FROM fees WHERE sale_id=s.id OR id=s.cancel_fee_id) AS fee_count,
      (SELECT COUNT(*) FROM sale_record_events WHERE sale_id=s.id) AS record_event_count,
      (SELECT COUNT(*) FROM sale_amendments WHERE sale_id=s.id) AS amendment_count,
      (SELECT COUNT(*) FROM sale_mutation_receipts WHERE sale_id=s.id) AS mutation_receipt_count,
      (SELECT COUNT(*) FROM audit_logs WHERE entity='sale' AND entity_id=CAST(s.id AS TEXT)) AS sale_audit_count,
      (SELECT COUNT(*) FROM action_history WHERE entity='sale_incident_recovery' AND entity_id=CAST(s.id AS TEXT)) AS recovery_history_count
      FROM sales s WHERE s.id IN (${ids}) ORDER BY s.id`).all<Record<string, unknown>>(),
    db.prepare(`SELECT id,sale_id,kind,amount_before_usd,amount_after_usd,total_before_usd,total_after_usd,created_at
      FROM sale_amendments WHERE sale_id IN (${ids}) ORDER BY id`).all<Record<string, unknown>>(),
  ])
  return {
    schema_version: 1,
    target: SALE_INCIDENT_RECOVERY_TARGET,
    sales,
    products,
    positive_lots: positiveLots,
    effects,
    amendments,
    recovery: TARGETS.map((target) => ({
      id: target.id,
      receipt_number: target.receipt_number,
      status: target.status,
      expected_revision: target.expected_revision,
      expected_revision_after: expectedRevisionAfter(target),
      restore_money: target.restore_money || null,
      lines: target.lines,
    })),
    unknown_line_fields: ['price_mode', 'base_price_usd', 'base_price_khr'],
    allocation_basis: 'recovery_time_unique_positive_lot_not_historical_proof',
  }
}

type CanonicalManifest = Awaited<ReturnType<typeof readCanonicalManifest>>

export type PreparedSaleIncidentRecovery = {
  outcome: 'apply' | 'already_applied'
  request: SaleIncidentRecoveryRequest
  identity: { id: number; name: string }
  manifest: CanonicalManifest | null
  statements: Statement[]
  operationId: string
}

function assertExpected(manifest: Awaited<ReturnType<typeof readCanonicalManifest>>) {
  if (manifest.sales.length !== TARGETS.length || manifest.effects.length !== TARGETS.length) conflict('One or more fixed sale targets are missing.')
  const saleById = new Map(manifest.sales.map((row) => [Number(row.id), row]))
  const effectsById = new Map(manifest.effects.map((row) => [Number(row.id), row]))
  for (const target of TARGETS) {
    const sale = saleById.get(target.id)
    const effect = effectsById.get(target.id)
    if (!sale || sale.receipt_number !== target.receipt_number || sale.sale_status !== target.status
      || Number(sale.revision) !== target.expected_revision || sale.updated_at !== target.expected_updated_at) {
      conflict(`Sale ${target.id} changed from its reviewed header/revision fingerprint.`)
    }
    let snapshot: { origin?: unknown; products?: Array<Record<string, unknown>> } = {}
    try { snapshot = JSON.parse(String(sale.creation_snapshot_json || '')) } catch { conflict(`Sale ${target.id} has an invalid creation snapshot.`) }
    if (snapshot.origin !== 'pos' || !Array.isArray(snapshot.products) || snapshot.products.length !== target.lines.length
      || target.lines.some((line, index) => {
        const saved = snapshot.products?.[index]
        return Number(saved?.product_id) !== line.product_id || saved?.product !== line.product_name
          || Number(saved?.quantity) !== line.quantity || Number(saved?.unit_price_usd) !== line.applied_price_usd
          || Number(saved?.line_total_usd) !== line.total_usd
      })) conflict(`Sale ${target.id} creation snapshot no longer matches the reviewed basket.`)
    if (!effect || Number(effect.item_count) !== 0 || Number(effect.allocation_count) !== 0
      || Number(effect.movement_count) !== 0 || Number(effect.return_count) !== 0
      || Number(effect.fee_count) !== 0 || Number(effect.record_event_count) !== 0
      || Number(effect.amendment_count) !== target.expected_amendments
      || Number(effect.mutation_receipt_count) !== target.expected_mutation_receipts
      || Number(effect.sale_audit_count) !== 0 || Number(effect.recovery_history_count) !== 0) {
      conflict(`Sale ${target.id} no longer has the reviewed zero-effect state.`)
    }
    if (target.restore_money) {
      if (Number(sale.delivery_fee_usd) !== 2.7 || Number(sale.delivery_actual_cost_usd) !== 2.7
        || Number(sale.subtotal_usd) !== 0 || Number(sale.total_usd) !== 0) {
        conflict('Sale 16952 no longer preserves the reviewed delivery edits and itemless money fallout.')
      }
    }
  }
  const products = new Map(manifest.products.map((row) => [Number(row.id), row]))
  const lots = new Map(manifest.positive_lots.map((row) => [Number(row.variant_product_id), row]))
  if (manifest.products.length !== 4 || manifest.positive_lots.length !== 4) conflict('The reviewed product or unique-positive-lot set changed.')
  for (const target of TARGETS) for (const line of target.lines) {
    const product = products.get(line.product_id)
    const lot = lots.get(line.product_id)
    const expected = PRODUCT_FINGERPRINTS[line.product_id as keyof typeof PRODUCT_FINGERPRINTS]
    if (!product || product.name !== line.product_name || Number(product.is_active) !== 1
      || product.updated_at !== expected.updated_at || Number(product.stock_quantity) !== expected.stock_quantity
      || Number(product.branch_quantity) !== expected.branch_quantity
      || Number(product.cost_price_usd) !== expected.cost_price_usd || Number(product.cost_price_khr) !== expected.cost_price_khr) {
      conflict(`Product ${line.product_id} changed from the reviewed cost/stock fingerprint.`)
    }
    if (!lot || Number(lot.id) !== line.batch_id || Number(lot.branch_batch_stock_id) !== line.batch_stock_id
      || lot.lot_code !== line.batch_label || Number(lot.branch_quantity) !== expected.batch_quantity) {
      conflict(`Product ${line.product_id} no longer has the reviewed unique positive Shop lot.`)
    }
  }
  if (manifest.amendments.length !== 2
    || Number(manifest.amendments[0]?.id) !== 13 || manifest.amendments[0]?.kind !== 'delivery_actual_cost_changed'
    || Number(manifest.amendments[0]?.amount_after_usd) !== 2.7 || Number(manifest.amendments[0]?.total_after_usd) !== 299
    || Number(manifest.amendments[1]?.id) !== 14 || manifest.amendments[1]?.kind !== 'delivery_fee_changed'
    || Number(manifest.amendments[1]?.amount_after_usd) !== 2.7 || Number(manifest.amendments[1]?.total_after_usd) !== 0) {
    conflict('Sale 16952 amendment evidence changed from the reviewed sequence.')
  }
}

function previewSales() {
  return TARGETS.map((target) => ({
    id: target.id,
    receipt_number: target.receipt_number,
    status: target.status,
    expected_revision: target.expected_revision,
    line_count: target.lines.length,
    stock_effect: target.status === 'completed' ? 'deduct_now' : 'released_allocation_only',
    subtotal_before_usd: target.id === 16952 ? 0 : target.lines.reduce((sum, line) => sum + line.total_usd, 0),
    subtotal_after_usd: target.lines.reduce((sum, line) => sum + line.total_usd, 0),
    total_before_usd: target.id === 16952 ? 0 : target.lines.reduce((sum, line) => sum + line.total_usd, 0),
    total_after_usd: target.lines.reduce((sum, line) => sum + line.total_usd, 0),
  }))
}

const BLOCKED_SALES = Object.freeze([{
  id: 16954,
  receipt_number: '20260909-130228',
  reason: 'sale_time_cost_not_proven',
}] as const)

export async function previewSaleIncidentRecovery(db: Pick<D1Compat, 'prepare'>, actor: Actor) {
  actorIdentity(actor)
  const receipt = await readReceipt(db)
  if (receipt) {
    return {
      success: true as const,
      target: SALE_INCIDENT_RECOVERY_TARGET,
      outcome: 'already_applied' as const,
      request: { target: SALE_INCIDENT_RECOVERY_TARGET, confirmation: SALE_INCIDENT_RECOVERY_CONFIRMATION, manifest_sha256: receipt.request_digest },
      sales: previewSales(),
      blocked_sales: BLOCKED_SALES,
      unknown_line_fields: ['price_mode', 'base_price_usd', 'base_price_khr'],
      allocation_basis: 'recovery_time_unique_positive_lot_not_historical_proof',
    }
  }
  const manifest = await readCanonicalManifest(db)
  assertExpected(manifest)
  const digest = await sha256(JSON.stringify(manifest))
  return {
    success: true as const,
    target: SALE_INCIDENT_RECOVERY_TARGET,
    outcome: 'apply' as const,
    request: { target: SALE_INCIDENT_RECOVERY_TARGET, confirmation: SALE_INCIDENT_RECOVERY_CONFIRMATION, manifest_sha256: digest },
    sales: previewSales(),
    blocked_sales: BLOCKED_SALES,
    unknown_line_fields: manifest.unknown_line_fields,
    allocation_basis: manifest.allocation_basis,
  }
}

export async function prepareSaleIncidentRecovery(db: Pick<D1Compat, 'prepare'>, rawRequest: unknown, actor: Actor): Promise<PreparedSaleIncidentRecovery> {
  const request = exactRequest(rawRequest)
  const identity = actorIdentity(actor)
  const receipt = await readReceipt(db)
  if (receipt) {
    if (receipt.request_digest !== request.manifest_sha256) conflict('A different recovery receipt already exists. Fetch a new preview.')
    return { outcome: 'already_applied' as const, request, identity, manifest: null, statements: [] as Statement[], operationId: receipt.id }
  }
  const manifest = await readCanonicalManifest(db)
  assertExpected(manifest)
  const digest = await sha256(JSON.stringify(manifest))
  if (digest !== request.manifest_sha256) conflict('Recovery state changed after preview. Fetch a new preview.')
  const operationId = crypto.randomUUID()
  return { outcome: 'apply' as const, request, identity, manifest, statements: buildStatements(manifest, request, identity, operationId), operationId }
}

function buildStatements(
  manifest: CanonicalManifest,
  request: SaleIncidentRecoveryRequest,
  actor: { id: number; name: string },
  operationId: string,
): Statement[] {
  const response = {
    success: true, outcome: 'applied', operation_id: operationId, manifest_sha256: request.manifest_sha256,
    affected: { sales: 3, items: 4, allocations: 4, movements: 1, histories: 3, audits: 3 },
  }
  const statements: Statement[] = [{
    sql: `INSERT INTO sale_incident_recovery_guards(id,guard_value)
      SELECT 1,CASE WHEN
        NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
        AND (SELECT COUNT(*) FROM sale_incident_recovery_receipts WHERE incident_key=@incident)=0
        AND (SELECT COUNT(*) FROM sales WHERE id IN (16951,16952,16953))=3
        AND (SELECT COUNT(*) FROM sale_items WHERE sale_id IN (16951,16952,16953))=0
        AND (SELECT COUNT(*) FROM sale_item_batch_allocations a JOIN sale_items si ON si.id=a.sale_item_id WHERE si.sale_id IN (16951,16952,16953))=0
        AND (SELECT COUNT(*) FROM inventory_movements WHERE reference_id IN (16951,16952,16953) AND movement_type IN ('sale','sale_from_damaged'))=0
        AND (SELECT COUNT(*) FROM returns WHERE sale_id IN (16951,16952,16953))=0
        AND (SELECT COUNT(*) FROM sale_record_events WHERE sale_id IN (16951,16952,16953))=0
        AND (SELECT COUNT(*) FROM audit_logs WHERE entity='sale' AND entity_id IN ('16951','16952','16953'))=0
        AND (SELECT COUNT(*) FROM action_history WHERE entity='sale_incident_recovery' AND entity_id IN ('16951','16952','16953'))=0
        AND (SELECT group_concat(value,'|') FROM (SELECT s.id||':'||r.revision||':'||s.updated_at AS value FROM sales s JOIN sale_write_revisions r ON r.sale_id=s.id WHERE s.id IN (16951,16952,16953) ORDER BY s.id))=@sale_guard
        AND (SELECT group_concat(value,'|') FROM (SELECT p.id||':'||p.name||':'||p.is_active||':'||p.cost_price_usd||':'||p.cost_price_khr||':'||p.stock_quantity||':'||p.updated_at||':'||bs.quantity AS value FROM products p JOIN branch_stock bs ON bs.product_id=p.id AND bs.branch_id=2 WHERE p.id IN (409,859,3490,4208) ORDER BY p.id))=@product_guard
        AND (SELECT group_concat(value,'|') FROM (SELECT pb.variant_product_id||':'||pb.id||':'||bbs.id||':'||pb.lot_code||':'||bbs.quantity AS value FROM product_batches pb JOIN branch_batch_stock bbs ON bbs.batch_id=pb.id AND bbs.branch_id=2 WHERE pb.variant_product_id IN (409,859,3490,4208) AND pb.is_active=1 AND bbs.quantity>0 ORDER BY pb.variant_product_id))=@lot_guard
        AND (SELECT group_concat(value,'|') FROM (SELECT s.id||':'||(SELECT COUNT(*) FROM sale_amendments WHERE sale_id=s.id)||':'||(SELECT COUNT(*) FROM sale_mutation_receipts WHERE sale_id=s.id) AS value FROM sales s WHERE s.id IN (16951,16952,16953) ORDER BY s.id))='16951:0:0|16952:2:2|16953:0:0'
        AND (SELECT delivery_fee_usd||':'||delivery_actual_cost_usd||':'||subtotal_usd||':'||total_usd FROM sales WHERE id=16952)='2.7:2.7:0.0:0.0'
        THEN 1 ELSE 0 END`,
    params: {
      incident: SALE_INCIDENT_RECOVERY_TARGET,
      sale_guard: '16951:1:2026-09-09 03:19:13|16952:6:2026-09-09T03:55:19.857Z|16953:1:2026-09-09 04:14:55',
      product_guard: '409:Canmake Eyeliner Dark Brown 03:1:6.5:0.0:9.0:2026-09-08 08:45:26:3.0|859:Chanel Set Limited:1:280.0:0.0:1.0:2026-09-02T15:30:00.000Z:1.0|3490:Lancôme Idole Mascara 8ml:1:18.0:0.0:3.0:2026-09-02T15:30:00.000Z:3.0|4208:Maybelline Loose Powder 05:1:9.55:0.0:288.0:2026-09-08T15:19:49.111Z:96.0',
      lot_guard: '409:51466:58719:ADJ09/02/2026:3.0|859:53462:62711:ADJ09/02/2026:1.0|3490:51280:58347:ADJ09/02/2026:3.0|4208:61143:77975:09082026:96.0',
    },
  }, {
    sql: `INSERT INTO sale_incident_recovery_receipts(id,incident_key,actor_id,actor_name,request_digest,request_json,before_json,after_json,response_json,backup_created)
      VALUES(@id,@incident,@actor_id,@actor_name,@digest,@request,@before,@after,@response,1)`,
    params: {
      id: operationId, incident: SALE_INCIDENT_RECOVERY_TARGET, actor_id: actor.id, actor_name: actor.name,
      digest: request.manifest_sha256, request: JSON.stringify(request), before: JSON.stringify(manifest),
      after: JSON.stringify({ target: SALE_INCIDENT_RECOVERY_TARGET, expected_revisions: { 16951: 3, 16952: 9, 16953: 5 } }),
      response: JSON.stringify(response),
    },
  }]

  for (const target of TARGETS) {
    if (target.restore_money) {
      statements.push({
        sql: `UPDATE sales SET subtotal_usd=@subtotal_usd,subtotal_khr=@subtotal_khr,total_usd=@total_usd,total_khr=@total_khr,updated_at=CURRENT_TIMESTAMP
          WHERE id=@sale_id AND sale_status='awaiting_payment'`,
        params: { ...target.restore_money, sale_id: target.id },
      })
    }
    for (const line of target.lines) {
      statements.push({
        sql: `INSERT INTO sale_items(sale_id,product_id,product_name,sku,quantity,unit,applied_price_usd,applied_price_khr,cost_price_usd,cost_price_khr,total_usd,total_khr,branch_id,price_mode,product_discount_type,product_discount_label,product_discount_usd,product_discount_khr,base_price_usd,base_price_khr,manual_discount_type,manual_discount_value,manual_discount_usd,manual_discount_khr,batch_id,batch_label,batch_expiry_date,damaged_lot_id)
          VALUES(@sale_id,@product_id,@product_name,NULL,@quantity,NULL,@applied_price_usd,@applied_price_khr,@cost_price_usd,@cost_price_khr,@total_usd,@total_khr,2,NULL,NULL,NULL,0,0,NULL,NULL,NULL,0,0,0,@batch_id,@batch_label,NULL,NULL)`,
        params: { sale_id: target.id, ...line },
      }, {
        sql: `INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,lot_code,expiry_date,released_quantity,released_at)
          SELECT id,@batch_id,2,@quantity,@batch_label,NULL,@released_quantity,CASE WHEN @released_quantity>0 THEN CURRENT_TIMESTAMP ELSE NULL END
          FROM sale_items WHERE sale_id=@sale_id AND product_id=@product_id`,
        params: {
          sale_id: target.id, product_id: line.product_id, batch_id: line.batch_id,
          quantity: line.quantity, batch_label: line.batch_label,
          released_quantity: line.allocation_released ? line.quantity : 0,
        },
      })
      if (target.status === 'completed') {
        statements.push({
          sql: 'UPDATE branch_batch_stock SET quantity=quantity-@quantity,updated_at=CURRENT_TIMESTAMP WHERE id=@stock_id AND batch_id=@batch_id AND branch_id=2',
          params: { quantity: line.quantity, stock_id: line.batch_stock_id, batch_id: line.batch_id },
        }, {
          sql: 'UPDATE branch_stock SET quantity=quantity-@quantity WHERE product_id=@product_id AND branch_id=2',
          params: { quantity: line.quantity, product_id: line.product_id },
        }, {
          sql: 'UPDATE products SET stock_quantity=stock_quantity-@quantity,updated_at=CURRENT_TIMESTAMP WHERE id=@product_id',
          params: { quantity: line.quantity, product_id: line.product_id },
        }, {
          sql: `INSERT INTO inventory_movements(product_id,product_name,branch_id,movement_type,quantity,unit_cost_usd,unit_cost_khr,reference_id,user_id,user_name,batch_id)
            VALUES(@product_id,@product_name,2,'sale',@movement_quantity,@cost_price_usd,@cost_price_khr,@sale_id,@actor_id,@actor_name,@batch_id)`,
          params: {
            product_id: line.product_id, product_name: line.product_name, movement_quantity: -line.quantity,
            cost_price_usd: line.cost_price_usd, cost_price_khr: line.cost_price_khr,
            sale_id: target.id, actor_id: actor.id, actor_name: actor.name, batch_id: line.batch_id,
          },
        })
      }
    }
    const provenance = {
      kind: SALE_INCIDENT_RECOVERY_TARGET,
      operation_id: operationId,
      manifest_sha256: request.manifest_sha256,
      sale_id: target.id,
      source: 'immutable_creation_snapshot_and_reviewed_production_fingerprints',
      optional_line_fields_unknown: ['price_mode', 'base_price_usd', 'base_price_khr'],
      numeric_discounts: 'zero_proven_by_header_and_line_equations',
      allocation_basis: 'recovery_time_unique_positive_lot_not_historical_proof',
      stock_effect: target.status === 'completed' ? 'deducted_now' : 'released_allocation_only',
      preserves_later_delivery_edits: target.id === 16952,
      reversible: false,
    }
    statements.push({
      sql: `INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name)
        VALUES('global','sale_incident_recovery',@sale_id,@label,0,'recorded','{}',@provenance,@actor_id,@actor_name)`,
      params: { sale_id: String(target.id), label: `Recover persisted lines for sale ${target.receipt_number}`, provenance: JSON.stringify(provenance), actor_id: actor.id, actor_name: actor.name },
    }, {
      sql: `INSERT INTO sale_incident_recovery_members(operation_id,sale_id,history_id,before_json,after_json)
        VALUES(@operation_id,@sale_id,last_insert_rowid(),@before,@after)`,
      params: {
        operation_id: operationId, sale_id: target.id,
        before: JSON.stringify({ sale_id: target.id, item_count: 0, revision: target.expected_revision }),
        after: JSON.stringify({ sale_id: target.id, item_count: target.lines.length, revision: expectedRevisionAfter(target), lines: target.lines }),
      },
    }, {
      sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,old_value,new_value)
        VALUES(@actor_id,@actor_name,'recover_missing_sale_items','sale',@sale_id,@details,'sales',@sale_id,@before,@after)`,
      params: {
        actor_id: actor.id, actor_name: actor.name, sale_id: String(target.id), details: JSON.stringify(provenance),
        before: JSON.stringify({ item_count: 0, revision: target.expected_revision }),
        after: JSON.stringify({ item_count: target.lines.length, revision: expectedRevisionAfter(target) }),
      },
    })
  }
  statements.push({
    sql: `UPDATE sale_incident_recovery_guards SET guard_value=CASE WHEN
      (SELECT group_concat(value,'|') FROM (SELECT s.id||':'||(SELECT COUNT(*) FROM sale_items si WHERE si.sale_id=s.id)||':'||r.revision AS value FROM sales s JOIN sale_write_revisions r ON r.sale_id=s.id WHERE s.id IN (16951,16952,16953) ORDER BY s.id))='16951:1:3|16952:1:9|16953:2:5'
      AND (SELECT COUNT(*) FROM sale_items WHERE
        (sale_id=16951 AND product_id=4208 AND quantity=36 AND applied_price_usd=9.5 AND applied_price_khr=38618 AND cost_price_usd=9.55 AND cost_price_khr=0 AND total_usd=342 AND total_khr=1390230 AND branch_id=2 AND batch_id=61143)
        OR (sale_id=16952 AND product_id=859 AND quantity=1 AND applied_price_usd=299 AND applied_price_khr=1215435 AND cost_price_usd=280 AND cost_price_khr=0 AND total_usd=299 AND total_khr=1215435 AND branch_id=2 AND batch_id=53462)
        OR (sale_id=16953 AND product_id=409 AND quantity=1 AND applied_price_usd=13 AND applied_price_khr=52845 AND cost_price_usd=6.5 AND cost_price_khr=0 AND total_usd=13 AND total_khr=52845 AND branch_id=2 AND batch_id=51466)
        OR (sale_id=16953 AND product_id=3490 AND quantity=1 AND applied_price_usd=27 AND applied_price_khr=109755 AND cost_price_usd=18 AND cost_price_khr=0 AND total_usd=27 AND total_khr=109755 AND branch_id=2 AND batch_id=51280)
      )=4
      AND (SELECT COUNT(*) FROM sale_item_batch_allocations a JOIN sale_items si ON si.id=a.sale_item_id WHERE si.sale_id IN (16951,16952,16953))=4
      AND (SELECT COUNT(*) FROM sale_item_batch_allocations a JOIN sale_items si ON si.id=a.sale_item_id WHERE
        (si.sale_id=16951 AND si.product_id=4208 AND a.batch_id=61143 AND a.branch_id=2 AND a.quantity=36 AND a.released_quantity=0 AND a.released_at IS NULL)
        OR (si.sale_id=16952 AND si.product_id=859 AND a.batch_id=53462 AND a.branch_id=2 AND a.quantity=1 AND a.released_quantity=1 AND a.released_at IS NOT NULL)
        OR (si.sale_id=16953 AND si.product_id=409 AND a.batch_id=51466 AND a.branch_id=2 AND a.quantity=1 AND a.released_quantity=1 AND a.released_at IS NOT NULL)
        OR (si.sale_id=16953 AND si.product_id=3490 AND a.batch_id=51280 AND a.branch_id=2 AND a.quantity=1 AND a.released_quantity=1 AND a.released_at IS NOT NULL)
      )=4
      AND (SELECT COUNT(*) FROM inventory_movements WHERE reference_id IN (16951,16952,16953) AND movement_type='sale')=1
      AND (SELECT subtotal_usd||':'||subtotal_khr||':'||total_usd||':'||total_khr||':'||delivery_fee_usd||':'||delivery_actual_cost_usd FROM sales WHERE id=16952)='299.0:1215435.0:299.0:1215435.0:2.7:2.7'
      AND (SELECT stock_quantity FROM products WHERE id=4208)=252
      AND (SELECT quantity FROM branch_stock WHERE product_id=4208 AND branch_id=2)=60
      AND (SELECT quantity FROM branch_batch_stock WHERE id=77975)=60
      AND (SELECT COUNT(*) FROM sale_incident_recovery_members WHERE operation_id=@operation_id)=3
      AND (SELECT COUNT(*) FROM action_history WHERE entity='sale_incident_recovery' AND entity_id IN ('16951','16952','16953') AND reversible=0 AND status='recorded')=3
      AND (SELECT COUNT(*) FROM audit_logs WHERE action='recover_missing_sale_items' AND entity='sale' AND entity_id IN ('16951','16952','16953'))=3
      THEN 1 ELSE 0 END WHERE id=1`,
    params: { operation_id: operationId },
  }, {
    sql: 'DELETE FROM sale_incident_recovery_guards WHERE id=1',
  })
  return statements
}

function expectedResponse(operationId: string, manifestSha256: string, outcome: 'applied' | 'already_applied') {
  return {
    success: true,
    outcome,
    operation_id: operationId,
    manifest_sha256: manifestSha256,
    affected: { sales: 3, items: 4, allocations: 4, movements: 1, histories: 3, audits: 3 },
  }
}

function storedResponse(row: { id: string; request_digest: string; response_json: string }, outcome: 'applied' | 'already_applied') {
  let stored: Record<string, unknown>
  try { stored = JSON.parse(row.response_json) as Record<string, unknown> } catch { conflict('The durable recovery receipt is malformed. No recovery was retried.') }
  const expected = expectedResponse(row.id, row.request_digest, 'applied')
  if (stored.success !== true || stored.outcome !== 'applied' || stored.operation_id !== expected.operation_id
    || stored.manifest_sha256 !== expected.manifest_sha256
    || JSON.stringify(stored.affected) !== JSON.stringify(expected.affected)) {
    conflict('The durable recovery receipt does not match the fixed recovery contract. No recovery was retried.')
  }
  return { ...stored, outcome, operation_id: row.id, verification_pending: false }
}

async function verifyImmediateAfterState(db: Pick<D1Compat, 'prepare'>, operationId: string): Promise<boolean> {
  const counts = await db.prepare(`SELECT
    (SELECT COUNT(*) FROM sale_items WHERE sale_id IN (16951,16952,16953)) AS items,
    (SELECT COUNT(*) FROM sale_items WHERE
      (sale_id=16951 AND product_id=4208 AND quantity=36 AND applied_price_usd=9.5 AND cost_price_usd=9.55 AND total_usd=342 AND batch_id=61143 AND price_mode IS NULL AND base_price_usd IS NULL AND base_price_khr IS NULL)
      OR (sale_id=16952 AND product_id=859 AND quantity=1 AND applied_price_usd=299 AND cost_price_usd=280 AND total_usd=299 AND batch_id=53462 AND price_mode IS NULL AND base_price_usd IS NULL AND base_price_khr IS NULL)
      OR (sale_id=16953 AND product_id=409 AND quantity=1 AND applied_price_usd=13 AND cost_price_usd=6.5 AND total_usd=13 AND batch_id=51466 AND price_mode IS NULL AND base_price_usd IS NULL AND base_price_khr IS NULL)
      OR (sale_id=16953 AND product_id=3490 AND quantity=1 AND applied_price_usd=27 AND cost_price_usd=18 AND total_usd=27 AND batch_id=51280 AND price_mode IS NULL AND base_price_usd IS NULL AND base_price_khr IS NULL)
    ) AS matched_items,
    (SELECT COUNT(*) FROM sale_item_batch_allocations a JOIN sale_items si ON si.id=a.sale_item_id WHERE si.sale_id IN (16951,16952,16953)) AS allocations,
    (SELECT COUNT(*) FROM inventory_movements WHERE reference_id IN (16951,16952,16953) AND movement_type='sale') AS movements,
    (SELECT COUNT(*) FROM sale_incident_recovery_members WHERE operation_id=@id) AS members,
    (SELECT COUNT(*) FROM action_history WHERE entity='sale_incident_recovery' AND entity_id IN ('16951','16952','16953') AND reversible=0 AND status='recorded') AS histories,
    (SELECT COUNT(*) FROM audit_logs WHERE action='recover_missing_sale_items' AND entity='sale' AND entity_id IN ('16951','16952','16953')) AS audits,
    (SELECT COUNT(*) FROM sale_write_revisions WHERE (sale_id=16951 AND revision=3) OR (sale_id=16952 AND revision=9) OR (sale_id=16953 AND revision=5)) AS revisions,
    (SELECT COUNT(*) FROM sales WHERE id=16952 AND subtotal_usd=299 AND subtotal_khr=1215435 AND total_usd=299 AND total_khr=1215435 AND delivery_fee_usd=2.7 AND delivery_actual_cost_usd=2.7) AS sale16952,
    (SELECT COUNT(*) FROM products p JOIN branch_stock bs ON bs.product_id=p.id AND bs.branch_id=2 JOIN branch_batch_stock bbs ON bbs.id=77975 WHERE p.id=4208 AND p.stock_quantity=252 AND bs.quantity=60 AND bbs.quantity=60) AS stock16951`).get<Record<string, unknown>>({ id: operationId })
  if (!counts || Number(counts.items) !== 4 || Number(counts.matched_items) !== 4
    || Number(counts.allocations) !== 4 || Number(counts.movements) !== 1 || Number(counts.members) !== 3
    || Number(counts.histories) !== 3 || Number(counts.audits) !== 3 || Number(counts.revisions) !== 3
    || Number(counts.sale16952) !== 1 || Number(counts.stock16951) !== 1) {
    return false
  }
  return true
}

export async function applySaleIncidentRecovery(
  db: Pick<D1Compat, 'prepare' | 'batch'>,
  prepared: Awaited<ReturnType<typeof prepareSaleIncidentRecovery>>,
) {
  if (prepared.outcome === 'already_applied') {
    const receipt = await readReceipt(db)
    if (!receipt || receipt.id !== prepared.operationId || receipt.request_digest !== prepared.request.manifest_sha256) {
      conflict('The durable recovery receipt changed before replay. No recovery was retried.')
    }
    return storedResponse(receipt, 'already_applied')
  }
  try {
    await db.batch(prepared.statements)
  } catch (error) {
    let receipt
    try { receipt = await readReceipt(db) } catch {
      throw new SaleIncidentRecoveryUncertainError(prepared.operationId, prepared.request.manifest_sha256)
    }
    if (!receipt || receipt.id !== prepared.operationId || receipt.request_digest !== prepared.request.manifest_sha256) {
      try {
        const current = await readCanonicalManifest(db)
        assertExpected(current)
        if (await sha256(JSON.stringify(current)) !== prepared.request.manifest_sha256) {
          conflict('Recovery state changed after backup. Fetch a new preview.')
        }
      } catch (refreshError) {
        if (refreshError instanceof SaleIncidentRecoveryConflictError) throw refreshError
      }
      throw error
    }
    const response = storedResponse(receipt, 'applied')
    let verified = false
    try { verified = await verifyImmediateAfterState(db, prepared.operationId) } catch { /* receipt still proves one atomic commit */ }
    return { ...response, verification_pending: !verified }
  }
  const fallback = expectedResponse(prepared.operationId, prepared.request.manifest_sha256, 'applied')
  try {
    const receipt = await readReceipt(db)
    if (!receipt || receipt.id !== prepared.operationId || receipt.request_digest !== prepared.request.manifest_sha256) {
      return { ...fallback, verification_pending: true }
    }
    const response = storedResponse(receipt, 'applied')
    let verified = false
    try { verified = await verifyImmediateAfterState(db, prepared.operationId) } catch { /* reported below */ }
    return { ...response, verification_pending: !verified }
  } catch (error) {
    if (error instanceof SaleIncidentRecoveryConflictError) throw error
    return { ...fallback, verification_pending: true }
  }
}
