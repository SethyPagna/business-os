// Execute both real twins and money kernels. An optional frontend path allows
// separate FE/BE worktrees to prove parity before their commits are integrated.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const backend = path.resolve(__dirname, '../src/lib/promotionRules.ts')
const frontend = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '../../frontend/src/utils/promotionRules.ts')
function load(file) {
  const source = fs.readFileSync(file, 'utf8')
  const out = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: file }).outputText
  const module = { exports: {} }
  new Function('module', 'exports', 'require', out)(module, module.exports, request => {
    assert.ok(request === './moneyPrecision.ts' || request === './moneyPrecision', 'only the real mirrored money dependency is admitted')
    return load(path.resolve(path.dirname(file), request.endsWith('.ts') ? request : `${request}.ts`))
  })
  return module.exports
}
const sourceBody = file => {
  const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  assert.ok(source.includes('import { addMoney4'), 'policy twin imports exact decimal helpers')
  // Worker tsc requires extensionless imports; Node-native frontend tests use .ts.
  return source.slice(source.indexOf('import { addMoney4')).replace("from './moneyPrecision.ts'", "from './moneyPrecision'")
}
assert.equal(sourceBody(frontend), sourceBody(backend), 'imports and entire executable promotion twins remain byte-equivalent')
const front = load(frontend), back = load(backend)
for (const kernel of [front,back]) {
  const product={id:7,selling_price_usd:.01,selling_price_khr:.01}
  for (const type of ['percent_off','quantity_percent']) {
    const rule=kernel.normalizePromotionRule({id:90,scope_type:'products',product_ids:[7],rule_type:type,min_quantity:3,percent_off:33.3333,is_active:1},1)
    const result=kernel.evaluatePromotionPricing(product,3,[rule],1,'2026-09-13',1)
    assert.equal(result.line_discount_usd,.01)
    assert.equal(result.line_total_usd,.02)
  }
  const productDiscount=kernel.evaluatePromotionPricing({...product,discount_enabled:1,discount_type:'percent',discount_percent:33.3333},3,[],1,'2026-09-13',1)
  assert.equal(productDiscount.line_discount_usd,.01)
  const fraction=kernel.evaluatePromotionPricing({...product,discount_enabled:1,discount_type:'percent',discount_percent:49.99},.015,[],1,'2026-09-13',1)
  assert.equal(fraction.line_discount_usd,.0001,'raw product percentage rounds once, not rounded gross then percent')
  const next=kernel.normalizePromotionRule({id:91,scope_type:'products',product_ids:[7],rule_type:'next_item',min_quantity:1,percent_off:33.3333,is_active:1},1)
  const pooled=kernel.evaluateCartPromotionAdjustments([{line_id:'a',product,quantity:6}],[next],1,'2026-09-13',1).get('a')
  assert.equal(pooled.line_discount_usd,.01,'three eligible hits aggregate before percentage rounding')
}
const now = '2026-09-13T00:00:00.000Z'
const product = { id: 7, selling_price_usd: 0.01, selling_price_khr: 0.01 }
const rawRule = overrides => ({ id: 1, title: 'Fixture', is_active: 1, scope_type: 'products', product_ids: '[7,8]', rule_type: 'percent_off', percent_off: 1.5, ...overrides })
let checks = 0
for (const kernel of [front, back]) {
  const evaluate = (p, qty, rows, version) => kernel.evaluatePromotionPricing(p, qty, rows.map(row => kernel.normalizePromotionRule(rawRule(row), version)), 1, now, version)
  // Explicit hand-calculated discriminating values, not a duplicated kernel.
  const legacy = evaluate(product, 1, [{}], 0)
  assert.equal(legacy.line_discount_usd, 0.01)
  assert.equal(legacy.line_total_usd, 0)
  assert.deepEqual(kernel.evaluatePromotionPricing(product, 1, [kernel.normalizePromotionRule(rawRule({}))], 1, now), legacy)
  const small = evaluate(product, 1, [{}], 1)
  assert.equal(small.line_discount_usd, 0.0002) // .01 * 1.5% = .00015, nearest4 away from zero
  assert.equal(small.line_total_usd, 0.0098)
  assert.equal(small.unit_price_usd, 0.0098)
  assert.equal(evaluate(product, 1, [{ percent_off: 0.5 }], 1).line_discount_usd, 0.0001)
  assert.equal(evaluate(product, 1, [{ percent_off: 0.49 }], 1).line_discount_usd, 0)
  const fraction = evaluate(product, 0.25, [{ percent_off: 50 }], 1)
  assert.equal(fraction.line_discount_usd, 0.0013)
  assert.equal(fraction.line_total_usd, 0.0012)
  assert.equal(fraction.unit_price_usd, 0.0048)
  const flat = evaluate(product, 3, [{ rule_type: 'fixed_off', save_usd: 0.0001, save_khr: 0.0001 }], 1)
  assert.equal(flat.line_discount_usd, 0.0003)
  assert.equal(flat.line_total_usd, 0.0297)
  const spread = evaluate(product, 3, [{rule_type:'quantity_save',min_quantity:3,save_usd:0.0001,save_khr:0.0001}], 1)
  assert.equal(spread.line_discount_usd,0.0001)
  assert.equal(spread.line_total_usd,0.0299)
  assert.equal(spread.unit_price_usd,0.01,'flat saving spread rounds the derived unit to nearest4; it is not secretly ceil-cent discounted')
  assert.equal(spread.unit_price_usd * 3,0.03,'unit4 times quantity can have an explicit residual against the preview line total')
  assert.equal(kernel.normalizePromotionRule(rawRule({save_usd:0.0001})).save_usd, 0.01)
  assert.equal(kernel.normalizePromotionRule(rawRule({save_usd:0.0001}),1).save_usd, 0.0001)
  const tie = evaluate(product, 1, [{id:12},{id:13}], 1)
  assert.equal(tie.rule_id, 12, 'equal benefits retain existing stable first rule')
  const khrTie = evaluate(product, 1, [
    { id: 12, rule_type: 'fixed_off', save_usd: 0.0001, save_khr: 0.0001 },
    { id: 13, rule_type: 'fixed_off', save_usd: 0.0001, save_khr: 0.0002 },
  ], 1)
  assert.equal(khrTie.rule_id, 13, 'KHR benefit still resolves equal USD benefits')
  const lines = [{line_id:'cheap',product,quantity:1},{line_id:'dear',product:{id:8,selling_price_usd:0.02,selling_price_khr:0.02},quantity:1}]
  const pair = kernel.evaluateCartPromotionAdjustments(lines,[kernel.normalizePromotionRule(rawRule({rule_type:'next_item',min_quantity:1,percent_off:1.5}),1)],1,now,1)
  assert.equal(pair.get('cheap').line_discount_usd,0.0002)
  assert.equal(pair.get('dear').active,false)
  checks++
}
// Every rule family, both policy versions, product discount and cart execution.
for (const version of [0,1]) for (const rule_type of ['percent_off','fixed_off','quantity_save','spend_save','quantity_percent','next_item']) {
  for (const quantity of [0.25,1,3,7]) {
    const row=rawRule({rule_type,min_quantity:1,min_spend_usd:0.01,save_usd:0.0001,save_khr:0.0001})
    const fr=front.normalizePromotionRule(row,version), br=back.normalizePromotionRule(row,version)
    assert.deepEqual(fr,br)
    const p={...product,discount_enabled:1,discount_type:'percent',discount_percent:0.5}
    assert.deepEqual(front.evaluatePromotionPricing(p,quantity,[fr],1,now,version),back.evaluatePromotionPricing(p,quantity,[br],1,now,version))
    const lines=[{line_id:'one',product:p,quantity}]
    assert.deepEqual([...front.evaluateCartPromotionAdjustments(lines,[fr],1,now,version)],[...back.evaluateCartPromotionAdjustments(lines,[br],1,now,version)])
    checks++
  }
}
console.log(`PASS promotion policy twin: ${checks} vector groups, legacy defaults, nearest4 percentage/fraction/ties and real FE/BE parity`)
