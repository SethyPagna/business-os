import type { D1Compat } from './db'

export const SALE_NOT_PAID_STOCK_RECOVERY_TARGET = 'sale-not-paid-stock-recovery-20260909-v1' as const
export const SALE_NOT_PAID_STOCK_RECOVERY_CONFIRMATION = 'CORRECT NOT PAID STOCK 16952 16953 16954' as const
export const SALE_NOT_PAID_STOCK_RECOVERY_BACKUP_TABLES = Object.freeze([
  'products', 'product_batches', 'branch_stock', 'branch_batch_stock',
  'sales', 'sale_items', 'sale_item_batch_allocations', 'returns', 'return_items',
  'inventory_movements', 'action_history', 'sale_write_revisions',
  'sale_incident_recovery_receipts', 'sale_incident_recovery_members',
  'sale_not_paid_stock_recovery_receipts', 'sale_not_paid_stock_recovery_members',
  'audit_logs',
] as const)

type Statement = { sql: string; params?: Record<string, unknown> }
type Actor = { id?: unknown; name?: unknown }

type LineSpec = {
  sale_id: 16952 | 16953 | 16954
  sale_item_id: number
  product_id: number
  product_name: string
  quantity: 1
  cost_price_usd: number
  cost_price_khr: 0
  branch_stock_id: number
  batch_id: number
  batch_label: string
  batch_stock_id: number
  stock_before: number
  branch_before: number
  batch_before: number
  product_updated_at: string
}

type TargetSpec = {
  id: 16952 | 16953 | 16954
  receipt_number: string
  expected_revision: number
  expected_revision_after: number
  expected_updated_at: string
  prior_incident: 'sale-zero-items-20260909-v1' | 'sale-zero-items-20260909-v2'
  prior_receipt_id: string
  prior_receipt_digest: string
  prior_audit_id: number
  prior_history_id: number
  prior_history_label: string
  lines: readonly LineSpec[]
}

const TARGETS: readonly TargetSpec[] = Object.freeze([
  {
    id: 16952,
    receipt_number: '20260909-104116',
    expected_revision: 9,
    expected_revision_after: 10,
    expected_updated_at: '2026-09-09 07:19:33',
    prior_incident: 'sale-zero-items-20260909-v1',
    prior_receipt_id: 'c2620a5d-84d8-4eca-a117-94a7368acef8',
    prior_receipt_digest: 'b828c09a8ef1ef0288a93e0ba9aade8676c635f21d49f6e74ce4c183bb550278',
    prior_audit_id: 4506,
    prior_history_id: 547,
    prior_history_label: 'Recover persisted lines for sale 20260909-104116',
    lines: [{
      sale_id: 16952, sale_item_id: 40378, product_id: 859, product_name: 'Chanel Set Limited', quantity: 1,
      cost_price_usd: 280, cost_price_khr: 0, branch_stock_id: 41660,
      batch_id: 53462, batch_label: 'ADJ09/02/2026', batch_stock_id: 62711,
      stock_before: 1, branch_before: 1, batch_before: 1,
      product_updated_at: '2026-09-02T15:30:00.000Z',
    }],
  },
  {
    id: 16953,
    receipt_number: '20260909-111455',
    expected_revision: 5,
    expected_revision_after: 7,
    expected_updated_at: '2026-09-09 04:14:55',
    prior_incident: 'sale-zero-items-20260909-v1',
    prior_receipt_id: 'c2620a5d-84d8-4eca-a117-94a7368acef8',
    prior_receipt_digest: 'b828c09a8ef1ef0288a93e0ba9aade8676c635f21d49f6e74ce4c183bb550278',
    prior_audit_id: 4507,
    prior_history_id: 548,
    prior_history_label: 'Recover persisted lines for sale 20260909-111455',
    lines: [
      {
        sale_id: 16953, sale_item_id: 40379, product_id: 409, product_name: 'Canmake Eyeliner Dark Brown 03', quantity: 1,
        cost_price_usd: 6.5, cost_price_khr: 0, branch_stock_id: 40554,
        batch_id: 51466, batch_label: 'ADJ09/02/2026', batch_stock_id: 58719,
        stock_before: 9, branch_before: 3, batch_before: 3,
        product_updated_at: '2026-09-08 08:45:26',
      },
      {
        sale_id: 16953, sale_item_id: 40380, product_id: 3490, product_name: 'Lancôme Idole Mascara 8ml', quantity: 1,
        cost_price_usd: 18, cost_price_khr: 0, branch_stock_id: 48140,
        batch_id: 51280, batch_label: 'ADJ09/02/2026', batch_stock_id: 58347,
        stock_before: 3, branch_before: 3, batch_before: 3,
        product_updated_at: '2026-09-02T15:30:00.000Z',
      },
    ],
  },
  {
    id: 16954,
    receipt_number: '20260909-130228',
    expected_revision: 3,
    expected_revision_after: 4,
    expected_updated_at: '2026-09-09 06:02:29',
    prior_incident: 'sale-zero-items-20260909-v2',
    prior_receipt_id: 'bfaebe1d-4435-4d5e-820d-b6ed439dc475',
    prior_receipt_digest: '3b5a3504bace192ba3d5968f89e860fced6e2f00e89a16c29e112ba7103990fe',
    prior_audit_id: 4514,
    prior_history_id: 549,
    prior_history_label: 'Recover persisted line for sale 20260909-130228',
    lines: [{
      sale_id: 16954, sale_item_id: 40381, product_id: 5370, product_name: 'SK-II Serum Facial Treatment 50ml', quantity: 1,
      cost_price_usd: 170, cost_price_khr: 0, branch_stock_id: 52786,
      batch_id: 56737, batch_label: 'ADJ09/02/2026', batch_stock_id: 69261,
      stock_before: 7, branch_before: 5, batch_before: 5,
      product_updated_at: '2026-09-09T06:11:40.658Z',
    }],
  },
])

