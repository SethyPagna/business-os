import type { D1Compat } from './db'
import { SALE_INCIDENT_RECOVERY_BACKUP_TABLES } from './saleIncidentRecovery'

export const SALE_INCIDENT_RECOVERY_V2_TARGET = 'sale-zero-items-20260909-v2' as const
export const SALE_INCIDENT_RECOVERY_V2_CONFIRMATION = 'RECOVER SALE 16954' as const
export const SALE_INCIDENT_RECOVERY_V2_BACKUP_TABLES = SALE_INCIDENT_RECOVERY_BACKUP_TABLES

const REQUEST_KEYS = Object.freeze(['target', 'confirmation', 'manifest_sha256'])
const UNKNOWN_LINE_FIELDS = Object.freeze(['price_mode', 'base_price_usd', 'base_price_khr'] as const)
const ALLOCATION_BASIS = 'recovery_time_unique_positive_lot_not_historical_proof' as const
const COST_EVIDENCE = Object.freeze({
  artifact: 'outputs/takeover-20260909/sale-16954-product-5370-cost-evidence.json',
  sha256: 'd35b883f00082292ca457f664a70ecb8be62aef20b5f149ad196c5271177b630',
  backup_created_at: '2026-09-09T00:00:29.559Z',
  backup_product_updated_at: '2026-09-02T15:30:00.000Z',
  cost_source: 'pre_sale_scheduled_backup_product_row',
})

const TARGET = Object.freeze({
  id: 16954,
  receipt_number: '20260909-130228',
  status: 'awaiting_payment',
  expected_revision: 1,
  expected_updated_at: '2026-09-09 06:02:29',
  expected_created_at: '2026-09-09 06:02:29',
  line: Object.freeze({
    product_id: 5370,
    product_name: 'SK-II Serum Facial Treatment 50ml',
    quantity: 1,
    applied_price_usd: 185,
    applied_price_khr: 752025,
    cost_price_usd: 170,
    cost_price_khr: 0,
    total_usd: 185,
    total_khr: 752025,
    batch_id: 56737,
    batch_label: 'ADJ09/02/2026',
    batch_stock_id: 69261,
  }),
})

const PRODUCT_FINGERPRINT = Object.freeze({
  name: TARGET.line.product_name,
  is_active: 1,
  cost_price_usd: 170,
  cost_price_khr: 0,
  stock_quantity: 7,
  updated_at: '2026-09-09T06:11:40.658Z',
  product_revision: 1,
  branch_stock_id: 52786,
  branch_quantity: 5,
  rfid_confirmed_qty: 0,
})

const LOT_FINGERPRINT = Object.freeze({
  id: 56737,
  is_active: 1,
  received_at: '2026-09-02T15:30:00.000Z',
  created_at: '2026-09-02T15:30:00.000Z',
  updated_at: '2026-09-02T15:30:00.000Z',
  lot_code: 'ADJ09/02/2026',
  expiry_date: null,
  unit_cost_usd: 170,
  received_quantity: 7,
  branch_batch_stock_id: 69261,
  branch_quantity: 5,
  branch_updated_at: '2026-09-02T15:30:00.000Z',
})

type Statement = { sql: string; params?: Record<string, unknown> }
type Actor = { id?: unknown; name?: unknown }

export type SaleIncidentRecoveryV2Request = {
  target: typeof SALE_INCIDENT_RECOVERY_V2_TARGET
  confirmation: typeof SALE_INCIDENT_RECOVERY_V2_CONFIRMATION
  manifest_sha256: string
}

export class SaleIncidentRecoveryV2ValidationError extends Error {}
export class SaleIncidentRecoveryV2ConflictError extends Error {}
export class SaleIncidentRecoveryV2UncertainError extends Error {
  constructor(public readonly operationId: string, public readonly manifestSha256: string) {
    super('The sale 16954 recovery may have committed, but its durable receipt could not be read. Retry the exact held request before taking any other action.')
  }
}

function validation(message: string): never { throw new SaleIncidentRecoveryV2ValidationError(message) }
function conflict(message: string): never { throw new SaleIncidentRecoveryV2ConflictError(message) }

