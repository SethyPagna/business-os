const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto')
const harness=path.join(__dirname,'test-product-resolve-keep-merge-native.cjs')
let source=fs.readFileSync(harness,'utf8').replaceAll('\r\n','\n'),boundary=source.indexOf('\nasync function main() {')
assert.ok(boundary>0)
source=source.slice(0,boundary)
const anchor="const code = ts.transpileModule(fs.readFileSync(full, 'utf8'),"
assert.equal(source.split(anchor).length,2)
source=source.replace(anchor,"const code = ts.transpileModule(file==='routes/products.ts' && process.env.BULK_CONFIRM_RUNTIME ? fs.readFileSync(process.env.BULK_CONFIRM_RUNTIME,'utf8') : fs.readFileSync(full, 'utf8'),")
source=source.replace('const noAudit = { audit:',"const noAudit = { ...load('lib/audit.ts'), audit:")
const runner=new Module(harness,module);runner.filename=harness;runner.paths=module.paths
runner._compile(source+'\nmodule.exports={fresh,one,rows,state,request,adapter,fixtureWrite,costReview}',harness)
const {fresh,one,rows,state,request,adapter,fixtureWrite,costReview}=runner.exports
adapter.batchOnce=statements=>adapter.batch(statements)
const route='/api/products/bulk-price-adjust'
let next=0,passed=0,failed=0
const statement=s=>state.native.prepare(s.sql)[/^\s*SELECT/i.test(s.sql)?'all':'run'](s.params||{})
function mark(id){return fixtureWrite(()=>{const row=one('SELECT cost_price_usd,cost_price_khr,cost_review_key FROM products WHERE id=?',id),outcome=costReview.mergeCostOutcome(id,{usd:row.cost_price_usd,khr:row.cost_price_khr},row.cost_review_key)
 for(const s of costReview.mergeCostReviewStatements(outcome,{id:1,name:'admin'},'bulk-fixture-'+(++next),0))statement(s)
 return one('SELECT cost_review_key FROM products WHERE id=?',id).cost_review_key
})}
function seed(usd,khr=123){fixtureWrite(()=>{
 state.native.db.exec('DELETE FROM branch_stock; UPDATE products SET stock_quantity=0; UPDATE products SET is_active=0')
 state.native.db.prepare('INSERT INTO products(id,name,cost_price_usd,purchase_price_usd,cost_price_khr,purchase_price_khr,selling_price_usd,is_active) VALUES(70,?,?,?,?,?,10,1)').run('Bulk confirmation',usd,usd,khr,khr)
});return mark(70)}
const confirmationRows=()=>rows("SELECT * FROM audit_logs WHERE json_valid(details) AND json_extract(details,'$.kind')='product.cost-review-confirm' ORDER BY id")
const snapshot=()=>JSON.stringify(['products','product_cost_entries','audit_logs','system_flags'].map(t=>rows(`SELECT * FROM ${t} ORDER BY rowid`)))
const body=(fields=['cost_price_usd'],extra={})=>({client_request_id:'bulk-confirm-'+(++next),direction:'increase',amount:1,fields,skip_zero:false,...extra})
async function send(input){assert.equal(one("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").n,0);const result=await request('POST',route,input);assert.equal(one("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").n,0);assert.equal(one("SELECT COUNT(*) n FROM system_flags WHERE key LIKE 'cost-review-edit:%'").n,0);console.log('QUERY bulk '+result.status+' '+result.queries+' statements');return result}
async function check(name,test){fresh();try{await test();passed++;console.log('PASS '+name)}catch(error){failed++;console.error('FAIL '+name+'\n'+error.stack)}finally{state.native.db.close()}}
async function main(){
 console.log('RUNTIME '+(process.env.BULK_CONFIRM_RUNTIME||'current routes/products.ts')+' '+crypto.createHash('sha256').update(fs.readFileSync(process.env.BULK_CONFIRM_RUNTIME||path.join(__dirname,'../src/routes/products.ts'))).digest('hex'))
 for(const [name,usd,amount,direction,expected,cleared]of [
  ['known change',7,1,'increase',8,true],['real zero to positive',0,1,'increase',1,true],['unknown stays unknown',null,1,'increase',null,false],
  ['same rounded echo',7,0.00001,'increase',7,false],['decrease to real zero',0.5,1,'decrease',0,true]
 ])await check(name,async()=>{const prior=seed(usd),result=await send(body(['cost_price_usd'],{amount,direction}));assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(one('SELECT cost_price_usd FROM products WHERE id=70').cost_price_usd,expected);assert.equal(one('SELECT cost_review_key FROM products WHERE id=70').cost_review_key,cleared?null:prior);assert.equal(confirmationRows().length,cleared?1:0);if(cleared){const event=JSON.parse(confirmationRows()[0].details);assert.equal(event.cost_review.before_key,prior);assert.equal(event.cost_review.after_usd,expected)}})
 for(const fields of [['cost_price_khr'],['selling_price_usd']])await check(fields[0]+' alone retains review',async()=>{const prior=seed(7),result=await send(body(fields));assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(one('SELECT cost_review_key FROM products WHERE id=70').cost_review_key,prior);assert.equal(confirmationRows().length,0);assert.equal(one('SELECT cost_price_usd FROM products WHERE id=70').cost_price_usd,7)})
 await check('committed retry never confirms a newer review',async()=>{seed(7);const input=body(),first=await send(input);assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(confirmationRows().length,1);const newer=mark(70),before=snapshot(),retry=await send(input);assert.equal(retry.status,200);assert.equal(retry.body.replayed,true);assert.equal(snapshot(),before);assert.equal(one('SELECT cost_review_key FROM products WHERE id=70').cost_review_key,newer);const conflict=await send({...input,amount:2});assert.equal(conflict.status,409);assert.equal(snapshot(),before)})
 await check('confirmation failure rolls cost entries audit and marker back in one once batch',async()=>{seed(7);const before=snapshot(),once=adapter.batchOnce;let calls=0,injected=false
 adapter.batchOnce=statements=>{calls++;const position=statements.findIndex(s=>s.sql.includes("'product.cost-review-confirm'")&&s.sql.includes('INSERT INTO audit_logs'));if(position<0)return once(statements);injected=true;return once([...statements.slice(0,position+1),{sql:"SELECT json_extract('', '$')"},...statements.slice(position+1)])}
 try{const result=await send(body());assert.equal(result.status,503,JSON.stringify(result.body));assert.equal(result.body.code,'bulk_price_outcome_unknown');assert.equal(calls,1);assert.equal(injected,true,'actual confirmation statement was interrupted');assert.equal(snapshot(),before)}finally{adapter.batchOnce=once}
 })
 await check('concurrent request claim never confirms another request or newer review',async()=>{seed(7);const input=body(),once=adapter.batchOnce;let afterWinner,winnerKey
 adapter.batchOnce=async statements=>{adapter.batchOnce=once;const winner=await send({...input,amount:2});assert.equal(winner.status,200,JSON.stringify(winner.body));winnerKey=mark(70);afterWinner=snapshot();return once(statements)}
 try{const loser=await send(input);assert.equal(loser.status,409,JSON.stringify(loser.body));assert.equal(loser.body.code,'idempotency_conflict');assert.equal(snapshot(),afterWinner);assert.equal(one('SELECT cost_review_key FROM products WHERE id=70').cost_review_key,winnerKey);assert.equal(one('SELECT cost_price_usd FROM products WHERE id=70').cost_price_usd,9);assert.equal(confirmationRows().length,1)}finally{adapter.batchOnce=once}
 })
 console.log(JSON.stringify({passed,failed}));if(failed)process.exitCode=1
}
main().catch(error=>{console.error(error);process.exitCode=1})