const LINES = TARGETS.flatMap((target) => [...target.lines])
const REQUEST_KEYS = Object.freeze(['target', 'confirmation', 'manifest_sha256'])

export type SaleNotPaidStockRecoveryRequest = {
  target: typeof SALE_NOT_PAID_STOCK_RECOVERY_TARGET
  confirmation: typeof SALE_NOT_PAID_STOCK_RECOVERY_CONFIRMATION
  manifest_sha256: string
}

export class SaleNotPaidStockRecoveryValidationError extends Error {}
export class SaleNotPaidStockRecoveryConflictError extends Error {}
export class SaleNotPaidStockRecoveryUncertainError extends Error {
  constructor(public readonly operationId: string, public readonly manifestSha256: string) {
    super('The Not Paid stock correction may have committed, but its durable receipt could not be read. Retry the exact held request before taking any other action.')
  }
}

function validation(message: string): never { throw new SaleNotPaidStockRecoveryValidationError(message) }
function conflict(message: string): never { throw new SaleNotPaidStockRecoveryConflictError(message) }

function exactRequest(raw: unknown): SaleNotPaidStockRecoveryRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) validation('request must be an object')
  const value = raw as Record<string, unknown>
  const actual = Object.keys(value).sort()
  const expected = [...REQUEST_KEYS].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    validation(`request must contain exactly: ${REQUEST_KEYS.join(', ')}`)
  }
  if (value.target !== SALE_NOT_PAID_STOCK_RECOVERY_TARGET) validation('invalid recovery target')
  if (value.confirmation !== SALE_NOT_PAID_STOCK_RECOVERY_CONFIRMATION) validation('invalid confirmation phrase')
  if (typeof value.manifest_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.manifest_sha256)) {
    validation('manifest_sha256 must be a lowercase SHA-256 digest')
  }
  return value as SaleNotPaidStockRecoveryRequest
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
    return await db.prepare(`SELECT id,request_digest,response_json FROM sale_not_paid_stock_recovery_receipts
      WHERE incident_key=@incident`).get<{ id: string; request_digest: string; response_json: string }>({ incident: SALE_NOT_PAID_STOCK_RECOVERY_TARGET })
  } catch (error) {
    if (/no such table/i.test(error instanceof Error ? error.message : String(error))) {
      conflict('Migration 0146 is not applied. No data was changed.')
    }
    throw error
  }
}