function exactRequest(raw: unknown): SaleIncidentRecoveryV2Request {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) validation('request must be an object')
  const value = raw as Record<string, unknown>
  const actual = Object.keys(value).sort()
  const expected = [...REQUEST_KEYS].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    validation(`request must contain exactly: ${REQUEST_KEYS.join(', ')}`)
  }
  if (value.target !== SALE_INCIDENT_RECOVERY_V2_TARGET) validation('invalid recovery target')
  if (value.confirmation !== SALE_INCIDENT_RECOVERY_V2_CONFIRMATION) validation('invalid confirmation phrase')
  if (typeof value.manifest_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.manifest_sha256)) {
    validation('manifest_sha256 must be a lowercase SHA-256 digest')
  }
  return value as SaleIncidentRecoveryV2Request
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
      WHERE incident_key=@incident`).get<{ id: string; request_digest: string; response_json: string; after_json: string }>({ incident: SALE_INCIDENT_RECOVERY_V2_TARGET })
  } catch (error) {
    if (/no such table/i.test(error instanceof Error ? error.message : String(error))) {
      conflict('Migration 0145 is not applied. No data was changed.')
    }
    throw error
  }
}

async function readCanonicalManifest(db: Pick<D1Compat, 'prepare'>) {
  const [sale, product, positiveLots, effects] = await Promise.all([
    db.prepare(`SELECT s.id,s.receipt_number,s.branch_id,s.sale_status,r.revision,s.created_at,s.updated_at,
      s.subtotal_usd,s.subtotal_khr,s.total_usd,s.total_khr,s.discount_usd,s.discount_khr,
      s.tax_usd,s.tax_khr,s.membership_discount_usd,s.membership_discount_khr,
      s.amount_paid_usd,s.amount_paid_khr,s.change_usd,s.change_khr,s.is_delivery,
      s.delivery_fee_usd,s.delivery_fee_khr,s.delivery_actual_cost_usd,s.delivery_actual_cost_khr,
      s.stock_skipped,s.creation_snapshot_json
      FROM sales s LEFT JOIN sale_write_revisions r ON r.sale_id=s.id WHERE s.id=16954`).get<Record<string, unknown>>(),
    db.prepare(`SELECT p.id,p.name,p.is_active,p.cost_price_usd,p.cost_price_khr,p.stock_quantity,p.updated_at,
      ssr.revision AS product_revision,bs.id AS branch_stock_id,bs.quantity AS branch_quantity,bs.rfid_confirmed_qty
      FROM products p
      LEFT JOIN stock_session_revisions ssr ON ssr.entity_type='product' AND ssr.entity_key=CAST(p.id AS TEXT)
      LEFT JOIN branch_stock bs ON bs.product_id=p.id AND bs.branch_id=2 WHERE p.id=5370`).get<Record<string, unknown>>(),
    db.prepare(`SELECT pb.id,pb.variant_product_id,pb.is_active,pb.received_at,pb.created_at,pb.updated_at,
      pb.lot_code,pb.expiry_date,pb.unit_cost_usd,pb.received_quantity,
      bbs.id AS branch_batch_stock_id,bbs.quantity AS branch_quantity,bbs.updated_at AS branch_updated_at
      FROM product_batches pb JOIN branch_batch_stock bbs ON bbs.batch_id=pb.id AND bbs.branch_id=2
      WHERE pb.variant_product_id=5370 AND pb.is_active=1 AND bbs.quantity>0 ORDER BY pb.id`).all<Record<string, unknown>>(),
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
      FROM sales s WHERE s.id=16954`).get<Record<string, unknown>>(),
  ])
  return {
    schema_version: 1,
    target: SALE_INCIDENT_RECOVERY_V2_TARGET,
    sale,
    product,
    positive_lots: positiveLots,
    effects,
    recovery: {
      id: TARGET.id,
      receipt_number: TARGET.receipt_number,
      status: TARGET.status,
      expected_revision: TARGET.expected_revision,
      expected_revision_after: 3,
      line: TARGET.line,
    },
    cost_evidence: COST_EVIDENCE,
    unknown_line_fields: UNKNOWN_LINE_FIELDS,
    allocation_basis: ALLOCATION_BASIS,
  }
}

type CanonicalManifest = Awaited<ReturnType<typeof readCanonicalManifest>>

