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
    AND json_type(${pointer},'$.generation')='integer'
    AND ((json_extract(${pointer},'$.generation')=-1 AND json_type(${pointer},'$.seal_id')='null')
      OR (json_extract(${pointer},'$.generation')>=0 AND json_type(${pointer},'$.seal_id')='integer'
        AND json_extract(${pointer},'$.seal_id')>0))`
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
    AND h.id=${field('p', 'history_id')}
    AND p.created_by_id=${field('p', 'actor_id')} AND NEW.created_by_id=${field('NEW', 'actor_id')} AND NEW.created_by_id>0
    AND ${field('p', 'operation_id')}=${field('NEW', 'operation_id')}
    AND ${field('p', 'keeper_id')}=${field('NEW', 'keeper_id')}
    AND ${field('p', 'loser_id')}=${field('NEW', 'loser_id')}
    AND h.created_by_id=p.created_by_id AND h.scope='products' AND h.entity='product_merge' AND h.entity_id=${field('p', 'operation_id')}
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
  const postStateMatches = (row: string) => `
    ${field(row, 'post_capture')}=(SELECT data FROM (${currentCapture.replaceAll('NEW.payload_json', `${row}.payload_json`)}) WHERE oversized=0)
    AND EXISTS(SELECT 1 FROM action_history h JOIN undo_snapshots p ON p.id=${field(row, 'plan_id')}
      WHERE h.id=${field(row, 'history_id')} AND h.id=${field('p', 'history_id')}
        AND p.kind='${planKind}' AND p.status='recorded'
        AND p.created_by_id=h.created_by_id AND h.scope='products' AND h.entity='product_merge'
        AND h.entity_id=${field('p', 'operation_id')} AND h.entity_id=${field(row, 'operation_id')}
        AND h.undo_payload=h.redo_payload AND ${pointerIdentity('h.undo_payload', 'p.id', field(row, 'operation_id'))}
        AND json_extract(h.undo_payload,'$.seal_id')=${row}.id
        AND json_extract(h.undo_payload,'$.generation')=${field(row, 'to_generation')}
        AND h.status=CASE ${field(row, 'direction')} WHEN 'undo' THEN 'redoable' ELSE 'undoable' END)`
  const v2History = (pointer: string) => `CASE WHEN json_valid(${pointer}) THEN
    json_extract(${pointer},'$.applier')='product.merge' AND json_extract(${pointer},'$.version')=2 ELSE 0 END`
  const immutableHistory = ['id', 'scope', 'entity', 'entity_id', 'label', 'undo_label', 'redo_label', 'reversible', 'created_by_id', 'created_by_name', 'created_at']
    .map(column => `NEW.${column} IS OLD.${column}`).join(' AND ')
  const sql = `
  CREATE UNIQUE INDEX product_merge_v2_plan_request ON undo_snapshots(created_by_id,json_extract(payload_json,'$.request_id')) WHERE kind='${planKind}';
  CREATE UNIQUE INDEX product_merge_v2_plan_operation ON undo_snapshots(json_extract(payload_json,'$.operation_id')) WHERE kind='${planKind}';
  CREATE UNIQUE INDEX product_merge_v2_plan_history ON undo_snapshots(json_extract(payload_json,'$.history_id')) WHERE kind='${planKind}';
  CREATE UNIQUE INDEX product_merge_v2_transition_generation ON undo_snapshots(json_extract(payload_json,'$.plan_id'),json_extract(payload_json,'$.to_generation')) WHERE kind='${transitionKind}';
  CREATE UNIQUE INDEX product_merge_v2_single_pending ON undo_snapshots((1)) WHERE kind='${transitionKind}' AND status IN ('prepared','catalog_changed','sealing');
  CREATE TRIGGER product_merge_v2_snapshot_insert_identity BEFORE INSERT ON undo_snapshots
  WHEN EXISTS(SELECT 1 FROM undo_snapshots s WHERE s.id=NEW.id AND s.kind IN ('${planKind}','${transitionKind}'))
    OR (NEW.kind='${planKind}' AND EXISTS(SELECT 1 FROM undo_snapshots p WHERE p.kind='${planKind}' AND (
      (p.created_by_id=NEW.created_by_id AND ${field('p', 'request_id')}=${field('NEW', 'request_id')})
      OR ${field('p', 'operation_id')}=${field('NEW', 'operation_id')}
      OR ${field('p', 'history_id')}=${field('NEW', 'history_id')})))
    OR (NEW.kind='${transitionKind}' AND EXISTS(SELECT 1 FROM undo_snapshots t WHERE t.kind='${transitionKind}' AND (
      (${field('t', 'plan_id')}=${field('NEW', 'plan_id')} AND ${field('t', 'to_generation')}=${field('NEW', 'to_generation')})
      OR (t.status IN ('prepared','catalog_changed','sealing') AND NEW.status IN ('prepared','catalog_changed','sealing')))))
  BEGIN SELECT RAISE(ABORT,'merge_identity_immutable'); END;
  CREATE TRIGGER product_merge_v2_plan_insert BEFORE INSERT ON undo_snapshots WHEN NEW.kind='${planKind}'
  BEGIN
   SELECT CASE WHEN ${permit} AND NEW.status='recorded' AND json_valid(NEW.payload_json)
    AND json_type(NEW.payload_json,'$.version')='integer' AND json_extract(NEW.payload_json,'$.version')=2
    AND json_type(NEW.payload_json,'$.actor_id')='integer'
    AND NEW.created_by_id=json_extract(NEW.payload_json,'$.actor_id')
    AND json_type(NEW.payload_json,'$.history_id')='integer' AND ${field('NEW', 'history_id')}>0
    AND NOT EXISTS(SELECT 1 FROM action_history WHERE id=${field('NEW', 'history_id')})
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
  BEGIN SELECT CASE WHEN NEW.id IS OLD.id AND NEW.kind IS OLD.kind AND NEW.created_by_id IS OLD.created_by_id
   AND NEW.created_by_name IS OLD.created_by_name AND NEW.created_at IS OLD.created_at
   AND ((${permit} AND ((OLD.status='prepared' AND NEW.status='catalog_changed' AND NEW.payload_json IS OLD.payload_json
    AND (SELECT is_active FROM products WHERE id=${field('OLD', 'loser_id')}) IS CASE ${field('OLD', 'direction')} WHEN 'undo' THEN 1 ELSE 0 END)
   OR (OLD.status='catalog_changed' AND NEW.status='sealing' AND json_remove(NEW.payload_json,'$.post_capture')=OLD.payload_json
    AND json_type(NEW.payload_json,'$.post_capture')='object'
    AND ${postStateMatches('NEW')})))
   OR (NOT EXISTS(SELECT 1 FROM system_flags WHERE key='stock_transaction_permit')
     AND OLD.status='sealing' AND NEW.status='sealed' AND NEW.payload_json IS OLD.payload_json
     AND ${postStateMatches('NEW')}))
   THEN 1 ELSE RAISE(ABORT,'merge_transition_immutable') END; END;
  CREATE TRIGGER product_merge_v2_transition_delete BEFORE DELETE ON undo_snapshots WHEN OLD.kind='${transitionKind}'
  BEGIN SELECT RAISE(ABORT,'merge_transition_immutable'); END;
  CREATE TRIGGER product_merge_v2_finish BEFORE DELETE ON system_flags WHEN OLD.key='stock_transaction_permit'
   AND EXISTS(SELECT 1 FROM undo_snapshots t INDEXED BY product_merge_v2_single_pending
     WHERE t.kind='${transitionKind}' AND t.status IN ('prepared','catalog_changed','sealing')
     AND (t.status<>'sealing' OR (${postStateMatches('t')}) IS NOT 1))
  BEGIN SELECT RAISE(ABORT,'merge_transition_unfinished'); END;
  CREATE TRIGGER product_merge_v2_publish AFTER DELETE ON system_flags WHEN OLD.key='stock_transaction_permit'
  BEGIN UPDATE undo_snapshots SET status='sealed' WHERE kind='${transitionKind}' AND status='sealing'; END;
  CREATE TRIGGER product_merge_v2_history_insert_identity BEFORE INSERT ON action_history
  BEGIN
    SELECT CASE WHEN EXISTS(SELECT 1 FROM action_history h WHERE h.id=NEW.id AND (${v2History('h.undo_payload')}))
      THEN RAISE(ABORT,'merge_history_immutable') ELSE 1 END;
    SELECT CASE WHEN (${v2History('NEW.undo_payload')}) AND NOT ((${permit}
      AND NOT EXISTS(SELECT 1 FROM action_history WHERE id=NEW.id)
      AND NEW.scope='products' AND NEW.entity='product_merge' AND NEW.status='recorded' AND NEW.undo_payload=NEW.redo_payload
      AND EXISTS(SELECT 1 FROM undo_snapshots p WHERE p.kind='${planKind}' AND p.status='recorded'
        AND ${field('p', 'history_id')}=NEW.id AND p.created_by_id=NEW.created_by_id
        AND NEW.entity_id=${field('p', 'operation_id')}
        AND ${pointerIdentity('NEW.undo_payload', 'p.id', field('p', 'operation_id'))}
        AND json_extract(NEW.undo_payload,'$.generation')=-1)) IS 1)
      THEN RAISE(ABORT,'merge_history_immutable') ELSE 1 END;
  END;
  CREATE TRIGGER product_merge_v2_history_update BEFORE UPDATE ON action_history
  WHEN (${v2History('OLD.undo_payload')}) OR (${v2History('NEW.undo_payload')})
  BEGIN SELECT CASE WHEN ${immutableHistory} AND (
    (NEW.undo_payload IS OLD.undo_payload AND NEW.redo_payload IS OLD.redo_payload AND NEW.status IS OLD.status)
    OR (${permit} AND NEW.undo_payload=NEW.redo_payload AND OLD.undo_payload=OLD.redo_payload
      AND EXISTS(SELECT 1 FROM undo_snapshots t WHERE t.kind='${transitionKind}' AND t.status='catalog_changed'
        AND ${field('t', 'history_id')}=OLD.id AND ${field('t', 'prior_pointer')}=OLD.undo_payload
        AND ${pointerIdentity('NEW.undo_payload', field('t', 'plan_id'), field('t', 'operation_id'))}
        AND json_extract(NEW.undo_payload,'$.seal_id')=t.id
        AND json_extract(NEW.undo_payload,'$.generation')=${field('t', 'to_generation')}
        AND NEW.status=CASE ${field('t', 'direction')} WHEN 'undo' THEN 'redoable' ELSE 'undoable' END)))
    THEN 1 ELSE RAISE(ABORT,'merge_history_immutable') END; END;
  CREATE TRIGGER product_merge_v2_history_delete BEFORE DELETE ON action_history WHEN ${v2History('OLD.undo_payload')}
  BEGIN SELECT RAISE(ABORT,'merge_history_immutable'); END;
  `

  return sql.replace(/\r/g, '')
}
