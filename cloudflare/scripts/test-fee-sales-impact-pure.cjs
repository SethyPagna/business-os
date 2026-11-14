'use strict'
// Review round 2 (finding 5): fee writes bump the shared 'sales' cache version only when the fee row, before or after the write, is one the
// cached sales snapshot reads (lib/feeSalesImpact.ts). That is only sound while lib/salesAnalytics.ts really reads fees in just those two ways, so
// this test pins the proof to the source: if a new fees read appears there (another type, the label, a plain expense total), this goes red and the
// predicate must be widened before the bump rule can be trusted.
//
// Run (from cloudflare/): node scripts/test-fee-sales-impact-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const src = path.join(__dirname, '..', 'src')
const read = (rel) => fs.readFileSync(path.join(src, rel), 'utf8').replace(/\r\n/g, '\n')
let passed = 0
const check = (name, run) => { run(); passed += 1; console.log(`PASS ${name}`) }

const filename = path.join(src, 'lib/feeSalesImpact.ts')
const mod = { exports: {} }
new Function('exports', 'module', ts.transpileModule(read('lib/feeSalesImpact.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename }).outputText)(mod.exports, mod)
const { feeAffectsSalesSnapshot, feeWriteNeedsSalesBump } = mod.exports

check('routes/fees.ts and lib/reviewApply.ts carry a byte-identical inline copy of lib/feeSalesImpact.ts (below its header)', () => {
  const canonical = read('lib/feeSalesImpact.ts')
  const body = canonical.slice(canonical.indexOf('export type FeeSnapshotShape')).trim()
  assert.ok(body.includes('export function feeWriteNeedsSalesBump'), 'the canonical body holds both functions')
  for (const file of ['routes/fees.ts', 'lib/reviewApply.ts']) {
    const text = read(file)
    const begin = text.indexOf('// feeSalesImpact:begin\n')
    const end = text.indexOf('// feeSalesImpact:end')
    assert.ok(begin > 0 && end > begin, `${file}: the marked block exists`)
    assert.equal(text.slice(begin + '// feeSalesImpact:begin\n'.length, end).trim(), body, `${file}: the inline copy drifted from lib/feeSalesImpact.ts`)
  }
  assert.ok(!/from '\.\.?\/(?:lib\/)?feeSalesImpact'/.test(read('routes/fees.ts') + read('lib/reviewApply.ts')), 'the writers use the inline copy, not an import (an import would break every test that loads them with a fixed require map)')
})

check('the predicate: delivery type or a delivery contact, nothing else', () => {
  assert.equal(feeAffectsSalesSnapshot({ fee_type: 'delivery', delivery_contact_id: null }), true)
  assert.equal(feeAffectsSalesSnapshot({ fee_type: 'expense', delivery_contact_id: 7 }), true)
  assert.equal(feeAffectsSalesSnapshot({ fee_type: 'expense', delivery_contact_id: null }), false)
  assert.equal(feeAffectsSalesSnapshot({ fee_type: 'other' }), false)
  assert.equal(feeAffectsSalesSnapshot({ fee_type: 'Delivery' }), false, 'the snapshot compares fee_type exactly (= delivery), so the predicate does too')
  assert.equal(feeAffectsSalesSnapshot({ fee_type: null, delivery_contact_id: '' }), false)
  assert.equal(feeAffectsSalesSnapshot(null), false)
  assert.equal(feeAffectsSalesSnapshot(undefined), false)
})

check('a write is relevant when EITHER side is read (create and delete have one side)', () => {
  const plain = { fee_type: 'other', delivery_contact_id: null }
  const delivery = { fee_type: 'delivery', delivery_contact_id: null }
  assert.equal(feeWriteNeedsSalesBump(plain, delivery), true, 'turned into delivery')
  assert.equal(feeWriteNeedsSalesBump(delivery, plain), true, 'turned out of delivery')
  assert.equal(feeWriteNeedsSalesBump(plain, plain), false)
  assert.equal(feeWriteNeedsSalesBump(delivery, delivery), true)
  assert.equal(feeWriteNeedsSalesBump(null, delivery), true, 'create')
  assert.equal(feeWriteNeedsSalesBump(delivery, null), true, 'delete')
  assert.equal(feeWriteNeedsSalesBump(null, plain), false)
})

check('lib/salesAnalytics.ts reads fees only as delivery-type rows or rows with a delivery contact (the proof the predicate rests on)', () => {
  const text = read('lib/salesAnalytics.ts')
  const reads = [...text.matchAll(/\b(?:FROM|JOIN)\s+fees\b/g)]
  assert.ok(reads.length >= 5, `the scan sees the fees reads (found ${reads.length})`)
  for (const hit of reads) {
    const window = text.slice(hit.index, hit.index + 700)
    const delivery = /fee_type,\s*''\)\s*=\s*'delivery'/.test(window) && /fees\.sale_id\s*=/.test(window)
    // The report groups build their WHERE from a feeClauses list that always starts with `delivery_contact_id IS NOT NULL`; pin that initialiser too.
    const contact = /delivery_contact_id/.test(window)
      || (/feeClauses\.join/.test(window) && /feeClauses(?::\s*string\[\])?\s*=\s*\['f(?:ees)?\.delivery_contact_id IS NOT NULL'/.test(text.slice(Math.max(0, hit.index - 2500), hit.index)))
    const line = text.slice(0, hit.index).split('\n').length
    assert.ok(delivery || contact, `salesAnalytics.ts:${line} reads fees in a way feeSalesImpact.ts does not cover: widen feeAffectsSalesSnapshot (and the writers) before trusting it\n${window.slice(0, 200)}`)
  }
  // And no read of a fee's label or notes by this module's fee queries (a label rename bumps nothing because of this).
  assert.ok(!/fees\.label|f\.label|fees\.notes|f\.notes/.test(text), 'the snapshot reads no fee label or notes')
})

check('only salesAnalytics.ts feeds the sales key from fees: the sales route reads no fees table itself', () => {
  const sales = read('routes/sales.ts')
  const reads = [...sales.matchAll(/(?<!DELETE )\b(?:FROM|JOIN)\s+fees\b/g)]
  assert.equal(reads.length, 0, 'routes/sales.ts has no FROM/JOIN fees read (its only fees statement is the DELETE of a cancel fee)')
})

console.log(`${passed} checks passed`)