async function readCanonicalManifest(db: Pick<D1Compat, 'prepare'>) {
  const saleIds = TARGETS.map((target) => target.id).join(',')
  const itemIds = LINES.map((line) => line.sale_item_id).join(',')
  const productIds = LINES.map((line) => line.product_id).sort((a, b) => a - b).join(',')
  const [sales, lines, products, provenance] = await Promise.all([
    db.prepare(`SELECT s.id,s.receipt_number,s.sale_status,s.stock_skipped,s.updated_at,r.revision,
      (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id=s.id) AS item_count,
      (SELECT COUNT(*) FROM returns ret WHERE ret.sale_id=s.id) AS return_count,
      (SELECT COUNT(*) FROM inventory_movements im WHERE im.reference_id=s.id AND im.movement_type IN ('sale','sale_from_damaged')) AS sale_movement_count
      FROM sales s LEFT JOIN sale_write_revisions r ON r.sale_id=s.id
      WHERE s.id IN (${saleIds}) ORDER BY s.id`).all<Record<string, unknown>>(),
    db.prepare(`SELECT si.id AS sale_item_id,si.sale_id,si.product_id,si.product_name,si.quantity,
      si.cost_price_usd,si.cost_price_khr,si.branch_id,si.batch_id,si.batch_label,
      a.id AS allocation_id,a.branch_id AS allocation_branch_id,a.batch_id AS allocation_batch_id,
      a.quantity AS allocation_quantity,a.lot_code,a.released_quantity,a.released_at
      FROM sale_items si LEFT JOIN sale_item_batch_allocations a ON a.sale_item_id=si.id
      WHERE si.id IN (${itemIds}) ORDER BY si.sale_id,si.id,a.id`).all<Record<string, unknown>>(),
    db.prepare(`SELECT p.id,p.name,p.is_active,p.stock_quantity,p.cost_price_usd,p.cost_price_khr,p.updated_at,
      bs.id AS branch_stock_id,bs.quantity AS branch_quantity,
      pb.id AS batch_id,pb.variant_product_id,pb.is_active AS batch_active,pb.lot_code,
      bbs.id AS batch_stock_id,bbs.quantity AS batch_quantity
      FROM products p JOIN branch_stock bs ON bs.product_id=p.id AND bs.branch_id=2
      JOIN product_batches pb ON pb.variant_product_id=p.id
      JOIN branch_batch_stock bbs ON bbs.batch_id=pb.id AND bbs.branch_id=2
      WHERE p.id IN (${productIds}) AND pb.id IN (${LINES.map((line) => line.batch_id).join(',')})
      ORDER BY p.id`).all<Record<string, unknown>>(),
    db.prepare(`SELECT r.id AS receipt_id,r.incident_key,r.request_digest,m.sale_id,m.history_id,
      h.label AS history_label,h.reversible AS history_reversible,h.status AS history_status,h.redo_payload AS history_provenance,
      a.id AS audit_id,a.action AS audit_action,a.details AS audit_details,a.old_value AS audit_before,a.new_value AS audit_after
      FROM sale_incident_recovery_receipts r JOIN sale_incident_recovery_members m ON m.operation_id=r.id
      JOIN action_history h ON h.id=m.history_id AND h.entity='sale_incident_recovery' AND h.entity_id=CAST(m.sale_id AS TEXT)
      JOIN audit_logs a ON a.action='recover_missing_sale_items' AND a.entity='sale' AND a.entity_id=CAST(m.sale_id AS TEXT)
      WHERE m.sale_id IN (${saleIds}) ORDER BY m.sale_id`).all<Record<string, unknown>>(),
  ])
  return {
    schema_version: 1,
    target: SALE_NOT_PAID_STOCK_RECOVERY_TARGET,
    sales,
    lines,
    products,
    provenance,
    correction: TARGETS.map((target) => ({
      id: target.id,
      receipt_number: target.receipt_number,
      expected_revision: target.expected_revision,
      expected_revision_after: target.expected_revision_after,
      expected_updated_at: target.expected_updated_at,
      prior_incident: target.prior_incident,
      prior_receipt_id: target.prior_receipt_id,
      prior_receipt_digest: target.prior_receipt_digest,
      prior_audit_id: target.prior_audit_id,
      lines: target.lines,
    })),
  }
}

type CanonicalManifest = Awaited<ReturnType<typeof readCanonicalManifest>>

function assertExpected(manifest: CanonicalManifest) {
  if (manifest.sales.length !== 3 || manifest.lines.length !== 4 || manifest.products.length !== 4 || manifest.provenance.length !== 3) {
    conflict('The fixed Not Paid correction cohort changed from the reviewed three-sale/four-line state.')
  }
  const saleById = new Map(manifest.sales.map((row) => [Number(row.id), row]))
  const lineById = new Map(manifest.lines.map((row) => [Number(row.sale_item_id), row]))
  const productById = new Map(manifest.products.map((row) => [Number(row.id), row]))
  const proofById = new Map(manifest.provenance.map((row) => [Number(row.sale_id), row]))
  for (const target of TARGETS) {
    const sale = saleById.get(target.id)
    const proof = proofById.get(target.id)
    if (!sale || sale.receipt_number !== target.receipt_number || sale.sale_status !== 'awaiting_payment'
      || Number(sale.stock_skipped) !== 0 || sale.updated_at !== target.expected_updated_at
      || Number(sale.revision) !== target.expected_revision || Number(sale.item_count) !== target.lines.length
      || Number(sale.return_count) !== 0 || Number(sale.sale_movement_count) !== 0) {
      conflict(`Sale ${target.id} changed from the reviewed Not Paid stock-correction fingerprint.`)
    }
    let proofDetails: Record<string, unknown> = {}
    let proofBefore: Record<string, unknown> = {}
    let proofAfter: Record<string, unknown> = {}
    try {
      proofDetails = JSON.parse(String(proof?.audit_details || ''))
      proofBefore = JSON.parse(String(proof?.audit_before || ''))
      proofAfter = JSON.parse(String(proof?.audit_after || ''))
    } catch { conflict(`Sale ${target.id} has malformed immutable recovery provenance.`) }
    if (!proof || proof.receipt_id !== target.prior_receipt_id || proof.incident_key !== target.prior_incident
      || proof.request_digest !== target.prior_receipt_digest || Number(proof.history_id) !== target.prior_history_id
      || proof.history_label !== target.prior_history_label || Number(proof.history_reversible) !== 0 || proof.history_status !== 'recorded'
      || Number(proof.audit_id) !== target.prior_audit_id || proof.audit_action !== 'recover_missing_sale_items'
      || proof.history_provenance !== proof.audit_details || proofDetails.operation_id !== target.prior_receipt_id
      || proofDetails.manifest_sha256 !== target.prior_receipt_digest || Number(proofDetails.sale_id) !== target.id
      || proofDetails.stock_effect !== 'released_allocation_only' || Number(proofBefore.item_count) !== 0
      || Number(proofAfter.item_count) !== target.lines.length) {
      conflict(`Sale ${target.id} no longer has the reviewed immutable recovery provenance.`)
    }
    for (const expected of target.lines) {
      const line = lineById.get(expected.sale_item_id)
      const product = productById.get(expected.product_id)
      if (!line || Number(line.sale_id) !== expected.sale_id || Number(line.product_id) !== expected.product_id
        || line.product_name !== expected.product_name || Number(line.quantity) !== 1
        || Number(line.cost_price_usd) !== expected.cost_price_usd || Number(line.cost_price_khr) !== 0
        || Number(line.branch_id) !== 2 || Number(line.batch_id) !== expected.batch_id || line.batch_label !== expected.batch_label
        || Number(line.allocation_id) < 1 || Number(line.allocation_branch_id) !== 2
        || Number(line.allocation_batch_id) !== expected.batch_id || Number(line.allocation_quantity) !== 1
        || line.lot_code !== expected.batch_label || Number(line.released_quantity) !== 1 || !line.released_at) {
        conflict(`Recovered sale item ${expected.sale_item_id} changed from its reviewed released-allocation fingerprint.`)
      }
      if (!product || product.name !== expected.product_name || Number(product.is_active) !== 1
        || Number(product.stock_quantity) !== expected.stock_before || Number(product.cost_price_usd) !== expected.cost_price_usd
        || Number(product.cost_price_khr) !== 0 || product.updated_at !== expected.product_updated_at
        || Number(product.branch_stock_id) !== expected.branch_stock_id || Number(product.branch_quantity) !== expected.branch_before
        || Number(product.batch_id) !== expected.batch_id || Number(product.variant_product_id) !== expected.product_id
        || Number(product.batch_active) !== 1 || product.lot_code !== expected.batch_label
        || Number(product.batch_stock_id) !== expected.batch_stock_id || Number(product.batch_quantity) !== expected.batch_before) {
        conflict(`Product ${expected.product_id} changed from the reviewed product/Shop/lot fingerprint.`)
      }
    }
  }
}

