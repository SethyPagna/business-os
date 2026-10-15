const assert = require('node:assert/strict')
const { Hono } = require('hono')
const f = require('./test-stock-bridge-core-native.cjs')
const { sql, db, load, actor } = f
const route = load('routes/actionHistory.ts')
const { productMergeGroupPrefixFingerprint } = load('lib/undoAppliers.ts')
const op = `product-merge-group-${'a'.repeat(64)}`
const pointer = { applier:'product.merge.group',merge_version:3,operation_id:op,review_id:'receipt-review',group_key:'receipt-group',snapshot_id:9000,generation:2 }
const outcome = {version:1,keeperId:1001,original:{usd:2,khr:null},reviewKey:'b'.repeat(32),rootKey:'c'.repeat(32),beforeKey:null}
let checks = 0
async function main() {
  const group = {version:1,review_id:pointer.review_id,group_key:pointer.group_key,child_snapshot_ids:[9001,9002],generation:2,
    prefix_fingerprint:await productMergeGroupPrefixFingerprint(pointer.review_id,pointer.group_key,[9001,9002],2),
    graph_receipt:{version:1,operation_id:op,generation:2,applied_prefix:2,graph_state:'{}'}}
  sql.prepare("INSERT INTO action_history(id,scope,entity,entity_id,label,status,reversible,undo_payload,redo_payload,created_by_id)VALUES(9000,'products','product','1001','Saved merge','recorded',0,?,?,7)").run(JSON.stringify(pointer),JSON.stringify(pointer))
  sql.prepare("INSERT INTO undo_snapshots(id,kind,status,payload_json,created_by_id)VALUES(9000,'product.merge.group','applied',?,7)").run(JSON.stringify(group))
  for(const [id,product,pending] of [[9001,1002,false],[9002,1003,true]]) sql.prepare("INSERT INTO undo_snapshots(id,kind,status,payload_json,created_by_id)VALUES(?,'product.merge.group.child','applied',?,7)").run(id,JSON.stringify({keeperId:1001,dupId:product,operationId:`child-${id}`,fingerprintPending:pending,costReviewOutcome:outcome,dupImagesBefore:[],imagesMovedToKeeper:[],dupImagePathBefore:null}))
  sql.exec("INSERT INTO product_conflict_action_reviews(id,actor_id,request_id,request_digest,manifest_version,resolution_version,draft_digest,status,requested_action_count,requested_group_count,requested_removal_count,actionable_group_count,blocked_group_count,total_member_count,expires_at)VALUES('receipt-review',7,'receipt-request','digest',1,2,'digest','completed',1,1,0,1,0,3,'2099-01-01')")
  sql.prepare("INSERT INTO product_conflict_action_groups(review_id,ordinal,group_key,source_group_keys_json,member_ids_json,status,state_digest,detail_json,operation_id,action_history_id,reversal_generation)VALUES('receipt-review',0,'receipt-group','[]','[1001,1002,1003]','completed','digest','{}',?,9000,2)").run(op)
  for(const [ordinal,product,role,snapshot,childOp] of [[0,1001,'keeper',null,null],[1,1002,'merged',9001,'child-9001'],[2,1003,'merged',9002,'child-9002']]) sql.prepare("INSERT INTO product_conflict_action_group_members(review_id,group_ordinal,member_ordinal,product_id,role,status,state_digest,snapshot_json,operation_id,undo_snapshot_id)VALUES('receipt-review',0,?,?,?,'undo_ready','digest','{}',?,?)").run(ordinal,product,role,childOp,snapshot)
  const row=()=>sql.prepare('SELECT * FROM action_history WHERE id=9000').get()
  const descriptor={version:1,history_id:9000,group_operation_id:op,expected_generation:1}
  async function check(name,run){await run();assert.equal(f.permits(),0);checks++;console.log(`PASS ${name}`)}
  await check('real batched projection retains recorded state and original generation without cost data',async()=>{
    let reads=0; const counted=Object.create(db); counted.prepare=(...args)=>{reads++;return db.prepare(...args)}
    const result=await route.pendingGroupRedoReceipts(counted,[row(),row()],actor)
    assert.equal(reads,1)
    assert.deepEqual(result.get(9000),descriptor)
    assert.equal(row().status,'recorded');assert.equal(row().reversible,0)
  })
  await check('actual Hono history GET supplies separate descriptor, never fake reversibility',async()=>{
    const app=new Hono();app.route('/api/action-history',route.default)
    const response=await app.request('/api/action-history?scope=products',{}, {DB:f.raw,PLAN_TIER:'paid'})
    assert.equal(response.status,200)
    const body=await response.json(),item=body.items.find(item=>item.id===9000)
    assert.deepEqual(item.pending_redo,descriptor);assert.equal(item.reversible,false);assert.equal(item.server_replayable,false);assert.equal(item.status,'recorded')
    assert.equal(JSON.stringify(item.pending_redo).includes('cost'),false)
  })
  for(const [name,mutate,restore] of [
    ['closed marker',()=>sql.exec("UPDATE action_history SET last_error='undo_closed:products_merged' WHERE id=9000"),()=>sql.exec('UPDATE action_history SET last_error=NULL WHERE id=9000')],
    ['already finalized child',()=>sql.prepare('UPDATE undo_snapshots SET payload_json=json_set(payload_json,\'$.fingerprintPending\',json(\'false\')) WHERE id=9002').run(),()=>sql.prepare('UPDATE undo_snapshots SET payload_json=json_set(payload_json,\'$.fingerprintPending\',json(\'true\')) WHERE id=9002').run()],
    ['wrong actor association',()=>sql.exec('UPDATE product_conflict_action_reviews SET actor_id=8'),()=>sql.exec('UPDATE product_conflict_action_reviews SET actor_id=7')],
    ['wrong generation',()=>sql.exec('UPDATE product_conflict_action_groups SET reversal_generation=3'),()=>sql.exec('UPDATE product_conflict_action_groups SET reversal_generation=2')],
    ['missing child',()=>sql.exec("UPDATE undo_snapshots SET kind='wrong' WHERE id=9002"),()=>sql.exec("UPDATE undo_snapshots SET kind='product.merge.group.child' WHERE id=9002")],
  ]) await check(`${name} has no advertised receipt action`,async()=>{mutate();try{assert.equal((await route.pendingGroupRedoReceipts(db,[row()],actor)).size,0)}finally{restore()}})
  await check('foreign actor and revoked full merge authority have no descriptor',async()=>{
    assert.equal((await route.pendingGroupRedoReceipts(db,[row()],{...actor,id:8})).size,0)
    assert.equal((await route.pendingGroupRedoReceipts(db,[row()],{id:7,username:'limited',role_code:'cashier',is_active:1,permissions:'{}'})).size,0)
  })
  console.log(`PASS ${checks} receipt projection groups; synthetic pending metadata, actual SQLite/query/Hono, not actual authenticated Worker fold`)
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>sql.close())
