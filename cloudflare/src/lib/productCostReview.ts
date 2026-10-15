import { CATALOG_COST_DERIVE_SQL, CATALOG_COST_HAS_RECORDED_LOT_SQL } from './catalogCostRecompute'

export type MergeCostFallback = { usd: number | null; khr: number | null }
export type MergeCostOutcome = {
  version: 1
  keeperId: number
  original: MergeCostFallback
  reviewKey: string
}
type Statement = { sql: string; params: Record<string, unknown> }

export function mergeCostOutcome(keeperId: number, original: MergeCostFallback): MergeCostOutcome {
  if (!Number.isSafeInteger(keeperId) || keeperId <= 0) throw new Error('Invalid merge cost keeper identity')
  for (const value of [original.usd, original.khr]) if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error('Invalid merge cost fallback')
  return { version: 1, keeperId, original: { ...original }, reviewKey: crypto.randomUUID().replaceAll('-', '') }
}

export function mergeCostReviewStatements(outcome: MergeCostOutcome, actor: { id: number | null; name: string | null }): Statement[] {
  const afterKey = `CASE WHEN ${CATALOG_COST_HAS_RECORDED_LOT_SQL} THEN NULL ELSE @reviewKey END`
  const usd = `COALESCE(${CATALOG_COST_DERIVE_SQL},@fallbackUsd)`
  const params = { productId: outcome.keeperId, reviewKey: outcome.reviewKey, fallbackUsd: outcome.original.usd,
    fallbackKhr: outcome.original.khr, actorId: actor.id, actorName: actor.name }
  return [{ sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details)
    SELECT @actorId,@actorName,'cost_override','product',CAST(products.id AS TEXT),json_object('cost_review',json_object(
      'version',1,'kind','merge','operation_key',@reviewKey,'revision_before',COALESCE((SELECT revision FROM stock_session_revisions WHERE entity_type='product' AND entity_key=CAST(products.id AS TEXT)),0),
      'before_key',cost_review_key,'after_key',${afterKey},'fallback_usd',@fallbackUsd,'fallback_khr',@fallbackKhr,
      'after_usd',${usd},'after_khr',@fallbackKhr,'recorded_lot',${CATALOG_COST_HAS_RECORDED_LOT_SQL}))
    FROM products WHERE id=@productId`, params },
  { sql: `UPDATE products SET cost_price_usd=${usd},purchase_price_usd=${usd},cost_price_khr=@fallbackKhr,purchase_price_khr=@fallbackKhr,
      cost_review_key=${afterKey} WHERE id=@productId`, params }]
}

export function productCostReviewGuardSql(): string {
  const event = "CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END"
  return `CREATE TRIGGER product_cost_review_insert_guard_0255 BEFORE INSERT ON products
WHEN NEW.cost_review_key IS NOT NULL
BEGIN SELECT RAISE(ABORT,'product_cost_review_write_refused'); END;
CREATE TRIGGER product_cost_review_update_guard_0255 BEFORE UPDATE OF cost_review_key ON products
WHEN NEW.cost_review_key IS NOT OLD.cost_review_key
  AND NOT (NEW.cost_review_key IS NULL AND EXISTS(SELECT 1 FROM products WHERE id=OLD.id AND ${CATALOG_COST_HAS_RECORDED_LOT_SQL}
    AND NEW.cost_price_usd IS (${CATALOG_COST_DERIVE_SQL})))
  AND NOT EXISTS(SELECT 1 FROM audit_logs a WHERE a.action='cost_override' AND a.entity='product' AND a.entity_id=CAST(OLD.id AS TEXT)
    AND json_extract(${event},'$.cost_review.version')=1 AND json_extract(${event},'$.cost_review.kind')='merge'
    AND json_extract(${event},'$.cost_review.before_key') IS OLD.cost_review_key
    AND json_extract(${event},'$.cost_review.after_key') IS NEW.cost_review_key
    AND json_extract(${event},'$.cost_review.revision_before')=COALESCE((SELECT revision FROM stock_session_revisions WHERE entity_type='product' AND entity_key=CAST(OLD.id AS TEXT)),0)
    AND (NEW.cost_review_key IS NULL OR json_extract(${event},'$.cost_review.operation_key')=NEW.cost_review_key))
BEGIN SELECT RAISE(ABORT,'product_cost_review_write_refused'); END;
`
}