function assertExpected(manifest: CanonicalManifest) {
  const sale = manifest.sale
  const effect = manifest.effects
  if (!sale || Number(sale.id) !== TARGET.id || sale.receipt_number !== TARGET.receipt_number
    || Number(sale.branch_id) !== 2 || sale.sale_status !== TARGET.status
    || Number(sale.revision) !== TARGET.expected_revision || sale.created_at !== TARGET.expected_created_at
    || sale.updated_at !== TARGET.expected_updated_at
    || Number(sale.subtotal_usd) !== 185 || Number(sale.subtotal_khr) !== 752025
    || Number(sale.total_usd) !== 185 || Number(sale.total_khr) !== 752025
    || Number(sale.discount_usd) !== 0 || Number(sale.discount_khr) !== 0
    || Number(sale.tax_usd) !== 0 || Number(sale.tax_khr) !== 0
    || Number(sale.membership_discount_usd) !== 0 || Number(sale.membership_discount_khr) !== 0
    || Number(sale.amount_paid_usd) !== 0 || Number(sale.amount_paid_khr) !== 0
    || Number(sale.change_usd) !== -185 || Number(sale.change_khr) !== -740000
    || Number(sale.is_delivery) !== 0 || Number(sale.delivery_fee_usd) !== 0
    || Number(sale.delivery_fee_khr) !== 0 || sale.delivery_actual_cost_usd != null
    || sale.delivery_actual_cost_khr != null || Number(sale.stock_skipped) !== 0) {
    conflict('Sale 16954 changed from its reviewed header/revision fingerprint.')
  }
  let snapshot: { origin?: unknown; products?: Array<Record<string, unknown>> } = {}
  try { snapshot = JSON.parse(String(sale.creation_snapshot_json || '')) } catch { conflict('Sale 16954 has an invalid creation snapshot.') }
  const saved = snapshot.products?.[0]
  if (snapshot.origin !== 'pos' || snapshot.products?.length !== 1
    || Number(saved?.product_id) !== TARGET.line.product_id || saved?.product !== TARGET.line.product_name
    || Number(saved?.quantity) !== TARGET.line.quantity || Number(saved?.unit_price_usd) !== TARGET.line.applied_price_usd
    || Number(saved?.line_total_usd) !== TARGET.line.total_usd) {
    conflict('Sale 16954 creation snapshot no longer matches the reviewed basket.')
  }
  if (!effect || Number(effect.item_count) !== 0 || Number(effect.allocation_count) !== 0
    || Number(effect.movement_count) !== 0 || Number(effect.return_count) !== 0
    || Number(effect.fee_count) !== 0 || Number(effect.record_event_count) !== 0
    || Number(effect.amendment_count) !== 0 || Number(effect.mutation_receipt_count) !== 0
    || Number(effect.sale_audit_count) !== 0 || Number(effect.recovery_history_count) !== 0) {
    conflict('Sale 16954 no longer has the reviewed zero-effect state.')
  }
  const product = manifest.product
  if (!product || Number(product.id) !== TARGET.line.product_id || product.name !== PRODUCT_FINGERPRINT.name
    || Number(product.is_active) !== PRODUCT_FINGERPRINT.is_active
    || Number(product.cost_price_usd) !== PRODUCT_FINGERPRINT.cost_price_usd
    || Number(product.cost_price_khr) !== PRODUCT_FINGERPRINT.cost_price_khr
    || Number(product.stock_quantity) !== PRODUCT_FINGERPRINT.stock_quantity
    || product.updated_at !== PRODUCT_FINGERPRINT.updated_at
    || Number(product.product_revision) !== PRODUCT_FINGERPRINT.product_revision
    || Number(product.branch_stock_id) !== PRODUCT_FINGERPRINT.branch_stock_id
    || Number(product.branch_quantity) !== PRODUCT_FINGERPRINT.branch_quantity
    || Number(product.rfid_confirmed_qty) !== PRODUCT_FINGERPRINT.rfid_confirmed_qty) {
    conflict('Product 5370 changed from its reviewed cost/stock/revision fingerprint.')
  }
  const lot = manifest.positive_lots[0]
  if (manifest.positive_lots.length !== 1 || !lot || Number(lot.id) !== LOT_FINGERPRINT.id
    || Number(lot.variant_product_id) !== TARGET.line.product_id || Number(lot.is_active) !== LOT_FINGERPRINT.is_active
    || lot.received_at !== LOT_FINGERPRINT.received_at || lot.created_at !== LOT_FINGERPRINT.created_at
    || lot.updated_at !== LOT_FINGERPRINT.updated_at || lot.lot_code !== LOT_FINGERPRINT.lot_code
    || lot.expiry_date !== LOT_FINGERPRINT.expiry_date || Number(lot.unit_cost_usd) !== LOT_FINGERPRINT.unit_cost_usd
    || Number(lot.received_quantity) !== LOT_FINGERPRINT.received_quantity
    || Number(lot.branch_batch_stock_id) !== LOT_FINGERPRINT.branch_batch_stock_id
    || Number(lot.branch_quantity) !== LOT_FINGERPRINT.branch_quantity
    || lot.branch_updated_at !== LOT_FINGERPRINT.branch_updated_at) {
    conflict('Product 5370 no longer has the reviewed unique positive Shop lot.')
  }
}

