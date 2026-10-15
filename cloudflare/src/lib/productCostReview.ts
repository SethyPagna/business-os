import { CATALOG_COST_DERIVE_SQL, CATALOG_COST_HAS_RECORDED_LOT_SQL, catalogCostFormulaSql, type CatalogCostInputPolicy } from './catalogCostRecompute'

export type MergeCostFallback = { usd: number | null; khr: number | null }
export type MergeCostOutcome = {
  version: 1
  keeperId: number
  original: MergeCostFallback
  reviewKey: string
  beforeKey: string | null
  rootKey: string
}
type Statement = { sql: string; params: Record<string, unknown> }

export const COST_REVIEW_MONEY_FIELDS = ['cost_price_usd', 'cost_price_khr', 'selling_price_usd', 'selling_price_khr', 'wholesale_price_usd', 'wholesale_price_khr', 'purchase_price_usd', 'purchase_price_khr'] as const
export type CostReviewState = Record<typeof COST_REVIEW_MONEY_FIELDS[number], number | null> & { id: number; revision: number; cost_review_key: string | null }

export async function costReviewConfirmationQuote(state: CostReviewState): Promise<{ version: 1; reviewed_digest: string; usd: number } | null> {
  if (!state.cost_review_key || typeof state.cost_price_usd !== 'number' || !Number.isFinite(state.cost_price_usd) || state.cost_price_usd < 0) return null
  const bytes = new TextEncoder().encode(JSON.stringify(['product_cost_review_confirmation', 1, state.id, state.revision, state.cost_review_key, ...COST_REVIEW_MONEY_FIELDS.map(field => state[field])]))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return { version: 1, reviewed_digest: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''), usd: state.cost_price_usd }
}

