/** Unwired prototype. All actor/source/effect inputs are trusted server context,
 * never wire JSON. Retrying SQL prefixes or restoring these control tables is forbidden. */
import type { D1Compat } from './db'
import { getActionTier, hasPermission, isAdminControlUser } from './permissions'
type Statement={sql:string;params?:Record<string,unknown>}
type Principal={actorId:number;organizationId:number|null}
type Actor={id:number;organization_id:number|null;created_at:string;username:string;role_id:number|null;role_code:string|null;permissions:string|null;role_permissions:string|null;dataset:string;maintenance:string|null}
type Binding={id:string;scope:'branches'|'inventory';receipt_id:number;history_id:number;self_actor_id:number|null;self_org_id:number|null;self_created_at:string|null;generation:number;replay_state:string;history_status:string;revision:number;self_invalid:number;bundle_valid:number;response_json:string|null}
const assertion=(condition:string,params:Record<string,unknown>):Statement=>({sql:`INSERT INTO branches(name) SELECT NULL WHERE COALESCE((${condition}),0)=0`,params})
export class TransferAdmissionError extends Error { statusCode=409 }
async function actor(db:D1Compat,principal:Principal):Promise<Actor>{
 const row=await db.prepare(`SELECT u.id,u.organization_id,u.created_at,u.username,u.role_id,u.permissions,r.code role_code,r.permissions role_permissions,
 (SELECT json_extract(value,'$.generation') FROM system_flags WHERE key='business_dataset_generation') dataset,
 (SELECT value FROM system_flags WHERE key='maintenance') maintenance
 FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=@actor AND u.is_active=1 AND u.deleted_at IS NULL`).get<Actor>({actor:principal.actorId})
 if(!row || row.organization_id!==principal.organizationId || !row.dataset)throw new TransferAdmissionError('Current transfer identity/dataset could not be verified. Refresh before continuing.')
 return row
}
async function binding(db:D1Compat,a:Actor,operation:string,responseRequest:string|null=null):Promise<Binding>{
 const row=await db.prepare(`SELECT b.*,x.generation,x.replay_state,x.history_status,x.revision,
 CASE WHEN @responseRequest IS NOT NULL THEN p.response_json ELSE NULL END response_json,
 EXISTS(SELECT 1 FROM transfer_binding_invalidations WHERE binding_id=b.id AND scope='self') self_invalid,
 (NOT EXISTS(SELECT 1 FROM transfer_binding_invalidations WHERE binding_id=b.id AND scope='bundle')
 AND p.identity_json=b.receipt_identity AND h.identity_json=b.history_identity
 AND (SELECT COUNT(*) FROM transfer_operation_members WHERE receipt_id=b.receipt_id)=b.member_count
 AND p.generation=x.generation AND p.replay_state=x.replay_state AND h.status=x.history_status AND h.reversible=1
 AND json_extract(h.undo_payload,'$.generation')=x.generation AND json_extract(h.redo_payload,'$.generation')=x.generation) bundle_valid
 FROM transfer_history_bindings b JOIN transfer_execution_heads x ON x.binding_id=b.id
 JOIN transfer_receipt_retirement_rows p ON p.id=b.receipt_id JOIN transfer_binding_history_rows h ON h.id=b.history_id
 WHERE b.operation_id=@operation AND b.dataset_generation=@dataset
 AND b.dataset_generation=(SELECT json_extract(value,'$.generation') FROM system_flags WHERE key='business_dataset_generation')
 AND NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance')
 AND (@responseRequest IS NULL OR (
 b.source='new' AND p.status='committed' AND p.actor_id=@actor AND p.request_id=@responseRequest
 AND EXISTS(SELECT 1 FROM transfer_owner_admissions o WHERE o.binding_id=b.id AND o.actor_id=@actor AND o.request_id=@responseRequest)
 AND NOT EXISTS(SELECT 1 FROM transfer_retired_receipt_keys k WHERE k.actor_id=@actor AND k.request_id=@responseRequest)
 AND NOT EXISTS(SELECT 1 FROM transfer_run_retired_keys k WHERE k.actor_id=@actor AND k.request_id=@responseRequest)))
 AND EXISTS(SELECT 1 FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=@actor AND u.is_active=1 AND u.deleted_at IS NULL
 AND u.organization_id IS @org AND u.created_at=@created AND u.username=@username AND u.role_id IS @role
 AND u.permissions IS @permissions AND r.permissions IS @rolePermissions AND r.code IS @roleCode)`)
 .get<Binding>({operation,responseRequest,dataset:a.dataset,actor:a.id,org:a.organization_id,created:a.created_at,username:a.username,role:a.role_id,permissions:a.permissions,rolePermissions:a.role_permissions,roleCode:a.role_code})
 if(!row || !row.bundle_valid)throw new TransferAdmissionError('Exact history binding requires administrator recovery; no stock was changed.')
 return row
}
function authority(a:Actor,b:Binding):'self'|'cross'{
 if(a.maintenance || getActionTier(a,b.scope,'transfer')!=='full')throw new TransferAdmissionError('Transfer permission changed or maintenance is active.')
 if(isAdminControlUser(a)||hasPermission(a,'audit_log'))return 'cross'
 if(!b.self_invalid&&b.self_actor_id===a.id&&b.self_org_id===a.organization_id&&b.self_created_at===a.created_at)return 'self'
 throw new TransferAdmissionError('This historical action requires an authorized administrator or audit reviewer.')
}
function tokenStatement(a:Actor,bindingId:string,operation:string,kind:string,extra:Record<string,unknown>={}):Statement{
 const params={token:crypto.randomUUID(),kind,binding:bindingId,operation,dataset:a.dataset,actor:a.id,org:a.organization_id,created:a.created_at,
 username:a.username,role:a.role_id,code:a.role_code,userPermissions:a.permissions,rolePermissions:a.role_permissions,
 authority:'cross',oldGeneration:null,newGeneration:null,oldState:null,newState:null,oldStatus:null,newStatus:null,oldRevision:null,scope:null,...extra}
 return {sql:`INSERT INTO transfer_execution_guard(id,token,kind,dataset_generation,binding_id,operation_id,actor_id,organization_id,actor_created_at,username,role_id,role_code,user_permissions,role_permissions,authority,old_generation,new_generation,old_state,new_state,old_status,new_status,old_revision,scope)
 VALUES(1,@token,@kind,@dataset,@binding,@operation,@actor,@org,@created,@username,@role,@code,@userPermissions,@rolePermissions,@authority,@oldGeneration,@newGeneration,@oldState,@newState,@oldStatus,@newStatus,@oldRevision,@scope)`,params}
}
async function execute(db:D1Compat,statements:Statement[],token:Statement,max:number):Promise<void>{
 statements.push({sql:'DELETE FROM transfer_execution_guard WHERE token=@token',params:{token:token.params!.token}})
 if(!Number.isSafeInteger(max)||max<statements.length)throw new TransferAdmissionError('Atomic transfer admission exceeds reserved budget.')
 await db.batchOnce(statements)
}
/** Existing financial SQL belongs to the trusted transfer planner. This wrapper
 * owns the COMPLETE batch; no caller can obtain/mint an execution prefix. */
