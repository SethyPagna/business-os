import { getDb } from './db'
import type { Env } from '../index'
import type { SessionUser } from './auth'
import type { StockWriteStatement } from './productBatches'
import { executeStockTransaction, stockTransactionStatementCount } from './stockTransaction'
import { assertReturnCreateQueryBudget, ReturnCreateBudgetError } from './returnCreateAction'
import { currentRequestMetrics } from './requestMetrics'
import { getPlanLimits } from './planTier'
import { countedStockFactsSql, CountedStockPlan, planExactCountedTaggedChange, isCountedStockConflict, subtractCountedQuantity, sumCountedQuantities } from './countedDamagedStock'
import { actorSnapshot } from './actorSnapshot'
import { bumpVersion } from './cache'
import { broadcast } from '../durable-objects/broadcastHub'
import { resolveMovementCostSnapshot } from './movementCostSnapshot'
import { subtractMoney4 } from './moneyPrecision'

export const COUNTED_CONDITION_HISTORY_KIND = 'inventory.counted_condition'
type Take = { lotId:number; productId:number; branchId:number; batchId:number|null; quantity:number; originalQuantity:number; remaining:number; tag:string; source:string|null; returnId:number|null; returnItemId:number|null; unitCostUsd:number|null; unitCostKhr:number|null; totalCostUsd?:number|null; totalCostKhr?:number|null }
type Snapshot = { operation:string; action:'tag'|'clear'|'dispose'; generation:number; productId:number; branchId:number; tag:string; takes:Take[] }
const snapshotWhere="kind=@kind AND json_extract(payload_json,'$.operation')=@operation"
const lotJson=`json_object('lotId',d.id,'productId',d.product_id,'branchId',d.branch_id,'batchId',d.batch_id,'quantity',@quantity,
  'originalQuantity',d.quantity,'remaining',d.quantity_remaining,'tag',d.condition_tag,'source',d.source,'returnId',d.return_id,'returnItemId',d.return_item_id,
  'unitCostUsd',COALESCE(d.unit_cost_usd,@costUsd),'unitCostKhr',@costKhr)`

export function planConditionHistory(input:{action:Snapshot['action'];productId:number;branchId:number;tag:string;actor:SessionUser|null; fallbackUnitCostUsd?:number|null;fallbackUnitCostKhr?:number|null;takes?:Array<{lotId:number;quantity:number;unitCostUsd?:number|null}>}, statements:StockWriteStatement[]):StockWriteStatement[] {
  const operation=crypto.randomUUID()
  const movement=statements.find(statement=>/INSERT\s+INTO\s+inventory_movements/i.test(statement.sql))?.params as Record<string,unknown>|undefined
  const units=sumCountedQuantities(input.takes?.map(take=>take.quantity)??statements.filter(statement=>/INSERT\s+INTO\s+damaged_stock_lots/i.test(statement.sql)).map(statement=>Number((statement.params as Record<string,unknown>).quantity)))
  const params={operation,kind:COUNTED_CONDITION_HISTORY_KIND,product:input.productId,branch:input.branchId,tag:input.tag,
    actor:input.actor?.id??null,actorName:actorSnapshot(input.actor),costUsd:movement?.unitCostUsd??null,costKhr:movement?.unitCostKhr??null,label:`${input.action==='tag'?'Tag':input.action==='clear'?'Clear tag':'Remove tagged'} ${units} ${input.tag} unit(s)`}
  const initial:Snapshot={operation,action:input.action,generation:0,productId:input.productId,branchId:input.branchId,tag:input.tag,takes:[]}
  const out:StockWriteStatement[]=[{sql:`INSERT INTO undo_snapshots(kind,status,payload_json,created_by_id,created_by_name) VALUES(@kind,'applied',@payload,@actor,@actorName)`,params:{...params,payload:JSON.stringify(initial)}}]
  const capture=(lotSql:string,quantity:unknown):StockWriteStatement=>({sql:`UPDATE undo_snapshots SET payload_json=json_insert(payload_json,'$.takes[#]',json((SELECT ${lotJson} FROM damaged_stock_lots d WHERE d.id=${lotSql}))) WHERE ${snapshotWhere}`,params:{...params,quantity}})
  for(const take of input.takes??[])out.push(capture('@lotId',take.quantity));
  // Bind each existing take separately; newly created identities are captured before a later INSERT changes last_insert_rowid.
  let priorUsd=0,priorKhr=0
  for(let i=0;i<(input.takes?.length??0);i++){
    const take=input.takes![i],prefix=input.takes!.slice(0,i+1)
    const cost=resolveMovementCostSnapshot({quantity:sumCountedQuantities(prefix.map(t=>t.quantity)),components:prefix.map(t=>({quantity:t.quantity,unitCostUsd:t.unitCostUsd})),fallbackUnitCostUsd:input.fallbackUnitCostUsd,fallbackUnitCostKhr:input.fallbackUnitCostKhr})
    const totalUsd=movement?.totalCostUsd==null?null:subtractMoney4(cost.totalCostUsd!,priorUsd)
    const totalKhr=movement?.totalCostKhr==null?null:subtractMoney4(cost.totalCostKhr!,priorKhr)
    priorUsd=cost.totalCostUsd??0;priorKhr=cost.totalCostKhr??0
    out[i+1].sql=out[i+1].sql.replace("'unitCostUsd',COALESCE(d.unit_cost_usd,@costUsd),'unitCostKhr',@costKhr", "'unitCostUsd',@takeUsd,'unitCostKhr',@takeKhr,'totalCostUsd',@takeTotalUsd,'totalCostKhr',@takeTotalKhr")
    out[i+1].params={...out[i+1].params,lotId:take.lotId,takeUsd:take.unitCostUsd??input.fallbackUnitCostUsd??null,takeKhr:input.fallbackUnitCostKhr??null,takeTotalUsd:totalUsd,takeTotalKhr:totalKhr}
  }
  for(const statement of statements){
    out.push(/INSERT\s+INTO\s+inventory_movements/i.test(statement.sql)?{...statement,sql:statement.sql.replace('@referenceId',`'condition_history:' || (SELECT id FROM undo_snapshots WHERE ${snapshotWhere}) || ':0'`),params:{...(statement.params as Record<string,unknown>),reason:`${(statement.params as Record<string,unknown>).reason??''} (${units} tagged unit(s)${input.action==='dispose'?', removed from physical stock':', physical stock unchanged'})`,kind:params.kind,operation}}:statement)
    if(input.action==='tag'&&/INSERT\s+INTO\s+damaged_stock_lots/i.test(statement.sql))out.push(capture('last_insert_rowid()',(statement.params as Record<string,unknown>).quantity))
  }
  out.push({sql:`SELECT CASE WHEN EXISTS(SELECT 1 FROM undo_snapshots WHERE ${snapshotWhere} AND json_array_length(payload_json,'$.takes')>0) THEN 1 ELSE json_extract('[1]','$[condition_history_missing]') END`,params})
  out.push({sql:`INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name)
    SELECT 'inventory','stock_condition',@product,@label,1,'undoable',json_object('applier',@kind,'snapshot_id',id,'generation',0),json_object('applier',@kind,'snapshot_id',id,'generation',0),@actor,@actorName FROM undo_snapshots WHERE ${snapshotWhere}`,params})
  return out
}