export function costReviewConfirmationStatements(state: CostReviewState, receipt: { actorId: number; actorName: string | null; requestId: string; request: string; nonce: string }): Statement[] {
  const params: Record<string, unknown> = { productId: state.id, entityId: String(state.id), revision: state.revision, reviewKey: state.cost_review_key, ...receipt }
  for (const field of COST_REVIEW_MONEY_FIELDS) params[field] = state[field]
  const prior = `SELECT 1 FROM audit_logs WHERE action='cost_override' AND entity='product' AND entity_id=@entityId AND user_id=@actorId AND json_extract(CASE WHEN json_valid(details) THEN details ELSE '{}' END,'$.client_request_id')=@requestId`
  const current = `SELECT 1 FROM products WHERE id=@productId AND is_active=1 AND cost_review_key IS @reviewKey AND COALESCE((SELECT revision FROM stock_session_revisions WHERE entity_type='product' AND entity_key=CAST(products.id AS TEXT)),0)=@revision AND ${COST_REVIEW_MONEY_FIELDS.map(field => `${field} IS @${field}`).join(' AND ')}`
  const details = JSON.stringify({ kind: 'product.cost-review-confirm', version: 1, client_request_id: receipt.requestId, request: receipt.request, claim_nonce: receipt.nonce,
    cost_review: { version: 1, kind: 'confirm', before_key: state.cost_review_key, after_key: null, revision_before: state.revision, after_usd: state.cost_price_usd, after_khr: state.cost_price_khr } })
  return [
    { sql: `SELECT CASE WHEN EXISTS(${prior}) OR EXISTS(${current}) THEN 1 ELSE json('product_cost_review_state_conflict') END`, params },
    { sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details) SELECT @actorId,@actorName,'cost_override','product',@entityId,@details WHERE NOT EXISTS(${prior})`, params: { ...params, details } },
    { sql: `UPDATE products SET cost_review_key=NULL WHERE id=@productId AND EXISTS(SELECT 1 FROM audit_logs WHERE action='cost_override' AND entity='product' AND entity_id=@entityId AND user_id=@actorId AND json_extract(details,'$.claim_nonce')=@nonce)`, params },
  ]
}

export function mergeCostOutcome(keeperId: number, original: MergeCostFallback, beforeKey: string | null = null, rootKey?: string): MergeCostOutcome {
  if (!Number.isSafeInteger(keeperId) || keeperId <= 0) throw new Error('Invalid merge cost keeper identity')
  for (const value of [original.usd, original.khr]) if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error('Invalid merge cost fallback')
  if (beforeKey !== null && !/^[a-f0-9]{32}$/.test(beforeKey)) throw new Error('Invalid prior merge cost review identity')
  const reviewKey = crypto.randomUUID().replaceAll('-', '')
  if (rootKey !== undefined && !/^[a-f0-9]{32}$/.test(rootKey)) throw new Error('Invalid root merge cost review identity')
  return { version: 1, keeperId, original: { ...original }, reviewKey, beforeKey, rootKey: rootKey ?? reviewKey }
}

export function parseMergeCostOutcome(value: unknown): MergeCostOutcome | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as MergeCostOutcome
  if (candidate.version !== 1 || !Number.isSafeInteger(candidate.keeperId) || candidate.keeperId <= 0
    || typeof candidate.reviewKey !== 'string' || !/^[a-f0-9]{32}$/.test(candidate.reviewKey)
    || typeof candidate.rootKey !== 'string' || !/^[a-f0-9]{32}$/.test(candidate.rootKey)
    || !Object.hasOwn(candidate, 'beforeKey') || (candidate.beforeKey !== null && (typeof candidate.beforeKey !== 'string' || !/^[a-f0-9]{32}$/.test(candidate.beforeKey)))
    || !candidate.original || !Object.hasOwn(candidate.original, 'usd') || !Object.hasOwn(candidate.original, 'khr')) return null
  for (const value of [candidate.original.usd, candidate.original.khr]) {
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) return null
  }
  return candidate
}

function reviewMoneyJsonSql(value: string): string {
  return `json(CASE WHEN (${value}) IS NULL THEN 'null' ELSE printf('%!.17g',(${value})) END)`
}

export function mergeCostReviewStatements(outcome: MergeCostOutcome, actor: { id: number | null; name: string | null }, operationId: string | null = null, generation = 0): Statement[] {
  if (!Number.isSafeInteger(generation) || generation < 0) throw new Error('Invalid merge cost generation')
  const afterKey = `CASE WHEN ${CATALOG_COST_HAS_RECORDED_LOT_SQL} THEN NULL ELSE @reviewKey END`
  const manual = `(SELECT CASE WHEN typeof(cost_usd) IN ('integer','real') AND cost_usd>=0 AND cost_usd<=1.7976931348623157e308 THEN cost_usd END
    FROM product_cost_entries WHERE product_id=products.id ORDER BY id DESC LIMIT 1)`
  const usd = `CASE WHEN ${CATALOG_COST_HAS_RECORDED_LOT_SQL} THEN COALESCE(${CATALOG_COST_DERIVE_SQL},@fallbackUsd)
    ELSE COALESCE(${manual},@fallbackUsd) END`
  const params = { productId: outcome.keeperId, reviewKey: outcome.reviewKey, fallbackUsd: outcome.original.usd,
    fallbackKhr: outcome.original.khr, actorId: actor.id, actorName: actor.name, beforeKey: outcome.beforeKey, rootKey: outcome.rootKey,
    operationId, costGeneration: generation, eventKind: outcome.rootKey === outcome.reviewKey ? 'merge' : 'merge_redo' }
  return [{ sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM products WHERE id=@productId AND cost_review_key IS @beforeKey)
    THEN 1 ELSE json_extract('', '$') END AS merge_review_guard`, params },
  { sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details)
    SELECT @actorId,@actorName,'cost_override','product',CAST(products.id AS TEXT),json_object('cost_review',json_object(
      'version',1,'kind',@eventKind,'operation_key',@reviewKey,'root_key',@rootKey,'merge_operation_id',@operationId,'generation',@costGeneration,'revision_before',COALESCE((SELECT revision FROM stock_session_revisions WHERE entity_type='product' AND entity_key=CAST(products.id AS TEXT)),0),
      'before_key',cost_review_key,'after_key',${afterKey},'fallback_usd',${reviewMoneyJsonSql('@fallbackUsd')},'fallback_khr',${reviewMoneyJsonSql('@fallbackKhr')},
      'after_usd',${reviewMoneyJsonSql(usd)},'after_khr',${reviewMoneyJsonSql('@fallbackKhr')},'recorded_lot',${CATALOG_COST_HAS_RECORDED_LOT_SQL}))
    FROM products WHERE id=@productId`, params },
  { sql: `UPDATE products SET cost_price_usd=${usd},purchase_price_usd=${usd},cost_price_khr=@fallbackKhr,purchase_price_khr=@fallbackKhr,
      cost_review_key=${afterKey} WHERE id=@productId`, params }]
}

export function mergeCostUndoStatements(outcome: MergeCostOutcome, context: { historyId: number; snapshotId: number; operationId: string; generation: number }, actor: { id: number | null; name: string | null }): Statement[] {
  const params = { productId: outcome.keeperId, beforeKey: outcome.beforeKey, rootKey: outcome.rootKey,
    eventKey: crypto.randomUUID().replaceAll('-', ''), actorId: actor.id, actorName: actor.name, ...context }
  const afterKey = `CASE WHEN ${CATALOG_COST_HAS_RECORDED_LOT_SQL} THEN NULL ELSE @beforeKey END`
  return [{ sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details)
    SELECT @actorId,@actorName,'cost_override','product',CAST(products.id AS TEXT),json_object('cost_review',json_object(
      'version',1,'kind','merge_undo','operation_key',@eventKey,'root_key',@rootKey,'history_id',@historyId,'snapshot_id',@snapshotId,
      'merge_operation_id',@operationId,'generation',@generation,'before_key',cost_review_key,'after_key',${afterKey},
      'revision_before',COALESCE((SELECT revision FROM stock_session_revisions WHERE entity_type='product' AND entity_key=CAST(products.id AS TEXT)),0),
      'after_usd',${reviewMoneyJsonSql('cost_price_usd')},'after_khr',${reviewMoneyJsonSql('cost_price_khr')})) FROM products WHERE id=@productId`, params },
  { sql: `UPDATE products SET cost_review_key=${afterKey} WHERE id=@productId`, params }]
}