export async function executeBoundTransferHistory(db:D1Compat,input:Principal&{
 operationId:string;direction:'undo'|'redo';expectedGeneration:number;effects:readonly Statement[];maxStatements:number
}):Promise<'committed'|'already-applied'>{
 const a=await actor(db,input),b=await binding(db,a,input.operationId),access=authority(a,b)
 if(!Number.isSafeInteger(input.expectedGeneration)||input.expectedGeneration<0)throw new TransferAdmissionError('Invalid expected history generation.')
 const target=input.direction==='undo'?'reversed':'applied',oldState=input.direction==='undo'?'applied':'reversed'
 if(b.generation===input.expectedGeneration+1&&b.replay_state===target)return 'already-applied'
 if(b.generation!==input.expectedGeneration||b.replay_state!==oldState||!input.effects.length)throw new TransferAdmissionError('History generation changed.')
 const nextStatus=target==='reversed'?'redoable':'undoable'
 const token=tokenStatement(a,b.id,input.operationId,'replay',{authority:access,scope:b.scope,oldGeneration:b.generation,newGeneration:b.generation+1,
 oldState,newState:target,oldStatus:b.history_status,newStatus:nextStatus,oldRevision:b.revision})
 const p={binding:b.id,receipt:b.receipt_id,history:b.history_id,revision:b.revision,generation:b.generation,next:b.generation+1,target,status:nextStatus}
 const statements=[token,assertion(`EXISTS(SELECT 1 FROM transfer_valid_execution_guard g JOIN transfer_history_bindings b ON b.id=g.binding_id
 JOIN transfer_execution_heads x ON x.binding_id=b.id JOIN transfer_receipt_retirement_rows r ON r.id=b.receipt_id JOIN transfer_binding_history_rows h ON h.id=b.history_id
 WHERE b.id=@binding AND x.revision=@revision AND x.generation=@generation AND r.generation=x.generation AND r.replay_state=x.replay_state
 AND h.status=x.history_status AND json_extract(h.undo_payload,'$.generation')=x.generation AND json_extract(h.redo_payload,'$.generation')=x.generation
 AND r.identity_json=b.receipt_identity AND h.identity_json=b.history_identity AND h.reversible=1
 AND (SELECT COUNT(*) FROM transfer_operation_members WHERE receipt_id=r.id)=b.member_count
 AND NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance')
 AND NOT EXISTS(SELECT 1 FROM transfer_binding_invalidations WHERE binding_id=b.id AND scope='bundle')
 AND (g.authority='cross' OR (b.self_actor_id=g.actor_id AND b.self_org_id IS g.organization_id AND b.self_created_at=g.actor_created_at
 AND NOT EXISTS(SELECT 1 FROM transfer_binding_invalidations WHERE binding_id=b.id AND scope='self'))))`,p),...input.effects,
 {sql:'UPDATE transfer_operation_receipts SET generation=@next,replay_state=@target,updated_at=CURRENT_TIMESTAMP WHERE id=@receipt AND generation=@generation',params:p},
 {sql:"UPDATE action_history SET status=@status,undo_payload=json_set(undo_payload,'$.generation',@next),redo_payload=json_set(redo_payload,'$.generation',@next),updated_at=CURRENT_TIMESTAMP WHERE id=@history",params:p},
 {sql:'UPDATE transfer_execution_heads SET revision=revision+1,generation=@next,replay_state=@target,history_status=@status WHERE binding_id=@binding AND revision=@revision',params:p},
 {sql:"INSERT INTO audit_logs(user_id,action,entity,entity_id,details) VALUES(@actor,'transfer_history_execution','stock_transfer',@operation,json_object('binding',@binding,'generation',@next))",params:{...p,actor:a.id,operation:input.operationId}}]
 await execute(db,statements,token,input.maxStatements)
 return 'committed'
}
/** Never returns private receipt JSON merely because a numeric actor matches. */
export async function readAdmittedTransferResponse(db:D1Compat,input:Principal&{requestId:string}):Promise<unknown>{
 const a=await actor(db,input)
 const retired=await db.prepare(`SELECT 1 yes FROM transfer_retired_receipt_keys WHERE actor_id=@actor AND request_id=@request
 UNION ALL SELECT 1 FROM transfer_run_retired_keys WHERE actor_id=@actor AND request_id=@request LIMIT 1`).get({actor:a.id,request:input.requestId})
 if(retired)throw new TransferAdmissionError('This retry identity is permanently retired. Use authorized history review, not a new retry key.')
 const row=await db.prepare(`SELECT o.binding_id,p.operation_id FROM transfer_owner_admissions o
 JOIN transfer_history_bindings b ON b.id=o.binding_id JOIN transfer_operation_receipts p ON p.id=b.receipt_id
 WHERE o.actor_id=@actor AND o.request_id=@request AND b.dataset_generation=@dataset AND b.source='new' AND p.status='committed'`).get<{operation_id:string}>({actor:a.id,request:input.requestId,dataset:a.dataset})
 if(!row)throw new TransferAdmissionError('Earlier retry ownership is unverified. Open its history or ask an administrator; do not resubmit with a new key.')
 // Read the response only in the final snapshot proving retirement absence,
 // owner admission, dataset, live principal/permission fingerprint and head.
 // Historical execution intentionally uses binding without this retry fence.
 const b=await binding(db,a,row.operation_id,input.requestId)
 authority(a,b)
 if(b.self_invalid||b.self_actor_id!==a.id||b.self_org_id!==a.organization_id||b.self_created_at!==a.created_at)throw new TransferAdmissionError('Receipt owner changed.')
 return JSON.parse(b.response_json!)
}

