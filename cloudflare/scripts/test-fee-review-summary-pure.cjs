const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const root = path.resolve(__dirname, '..')
const raw = openDb(loadAll())
const db = { prepare(sql) { const stmt=raw.prepare(sql);return {get:p=>stmt.get(p),all:p=>stmt.all(p),run:p=>{const r=stmt.run(p);return {changes:r.meta?.changes||0,lastInsertRowid:Number(r.meta?.last_row_id||0)}}}} }
const cache=new Map()
function load(file) {
 const absolute=path.resolve(root,'src',file)
 if(cache.has(absolute))return cache.get(absolute)
 const exports={};cache.set(absolute,exports)
 const output=ts.transpileModule(fs.readFileSync(absolute,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const requireLocal=name=>{if(name==='./db'||name==='../lib/db')return {getDb:()=>db};if(name.startsWith('.')){const resolved=path.resolve(path.dirname(absolute),name);return load(path.relative(path.join(root,'src'),fs.existsSync(resolved)?resolved:resolved+'.ts'))}return require(name)}
 new Function('exports','require',output)(exports,requireLocal);return exports
}
const permissions=load('lib/permissions.ts')
const {maybeQueueForReview}=load('lib/reviewGate.ts')
const source=fs.readFileSync(path.join(root,'src/routes/fees.ts'),'utf8')
const tree=ts.createSourceFile('fees.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
let callback, columns
function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(tree)==='FEE_AUDIT_COLUMNS')columns='const '+node.getText(tree)+';';if(ts.isCallExpression(node)&&node.expression.getText(tree)==='app.delete'&&node.arguments[0].text==='/:id')callback=node.arguments[1].getText(tree);ts.forEachChild(node,visit)}visit(tree);assert(callback)
const output=ts.transpileModule(columns+'const handler='+callback,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const audits=[],broadcasts=[]
const handler=new Function('getActionTier','getDb','maybeQueueForReview','audit','changedFields','broadcast',output+';return handler')(permissions.getActionTier,()=>db,maybeQueueForReview,async(...args)=>audits.push(args),()=>[],async(...args)=>broadcasts.push(args))
function context(user,id){return {env:{},get:()=>user,req:{param:()=>String(id)},json:(body,status=200)=>({body,status}),executionCtx:{waitUntil:()=>{}}}}
function seed(id,label='Synthetic shop rent',type='rent'){raw.prepare('INSERT INTO fees(id,fee_type,label,amount_usd,amount_khr,fee_date) VALUES(@id,@type,@label,12.35,4100,\'2026-10-09\')').run({id,type,label})}
async function main(){
 seed(90000801)
 const user={id:1,username:'synthetic-reviewer',permissions:JSON.stringify({fees:'review'}),role_permissions:'{}'}
 const queued=await handler(context(user,90000801));assert.equal(queued.status,202)
 const pending=raw.prepare('SELECT * FROM pending_actions WHERE id=@id').get({id:queued.body.pendingActionId})
 for(const part of ['Synthetic shop rent','rent','12.35','4100','09/10/2026'])assert.ok(pending.summary.includes(part),'new request must retain '+part)
 assert.equal(pending.entity_id,90000801);assert.equal(pending.section,'fees');assert.equal(pending.action_type,'delete');assert.deepEqual(JSON.parse(pending.payload_json),{id:90000801});assert.equal(pending.requested_by_name,'synthetic-reviewer');assert(raw.prepare('SELECT id FROM fees WHERE id=90000801').get());assert.equal(audits.length,0);assert.equal(broadcasts.length,0)
 console.log('PASS actual fee DELETE + actual review gate + SQLite pending insert retain human description/type/date/both money values without applying')
 seed(90000802,null,'transport');const emptyLabel=await handler(context(user,90000802));const second=raw.prepare('SELECT summary FROM pending_actions WHERE id=@id').get({id:emptyLabel.body.pendingActionId});assert.ok(second.summary.includes('transport'))
 const before=raw.prepare('SELECT COUNT(*) n FROM pending_actions').get().n
 for(const permissions of [{fees:false},{fees:'review','fees:delete':false}]){const denied=await handler(context({...user,permissions:JSON.stringify(permissions)},90000801));assert.equal(denied.status,403)}
 assert.equal(raw.prepare('SELECT COUNT(*) n FROM pending_actions').get().n,before);console.log('PASS section/action denied never queue or delete')
 const full=await handler(context({...user,permissions:JSON.stringify({fees:true})},90000801));assert.equal(full.status,200);assert.equal(raw.prepare('SELECT id FROM fees WHERE id=90000801').get(),undefined);assert.equal(raw.prepare('SELECT COUNT(*) n FROM pending_actions').get().n,before);assert.equal(audits.length,1);assert.equal(audits[0][6].before.label,'Synthetic shop rent');assert.equal(audits[0][6].after,null);console.log('PASS full access retains original physical delete/audit and no pending insert')
 const missing=await handler(context(user,9999));assert.equal(missing.status,404);assert.equal(raw.prepare('SELECT COUNT(*) n FROM pending_actions').get().n,before);console.log('PASS missing record cannot create invented summary')
}
main().catch(error=>{console.error(error);process.exitCode=1})