function previewSales() {
  return TARGETS.map((target) => ({
    id: target.id,
    receipt_number: target.receipt_number,
    status: 'awaiting_payment' as const,
    line_count: target.lines.length,
    unit_count: target.lines.length,
    stock_effect: 'deduct_now' as const,
  }))
}

function expectedResponse(operationId: string, manifestSha256: string, outcome: 'applied' | 'already_applied') {
  return {
    success: true,
    outcome,
    operation_id: operationId,
    manifest_sha256: manifestSha256,
    affected: { sales: 3, items: 4, allocations: 4, units: 4, movements: 4, histories: 3, audits: 3 },
  }
}

function storedResponse(row: { id: string; request_digest: string; response_json: string }, outcome: 'applied' | 'already_applied', verificationPending = false) {
  let stored: Record<string, unknown>
  try { stored = JSON.parse(row.response_json) as Record<string, unknown> } catch { conflict('The durable Not Paid stock correction receipt is malformed. No correction was retried.') }
  const expected = expectedResponse(row.id, row.request_digest, 'applied')
  if (stored.success !== true || stored.outcome !== 'applied' || stored.operation_id !== expected.operation_id
    || stored.manifest_sha256 !== expected.manifest_sha256
    || JSON.stringify(stored.affected) !== JSON.stringify(expected.affected)) {
    conflict('The durable Not Paid stock correction receipt does not match the fixed contract. No correction was retried.')
  }
  return { ...stored, outcome, operation_id: row.id, verification_pending: verificationPending }
}

export async function previewSaleNotPaidStockRecovery(db: Pick<D1Compat, 'prepare'>, actor: Actor) {
  actorIdentity(actor)
  const receipt = await readReceipt(db)
  if (receipt) {
    return {
      success: true as const,
      target: SALE_NOT_PAID_STOCK_RECOVERY_TARGET,
      outcome: 'already_applied' as const,
      request: { target: SALE_NOT_PAID_STOCK_RECOVERY_TARGET, confirmation: SALE_NOT_PAID_STOCK_RECOVERY_CONFIRMATION, manifest_sha256: receipt.request_digest },
      sales: previewSales(),
      summary: { sales: 3, items: 4, allocations: 4, units: 4, movements: 4 },
    }
  }
  const manifest = await readCanonicalManifest(db)
  assertExpected(manifest)
  const digest = await sha256(JSON.stringify(manifest))
  return {
    success: true as const,
    target: SALE_NOT_PAID_STOCK_RECOVERY_TARGET,
    outcome: 'apply' as const,
    request: { target: SALE_NOT_PAID_STOCK_RECOVERY_TARGET, confirmation: SALE_NOT_PAID_STOCK_RECOVERY_CONFIRMATION, manifest_sha256: digest },
    sales: previewSales(),
    summary: { sales: 3, items: 4, allocations: 4, units: 4, movements: 4 },
  }
}