function materializeBinding(token:Statement,source:'new'|'restored'):Statement[]{
 const p=token.params!
 return [{sql:`INSERT INTO transfer_history_bindings
 SELECT @binding,@dataset,p.operation_id,p.id,h.id,h.scope,p.identity_json,h.identity_json,
 (SELECT COUNT(*) FROM transfer_operation_members m WHERE m.receipt_id=p.id),@kind,
 CASE WHEN @kind='new' THEN @actor ELSE NULL END,CASE WHEN @kind='new' THEN @org ELSE NULL END,CASE WHEN @kind='new' THEN @created ELSE NULL END
 FROM transfer_receipt_retirement_rows p JOIN transfer_binding_history_rows h ON h.id=p.action_history_id
 WHERE p.operation_id=@operation AND p.status='committed' AND p.provenance_version=1 AND h.reversible=1
 AND h.scope IN ('branches','inventory') AND h.entity='stock_transfer' AND h.created_by_id=p.actor_id AND h.entity_id=p.operation_id
 AND (@kind='restored' OR p.actor_id=@actor)
 AND json_extract(h.undo_payload,'$.applier')='stock.transfer' AND json_extract(h.redo_payload,'$.applier')='stock.transfer'
 AND json_extract(h.undo_payload,'$.operation_id')=p.operation_id AND json_extract(h.redo_payload,'$.operation_id')=p.operation_id
 AND json_extract(h.undo_payload,'$.permission')=h.scope AND json_extract(h.redo_payload,'$.permission')=h.scope
 AND json_extract(h.undo_payload,'$.generation')=p.generation AND json_extract(h.redo_payload,'$.generation')=p.generation
 AND h.status=CASE p.replay_state WHEN 'applied' THEN 'undoable' WHEN 'reversed' THEN 'redoable' END
 AND EXISTS(SELECT 1 FROM transfer_operation_members WHERE receipt_id=p.id)`,params:p},
 assertion('EXISTS(SELECT 1 FROM transfer_history_bindings WHERE id=@binding)',p),
 {sql:`INSERT INTO transfer_execution_heads(binding_id,generation,replay_state,history_status)
 SELECT b.id,p.generation,p.replay_state,h.status FROM transfer_history_bindings b
 JOIN transfer_operation_receipts p ON p.id=b.receipt_id JOIN action_history h ON h.id=b.history_id WHERE b.id=@binding`,params:p},
 ...(source==='new'?[{sql:`INSERT INTO transfer_owner_admissions(actor_id,request_id,binding_id)
 SELECT p.actor_id,p.request_id,b.id FROM transfer_history_bindings b JOIN transfer_operation_receipts p ON p.id=b.receipt_id WHERE b.id=@binding`,params:p}]:[])]
}
/** Prospective only: receipt MUST NOT exist before the trusted complete transfer
 * batch. This cannot retrospectively claim a legacy receipt owner. */