function previewSales() {
  return [{
    id: TARGET.id,
    receipt_number: TARGET.receipt_number,
    status: TARGET.status,
    expected_revision: TARGET.expected_revision,
    line_count: 1,
    stock_effect: 'released_allocation_only',
    subtotal_before_usd: 185,
    subtotal_after_usd: 185,
    total_before_usd: 185,
    total_after_usd: 185,
  }]
}

export async function previewSaleIncidentRecoveryV2(db: Pick<D1Compat, 'prepare'>, actor: Actor) {
  actorIdentity(actor)
  const receipt = await readReceipt(db)
  if (receipt) {
    return {
      success: true as const,
      target: SALE_INCIDENT_RECOVERY_V2_TARGET,
      outcome: 'already_applied' as const,
      request: { target: SALE_INCIDENT_RECOVERY_V2_TARGET, confirmation: SALE_INCIDENT_RECOVERY_V2_CONFIRMATION, manifest_sha256: receipt.request_digest },
      sales: previewSales(),
      blocked_sales: [],
      unknown_line_fields: UNKNOWN_LINE_FIELDS,
      allocation_basis: ALLOCATION_BASIS,
    }
  }
  const manifest = await readCanonicalManifest(db)
  assertExpected(manifest)
  const digest = await sha256(JSON.stringify(manifest))
  return {
    success: true as const,
    target: SALE_INCIDENT_RECOVERY_V2_TARGET,
    outcome: 'apply' as const,
    request: { target: SALE_INCIDENT_RECOVERY_V2_TARGET, confirmation: SALE_INCIDENT_RECOVERY_V2_CONFIRMATION, manifest_sha256: digest },
    sales: previewSales(),
    blocked_sales: [],
    unknown_line_fields: UNKNOWN_LINE_FIELDS,
    allocation_basis: ALLOCATION_BASIS,
  }
}

export type PreparedSaleIncidentRecoveryV2 = {
  outcome: 'apply' | 'already_applied'
  request: SaleIncidentRecoveryV2Request
  identity: { id: number; name: string }
  manifest: CanonicalManifest | null
  statements: Statement[]
  operationId: string
}

export async function prepareSaleIncidentRecoveryV2(
  db: Pick<D1Compat, 'prepare'>,
  rawRequest: unknown,
  actor: Actor,
): Promise<PreparedSaleIncidentRecoveryV2> {
  const request = exactRequest(rawRequest)
  const identity = actorIdentity(actor)
  const receipt = await readReceipt(db)
  if (receipt) {
    if (receipt.request_digest !== request.manifest_sha256) conflict('A different sale 16954 recovery receipt already exists. Fetch a new preview.')
    return { outcome: 'already_applied', request, identity, manifest: null, statements: [], operationId: receipt.id }
  }
  const manifest = await readCanonicalManifest(db)
  assertExpected(manifest)
  const digest = await sha256(JSON.stringify(manifest))
  if (digest !== request.manifest_sha256) conflict('Sale 16954 recovery state changed after preview. Fetch a new preview.')
  const operationId = crypto.randomUUID()
  return { outcome: 'apply', request, identity, manifest, statements: buildStatements(manifest, request, identity, operationId), operationId }
}

