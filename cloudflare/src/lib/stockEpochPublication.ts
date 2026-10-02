import type { SessionUser } from './auth';
import { getDb } from './db';
import { getActionTier } from './permissions';
import { canEditAcquisitionCosts } from './acquisitionCostAccess';
import { actorSnapshot } from './actorSnapshot';
import { feeRequestDigest } from './feeOperationReceipt';
import { assertEpochPartition, epochReceiptOpening, splitEpochBasis } from './stockEpochMath';
import { exactMoney4, quantityDecimal, subtractQuantity } from './stockDispositionBasis';
import { sumValuationQuantity } from './stockValuationMath';
import { ordinaryBusinessMaintenanceGuard } from './businessMaintenanceGuard';

type Row = Record<string, any>;
type Statement = { sql: string; params: Record<string, unknown> };
type Env = { DB: D1Database; IMPORT_DB?: D1Database };
type SourceState = { event_id: string; source_id: string; funding_generation: number; gross4: number; paid4: number; debt4: number; credit4: number; asset4: number; cash_in4: number; cash_out4: number; shipping4: number; sellable_quantity: string; held_quantity: string; disposed_quantity: string; consumed_quantity: string; sellable_net4: number; held_net4: number; loss4: number; loss_recovery4: number; consumed_cost4: number; consumed_recovery4: number; pending4: number };

export class StockEpochError extends Error {
  constructor(public code: string, public statusCode: 400 | 403 | 409 = 409) { super(code); }
}

export const stockEpochEnabled = (env: Env) => (env as Env & { STOCK_VALUATION_EXPERIMENT?: string }).STOCK_VALUATION_EXPERIMENT === 'local-fixture-only';
const fail = (code: string, status: 400 | 403 | 409 = 409): never => { throw new StockEpochError(code, status); };

export async function currentStockEpochActor(env: Env, actor: SessionUser) {
  const user = await getDb(env).prepare('SELECT u.id,u.name,u.username,u.permissions,u.role_id,u.is_active,u.deleted_at,r.code AS role_code,r.permissions AS role_permissions FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=@id').get<SessionUser & { deleted_at: string | null }>({ id: actor.id });
  if (!user || user.is_active !== 1 || user.deleted_at || getActionTier(user, 'inventory', 'adjust') !== 'full' || !canEditAcquisitionCosts(user)) return fail('epoch_permission_denied', 403);
  return user;
}

export async function assertStockEpochSessionReplay(env: Env, actor: SessionUser, operationId: string) {
  if (!stockEpochEnabled(env)) return;
  const db = getDb(env);
  const contract = await db.prepare('SELECT o.id FROM stock_epoch_operations o JOIN stock_epoch_publications p ON p.operation_id=o.id WHERE o.protocol=2 AND o.ordinary_id=@id').get({ id: operationId });
  if (contract) await currentStockEpochActor(env, actor);
}

