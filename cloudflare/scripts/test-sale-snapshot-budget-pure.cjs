'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const moduleUnderTest = { exports:{} }
const source = fs.readFileSync(path.join(__dirname,'../src/lib/saleSnapshotBudget.ts'),'utf8')
new Function('module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(moduleUnderTest,moduleUnderTest.exports)
const {assertSaleSnapshotBudget,serializedSaleSnapshotBytes,SaleSnapshotBudgetError}=moduleUnderTest.exports
const ascii={items:[{pricing_snapshot_json:'a'.repeat(700_000)}]}
const unicode={items:[{pricing_snapshot_json:'ក'.repeat(700_000)}]}
assertSaleSnapshotBudget(ascii)
assert.throws(()=>assertSaleSnapshotBudget(unicode),SaleSnapshotBudgetError)
assert.equal(serializedSaleSnapshotBytes(unicode),Buffer.byteLength(JSON.stringify(unicode),'utf8'))
const quoted={items:[{pricing_snapshot_json:'"\\'.repeat(450_000)}]}
assert.ok(Buffer.byteLength(quoted.items[0].pricing_snapshot_json,'utf8')<1_000_000)
assert.throws(()=>assertSaleSnapshotBudget(quoted),SaleSnapshotBudgetError)
assertSaleSnapshotBudget({items:[{pricing_snapshot_json:'😀'.repeat(100_000)}]})
assertSaleSnapshotBudget('a'.repeat(1_783_614))
assert.throws(()=>assertSaleSnapshotBudget('a'.repeat(1_783_615)),SaleSnapshotBudgetError)
assert.throws(()=>assertSaleSnapshotBudget({before:'a'.repeat(600_000),after:'a'.repeat(600_000),response:'a'.repeat(600_000)}),SaleSnapshotBudgetError)
console.log('PASS sale snapshot UTF8, JSON escaping, complete envelope and exact framing boundary')
