const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process')
const originalRead=fs.readFileSync
if(process.argv.includes('--frozen-base')){
  const frozen=execFileSync('git',['show','993564a8e356ea07358dd51cb5278489a40ba42f:cloudflare/src/lib/countedDamagedStock.ts'],{encoding:'utf8'})
  fs.readFileSync=function(file,...args){return String(file).replaceAll('\\','/').endsWith('/src/lib/countedDamagedStock.ts')?frozen:originalRead.call(this,file,...args)}
}
const fixture=require('./test-stock-remove-atomic-pure.cjs')
fs.readFileSync=originalRead
let controls=0
async function main(){
 for(const plan of ['free','paid']){
  fixture.fakeEnv.PLAN_TIER=plan
  for(const message of ['unrelated fixture failure','counted_quantity_conflict','counted_ordinary_null_conflict','counted_ordinary_null_conflict_extra','prefixcounted_ordinary_null_conflict']){
   fixture.seedStock({lot:3,unlotted:2});const before=fixture.stateOf(1)
   fixture.raw().exec(`CREATE TRIGGER fixture_unrelated BEFORE INSERT ON inventory_movements BEGIN SELECT RAISE(ABORT,'${message}'); END`)
   const result=await fixture.req('POST','/adjust',fixture.REMOVE({quantity:4}))
   assert.equal(result.status,503,JSON.stringify({plan,message,result}))
   assert.equal(result.json.code,'stock_request_outcome_unknown')
   assert.notEqual(result.json.code,'counted_quantity_conflict')
   assert.deepEqual(fixture.stateOf(1),before);assert.equal(fixture.moves(1).length,0)
   assert.equal(fixture.raw().prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n,0)
   controls++
  }
  fixture.seedStock({lot:3,unlotted:2})
  fixture.onFirstBatch(fixture.concurrentUnlottedSale(2))
  const raced=await fixture.req('POST','/adjust',fixture.REMOVE({quantity:4,client_request_id:'null_race_'+plan+'_0001'}))
  assert.equal(raced.status,409,JSON.stringify({plan,raced}))
  assert.equal(raced.json.code,'counted_quantity_conflict')
  assert.deepEqual(fixture.stateOf(1),{branch:3,product:3,lots:3})
  assert.equal(fixture.moves(1).length,0)
  assert.equal(fixture.raw().prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n,0)
  const retry=await fixture.req('POST','/adjust',fixture.REMOVE({quantity:4,client_request_id:'null_race_'+plan+'_0001'}))
  assert.equal(retry.status,400,JSON.stringify(retry));assert.notEqual(retry.json.code,'stock_request_partially_applied')
  assert.deepEqual(fixture.stateOf(1),{branch:3,product:3,lots:3});controls+=2
  fixture.seedStock({lot:3,unlotted:2}); const readBefore=fixture.stateOf(1), prepare=fixture.db.prepare
  fixture.db.prepare=function(sql){if(sql.includes('FROM products'))throw new Error('unrelated outer read failure');return prepare.call(this,sql)}
  let outer
  try{outer=await fixture.req('POST','/adjust',fixture.REMOVE({quantity:4}))}finally{fixture.db.prepare=prepare}
  assert.equal(outer.status,500,JSON.stringify(outer));assert.deepEqual(fixture.stateOf(1),readBefore);assert.equal(fixture.moves(1).length,0);controls++
  fixture.seedStock({lot:3,unlotted:2})
  const body=fixture.REMOVE({quantity:4,client_request_id:'null_positive_'+plan+'_001'})
  const first=await fixture.req('POST','/adjust',body),again=await fixture.req('POST','/adjust',body)
  assert.equal(first.status,200,JSON.stringify(first));assert.equal(again.status,200,JSON.stringify(again));assert.equal(again.json.replayed,true)
  assert.deepEqual(fixture.stateOf(1),{branch:1,product:1,lots:0});assert.equal(fixture.moves(1,'remove').length,1);controls++
 }
 const mapper=fixture.loadReal('lib/countedDamagedStock.ts').isCountedStockConflict
 for(const [message,expected] of [['counted_quantity_conflict',false],["D1_ERROR: bad JSON path: '$[counted_ordinary_null_conflict]': SQLITE_ERROR",true],['counted_ordinary_null_conflict',false],['counted_ordinary_null_conflict_extra',false],['prefixcounted_ordinary_null_conflict',false],['ordinary_null_conflict',false],['malformed JSON',false],['unrelated failure',false]]){assert.equal(mapper(new Error(message)),expected,message);controls++}
 console.log(JSON.stringify({status:'PASS',controls,scope:'real inventory routes and full migrated native SQLite with stock guards on; both plan configurations; authentication/index/tail/CPU/quota NOT certified'}))
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>fixture.raw()?.db.close())