export async function planStockEpochStockSession(env: Env, actor: SessionUser, operationId: string, request: Row, targets: Map<string, { batchKey: string; existingBatchId: number | null }>) {
  const prefix: Statement[] = [], finish: Statement[] = [];
  if (!stockEpochEnabled(env)) return { prefix, finish };
  const lines = (request.items as Row[]).filter(line => line.quantity > 0);
  if (!lines.length) return { prefix, finish };
  if (lines.some(line => line.kind !== 'receive' || !line.product_id || !line.supplier_id)) return fail('epoch_receipt_identity_reconciliation_required');
  const current = await currentStockEpochActor(env, actor), db = getDb(env);
  const dataset = await db.prepare('SELECT generation FROM stock_epoch_dataset WHERE singleton=1').get<{ generation: number }>();
  if (!dataset) return fail('epoch_dataset_missing');
  const id = `session-${operationId}`, at = new Date().toISOString(), requestJson = JSON.stringify(request), digest = await feeRequestDigest(requestJson);
  const shared = { operation: id, ordinary: operationId, request: `epoch-session-${request.client_request_id}`, actor: actor.id, name: actorSnapshot(current), permissions: current.permissions, role: current.role_id ?? null, roleCode: current.role_code ?? null, rolePermissions: current.role_permissions ?? null, dataset: dataset.generation, requestJson, digest, at, count: lines.length };
  prefix.push({ sql: `INSERT INTO stock_epoch_operations(id,request_id,actor_id,actor_permissions,dataset_generation,kind,request_json,source_count,epoch_count,assignment_count,protocol,ordinary_id,role_id,role_code,role_permissions,actor_name) VALUES(@operation,@request,@actor,@permissions,@dataset,'stock_session',@requestJson,@count,0,0,2,@ordinary,@role,@roleCode,@rolePermissions,@name)`, params: shared });
  for (const line of lines) {
    let opening: ReturnType<typeof epochReceiptOpening>;
    try { opening = epochReceiptOpening(line.quantity, line.unit_cost_usd, line.payment_status); }
    catch (error) { return fail(error instanceof Error ? error.message : 'epoch_receipt_money_invalid'); }
    const target = targets.get(line.line_id);
    if (!target) return fail('epoch_receipt_target_missing');
    if (await db.prepare('SELECT id FROM supplier_invoices WHERE (supplier_id=@supplier OR supplier_id IS NULL) AND (branch_id=@branch OR branch_id IS NULL) LIMIT 1').get({ supplier: line.supplier_id, branch: line.branch_id })) return fail('epoch_receipt_invoice_reconciliation_required');
    const before = await db.prepare(`SELECT b.id,b.received_quantity,b.received_cost_usd,bs.quantity, h.operation_id AS head_operation FROM product_batches b LEFT JOIN branch_batch_stock bs ON bs.batch_id=b.id AND bs.branch_id=@branch LEFT JOIN stock_epoch_lot_heads h ON h.batch_id=b.id AND h.branch_id=@branch WHERE b.variant_product_id=@product AND b.batch_key=@key`).get<Row>({ product: line.product_id, branch: line.branch_id, key: target.batchKey });
    if (before && !before.head_operation) return fail('epoch_receipt_existing_lot_adoption_required');
    const aggregate = await db.prepare('SELECT p.stock_quantity AS product_quantity,bs.quantity AS branch_quantity FROM products p JOIN branch_stock bs ON bs.product_id=p.id AND bs.branch_id=@branch WHERE p.id=@product').get<Row>({ product: line.product_id, branch: line.branch_id });
    if (!aggregate) return fail('epoch_receipt_aggregate_missing');
    const source = `receipt-${crypto.randomUUID()}`, event = crypto.randomUUID();
    const funding = { gross4: opening.gross4, paid4: opening.paid4, debt4: opening.debt4, credit4: 0, asset4: 0, cash_in4: 0, cash_out4: 0, shipping4: 0 };
    const params = { ...shared, line: line.line_id, source, event, sourceRequest: `epoch-receipt-${event}`, batch: before?.id ?? null, key: target.batchKey, product: line.product_id, branch: line.branch_id, supplier: line.supplier_id, quantity: opening.quantity, gross: opening.gross4, paid: opening.paid4, debt: opening.debt4, payment: line.payment_status, unit: line.unit_cost_usd, beforeQuantity: quantityDecimal(before?.quantity ?? 0, true), afterQuantity: quantityDecimal(Number(before?.quantity ?? 0) + Number(opening.quantity), true), beforeReceived: quantityDecimal(before?.received_quantity ?? 0, true), afterReceived: quantityDecimal(Number(before?.received_quantity ?? 0) + Number(opening.quantity), true), beforeGross: exactMoney4(before?.received_cost_usd ?? 0), afterGross: exactMoney4(before?.received_cost_usd ?? 0) + opening.gross4, previousOperation: before?.head_operation ?? null, branchBefore: aggregate.branch_quantity, branchAfter: aggregate.branch_quantity + Number(opening.quantity), productBefore: aggregate.product_quantity, productAfter: aggregate.product_quantity + Number(opening.quantity), fundingJson: JSON.stringify(funding) };
    prefix.push({ sql: `INSERT INTO stock_epoch_lot_effects(operation_id,line_id,product_id,branch_id,batch_id,batch_key,previous_operation_id,quantity_before,quantity_after,received_before,received_after,gross_before4,gross_after4,branch_before,branch_after,product_before,product_after) VALUES(@operation,@line,@product,@branch,@batch,@key,@previousOperation,@beforeQuantity,@afterQuantity,@beforeReceived,@afterReceived,@beforeGross,@afterGross,@branchBefore,@branchAfter,@productBefore,@productAfter)`, params });
    finish.push({ sql: `INSERT INTO stock_epoch_sources(id,movement_id,batch_id,product_id,branch_id,supplier_id,quantity,free_quantity,gross4,opening_paid4,opening_debt4,reconciliation_proof,invoice_id,actor_id,source_json,source_format,admission_operation_id) SELECT @source,m.movement_id,m.batch_id,m.product_id,m.branch_id,@supplier,@quantity,'0',@gross,@paid,@debt,@ordinary,NULL,@actor,json_object('operation_id',@ordinary,'line_id',@line,'payment_status',@payment,'quantity',@quantity,'gross4',@gross),5,@operation FROM stock_session_members m WHERE m.operation_id=@ordinary AND m.line_id=@line`, params });
    finish.push({ sql: `INSERT INTO stock_epoch_operation_sources(operation_id,source_id,expected_revision,expected_funding_generation,event_id) VALUES(@operation,@source,-1,-1,@event)`, params });
    finish.push({ sql: `INSERT INTO stock_epoch_events(id,source_id,revision,kind,loss4,recovery4,expense_category,actor_id,occurred_at,consumed_cost4,consumed_recovery4,operation_id,funding_generation,funding_json) VALUES(@event,@source,0,'admit',0,0,NULL,@actor,@at,0,0,@operation,0,@fundingJson)`, params });
    finish.push({ sql: `INSERT INTO stock_epoch_source_states(event_id,source_id,funding_generation,gross4,paid4,debt4,credit4,asset4,cash_in4,cash_out4,shipping4,sellable_quantity,held_quantity,disposed_quantity,consumed_quantity,sellable_net4,held_net4,loss4,loss_recovery4,consumed_cost4,consumed_recovery4,pending4) VALUES(@event,@source,0,@gross,@paid,@debt,0,0,0,0,0,@quantity,'0','0','0',@gross,0,0,0,0,0,0)`, params });
    finish.push({ sql: `INSERT INTO stock_epoch_segments(event_id,segment_id,allocation_id,fate,quantity,gross4,coverage4,loss4,recovery4,reason,consumption_id,consumed_cost4,consumed_recovery4,source_id,branch_id,parent_segment_id) VALUES(@event,'origin','origin','sellable',@quantity,@gross,0,0,0,'',NULL,0,0,@source,@branch,NULL)`, params });
    finish.push({ sql: `INSERT INTO stock_epoch_current_fragments(source_id,segment_id,event_id,allocation_id,branch_id,fate,assignment_id) VALUES(@source,'origin',@event,'origin',@branch,'sellable',NULL)`, params });
    finish.push({ sql: `INSERT INTO stock_epoch_source_heads(source_id,event_id,revision,funding_generation,dataset_generation) VALUES(@source,@event,0,0,@dataset)`, params });
    finish.push({ sql: `INSERT INTO stock_epoch_receipts(request_id,event_id,actor_id,request_digest,request_json,response_json) VALUES(@sourceRequest,@event,@actor,@digest,@requestJson,json_object('valuation_version',5,'protocol',2,'source_id',@source,'event_id',@event,'quantity',@quantity,'gross4',@gross,'paid4',@paid,'debt4',@debt))`, params });
    finish.push({ sql: `INSERT INTO stock_epoch_lot_heads(batch_id,branch_id,product_id,operation_id,quantity,received_quantity,received_gross4,dataset_generation) SELECT m.batch_id,@branch,@product,@operation,@afterQuantity,@afterReceived,@afterGross,@dataset FROM stock_session_members m WHERE m.operation_id=@ordinary AND m.line_id=@line ON CONFLICT(batch_id,branch_id) DO UPDATE SET operation_id=excluded.operation_id,quantity=excluded.quantity,received_quantity=excluded.received_quantity,received_gross4=excluded.received_gross4,dataset_generation=excluded.dataset_generation`, params });
  }
  finish.push({ sql: `INSERT INTO stock_epoch_operation_contracts(operation_id,request_digest,ordinary_receipt_json,audit_id) SELECT @operation,@digest,o.receipt_json,a.id FROM stock_session_operations o JOIN audit_logs a ON a.entity='stock_session' AND a.entity_id=o.id AND a.action='stock_session_create' AND a.details=o.receipt_json AND a.new_value=o.receipt_json WHERE o.id=@ordinary`, params: shared });
  finish.push({ sql: 'INSERT INTO stock_epoch_publications(operation_id,published_at) VALUES(@operation,@at)', params: shared });
  finish.push({ sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM stock_epoch_publications p JOIN stock_epoch_operation_contracts c ON c.operation_id=p.operation_id WHERE p.operation_id=@operation AND c.request_digest=@digest) THEN 1 ELSE json_extract('[1]','$[epoch_publication_missing]') END`, params: shared });
  finish.push({ ...ordinaryBusinessMaintenanceGuard, params: {} });
  return { prefix, finish };
}

export async function commitStockEpochTransition(env: Env, actor: SessionUser, raw: Row) {
  if (!stockEpochEnabled(env)) return null;
  const db = getDb(env);
  const source = await db.prepare(`SELECT s.*,h.event_id,h.revision,h.funding_generation,h.dataset_generation FROM stock_epoch_sources s JOIN stock_epoch_source_heads h ON h.source_id=s.id JOIN stock_epoch_events e ON e.id=h.event_id JOIN stock_epoch_publications p ON p.operation_id=e.operation_id WHERE s.id=@source`).get<Row>({ source: raw.source_id });
  if (!source) return null;
  const current = await currentStockEpochActor(env, actor);
  const requestJson = JSON.stringify(raw), digest = await feeRequestDigest(requestJson);
  const saved = await db.prepare('SELECT r.* FROM stock_epoch_receipts r JOIN stock_epoch_events e ON e.id=r.event_id JOIN stock_epoch_publications p ON p.operation_id=e.operation_id WHERE r.request_id=@request').get<Row>({ request: raw.client_request_id });
  if (saved) {
    if (saved.actor_id !== actor.id || saved.request_digest !== digest || saved.request_json !== requestJson) return fail('epoch_request_intent_conflict');
    return { ...JSON.parse(saved.response_json), replayed: true };
  }
  if (!['hold', 'repair'].includes(raw.kind)) return fail('epoch_transition_not_implemented');
  if (source.revision !== raw.expected_revision || source.funding_generation !== raw.expected_generation) return fail('epoch_revision_conflict');
  const original = await db.prepare(`SELECT g.* FROM stock_epoch_current_fragments h JOIN stock_epoch_segments g ON g.event_id=h.event_id AND g.segment_id=h.segment_id WHERE h.source_id=@source AND h.segment_id=@segment`).get<Row>({ source: source.id, segment: raw.segment_id });
  if (!original || original.fate !== (raw.kind === 'hold' ? 'sellable' : 'held')) return fail('epoch_fragment_fate_conflict');
  if (typeof raw.child_segment_id !== 'string' || !raw.child_segment_id.trim() || raw.child_segment_id.length > 100 || raw.child_segment_id === original.segment_id || `${raw.child_segment_id}-remaining` === original.segment_id) return fail('epoch_fragment_identity_invalid', 400);
  let quantity: string;
  try { quantity = quantityDecimal(raw.quantity); subtractQuantity(original.quantity, [quantity]); }
  catch (error) {
    if (error instanceof RangeError) return fail('epoch_quantity_invalid', 400);
    throw error;
  }
  if (await db.prepare('SELECT 1 FROM stock_epoch_segments g JOIN stock_epoch_events e ON e.id=g.event_id WHERE e.source_id=@source AND g.segment_id IN (@child,@remaining) LIMIT 1').get({ source: source.id, child: raw.child_segment_id, remaining: `${raw.child_segment_id}-remaining` })) return fail('epoch_fragment_identity_conflict');
  const event = crypto.randomUUID(), operation = `transition-${event}`, at = new Date().toISOString();
  const split = splitEpochBasis(original as any, quantity, raw.child_segment_id);
  const selected = { ...original, ...split.selected, event_id: event, fate: raw.kind === 'hold' ? 'held' : 'sellable', allocation_id: raw.kind === 'hold' && original.allocation_id === 'origin' ? raw.child_segment_id : original.allocation_id, reason: raw.kind === 'hold' ? String(raw.reason || '') : '' };
  if (raw.kind === 'hold' && (!selected.reason.trim() || selected.reason.length > 500)) return fail('epoch_reason_required', 400);
  const remainder = { ...original, ...split.remaining, event_id: event };
  assertEpochPartition([original as any], [selected, remainder]);
  const after = [selected, ...(remainder.quantity === '0' ? [] : [remainder])];
  const retired = { ...original, event_id: event, parent_segment_id: original.segment_id, fate: 'retired', quantity: '0', gross4: 0, coverage4: 0, loss4: 0, recovery4: 0, consumption_id: null, consumed_cost4: 0, consumed_recovery4: 0 };
  const beforeState = await db.prepare('SELECT * FROM stock_epoch_source_states WHERE event_id=@event').get<SourceState>({ event: source.event_id });
  if (!beforeState) return fail('epoch_source_state_missing');
  const state = { ...beforeState, event_id: event };
  const selectedNet = selected.gross4 - selected.coverage4;
  const held = raw.kind === 'hold';
  state.sellable_quantity = held ? subtractQuantity(state.sellable_quantity, [selected.quantity]) : sumValuationQuantity([state.sellable_quantity, selected.quantity]);
  state.held_quantity = held ? sumValuationQuantity([state.held_quantity, selected.quantity]) : subtractQuantity(state.held_quantity, [selected.quantity]);
  state.sellable_net4 += held ? -selectedNet : selectedNet;
  state.held_net4 += held ? selectedNet : -selectedNet;
  const lot = await db.prepare('SELECT h.*,b.quantity AS physical_quantity,p.stock_quantity AS product_quantity,a.quantity AS branch_quantity FROM stock_epoch_lot_heads h JOIN branch_batch_stock b ON b.batch_id=h.batch_id AND b.branch_id=h.branch_id JOIN products p ON p.id=h.product_id JOIN branch_stock a ON a.product_id=h.product_id AND a.branch_id=h.branch_id WHERE h.batch_id=@batch AND h.branch_id=@branch').get<Row>({ batch: source.batch_id, branch: source.branch_id });
  if (!lot) return fail('epoch_lot_head_missing');
  const delta = Number(selected.quantity) * (held ? -1 : 1);
  const nextQuantity = (value: number) => held ? subtractQuantity(value, [selected.quantity]) : sumValuationQuantity([quantityDecimal(value, true), selected.quantity]);
  const funding = Object.fromEntries((['gross4', 'paid4', 'debt4', 'credit4', 'asset4', 'cash_in4', 'cash_out4', 'shipping4'] as const).map(key => [key, state[key]]));
  const response = { valuation_version: 5, protocol: 2, source_id: source.id, event_id: event, revision: source.revision + 1, kind: raw.kind, funding: { generation: source.funding_generation, ...funding }, changed_segments: after, totals: state };
  const responseJson = JSON.stringify(response);
  const params = { operation, ordinary: event, event, source: source.id, request: raw.client_request_id, actor: actor.id, name: actorSnapshot(current), permissions: current.permissions, role: current.role_id ?? null, roleCode: current.role_code ?? null, rolePermissions: current.role_permissions ?? null, dataset: source.dataset_generation, requestJson, digest, at, kind: raw.kind, revision: source.revision, nextRevision: source.revision + 1, generation: source.funding_generation, beforeEvent: source.event_id, parent: original.segment_id, parentEvent: original.event_id, batch: source.batch_id, branch: source.branch_id, product: source.product_id, previousLot: lot.operation_id, beforeQuantity: quantityDecimal(lot.physical_quantity,true), afterQuantity: nextQuantity(lot.physical_quantity), branchBefore: quantityDecimal(lot.branch_quantity,true), branchAfter: nextQuantity(lot.branch_quantity), productBefore: quantityDecimal(lot.product_quantity,true), productAfter: nextQuantity(lot.product_quantity), delta, fundingJson: JSON.stringify(funding), responseJson };
  const statements: Statement[] = [
    { sql: `INSERT INTO stock_epoch_operations(id,request_id,actor_id,actor_permissions,dataset_generation,kind,request_json,source_count,epoch_count,assignment_count,protocol,ordinary_id,role_id,role_code,role_permissions,actor_name) VALUES(@operation,@request,@actor,@permissions,@dataset,@kind,@requestJson,1,0,0,2,@ordinary,@role,@roleCode,@rolePermissions,@name)`, params },
    { sql: `INSERT INTO stock_epoch_operation_sources(operation_id,source_id,expected_revision,expected_funding_generation,event_id) VALUES(@operation,@source,@revision,@generation,@event)`, params },
    { sql: `INSERT INTO stock_epoch_events(id,source_id,revision,kind,loss4,recovery4,expense_category,actor_id,occurred_at,consumed_cost4,consumed_recovery4,operation_id,funding_generation,funding_json) VALUES(@event,@source,@nextRevision,@kind,0,0,NULL,@actor,@at,0,0,@operation,@generation,@fundingJson)`, params },
    { sql: `INSERT INTO stock_epoch_fragment_inputs(event_id,source_id,before_event_id,before_segment_id) VALUES(@event,@source,@parentEvent,@parent)`, params },
    { sql: `INSERT INTO stock_epoch_commands(operation_id,source_id,before_event_id,previous_lot_operation_id,batch_id,branch_id,product_id,quantity_before,quantity_after,branch_before,branch_after,product_before,product_after,delta_quantity,request_digest,response_json) VALUES(@operation,@source,@beforeEvent,@previousLot,@batch,@branch,@product,@beforeQuantity,@afterQuantity,@branchBefore,@branchAfter,@productBefore,@productAfter,@delta,@digest,@responseJson)`, params },
  ];
  for (const fragment of [retired, ...after]) statements.push({ sql: `INSERT INTO stock_epoch_segments(event_id,segment_id,allocation_id,fate,quantity,gross4,coverage4,loss4,recovery4,reason,consumption_id,consumed_cost4,consumed_recovery4,source_id,branch_id,parent_segment_id) VALUES(@event_id,@segment_id,@allocation_id,@fate,@quantity,@gross4,@coverage4,@loss4,@recovery4,@reason,@consumption_id,@consumed_cost4,@consumed_recovery4,@source_id,@branch_id,@parent_segment_id)`, params: fragment });
  const stateColumns = Object.keys(beforeState);
  statements.push({ sql: `INSERT INTO stock_epoch_source_states(${stateColumns.join(',')}) VALUES(${stateColumns.map(key => `@${key}`).join(',')})`, params: state });
  statements.push({ sql: 'DELETE FROM stock_epoch_current_fragments WHERE source_id=@source AND segment_id=@parent AND event_id=@parentEvent', params });
  for (const fragment of after) statements.push({ sql: `INSERT INTO stock_epoch_current_fragments(source_id,segment_id,event_id,allocation_id,branch_id,fate,assignment_id) VALUES(@source_id,@segment_id,@event_id,@allocation_id,@branch_id,@fate,@consumption_id)`, params: fragment });
  statements.push(
    { sql: 'UPDATE stock_epoch_source_heads SET event_id=@event,revision=@nextRevision WHERE source_id=@source AND event_id=@beforeEvent AND revision=@revision', params },
    { sql: 'UPDATE branch_batch_stock SET quantity=@afterQuantity WHERE batch_id=@batch AND branch_id=@branch AND quantity=@beforeQuantity', params },
    { sql: 'UPDATE branch_stock SET quantity=@branchAfter WHERE product_id=@product AND branch_id=@branch AND quantity=@branchBefore', params },
    { sql: 'UPDATE products SET stock_quantity=@productAfter WHERE id=@product AND stock_quantity=@productBefore', params },
    { sql: "INSERT INTO inventory_movements(product_id,branch_id,batch_id,movement_type,quantity,reference_id,user_id,user_name,reason) VALUES(@product,@branch,@batch,CASE WHEN @delta<0 THEN 'remove' ELSE 'add' END,@delta,@operation,@actor,@name,@kind)", params },
    { sql: 'UPDATE stock_epoch_commands SET movement_id=last_insert_rowid() WHERE operation_id=@operation', params },
    { sql: `UPDATE stock_epoch_lot_heads SET operation_id=@operation,quantity=CAST(@afterQuantity AS TEXT) WHERE batch_id=@batch AND branch_id=@branch AND operation_id=@previousLot`, params },
    { sql: 'INSERT INTO stock_epoch_receipts(request_id,event_id,actor_id,request_digest,request_json,response_json) VALUES(@request,@event,@actor,@digest,@requestJson,@responseJson)', params },
    { sql: "INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,new_value) VALUES(@actor,@name,@kind,'stock_epoch',@event,@responseJson,'stock_epoch_events',@event,@responseJson)", params },
    { sql: 'UPDATE stock_epoch_commands SET audit_id=last_insert_rowid() WHERE operation_id=@operation', params },
    { sql: 'INSERT INTO stock_epoch_publications(operation_id,published_at) VALUES(@operation,@at)', params },
    { sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM stock_epoch_publications WHERE operation_id=@operation) THEN 1 ELSE json_extract('[1]','$[epoch_publication_missing]') END`, params },
    { ...ordinaryBusinessMaintenanceGuard, params: {} },
  );
  try { await db.batch(statements); }
  catch {
    await currentStockEpochActor(env, actor);
    const committed = await db.prepare('SELECT r.* FROM stock_epoch_receipts r JOIN stock_epoch_events e ON e.id=r.event_id JOIN stock_epoch_publications p ON p.operation_id=e.operation_id WHERE r.request_id=@request').get<Row>({ request: raw.client_request_id });
    if (committed && committed.actor_id === actor.id && committed.request_digest === digest && committed.request_json === requestJson) return { ...JSON.parse(committed.response_json), replayed: true };
    return fail('epoch_atomic_conflict');
  }
  await currentStockEpochActor(env, actor);
  const committed = await db.prepare('SELECT r.* FROM stock_epoch_receipts r JOIN stock_epoch_events e ON e.id=r.event_id JOIN stock_epoch_publications p ON p.operation_id=e.operation_id WHERE r.request_id=@request').get<Row>({ request: raw.client_request_id });
  if (!committed || committed.actor_id !== actor.id || committed.request_digest !== digest || committed.request_json !== requestJson) return fail('epoch_committed_receipt_unavailable');
  return { ...JSON.parse(committed.response_json), replayed: false };
}
