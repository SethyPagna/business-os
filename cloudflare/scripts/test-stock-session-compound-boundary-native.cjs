const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Miniflare } = require('miniflare')
const source = fs.readFileSync(path.join(__dirname,'../src/lib/stockSession.ts'),'utf8')
const kernel = source.slice(source.indexOf('function packSessionAssertions('),source.indexOf('function checkBounds('))
const output = ts.transpileModule(kernel+'\nexports.pack=packSessionAssertions',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const moduleExports = {}
new Function('exports','D1_MAX_BOUND_PARAMS',output)(moduleExports,100)
const prefix='INSERT INTO stock_session_guards(guard_value) '
const guard = value => ({sql:prefix+'SELECT '+value,params:{}})
;(async () => {
  const mf = new Miniflare({ modules:true, script:'export default {fetch(){return new Response("ok")}}', d1Databases:['DB'], compatibilityDate:'2026-08-01' })
  try {
    const db = await mf.getD1Database('DB')
    await db.prepare(Array(5).fill('SELECT 1').join(' UNION ALL ')).all()
    await assert.rejects(()=>db.prepare(Array(6).fill('SELECT 1').join(' UNION ALL ')).all(),/too many terms/)
    await db.batch([db.prepare('CREATE TABLE stock_session_guards(guard_value INTEGER CHECK(guard_value=1))'),db.prepare('CREATE TABLE effects(id INTEGER)')])
    for(const size of [5,6,501]) {
      const packed=moduleExports.pack(Array.from({length:size},()=>guard(1)))
      assert.equal(packed.length,Math.ceil(size/5))
      await db.batch(packed.map(s=>db.prepare(s.sql)))
      assert.equal((await db.prepare('SELECT COUNT(*) n FROM stock_session_guards').first()).n,size)
      await db.prepare('DELETE FROM stock_session_guards').run()
    }
    const packed=moduleExports.pack([{sql:'INSERT INTO effects VALUES(1)',params:{}},...Array.from({length:7},(_,i)=>guard(i===6?0:1))])
    await assert.rejects(()=>db.batch(packed.map(s=>db.prepare(s.sql))),/CHECK constraint/)
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM effects').first()).n,0)
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM stock_session_guards').first()).n,0)
    const bindings=moduleExports.pack(Array.from({length:6},()=>({sql:prefix+'SELECT CASE WHEN '+Array(25).fill('@value=1').join(' AND ')+' THEN 1 ELSE 0 END',params:{value:1}})))
    assert.equal(bindings.length,2)
    for(const s of bindings) assert.ok([...s.sql.matchAll(/@(\w+)/g)].length<=100)
    console.log('PASS native D1 five/six term boundary; actual packer5/6/501; non-first second-pack refusal rolls back preceding effects;100-bind cap')
  } finally { await mf.dispose() }
})().catch(e=>{console.error(e);process.exitCode=1})