function buildStatements(
  manifest: CanonicalManifest,
  request: SaleIncidentRecoveryV2Request,
  actor: { id: number; name: string },
  operationId: string,
): Statement[] {
  const sale = manifest.sale as Record<string, unknown>
  const response = expectedResponse(operationId, request.manifest_sha256, 'applied')
  const line = TARGET.line
  const provenance = {
    kind: SALE_INCIDENT_RECOVERY_V2_TARGET,
    operation_id: operationId,
    manifest_sha256: request.manifest_sha256,
    sale_id: TARGET.id,
    source: 'immutable_creation_snapshot_and_pre_sale_backup_product_cost',
    cost_evidence: COST_EVIDENCE,
    optional_line_fields_unknown: UNKNOWN_LINE_FIELDS,
    numeric_discounts: 'zero_proven_by_header_and_line_equations',
    allocation_basis: ALLOCATION_BASIS,
    stock_effect: 'released_allocation_only',
    reversible: false,
  }
  const guardParams = {
    incident: SALE_INCIDENT_RECOVERY_V2_TARGET,
    receipt_number: TARGET.receipt_number,
    created_at: TARGET.expected_created_at,
    updated_at: TARGET.expected_updated_at,
    snapshot: sale.creation_snapshot_json,
    product_name: line.product_name,
    product_updated_at: PRODUCT_FINGERPRINT.updated_at,
    lot_code: LOT_FINGERPRINT.lot_code,
    lot_updated_at: LOT_FINGERPRINT.updated_at,
    branch_updated_at: LOT_FINGERPRINT.branch_updated_at,
  }
  return [{
    sql: `INSERT INTO sale_incident_recovery_guards(id,guard_value)
      SELECT 1,CASE WHEN
        NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
        AND (SELECT COUNT(*) FROM sale_incident_recovery_receipts WHERE incident_key=@incident)=0
        AND EXISTS (SELECT 1 FROM sales s JOIN sale_write_revisions r ON r.sale_id=s.id
          WHERE s.id=16954 AND s.receipt_number=@receipt_number AND s.branch_id=2 AND s.sale_status='awaiting_payment'
          AND r.revision=1 AND s.created_at=@created_at AND s.updated_at=@updated_at
          AND s.subtotal_usd=185 AND s.subtotal_khr=752025 AND s.total_usd=185 AND s.total_khr=752025
          AND s.discount_usd=0 AND s.discount_khr=0 AND s.tax_usd=0 AND s.tax_khr=0
          AND s.membership_discount_usd=0 AND s.membership_discount_khr=0
          AND s.amount_paid_usd=0 AND s.amount_paid_khr=0 AND s.change_usd=-185 AND s.change_khr=-740000
          AND s.is_delivery=0 AND s.delivery_fee_usd=0 AND s.delivery_fee_khr=0
          AND s.delivery_actual_cost_usd IS NULL AND s.delivery_actual_cost_khr IS NULL
          AND s.stock_skipped=0 AND s.creation_snapshot_json=@snapshot)
        AND (SELECT COUNT(*) FROM sale_items WHERE sale_id=16954)=0
        AND (SELECT COUNT(*) FROM sale_item_batch_allocations a JOIN sale_items si ON si.id=a.sale_item_id WHERE si.sale_id=16954)=0
        AND (SELECT COUNT(*) FROM inventory_movements WHERE reference_id=16954 AND movement_type IN ('sale','sale_from_damaged'))=0
        AND (SELECT COUNT(*) FROM returns WHERE sale_id=16954)=0
        AND (SELECT COUNT(*) FROM fees WHERE sale_id=16954 OR id=(SELECT cancel_fee_id FROM sales WHERE id=16954))=0
        AND (SELECT COUNT(*) FROM sale_record_events WHERE sale_id=16954)=0
        AND (SELECT COUNT(*) FROM sale_amendments WHERE sale_id=16954)=0
        AND (SELECT COUNT(*) FROM sale_mutation_receipts WHERE sale_id=16954)=0
        AND (SELECT COUNT(*) FROM audit_logs WHERE entity='sale' AND entity_id='16954')=0
        AND (SELECT COUNT(*) FROM action_history WHERE entity='sale_incident_recovery' AND entity_id='16954')=0
        AND EXISTS (SELECT 1 FROM products p
          JOIN stock_session_revisions ssr ON ssr.entity_type='product' AND ssr.entity_key=CAST(p.id AS TEXT)
          JOIN branch_stock bs ON bs.product_id=p.id AND bs.branch_id=2
          WHERE p.id=5370 AND p.name=@product_name AND p.is_active=1 AND p.cost_price_usd=170 AND p.cost_price_khr=0
          AND p.stock_quantity=7 AND p.updated_at=@product_updated_at AND ssr.revision=1
          AND bs.id=52786 AND bs.quantity=5 AND bs.rfid_confirmed_qty=0)
        AND (SELECT COUNT(*) FROM product_batches pb JOIN branch_batch_stock bbs ON bbs.batch_id=pb.id AND bbs.branch_id=2
          WHERE pb.variant_product_id=5370 AND pb.is_active=1 AND bbs.quantity>0)=1
        AND EXISTS (SELECT 1 FROM product_batches pb JOIN branch_batch_stock bbs ON bbs.batch_id=pb.id AND bbs.branch_id=2
          WHERE pb.id=56737 AND pb.variant_product_id=5370 AND pb.is_active=1
          AND pb.received_at='2026-09-02T15:30:00.000Z' AND pb.created_at='2026-09-02T15:30:00.000Z'
          AND pb.updated_at=@lot_updated_at AND pb.lot_code=@lot_code AND pb.expiry_date IS NULL
          AND pb.unit_cost_usd=170 AND pb.received_quantity=7
          AND bbs.id=69261 AND bbs.quantity=5 AND bbs.updated_at=@branch_updated_at)
        THEN 1 ELSE 0 END`,
    params: guardParams,
  }, {
    sql: `INSERT INTO sale_incident_recovery_receipts(id,incident_key,actor_id,actor_name,request_digest,request_json,before_json,after_json,response_json,backup_created)
      VALUES(@id,@incident,@actor_id,@actor_name,@digest,@request,@before,@after,@response,1)`,
    params: {
      id: operationId,
      incident: SALE_INCIDENT_RECOVERY_V2_TARGET,
      actor_id: actor.id,
      actor_name: actor.name,
      digest: request.manifest_sha256,
      request: JSON.stringify(request),
      before: JSON.stringify(manifest),
      after: JSON.stringify({ target: SALE_INCIDENT_RECOVERY_V2_TARGET, expected_revisions: { 16954: 3 } }),
      response: JSON.stringify(response),
    },
  }, {
    sql: `INSERT INTO sale_items(sale_id,product_id,product_name,sku,quantity,unit,applied_price_usd,applied_price_khr,cost_price_usd,cost_price_khr,total_usd,total_khr,branch_id,price_mode,product_discount_type,product_discount_label,product_discount_usd,product_discount_khr,base_price_usd,base_price_khr,manual_discount_type,manual_discount_value,manual_discount_usd,manual_discount_khr,batch_id,batch_label,batch_expiry_date,damaged_lot_id)
      VALUES(16954,5370,@product_name,NULL,1,NULL,185,752025,170,0,185,752025,2,NULL,NULL,NULL,0,0,NULL,NULL,NULL,0,0,0,56737,@lot_code,NULL,NULL)`,
    params: { product_name: line.product_name, lot_code: line.batch_label },
  }, {
    sql: `INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,lot_code,expiry_date,released_quantity,released_at)
      SELECT id,56737,2,1,@lot_code,NULL,1,CURRENT_TIMESTAMP FROM sale_items WHERE sale_id=16954 AND product_id=5370`,
    params: { lot_code: line.batch_label },
  }, {
    sql: `INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name)
      VALUES('global','sale_incident_recovery','16954',@label,0,'recorded','{}',@provenance,@actor_id,@actor_name)`,
    params: {
      label: `Recover persisted line for sale ${TARGET.receipt_number}`,
      provenance: JSON.stringify(provenance),
      actor_id: actor.id,
      actor_name: actor.name,
    },
  }, {
    sql: `INSERT INTO sale_incident_recovery_members(operation_id,sale_id,history_id,before_json,after_json)
      VALUES(@operation_id,16954,last_insert_rowid(),@before,@after)`,
    params: {
      operation_id: operationId,
      before: JSON.stringify({ sale_id: 16954, item_count: 0, revision: 1 }),
      after: JSON.stringify({ sale_id: 16954, item_count: 1, revision: 3, line }),
    },
  }, {
    sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,old_value,new_value)
      VALUES(@actor_id,@actor_name,'recover_missing_sale_items','sale','16954',@details,'sales','16954',@before,@after)`,
    params: {
      actor_id: actor.id,
      actor_name: actor.name,
      details: JSON.stringify(provenance),
      before: JSON.stringify({ item_count: 0, revision: 1 }),
      after: JSON.stringify({ item_count: 1, revision: 3 }),
    },
  }, {
    sql: `UPDATE sale_incident_recovery_guards SET guard_value=CASE WHEN
      (SELECT COUNT(*) FROM sale_items WHERE sale_id=16954)=1
      AND EXISTS (SELECT 1 FROM sale_items WHERE sale_id=16954 AND product_id=5370 AND product_name=@product_name
        AND quantity=1 AND applied_price_usd=185 AND applied_price_khr=752025 AND cost_price_usd=170 AND cost_price_khr=0
        AND total_usd=185 AND total_khr=752025 AND branch_id=2 AND batch_id=56737 AND batch_label=@lot_code
        AND price_mode IS NULL AND base_price_usd IS NULL AND base_price_khr IS NULL
        AND product_discount_usd=0 AND product_discount_khr=0 AND manual_discount_usd=0 AND manual_discount_khr=0)
      AND (SELECT COUNT(*) FROM sale_item_batch_allocations a JOIN sale_items si ON si.id=a.sale_item_id
        WHERE si.sale_id=16954 AND si.product_id=5370 AND a.batch_id=56737 AND a.branch_id=2
        AND a.quantity=1 AND a.lot_code=@lot_code AND a.released_quantity=1 AND a.released_at IS NOT NULL)=1
      AND (SELECT COUNT(*) FROM inventory_movements WHERE reference_id=16954 AND movement_type IN ('sale','sale_from_damaged'))=0
      AND EXISTS (SELECT 1 FROM sale_write_revisions WHERE sale_id=16954 AND revision=3)
      AND EXISTS (SELECT 1 FROM sales WHERE id=16954 AND sale_status='awaiting_payment'
        AND subtotal_usd=185 AND subtotal_khr=752025 AND total_usd=185 AND total_khr=752025
        AND amount_paid_usd=0 AND amount_paid_khr=0 AND change_usd=-185 AND change_khr=-740000)
      AND EXISTS (SELECT 1 FROM products p JOIN branch_stock bs ON bs.product_id=p.id AND bs.branch_id=2
        JOIN branch_batch_stock bbs ON bbs.id=69261 AND bbs.batch_id=56737 AND bbs.branch_id=2
        WHERE p.id=5370 AND p.stock_quantity=7 AND p.updated_at=@product_updated_at AND bs.id=52786 AND bs.quantity=5 AND bbs.quantity=5)
      AND (SELECT COUNT(*) FROM sale_incident_recovery_members WHERE operation_id=@operation_id AND sale_id=16954)=1
      AND (SELECT COUNT(*) FROM action_history WHERE entity='sale_incident_recovery' AND entity_id='16954' AND reversible=0 AND status='recorded')=1
      AND (SELECT COUNT(*) FROM audit_logs WHERE action='recover_missing_sale_items' AND entity='sale' AND entity_id='16954')=1
      THEN 1 ELSE 0 END WHERE id=1`,
    params: {
      operation_id: operationId,
      product_name: line.product_name,
      lot_code: line.batch_label,
      product_updated_at: PRODUCT_FINGERPRINT.updated_at,
    },
  }, {
    sql: 'DELETE FROM sale_incident_recovery_guards WHERE id=1',
  }]
}

function expectedResponse(operationId: string, manifestSha256: string, outcome: 'applied' | 'already_applied') {
  return {
    success: true,
    outcome,
    operation_id: operationId,
    manifest_sha256: manifestSha256,
    affected: { sales: 1, items: 1, allocations: 1, movements: 0, histories: 1, audits: 1 },
  }
}

function storedResponse(row: { id: string; request_digest: string; response_json: string }, outcome: 'applied' | 'already_applied') {
  let stored: Record<string, unknown>
  try { stored = JSON.parse(row.response_json) as Record<string, unknown> } catch { conflict('The durable sale 16954 recovery receipt is malformed. No recovery was retried.') }
  const expected = expectedResponse(row.id, row.request_digest, 'applied')
  if (stored.success !== true || stored.outcome !== 'applied' || stored.operation_id !== expected.operation_id
    || stored.manifest_sha256 !== expected.manifest_sha256
    || JSON.stringify(stored.affected) !== JSON.stringify(expected.affected)) {
    conflict('The durable sale 16954 recovery receipt does not match the fixed contract. No recovery was retried.')
  }
  return { ...stored, outcome, operation_id: row.id, verification_pending: false }
}

async function verifyImmediateAfterState(db: Pick<D1Compat, 'prepare'>, operationId: string): Promise<boolean> {
  const counts = await db.prepare(`SELECT
    (SELECT COUNT(*) FROM sale_items WHERE sale_id=16954) AS items,
    (SELECT COUNT(*) FROM sale_items WHERE sale_id=16954 AND product_id=5370 AND quantity=1
      AND applied_price_usd=185 AND applied_price_khr=752025 AND cost_price_usd=170 AND cost_price_khr=0
      AND total_usd=185 AND total_khr=752025 AND batch_id=56737
      AND price_mode IS NULL AND base_price_usd IS NULL AND base_price_khr IS NULL) AS matched_items,
    (SELECT COUNT(*) FROM sale_item_batch_allocations a JOIN sale_items si ON si.id=a.sale_item_id
      WHERE si.sale_id=16954 AND a.batch_id=56737 AND a.branch_id=2 AND a.quantity=1
      AND a.released_quantity=1 AND a.released_at IS NOT NULL) AS allocations,
    (SELECT COUNT(*) FROM inventory_movements WHERE reference_id=16954 AND movement_type IN ('sale','sale_from_damaged')) AS movements,
    (SELECT COUNT(*) FROM sale_incident_recovery_members WHERE operation_id=@id AND sale_id=16954) AS members,
    (SELECT COUNT(*) FROM action_history WHERE entity='sale_incident_recovery' AND entity_id='16954' AND reversible=0 AND status='recorded') AS histories,
    (SELECT COUNT(*) FROM audit_logs WHERE action='recover_missing_sale_items' AND entity='sale' AND entity_id='16954') AS audits,
    (SELECT COUNT(*) FROM sale_write_revisions WHERE sale_id=16954 AND revision=3) AS revisions`).get<Record<string, unknown>>({ id: operationId })
  return Boolean(counts && Number(counts.items) === 1 && Number(counts.matched_items) === 1
    && Number(counts.allocations) === 1 && Number(counts.movements) === 0 && Number(counts.members) === 1
    && Number(counts.histories) === 1 && Number(counts.audits) === 1 && Number(counts.revisions) === 1)
}

export async function applySaleIncidentRecoveryV2(
  db: Pick<D1Compat, 'prepare' | 'batch'>,
  prepared: PreparedSaleIncidentRecoveryV2,
) {
  if (prepared.outcome === 'already_applied') {
    const receipt = await readReceipt(db)
    if (!receipt || receipt.id !== prepared.operationId || receipt.request_digest !== prepared.request.manifest_sha256) {
      conflict('The durable sale 16954 recovery receipt changed before replay. No recovery was retried.')
    }
    return storedResponse(receipt, 'already_applied')
  }
  try {
    await db.batch(prepared.statements)
  } catch (error) {
    let receipt
    try { receipt = await readReceipt(db) } catch {
      throw new SaleIncidentRecoveryV2UncertainError(prepared.operationId, prepared.request.manifest_sha256)
    }
    if (!receipt || receipt.id !== prepared.operationId || receipt.request_digest !== prepared.request.manifest_sha256) {
      try {
        const current = await readCanonicalManifest(db)
        assertExpected(current)
        if (await sha256(JSON.stringify(current)) !== prepared.request.manifest_sha256) {
          conflict('Sale 16954 recovery state changed after backup. Fetch a new preview.')
        }
      } catch (refreshError) {
        if (refreshError instanceof SaleIncidentRecoveryV2ConflictError) throw refreshError
      }
      throw error
    }
    const response = storedResponse(receipt, 'applied')
    let verified = false
    try { verified = await verifyImmediateAfterState(db, prepared.operationId) } catch { /* durable receipt still proves the commit */ }
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
    if (error instanceof SaleIncidentRecoveryV2ConflictError) throw error
    return { ...fallback, verification_pending: true }
  }
}
