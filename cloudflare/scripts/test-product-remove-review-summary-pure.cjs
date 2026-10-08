const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript')
const {execFileSync}=require('node:child_process')
const root=path.resolve(__dirname,'..')
function load(relative,override){const file=path.join(root,'src',relative);const exports={};const output=ts.transpileModule(override||fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const req=name=>name.startsWith('.')?load(path.relative(path.join(root,'src'),path.resolve(path.dirname(file),name.endsWith('.ts')?name:name+'.ts'))):require(name);new Function('exports','require',output)(exports,req);return exports}
const subject='lib/productDelete.ts'
const current=load(subject)
const original=load(subject,execFileSync('git',['show','8b0e2c4cf608c3f6f3dbcad1d1a2ff8fa7ee1240:cloudflare/src/lib/productDelete.ts'],{cwd:root,encoding:'utf8'}))
const plan={version:1,product_id:77,reason:'Duplicate shelf card',product:{id:77,name:'Synthetic rice <25 kg>',cost_price_usd:999.99,cost_price_khr:4000000},branch_stock:[],batches:[],branch_batch_stock:[],product_images:[],child_links:[],damaged_lots:[],source_bytes:1,state_digest:'synthetic-state'}
const user={id:2,username:'synthetic-requester'}
const args={plan,user,operationId:'synthetic-direct',requestId:'synthetic-request',planDigest:'synthetic-digest',operation:{operation_id:'synthetic-review',actor_id:2,review_id:'synthetic-review-id',action_ordinal:1,product_id:77,plan_digest:'synthetic-digest'}}
for(const name of ['productRemoveQueueStatements','productRemoveReviewQueueStatements']){
 const statements=current[name](args),before=original[name](args)
 const pending=statements.find(s=>s.sql.includes('INSERT INTO pending_actions'))
 assert(pending)
 for(const value of ['Synthetic rice <25 kg>','Duplicate shelf card'])assert.ok(pending.params.summary.includes(value),name+' retains '+value)
 for(const privateValue of ['999.99','4000000','cost_price'])assert.equal(pending.params.summary.includes(privateValue),false,'summary must not project acquisition cost from full snapshot')
 const pointer=JSON.parse(pending.params.payload);assert.deepEqual(pointer,{kind:'product.remove.pending',operation_id:name==='productRemoveQueueStatements'?'synthetic-direct':'synthetic-review',plan_digest:'synthetic-digest'})
 const withoutSummary=rows=>rows.map(s=>({...s,params:s.params?Object.fromEntries(Object.entries(s.params).filter(([key])=>key!=='summary')):undefined}))
 assert.deepEqual(withoutSummary(statements),withoutSummary(before),'all stock/graph/epoch/operation guards and statement ordering/bindings remain identical')
 assert.equal(before.find(s=>s.sql.includes('INSERT INTO pending_actions')).params.summary.includes(plan.product.name),false,'actual original source is a discriminating negative control')
 console.log('PASS '+name+' snapshot name/reason, hidden costs, immutable pointer, original exact guard/statement identity, old-source negative control')
}
