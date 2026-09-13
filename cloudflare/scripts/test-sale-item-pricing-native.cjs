const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')
const cache = new Map()
function load(name) {
  assert.ok(['saleItemPricing','moneyPrecision','promotionRules'].includes(name))
  if (cache.has(name)) return cache.get(name)
  const file = path.resolve(__dirname,`../src/lib/${name}.ts`)
  const code = ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const module = {exports:{}}
  new Function('module','exports','require',code)(module,module.exports,request => {
    assert.ok(/^\.\/(moneyPrecision|promotionRules)$/.test(request))
    return load(request.slice(2))
  })
  cache.set(name,module.exports); return module.exports
}
const p=load('saleItemPricing'), rules=load('promotionRules')
const rule=rules.normalizePromotionRule({id:1,rule_type:'quantity_save',min_quantity:3,save_usd:1,product_ids:[7],scope_type:'products',is_active:1},1)
const pool={version:1,pool_key:'pool-1',evaluation_time:'2026-09-13T00:00:00.000Z',exchange_rate:4000,rules:[rule],lines:[{
  line_key:'a',source:'promotion',product:{id:7,selling_price_usd:10,selling_price_khr:1},selling_price_input_usd:null,manual:{type:'none',value:0}
}]}
const at=(quantity,context=pool)=>p.evaluateCapturedPricingPool(context,{a:quantity}).get('a')
assert.equal(at(3).total_usd,29)
assert.equal(at(3).applied_price_usd,9.6667)
assert.equal(at(3).total_khr,116000,'USD authority, not conflicting catalogue KHR')
assert.equal(at(2).total_usd,20,'captured threshold re-evaluates on quantity change')
const manual=structuredClone(pool); manual.lines[0].manual={type:'fixed',value:1}
assert.equal(at(3,manual).total_usd,26,'fixed manual discount is per-unit after exact promotion')
manual.lines[0].manual={type:'percent',value:12.3456}
assert.equal(at(3,manual).total_usd,25.4198)
manual.lines[0].manual={type:'fixed',value:100}
assert.equal(at(3,manual).total_usd,0)
const stored=p.serializeSaleItemPricing(pool,{a:3},'a')
assert.equal(p.parseSaleItemPricing(stored).amounts.total_usd,29)
assert.equal(p.parseSaleItemPricing(null),null)
const tampered=JSON.parse(stored); tampered.amounts.total_usd=29.0001
assert.throws(()=>p.parseSaleItemPricing(JSON.stringify(tampered)))
for (const quantity of [0,-1,Infinity,NaN,10001]) assert.throws(()=>at(quantity))
const duplicate=structuredClone(pool); duplicate.lines.push(duplicate.lines[0]); assert.throws(()=>at(3,duplicate))
const ambiguous=structuredClone(pool); ambiguous.lines[0].product.selling_price_usd=1.2345; assert.throws(()=>at(3,ambiguous))
const alloc=p.allocateLineMoney4(.0001,[{line_key:'b',amount:1},{line_key:'a',amount:1}])
assert.equal(alloc.get('a'),.0001); assert.equal(alloc.get('b'),0)
assert.deepEqual([...alloc],[...p.allocateLineMoney4(.0001,[{line_key:'a',amount:1},{line_key:'b',amount:1}])])
assert.equal(p.allocateLineMoney4(1e11,[{line_key:'a',amount:1e11}]).get('a'),1e11)
assert.throws(()=>p.allocateLineMoney4(1,[{line_key:'a',amount:0}]))
const paired=structuredClone(pool)
paired.rules=[rules.normalizePromotionRule({id:2,rule_type:'next_item',min_quantity:1,percent_off:100,product_ids:[7],scope_type:'products',is_active:1},1)]
paired.lines.push({...structuredClone(paired.lines[0]),line_key:'b'})
const pairing=p.evaluateCapturedPricingPool(paired,{a:1,b:1})
assert.equal(pairing.get('a').total_usd,0,'equal-price pooled tie follows stable key')
assert.equal(pairing.get('b').total_usd,10)
paired.lines.reverse()
assert.deepEqual([...p.evaluateCapturedPricingPool(paired,{b:1,a:1})],[...pairing],'pool quote independent of incoming order')
assert.equal(p.evaluateCapturedPricingPool(paired,{a:1,b:2}).get('b').total_usd,20,'whole captured pool re-evaluates quantity')

// Actual SQLite additive migration, existing-column and rollback invariance.
const db=new DatabaseSync(':memory:')
db.exec('CREATE TABLE sale_items(id INTEGER PRIMARY KEY,total_usd REAL,details TEXT); INSERT INTO sale_items VALUES(1,1.23456789,\'historical\')')
const before=db.prepare('SELECT * FROM sale_items').all()
const sql=fs.readFileSync(path.resolve(__dirname,'../migrations/0159_sale_item_pricing_snapshot.sql'),'utf8')
assert.ok(!sql.includes('\r'),'migration remains LF-only')
db.exec(sql)
assert.deepEqual(db.prepare('SELECT id,total_usd,details FROM sale_items').all(),before)
assert.equal(db.prepare('SELECT pricing_snapshot_json FROM sale_items').get().pricing_snapshot_json,null)
db.prepare('UPDATE sale_items SET pricing_snapshot_json=? WHERE id=1').run(stored)
assert.equal(db.prepare('SELECT pricing_snapshot_json FROM sale_items').get().pricing_snapshot_json,stored)
db.exec('BEGIN')
db.prepare('UPDATE sale_items SET pricing_snapshot_json=NULL WHERE id=1').run()
db.exec('ROLLBACK')
assert.equal(db.prepare('SELECT pricing_snapshot_json FROM sale_items').get().pricing_snapshot_json,stored)
db.close()
console.log('PASS actual captured-pricing modules: exact residual/threshold/manual/FX, bounds/tamper, deterministic allocation and additive SQLite migration/rollback')