function refuse(message:string):never{throw Object.assign(new Error(message),{statusCode:409,code:'undo_record_changed'})}
export async function replayCountedCondition(env:Env,user:SessionUser|null,direction:'undo'|'redo',historyId:number,generation:unknown,payload:Record<string,unknown>):Promise<void>{
  const db=getDb(env)
  const row=await db.prepare(`SELECT s.id,s.status,s.payload_json,h.status history_status,h.undo_payload,h.redo_payload,
    ${countedStockFactsSql("json_extract(s.payload_json,'$.productId')", "json_extract(s.payload_json,'$.branchId')")} AS counted_facts
    FROM undo_snapshots s JOIN action_history h ON h.id=@history WHERE s.id=@snapshot AND s.kind=@kind
    AND json_extract(h.undo_payload,'$.snapshot_id')=s.id AND json_extract(h.undo_payload,'$.applier')=@kind`).get<{id:number;status:string;payload_json:string;history_status:string;undo_payload:string;redo_payload:string;counted_facts:string}>({history:historyId,snapshot:Number(payload.snapshot_id),kind:COUNTED_CONDITION_HISTORY_KIND})
  if(!row)refuse('This condition action has no authoritative saved lot provenance.')
  const saved=JSON.parse(row.payload_json) as Snapshot
  const expected=typeof generation==='number'?generation:NaN
  const target=direction==='undo'?'reversed':'applied',before=direction==='undo'?'applied':'reversed'
  if(!Number.isSafeInteger(expected)||expected<0)refuse('An exact condition history generation is required.')
  if(saved.generation===expected+1&&row.status===target)return
  if(saved.generation!==expected||row.status!==before)refuse('This condition action changed. Refresh history before retrying.')
  if(!Array.isArray(saved.takes)||!saved.takes.length)refuse('This condition action has no exact lot takes.')
  const exact = new CountedStockPlan(row.counted_facts, saved.branchId)
  const statements:StockWriteStatement[]=[{sql:`SELECT CASE WHEN EXISTS(SELECT 1 FROM undo_snapshots WHERE id=@snapshot AND kind=@kind AND status=@status AND payload_json=@saved)
    AND EXISTS(SELECT 1 FROM action_history WHERE id=@history AND status=@historyStatus AND undo_payload=@undo AND redo_payload=@redo)
    THEN 1 ELSE json_extract('[1]','$[condition_history_changed]') END`,params:{snapshot:row.id,kind:COUNTED_CONDITION_HISTORY_KIND,status:before,saved:row.payload_json,history:historyId,historyStatus:direction==='undo'?'undoable':'redoable',undo:row.undo_payload,redo:row.redo_payload}}]
  for(const take of saved.takes){
    const decreasing=saved.action==='tag'?direction==='undo':direction==='redo'
    const balance=subtractCountedQuantity(take.remaining,[saved.action==='tag'?(direction==='redo'?take.quantity:0):(direction==='undo'?take.quantity:0)])
    const params={...take,balance}
    statements.push({sql:`SELECT CASE WHEN EXISTS(SELECT 1 FROM damaged_stock_lots WHERE id=@lotId AND product_id=@productId AND branch_id IS @branchId AND batch_id IS @batchId
      AND condition_tag=@tag AND source IS @source AND return_id IS @returnId AND return_item_id IS @returnItemId AND quantity=@originalQuantity AND quantity_remaining=@balance
      AND EXISTS(SELECT 1 FROM products WHERE id=@productId AND is_active=1) AND EXISTS(SELECT 1 FROM branches WHERE id=@branchId AND is_active=1))
      THEN 1 ELSE json_extract('[1]','$[condition_lot_changed]') END`,params})
    const identity={lotId:take.lotId,productId:take.productId,branchId:take.branchId,batchId:take.batchId}
    if(saved.action==='dispose')statements.push(...planExactCountedTaggedChange(exact,identity,take.quantity,decreasing?'consume':'restore'))
    else statements.push(...planExactCountedTaggedChange(exact,identity,take.quantity,decreasing?'clear':'retag'))
    const legacyCost=resolveMovementCostSnapshot({quantity:take.quantity,components:[{quantity:take.quantity,unitCostUsd:take.unitCostUsd,unitCostKhr:take.unitCostKhr}]})
    statements.push({sql:`INSERT INTO inventory_movements(product_id,branch_id,batch_id,movement_type,quantity,unit_cost_usd,unit_cost_khr,total_cost_usd,total_cost_khr,reason,reference_id,user_id,user_name)
      VALUES(@productId,@branchId,@batchId,@movement,@physical,@unitCostUsd,@unitCostKhr,@totalUsd,@totalKhr,@reason,@reference,@actor,@actorName)`,params:{...params,movement:saved.action==='dispose'?(direction==='undo'?'adjustment':'write_off'):(decreasing?'condition_clear':'condition_tag'),physical:saved.action==='dispose'?take.quantity:0,totalUsd:take.totalCostUsd===undefined?legacyCost.totalCostUsd:take.totalCostUsd,totalKhr:take.totalCostKhr===undefined?legacyCost.totalCostKhr:take.totalCostKhr,reason:`${direction}: ${saved.tag} ${take.quantity} unit(s)`,reference:saved.action==='dispose'&&direction==='undo'?`revert:condition_history:${row.id}:${expected}`:`condition_history:${row.id}:${expected+1}`,actor:user?.id??null,actorName:actorSnapshot(user)}})
  }
  const next=expected+1,pointer=JSON.stringify({applier:COUNTED_CONDITION_HISTORY_KIND,snapshot_id:row.id,generation:next})
  statements.push({sql:`UPDATE undo_snapshots SET status=@target,payload_json=json_set(payload_json,'$.generation',@next),updated_at=CURRENT_TIMESTAMP WHERE id=@snapshot`,params:{target,next,snapshot:row.id}},
    {sql:`UPDATE action_history SET status=@status,undo_payload=@pointer,redo_payload=@pointer,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=@history`,params:{status:direction==='undo'?'redoable':'undoable',pointer,history:historyId}})
  try{assertReturnCreateQueryBudget(getPlanLimits(env).d1QueriesPerInvocation,currentRequestMetrics()?.invocation.attemptedStatements??18,stockTransactionStatementCount(statements.length),12)}catch(error){
    if(error instanceof ReturnCreateBudgetError)throw Object.assign(new Error('This condition change is too large for the current plan. Nothing was reversed; use a smaller original action.'),{statusCode:409,code:'stock_request_query_budget_exceeded'})
    throw error
  }
  try{await executeStockTransaction(db,statements,'once')}catch(error){
    const durable=await db.prepare('SELECT status,json_extract(payload_json,\'$.generation\') generation FROM undo_snapshots WHERE id=? AND kind=?').get<{status:string;generation:number}>([row.id,COUNTED_CONDITION_HISTORY_KIND])
    if(durable?.status===target&&durable.generation===next)return
    if(isCountedStockConflict(error)||/\bcondition_history_changed\b|\bcondition_lot_changed\b/.test(error instanceof Error?error.message:String(error)))refuse('The exact tagged stock changed or was consumed. Nothing was reversed; refresh the stock and history.')
    throw error
  }
}
export async function notifyCountedCondition(env:Env):Promise<void>{await Promise.all([bumpVersion(env,'products'),broadcast(env,'products',{action:'update'}),broadcast(env,'inventory',{action:'adjust'})])}