export type PreparedSaleNotPaidStockRecovery = {
  outcome: 'apply' | 'already_applied'
  request: SaleNotPaidStockRecoveryRequest
  identity: { id: number; name: string }
  manifest: CanonicalManifest | null
  statements: Statement[]
  operationId: string
}

function buildStatements(manifest: CanonicalManifest, request: SaleNotPaidStockRecoveryRequest, actor: { id: number; name: string }, operationId: string): Statement[] {
  const response = expectedResponse(operationId, request.manifest_sha256, 'applied')
  const afterHeaders = Object.fromEntries(TARGETS.map((target) => [String(target.id), {
    status: 'awaiting_payment', stock_skipped: 0, updated_at: target.expected_updated_at, revision: target.expected_revision_after,
  }]))
  const guardConditions: string[] = [
    `(SELECT COUNT(*) FROM sale_not_paid_stock_recovery_receipts WHERE incident_key=@incident)=0`,
    `(SELECT COUNT(*) FROM sale_not_paid_stock_recovery_guards)=0`,
    `NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')`,
    `(SELECT COUNT(*) FROM sales WHERE id=16951 AND sale_status='completed')=1`,
    `(SELECT COUNT(*) FROM inventory_movements WHERE reference_id=16951 AND movement_type='sale' AND quantity=-36)=1`,
  ]
  const guardParams: Record<string, unknown> = { incident: SALE_NOT_PAID_STOCK_RECOVERY_TARGET }
  const proofById = new Map(manifest.provenance.map((row) => [Number(row.sale_id), row]))
  const lineById = new Map(manifest.lines.map((row) => [Number(row.sale_item_id), row]))
  for (const target of TARGETS) {
    const proof = proofById.get(target.id)!
    guardConditions.push(`EXISTS (SELECT 1 FROM sales s JOIN sale_write_revisions r ON r.sale_id=s.id
      WHERE s.id=${target.id} AND s.receipt_number=@receipt_${target.id} AND s.sale_status='awaiting_payment'
      AND s.stock_skipped=0 AND s.updated_at=@sale_updated_${target.id} AND r.revision=${target.expected_revision})`)
    guardConditions.push(`(SELECT COUNT(*) FROM sale_items WHERE sale_id=${target.id})=${target.lines.length}`)
    guardConditions.push(`(SELECT COUNT(*) FROM returns WHERE sale_id=${target.id})=0`)
    guardConditions.push(`(SELECT COUNT(*) FROM inventory_movements WHERE reference_id=${target.id} AND movement_type IN ('sale','sale_from_damaged'))=0`)
    guardConditions.push(`EXISTS (SELECT 1 FROM sale_incident_recovery_receipts rr
      JOIN sale_incident_recovery_members rm ON rm.operation_id=rr.id
      JOIN action_history h ON h.id=rm.history_id
      JOIN audit_logs a ON a.id=@prior_audit_id_${target.id}
      WHERE rr.id=@prior_receipt_id_${target.id} AND rr.incident_key=@prior_${target.id}
      AND rr.request_digest=@prior_digest_${target.id} AND rm.sale_id=${target.id} AND rm.history_id=@prior_history_id_${target.id}
      AND h.entity='sale_incident_recovery' AND h.entity_id=@sale_entity_${target.id}
      AND h.label=@prior_history_label_${target.id} AND h.reversible=0 AND h.status='recorded'
      AND h.redo_payload=@prior_details_${target.id} AND a.action='recover_missing_sale_items'
      AND a.entity='sale' AND a.entity_id=@sale_entity_${target.id} AND a.details=@prior_details_${target.id}
      AND a.old_value=@prior_before_${target.id} AND a.new_value=@prior_after_${target.id})`)
    guardParams[`receipt_${target.id}`] = target.receipt_number
    guardParams[`sale_updated_${target.id}`] = target.expected_updated_at
    guardParams[`prior_${target.id}`] = target.prior_incident
    guardParams[`prior_receipt_id_${target.id}`] = target.prior_receipt_id
    guardParams[`prior_digest_${target.id}`] = target.prior_receipt_digest
    guardParams[`prior_audit_id_${target.id}`] = target.prior_audit_id
    guardParams[`prior_history_id_${target.id}`] = target.prior_history_id
    guardParams[`prior_history_label_${target.id}`] = target.prior_history_label
    guardParams[`prior_details_${target.id}`] = proof.audit_details
    guardParams[`prior_before_${target.id}`] = proof.audit_before
    guardParams[`prior_after_${target.id}`] = proof.audit_after
    guardParams[`sale_entity_${target.id}`] = String(target.id)
    for (const line of target.lines) {
      const key = line.sale_item_id
      const currentLine = lineById.get(line.sale_item_id)!
      guardConditions.push(`EXISTS (SELECT 1 FROM sale_items si JOIN sale_item_batch_allocations a ON a.sale_item_id=si.id
        WHERE si.id=${line.sale_item_id} AND si.sale_id=${line.sale_id} AND si.product_id=${line.product_id}
        AND si.product_name=@name_${key} AND si.quantity=1 AND si.cost_price_usd=${line.cost_price_usd} AND si.cost_price_khr=0
        AND si.branch_id=2 AND si.batch_id=${line.batch_id} AND si.batch_label=@lot_${key}
        AND a.id=@allocation_id_${key} AND a.branch_id=2 AND a.batch_id=${line.batch_id} AND a.quantity=1 AND a.lot_code=@lot_${key}
        AND a.released_quantity=1 AND a.released_at IS NOT NULL)`)
      guardConditions.push(`EXISTS (SELECT 1 FROM products p JOIN branch_stock bs ON bs.id=${line.branch_stock_id} AND bs.product_id=p.id AND bs.branch_id=2
        JOIN product_batches pb ON pb.id=${line.batch_id} AND pb.variant_product_id=p.id AND pb.is_active=1
        JOIN branch_batch_stock bbs ON bbs.id=${line.batch_stock_id} AND bbs.batch_id=pb.id AND bbs.branch_id=2
        WHERE p.id=${line.product_id} AND p.name=@name_${key} AND p.is_active=1 AND p.stock_quantity=${line.stock_before}
        AND p.cost_price_usd=${line.cost_price_usd} AND p.cost_price_khr=0 AND p.updated_at=@product_updated_${key}
        AND bs.quantity=${line.branch_before} AND pb.lot_code=@lot_${key} AND bbs.quantity=${line.batch_before})`)
      guardParams[`name_${key}`] = line.product_name
      guardParams[`lot_${key}`] = line.batch_label
      guardParams[`product_updated_${key}`] = line.product_updated_at
      guardParams[`allocation_id_${key}`] = currentLine.allocation_id
    }
  }

  const statements: Statement[] = [{
    sql: `INSERT INTO sale_not_paid_stock_recovery_guards(id,guard_value)
      SELECT 1,CASE WHEN ${guardConditions.join('\n AND ')} THEN 1 ELSE 0 END`,
    params: guardParams,
  }, {
    sql: `INSERT INTO sale_not_paid_stock_recovery_receipts(id,incident_key,actor_id,actor_name,request_digest,request_json,before_json,after_json,response_json,backup_created)
      VALUES(@id,@incident,@actor_id,@actor_name,@digest,@request,@before,@after,@response,1)`,
    params: {
      id: operationId, incident: SALE_NOT_PAID_STOCK_RECOVERY_TARGET, actor_id: actor.id, actor_name: actor.name,
      digest: request.manifest_sha256, request: JSON.stringify(request), before: JSON.stringify(manifest),
      after: JSON.stringify({ sale_headers: afterHeaders, stock_effect: 'deducted_now', units: 4 }),
      response: JSON.stringify(response),
    },
  }]

  for (const target of TARGETS) {
    for (const line of target.lines) {
      const currentLine = lineById.get(line.sale_item_id)!
      statements.push({
        sql: `UPDATE sale_item_batch_allocations SET released_quantity=0,released_at=NULL
          WHERE id=@allocation_id AND sale_item_id=@sale_item_id AND batch_id=@batch_id AND branch_id=2
          AND quantity=1 AND released_quantity=1 AND released_at IS NOT NULL`,
        params: { allocation_id: currentLine.allocation_id, sale_item_id: line.sale_item_id, batch_id: line.batch_id },
      }, {
        sql: `UPDATE branch_batch_stock SET quantity=quantity-1,updated_at=CURRENT_TIMESTAMP
          WHERE id=@id AND batch_id=@batch_id AND branch_id=2 AND quantity=@before AND quantity>=1`,
        params: { id: line.batch_stock_id, batch_id: line.batch_id, before: line.batch_before },
      }, {
        sql: `UPDATE branch_stock SET quantity=quantity-1
          WHERE id=@id AND product_id=@product_id AND branch_id=2 AND quantity=@before AND quantity>=1`,
        params: { id: line.branch_stock_id, product_id: line.product_id, before: line.branch_before },
      }, {
        sql: `UPDATE products SET stock_quantity=stock_quantity-1,updated_at=CURRENT_TIMESTAMP
          WHERE id=@product_id AND stock_quantity=@before AND stock_quantity>=1 AND updated_at=@updated_at`,
        params: { product_id: line.product_id, before: line.stock_before, updated_at: line.product_updated_at },
      }, {
        sql: `INSERT INTO inventory_movements(product_id,product_name,branch_id,movement_type,quantity,unit_cost_usd,unit_cost_khr,reason,reference_id,user_id,user_name,batch_id)
          VALUES(@product_id,@product_name,2,'sale',-1,@cost_price_usd,0,'Awaiting payment stock hold correction',@sale_id,@actor_id,@actor_name,@batch_id)`,
        params: {
          product_id: line.product_id, product_name: line.product_name, cost_price_usd: line.cost_price_usd,
          sale_id: target.id, actor_id: actor.id, actor_name: actor.name, batch_id: line.batch_id,
        },
      })
    }
    const heldUnits = target.lines.length
    const provenance = {
      kind: 'sale_stock_corrected',
      operation_id: operationId,
      manifest_sha256: request.manifest_sha256,
      sale_id: target.id,
      source: 'reviewed_sale_incident_recovery_receipt',
      correction: 'awaiting_payment_holds_stock',
      stock_effect_before: 'released_allocation_only',
      stock_effect_after: 'deducted_now',
      held_units_before: 0,
      held_units_after: heldUnits,
      reversible: false,
    }
    statements.push({
      sql: `INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name)
        VALUES('global','sale_not_paid_stock_recovery',@sale_id,@label,0,'recorded','{}',@provenance,@actor_id,@actor_name)`,
      params: {
        sale_id: String(target.id), label: `Correct Not Paid stock hold for sale ${target.receipt_number}`,
        provenance: JSON.stringify(provenance), actor_id: actor.id, actor_name: actor.name,
      },
    }, {
      sql: `INSERT INTO sale_not_paid_stock_recovery_members(operation_id,sale_id,history_id,before_json,after_json)
        VALUES(@operation_id,@sale_id,last_insert_rowid(),@before,@after)`,
      params: {
        operation_id: operationId, sale_id: target.id,
        before: JSON.stringify({ held_units: 0, stock_effect: 'released_allocation_only', revision: target.expected_revision }),
        after: JSON.stringify({ held_units: heldUnits, stock_effect: 'deducted_now', revision: target.expected_revision_after }),
      },
    }, {
      sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,old_value,new_value)
        VALUES(@actor_id,@actor_name,'correct_awaiting_payment_stock_hold','sale',@sale_id,@details,'sales',@sale_id,@before,@after)`,
      params: {
        actor_id: actor.id, actor_name: actor.name, sale_id: String(target.id), details: JSON.stringify(provenance),
        before: JSON.stringify({ held_units: 0, stock_effect: 'released_allocation_only', revision: target.expected_revision }),
        after: JSON.stringify({ held_units: heldUnits, stock_effect: 'deducted_now', revision: target.expected_revision_after }),
      },
    })
  }

  const postConditions: string[] = [
    `(SELECT COUNT(*) FROM sale_not_paid_stock_recovery_receipts WHERE id=@operation_id AND incident_key=@incident AND request_digest=@digest)=1`,
    `(SELECT COUNT(*) FROM sale_not_paid_stock_recovery_members WHERE operation_id=@operation_id)=3`,
    `(SELECT COUNT(*) FROM action_history WHERE entity='sale_not_paid_stock_recovery' AND reversible=0 AND status='recorded')=3`,
    `(SELECT COUNT(*) FROM audit_logs WHERE action='correct_awaiting_payment_stock_hold' AND entity='sale' AND entity_id IN ('16952','16953','16954'))=3`,
    `(SELECT COUNT(*) FROM inventory_movements WHERE reference_id IN (16952,16953,16954) AND movement_type='sale' AND quantity=-1)=4`,
    `(SELECT COUNT(*) FROM inventory_movements WHERE reference_id=16951 AND movement_type='sale' AND quantity=-36)=1`,
  ]
  const postParams: Record<string, unknown> = { operation_id: operationId, incident: SALE_NOT_PAID_STOCK_RECOVERY_TARGET, digest: request.manifest_sha256 }
  for (const target of TARGETS) {
    const proof = proofById.get(target.id)!
    postConditions.push(`EXISTS (SELECT 1 FROM sales s JOIN sale_write_revisions r ON r.sale_id=s.id
      WHERE s.id=${target.id} AND s.sale_status='awaiting_payment' AND s.stock_skipped=0
      AND s.updated_at=@sale_updated_${target.id} AND r.revision=${target.expected_revision_after})`)
    postParams[`sale_updated_${target.id}`] = target.expected_updated_at
    postConditions.push(`EXISTS (SELECT 1 FROM sale_incident_recovery_receipts rr
      JOIN sale_incident_recovery_members rm ON rm.operation_id=rr.id
      JOIN action_history h ON h.id=rm.history_id
      JOIN audit_logs a ON a.id=@prior_audit_id_${target.id}
      WHERE rr.id=@prior_receipt_id_${target.id} AND rr.incident_key=@prior_${target.id}
      AND rr.request_digest=@prior_digest_${target.id} AND rm.sale_id=${target.id} AND rm.history_id=@prior_history_id_${target.id}
      AND h.redo_payload=@prior_details_${target.id} AND a.details=@prior_details_${target.id}
      AND a.old_value=@prior_before_${target.id} AND a.new_value=@prior_after_${target.id})`)
    postParams[`prior_receipt_id_${target.id}`] = target.prior_receipt_id
    postParams[`prior_${target.id}`] = target.prior_incident
    postParams[`prior_digest_${target.id}`] = target.prior_receipt_digest
    postParams[`prior_audit_id_${target.id}`] = target.prior_audit_id
    postParams[`prior_history_id_${target.id}`] = target.prior_history_id
    postParams[`prior_details_${target.id}`] = proof.audit_details
    postParams[`prior_before_${target.id}`] = proof.audit_before
    postParams[`prior_after_${target.id}`] = proof.audit_after
    for (const line of target.lines) {
      const key = line.sale_item_id
      const currentLine = lineById.get(line.sale_item_id)!
      postConditions.push(`EXISTS (SELECT 1 FROM sale_item_batch_allocations a WHERE a.id=@allocation_id_${key} AND a.sale_item_id=${line.sale_item_id}
        AND a.batch_id=${line.batch_id} AND a.branch_id=2 AND a.quantity=1 AND a.released_quantity=0 AND a.released_at IS NULL)`)
      postConditions.push(`EXISTS (SELECT 1 FROM products p JOIN branch_stock bs ON bs.id=${line.branch_stock_id} AND bs.product_id=p.id AND bs.branch_id=2
        JOIN branch_batch_stock bbs ON bbs.id=${line.batch_stock_id} AND bbs.batch_id=${line.batch_id} AND bbs.branch_id=2
        WHERE p.id=${line.product_id} AND p.stock_quantity=${line.stock_before - 1}
        AND bs.quantity=${line.branch_before - 1} AND bbs.quantity=${line.batch_before - 1})`)
      postConditions.push(`(SELECT COUNT(*) FROM inventory_movements WHERE reference_id=${target.id} AND product_id=${line.product_id}
        AND branch_id=2 AND movement_type='sale' AND quantity=-1 AND unit_cost_usd=${line.cost_price_usd}
        AND unit_cost_khr=0 AND batch_id=${line.batch_id} AND reason='Awaiting payment stock hold correction')=1`)
      postParams[`allocation_id_${key}`] = currentLine.allocation_id
    }
  }
  statements.push({
    sql: `UPDATE sale_not_paid_stock_recovery_guards SET guard_value=CASE WHEN
      ${postConditions.join('\n AND ')} THEN 1 ELSE 0 END WHERE id=1`,
    params: postParams,
  }, { sql: 'DELETE FROM sale_not_paid_stock_recovery_guards WHERE id=1' })
  return statements
}

export async function prepareSaleNotPaidStockRecovery(
  db: Pick<D1Compat, 'prepare'>,
  rawRequest: unknown,
  actor: Actor,
): Promise<PreparedSaleNotPaidStockRecovery> {
  const request = exactRequest(rawRequest)
  const identity = actorIdentity(actor)
  const receipt = await readReceipt(db)
  if (receipt) {
    if (receipt.request_digest !== request.manifest_sha256) conflict('The correction is already recorded under a different manifest digest. No correction was retried.')
    storedResponse(receipt, 'already_applied')
    return { outcome: 'already_applied', request, identity, manifest: null, statements: [], operationId: receipt.id }
  }
  const manifest = await readCanonicalManifest(db)
  assertExpected(manifest)
  const digest = await sha256(JSON.stringify(manifest))
  if (digest !== request.manifest_sha256) conflict('The reviewed Not Paid stock state changed. Request a fresh preview before applying.')
  const operationId = crypto.randomUUID()
  return { outcome: 'apply', request, identity, manifest, statements: buildStatements(manifest, request, identity, operationId), operationId }
}

export async function applySaleNotPaidStockRecovery(
  db: Pick<D1Compat, 'prepare' | 'batch'>,
  prepared: PreparedSaleNotPaidStockRecovery,
) {
  if (prepared.outcome === 'already_applied') {
    const receipt = await readReceipt(db)
    if (!receipt || receipt.request_digest !== prepared.request.manifest_sha256) {
      conflict('The durable Not Paid stock correction receipt changed before replay. No correction was retried.')
    }
    return storedResponse(receipt, 'already_applied')
  }
  try {
    await db.batch(prepared.statements)
  } catch (error) {
    let receipt
    try { receipt = await readReceipt(db) } catch {
      throw new SaleNotPaidStockRecoveryUncertainError(prepared.operationId, prepared.request.manifest_sha256)
    }
    if (receipt?.request_digest === prepared.request.manifest_sha256) {
      return storedResponse(receipt, receipt.id === prepared.operationId ? 'applied' : 'already_applied', true)
    }
    conflict(`The guarded Not Paid stock correction did not commit: ${error instanceof Error ? error.message : String(error)}`)
  }
  let receipt
  try { receipt = await readReceipt(db) } catch {
    throw new SaleNotPaidStockRecoveryUncertainError(prepared.operationId, prepared.request.manifest_sha256)
  }
  if (!receipt || receipt.id !== prepared.operationId || receipt.request_digest !== prepared.request.manifest_sha256) {
    throw new SaleNotPaidStockRecoveryUncertainError(prepared.operationId, prepared.request.manifest_sha256)
  }
  return storedResponse(receipt, 'applied')
}