export async function commitAdmittedTransfer(db:D1Compat,input:Principal&{
 operationId:string;requestId:string;scope:'branches'|'inventory';effects:readonly Statement[];maxStatements:number
}):Promise<void>{
 const a=await actor(db,input)
 if(a.maintenance||getActionTier(a,input.scope,'transfer')!=='full'||!input.effects.length)throw new TransferAdmissionError('Transfer admission denied.')
 const token=tokenStatement(a,crypto.randomUUID(),input.operationId,'new',{scope:input.scope})
 const p={...token.params,request:input.requestId}
 await execute(db,[token,assertion(`EXISTS(SELECT 1 FROM transfer_valid_execution_guard WHERE binding_id=@binding)
 AND NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance')
 AND NOT EXISTS(SELECT 1 FROM transfer_operation_receipts WHERE operation_id=@operation OR (actor_id=@actor AND request_id=@request))
 AND NOT EXISTS(SELECT 1 FROM transfer_retired_receipt_keys WHERE actor_id=@actor AND request_id=@request)
 AND NOT EXISTS(SELECT 1 FROM transfer_run_retired_keys WHERE actor_id=@actor AND request_id=@request)`,p),
 ...input.effects,...materializeBinding(token,'new')],token,input.maxStatements)
}
/** Restored evidence gains cross-user historical execution only, NEVER retry
 * ownership or a restored employee self-grant. Pinning source bytes is the
 * future restore orchestrator's prerequisite, not certified by this prototype. */
export async function bindRestoredTransferHistory(db:D1Compat,input:Principal&{
 operationId:string;maintenanceToken:string;sourceId:string;maxStatements:number
}):Promise<void>{
 const a=await actor(db,input)
 if(!hasPermission(a,'backup_restore')||!a.maintenance)throw new TransferAdmissionError('Authorized restore context required.')
 const token=tokenStatement(a,crypto.randomUUID(),input.operationId,'restored')
 const p={...token.params,maintenanceToken:input.maintenanceToken,source:input.sourceId}
 await execute(db,[token,assertion(`EXISTS(SELECT 1 FROM transfer_valid_execution_guard WHERE binding_id=@binding)
 AND EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.token')=@maintenanceToken AND json_extract(value,'$.backupKey')=@source)
 AND EXISTS(SELECT 1 FROM transfer_receipt_retirement_rows p JOIN transfer_retired_receipt_snapshots s
 ON s.actor_id=p.actor_id AND s.request_id=p.request_id AND s.snapshot_json=p.snapshot_json WHERE p.operation_id=@operation
 AND EXISTS(SELECT 1 FROM transfer_retired_receipt_keys k WHERE k.actor_id=p.actor_id AND k.request_id=p.request_id
 AND k.identity_json=p.identity_json AND k.member_count=(SELECT COUNT(*) FROM transfer_operation_members WHERE receipt_id=p.id))
 AND NOT EXISTS(SELECT 1 FROM transfer_receipt_member_retirement_rows m WHERE m.receipt_id=p.id AND NOT EXISTS(
 SELECT 1 FROM transfer_retired_receipt_members r WHERE r.actor_id=m.actor_id AND r.request_id=m.request_id AND r.ordinal=m.ordinal AND r.snapshot_json=m.snapshot_json)))`,p),
 ...materializeBinding(token,'restored')],token,input.maxStatements)
}