export function productCostReviewGuardSql({ inputPolicy = 'validated' }: { inputPolicy?: CatalogCostInputPolicy } = {}): string {
  return `CREATE TRIGGER product_cost_review_insert_guard_0255 BEFORE INSERT ON products
WHEN NEW.cost_review_key IS NOT NULL
BEGIN SELECT RAISE(ABORT,'product_cost_review_write_refused'); END;
${productCostReviewUpdateGuardSql({ inputPolicy })}`
}

export function productCostReviewUpdateGuardSql({ inputPolicy = 'validated' }: { inputPolicy?: CatalogCostInputPolicy } = {}): string {
  const formula = catalogCostFormulaSql(inputPolicy)
  const event = "CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END"
  return `CREATE TRIGGER product_cost_review_update_guard_0255 BEFORE UPDATE OF cost_review_key ON products
WHEN NEW.cost_review_key IS NOT OLD.cost_review_key
  AND NOT (NEW.cost_review_key IS NULL AND EXISTS(SELECT 1 FROM products WHERE id=OLD.id AND ${formula.hasRecordedLot}
    AND NEW.cost_price_usd IS (${formula.derive})))
  AND NOT EXISTS(SELECT 1 FROM audit_logs a WHERE a.action='cost_override' AND a.entity='product' AND a.entity_id=CAST(OLD.id AS TEXT)
    AND json_extract(${event},'$.cost_review.version')=1 AND json_extract(${event},'$.cost_review.kind') IN ('merge','merge_undo','merge_redo')
    AND json_extract(${event},'$.cost_review.before_key') IS OLD.cost_review_key
    AND json_extract(${event},'$.cost_review.after_key') IS NEW.cost_review_key
    AND json_extract(${event},'$.cost_review.revision_before')=COALESCE((SELECT revision FROM stock_session_revisions WHERE entity_type='product' AND entity_key=CAST(OLD.id AS TEXT)),0)
    AND json_extract(${event},'$.cost_review.after_usd') IS NEW.cost_price_usd
    AND json_extract(${event},'$.cost_review.after_khr') IS NEW.cost_price_khr
    AND (json_extract(${event},'$.cost_review.kind')='merge_undo' AND EXISTS(SELECT 1 FROM action_history h
      WHERE h.id=json_extract(${event},'$.cost_review.history_id')
        AND json_extract(h.undo_payload,'$.snapshot_id')=json_extract(${event},'$.cost_review.snapshot_id')
        AND json_extract(h.undo_payload,'$.operation_id')=json_extract(${event},'$.cost_review.merge_operation_id')
        AND json_extract(h.undo_payload,'$.generation')=json_extract(${event},'$.cost_review.generation'))
      OR json_extract(${event},'$.cost_review.kind') IN ('merge','merge_redo') AND (NEW.cost_review_key IS NULL OR json_extract(${event},'$.cost_review.operation_key')=NEW.cost_review_key)))
BEGIN SELECT RAISE(ABORT,'product_cost_review_write_refused'); END;
`
}

export function productCostReviewConfirmationGuardSql(): string {
  const event = "CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END"
  const unchanged = COST_REVIEW_MONEY_FIELDS.map(field => `NEW.${field} IS OLD.${field}`).join(' AND ')
  const confirmation = `AND NOT EXISTS(SELECT 1 FROM audit_logs a WHERE a.action='cost_override' AND a.entity='product' AND a.entity_id=CAST(OLD.id AS TEXT)
    AND json_extract(${event},'$.kind')='product.cost-review-confirm' AND json_extract(${event},'$.version')=1
    AND json_extract(${event},'$.cost_review.version')=1 AND json_extract(${event},'$.cost_review.kind')='confirm'
    AND OLD.cost_review_key IS NOT NULL AND NEW.cost_review_key IS NULL
    AND typeof(OLD.cost_price_usd) IN ('integer','real') AND OLD.cost_price_usd>=0 AND OLD.cost_price_usd<=1.7976931348623157e308
    AND ${unchanged}
    AND json_extract(${event},'$.cost_review.before_key') IS OLD.cost_review_key
    AND json_type(${event},'$.cost_review.after_key')='null'
    AND json_extract(${event},'$.cost_review.revision_before')=COALESCE((SELECT revision FROM stock_session_revisions WHERE entity_type='product' AND entity_key=CAST(OLD.id AS TEXT)),0)
    AND json_extract(${event},'$.cost_review.after_usd') IS NEW.cost_price_usd AND json_extract(${event},'$.cost_review.after_khr') IS NEW.cost_price_khr)
  `
  return productCostReviewUpdateGuardSql().replace('  AND NOT EXISTS(SELECT 1 FROM audit_logs a', `  ${confirmation}AND NOT EXISTS(SELECT 1 FROM audit_logs a`)
}
