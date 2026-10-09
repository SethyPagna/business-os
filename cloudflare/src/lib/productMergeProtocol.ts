import { planProductMergeCaseSnapshot } from './productMergeSnapshot'

export const PRODUCT_MERGE_PLAN_V2 = 'product.merge.plan.v2'
export const PRODUCT_MERGE_TRANSITION_V2 = 'product.merge.transition.v2'

export type ProductMergePointer = Readonly<{
  applier: 'product.merge'
  version: 2
  plan_id: number
  operation_id: string
  generation: number
  seal_id: number | null
}>

export function productMergePointer(planId: number, operationId: string, generation: number, sealId: number | null): ProductMergePointer {
  if (!Number.isSafeInteger(planId) || planId <= 0 || typeof operationId !== 'string' || !operationId.trim() || operationId.length > 200
    || !Number.isSafeInteger(generation) || generation < -1 || generation >= Number.MAX_SAFE_INTEGER
    || (generation === -1 ? sealId !== null : !Number.isSafeInteger(sealId) || Number(sealId) <= 0)) {
    throw new Error('merge_state_conflict')
  }
  return Object.freeze({ applier: 'product.merge', version: 2, plan_id: planId, operation_id: operationId, generation, seal_id: sealId })
}

export function productMergeProtocolSchemaSql(): string {
  const planKind = PRODUCT_MERGE_PLAN_V2
  const transitionKind = PRODUCT_MERGE_TRANSITION_V2
  const permit = "EXISTS(SELECT 1 FROM system_flags WHERE key='stock_transaction_permit' AND value='counted-tagged-subset-v1')"
  const field = (row: string, key: string) => `json_extract(${row}.payload_json,'$.${key}')`
  const pointerIdentity = (pointer: string, plan: string, operation: string) => `
    json_valid(${pointer}) AND json_extract(${pointer},'$.applier')='product.merge'
    AND json_type(${pointer},'$.version')='integer' AND json_extract(${pointer},'$.version')=2
    AND json_type(${pointer},'$.plan_id')='integer' AND json_extract(${pointer},'$.plan_id')=${plan}
    AND json_extract(${pointer},'$.operation_id')=${operation}
    AND json_type(${pointer},'$.generation')='integer'`
  const currentCapture = planProductMergeCaseSnapshot(1, 2, []).reads[0].sql
    .replaceAll('@keeperId', field('NEW', 'keeper_id')).replaceAll('@duplicateId', field('NEW', 'loser_id'))
  const actualSource = `${field('NEW', 'source_capture')}=(SELECT data FROM (${currentCapture}) WHERE oversized=0)`
  const continuity = `((${field('NEW', 'from_generation')}=-1 AND ${field('p', 'source_capture')}=${field('NEW', 'source_capture')})
   OR (${field('NEW', 'from_generation')}>=0 AND EXISTS(SELECT 1 FROM undo_snapshots s
    WHERE s.id=json_extract(${field('NEW', 'prior_pointer')},'$.seal_id') AND s.kind='${transitionKind}' AND s.status='sealed'
    AND ${field('s', 'plan_id')}=p.id AND ${field('s', 'operation_id')}=${field('NEW', 'operation_id')}
    AND ${field('s', 'to_generation')}=${field('NEW', 'from_generation')}
    AND ${field('s', 'post_capture')}=${field('NEW', 'source_capture')})))`
  const zero = (id: string) => `(SELECT stock_quantity FROM products WHERE id=${id}) IS 0
    AND NOT EXISTS(SELECT 1 FROM branch_stock WHERE product_id=${id} AND quantity IS NOT 0)
    AND NOT EXISTS(SELECT 1 FROM branch_batch_stock s JOIN product_batches b ON b.id=s.batch_id WHERE b.variant_product_id=${id} AND s.quantity IS NOT 0)
    AND NOT EXISTS(SELECT 1 FROM damaged_stock_lots WHERE product_id=${id} AND quantity_remaining IS NOT 0)`
  const identity = `EXISTS(SELECT 1 FROM undo_snapshots p JOIN action_history h ON h.id=${field('NEW', 'history_id')}
    WHERE p.id=${field('NEW', 'plan_id')} AND p.kind='${planKind}' AND p.status='recorded'
    AND p.created_by_id=${field('p', 'actor_id')} AND NEW.created_by_id=${field('NEW', 'actor_id')} AND NEW.created_by_id>0
    AND ${field('p', 'operation_id')}=${field('NEW', 'operation_id')}
    AND ${field('p', 'keeper_id')}=${field('NEW', 'keeper_id')}
    AND ${field('p', 'loser_id')}=${field('NEW', 'loser_id')}
    AND h.created_by_id=p.created_by_id AND h.entity='product_merge' AND h.entity_id=${field('p', 'operation_id')}
    AND h.undo_payload=${field('NEW', 'prior_pointer')} AND h.redo_payload=h.undo_payload
    AND ${pointerIdentity('h.undo_payload', 'p.id', field('p', 'operation_id'))}
    AND json_extract(h.undo_payload,'$.generation')=${field('NEW', 'from_generation')}
    AND ${field('NEW', 'to_generation')}=${field('NEW', 'from_generation')}+1
    AND ${continuity}
    AND ((${field('NEW', 'from_generation')}=-1 AND h.status='recorded' AND ${field('NEW', 'direction')}='redo')
      OR (${field('NEW', 'from_generation')}>=0 AND ${field('NEW', 'from_generation')}%2=0 AND h.status='undoable' AND ${field('NEW', 'direction')}='undo')
      OR (${field('NEW', 'from_generation')}>=1 AND ${field('NEW', 'from_generation')}%2=1 AND h.status='redoable' AND ${field('NEW', 'direction')}='redo')))`
  const pending = `SELECT 1 FROM undo_snapshots t WHERE t.kind='${transitionKind}' AND t.status='prepared'
    AND ${field('t', 'loser_id')}=OLD.id AND NEW.id IS OLD.id
    AND ((${field('t', 'direction')}='redo' AND OLD.is_active IS 1 AND NEW.is_active IS 0)
      OR (${field('t', 'direction')}='undo' AND OLD.is_active IS 0 AND NEW.is_active IS 1))`
  const sql = `
  CREATE UNIQUE INDEX product_merge_v2_plan_request ON undo_snapshots(created_by_id,json_extract(payload_json,'$.request_id')) WHERE kind='${planKind}';
  CREATE UNIQUE INDEX product_merge_v2_transition_generation ON undo_snapshots(json_extract(payload_json,'$.plan_id'),json_extract(payload_json,'$.to_generation')) WHERE kind='${transitionKind}';
  CREATE UNIQUE INDEX product_merge_v2_single_pending ON undo_snapshots((1)) WHERE kind='${transitionKind}' AND status IN ('prepared','catalog_changed');
  CREATE TRIGGER product_merge_v2_plan_insert BEFORE INSERT ON undo_snapshots WHEN NEW.kind='${planKind}'
  BEGIN
   SELECT CASE WHEN ${permit} AND NEW.status='recorded' AND json_valid(NEW.payload_json)
    AND json_type(NEW.payload_json,'$.version')='integer' AND json_extract(NEW.payload_json,'$.version')=2
    AND json_type(NEW.payload_json,'$.actor_id')='integer'
    AND NEW.created_by_id=json_extract(NEW.payload_json,'$.actor_id')
    AND json_type(NEW.payload_json,'$.keeper_id')='integer' AND ${field('NEW', 'keeper_id')}>0
    AND json_type(NEW.payload_json,'$.loser_id')='integer' AND ${field('NEW', 'loser_id')}>0
    AND ${field('NEW', 'keeper_id')}<>${field('NEW', 'loser_id')}
    AND json_type(NEW.payload_json,'$.request_id')='text' AND length(trim(${field('NEW', 'request_id')})) BETWEEN 1 AND 200
    AND json_type(NEW.payload_json,'$.operation_id')='text' AND length(trim(${field('NEW', 'operation_id')})) BETWEEN 1 AND 200
    AND NEW.created_by_id>0 AND length(CAST(NEW.payload_json AS BLOB))<=1048576 THEN 1 ELSE RAISE(ABORT,'merge_plan_invalid') END;
  END;
  CREATE TRIGGER product_merge_v2_plan_immutable BEFORE UPDATE ON undo_snapshots WHEN OLD.kind='${planKind}' OR NEW.kind='${planKind}'
  BEGIN SELECT RAISE(ABORT,'merge_plan_immutable'); END;
  CREATE TRIGGER product_merge_v2_plan_delete BEFORE DELETE ON undo_snapshots WHEN OLD.kind='${planKind}'
  BEGIN SELECT RAISE(ABORT,'merge_plan_immutable'); END;
  CREATE TRIGGER product_merge_v2_transition_insert BEFORE INSERT ON undo_snapshots WHEN NEW.kind='${transitionKind}'
  BEGIN SELECT CASE WHEN ${permit} AND NEW.status='prepared' AND json_valid(NEW.payload_json)
    AND json_type(NEW.payload_json,'$.from_generation')='integer' AND json_type(NEW.payload_json,'$.to_generation')='integer'
    AND ${field('NEW', 'from_generation')} BETWEEN -1 AND 9007199254740989
    AND json_type(NEW.payload_json,'$.actor_id')='integer' AND length(CAST(NEW.payload_json AS BLOB))<=1048576
    AND json_type(NEW.payload_json,'$.source_capture')='text' AND ${actualSource} AND ${identity}
    THEN 1 ELSE RAISE(ABORT,'merge_transition_invalid') END; END;
  DROP TRIGGER transfer_product_identity_update;
  CREATE TRIGGER transfer_product_identity_update BEFORE UPDATE OF id,is_active ON products
  WHEN (NEW.id IS NOT OLD.id OR NEW.is_active IS NOT OLD.is_active)
   AND EXISTS(SELECT 1 FROM transfer_operation_members WHERE source_product_id=OLD.id OR destination_product_id=OLD.id)
  BEGIN SELECT CASE WHEN ${permit} AND (${zero('OLD.id')}) AND EXISTS(${pending})
   THEN 1 ELSE RAISE(ABORT,'product has immutable transfer provenance') END; END;
  CREATE TRIGGER product_merge_v2_catalog_consumed AFTER UPDATE OF is_active ON products
  WHEN NEW.is_active IS NOT OLD.is_active AND EXISTS(${pending})
  BEGIN UPDATE undo_snapshots SET status='catalog_changed' WHERE kind='${transitionKind}' AND status='prepared' AND ${field('undo_snapshots', 'loser_id')}=NEW.id; END;
  CREATE TRIGGER product_merge_v2_transition_update BEFORE UPDATE ON undo_snapshots WHEN OLD.kind='${transitionKind}' OR NEW.kind='${transitionKind}'
  BEGIN SELECT CASE WHEN ${permit} AND NEW.id IS OLD.id AND NEW.kind IS OLD.kind AND NEW.created_by_id IS OLD.created_by_id
   AND NEW.created_by_name IS OLD.created_by_name AND NEW.created_at IS OLD.created_at
   AND ((OLD.status='prepared' AND NEW.status='catalog_changed' AND NEW.payload_json IS OLD.payload_json
    AND (SELECT is_active FROM products WHERE id=${field('OLD', 'loser_id')}) IS CASE ${field('OLD', 'direction')} WHEN 'undo' THEN 1 ELSE 0 END)
   OR (OLD.status='catalog_changed' AND NEW.status='sealed' AND json_remove(NEW.payload_json,'$.post_capture')=OLD.payload_json
    AND json_type(NEW.payload_json,'$.post_capture')='object'
    AND ${field('NEW', 'post_capture')}=(SELECT data FROM (${currentCapture}) WHERE oversized=0)
    AND EXISTS(SELECT 1 FROM action_history h WHERE h.id=${field('OLD', 'history_id')}
     AND h.undo_payload=h.redo_payload AND ${pointerIdentity('h.undo_payload', field('OLD', 'plan_id'), field('OLD', 'operation_id'))}
     AND json_extract(h.undo_payload,'$.seal_id')=OLD.id AND json_extract(h.undo_payload,'$.generation')=${field('OLD', 'to_generation')}
     AND h.status=CASE ${field('OLD', 'direction')} WHEN 'undo' THEN 'redoable' ELSE 'undoable' END)))
   THEN 1 ELSE RAISE(ABORT,'merge_transition_immutable') END; END;
  CREATE TRIGGER product_merge_v2_transition_delete BEFORE DELETE ON undo_snapshots WHEN OLD.kind='${transitionKind}'
  BEGIN SELECT RAISE(ABORT,'merge_transition_immutable'); END;
  CREATE TRIGGER product_merge_v2_finish BEFORE DELETE ON system_flags WHEN OLD.key='stock_transaction_permit'
   AND EXISTS(SELECT 1 FROM undo_snapshots WHERE kind='${transitionKind}' AND status<>'sealed')
  BEGIN SELECT RAISE(ABORT,'merge_transition_unfinished'); END;
  `

  return sql.replace(/\r/g, '')
}
