// The payment-method registry (user, Sep 4 2026): "it seems, the payment
// methods made and entered in sales and so on did not get updated in the
// available payment methods".
//
// Root cause: the POS method field is a free-text datalist. A cashier types
// "ACLEDA" at the till, the sale records it, and `settings.pos_payment_methods`
// never hears about it -- so Settings shows a shorter list than the shop is
// actually paid through, the next cashier retypes it slightly differently, and
// the day's report grows two columns for one method.
//
// lib/paymentMethodRegistry.ts is the pure half of the fix: it decides what a
// sale actually used and how to merge that into the configured list. This test
// runs that real module. The I/O half (the settings read/write in routes) is
// covered by test-loyalty-and-payment-writeback-pure.cjs against a real DB.
//
// Run (from cloudflare/): node scripts/test-payment-method-registry-pure.cjs

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const ts = require('typescript')

let checks = 0
function check(label, cond) {
  assert.ok(cond, `FAIL: ${label}`)
  checks++
  console.log(`  ok  ${label}`)
}

function loadTs(relPath, requireShim) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  const mod = { exports: {} }
  const req = (id) => (requireShim && requireShim[id] !== undefined ? requireShim[id] : require(id))
  new Function('module', 'exports', 'require', outputText)(mod, mod.exports, req)
  return mod.exports
}

const registry = loadTs('lib/paymentMethodRegistry.ts', {})
const {
  paymentMethodKey,
  parseConfiguredMethods,
  parseConfiguredMethodsStrict,
  mergePaymentMethods,
  saleMethodsUsed,
  RETIRED_PAYMENT_METHODS,
  MAX_CONFIGURED_METHODS,
  MAX_METHOD_LENGTH,
} = registry

console.log('paymentMethodRegistry')

// --- identity -------------------------------------------------------------
// The key must match what settings.ts's own rename/merge uses, or the two
// disagree about whether "aba bank" and "ABA Bank" are one method -- and a
// disagreement there is what puts a duplicate in the shop's list.
check('identity ignores case', paymentMethodKey('ABA Bank') === paymentMethodKey('aba bank'))
check('identity ignores surrounding space', paymentMethodKey('  Cash  ') === paymentMethodKey('Cash'))
check('identity keeps interior spacing', paymentMethodKey('ABA Bank') !== paymentMethodKey('ABABank'))

// --- tolerant parse -------------------------------------------------------
// This runs on the read path of a live checkout. A settings row that is not
// JSON, or is JSON of the wrong shape, must degrade to "nothing configured",
// never throw -- throwing here would fail the sale.
check('parses a normal array', parseConfiguredMethods('["Cash","Card"]').length === 2)
for (const raw of [undefined, null, '', 'not json', '{}', '[1,2]', '[""]', '   ']) {
  const parsed = parseConfiguredMethods(raw)
  check(`tolerates ${JSON.stringify(raw)}`, Array.isArray(parsed))
}
check('drops non-string entries', parseConfiguredMethods('["Cash",7,null,"Card"]').join('|') === 'Cash|Card')
check('strict parser accepts a non-empty valid array', parseConfiguredMethodsStrict('["Cash","ABA Bank"]').ok === true)
for (const raw of [undefined, null, '', 'not json', '{}', '[]', '[1,2]', '["Cash",null]', '["Cash","cash"]', JSON.stringify(['x'.repeat(MAX_METHOD_LENGTH + 1)])]) {
  check(`strict parser rejects ${JSON.stringify(raw)}`, parseConfiguredMethodsStrict(raw).ok === false)
}

// --- what a sale actually used -------------------------------------------
// payment_method is a SUMMARY column: on a split payment it is the ' + '-join
// of the itemised methods. Registering it verbatim would invent a method
// called "Cash + ABA Bank" that no one can ever select, so the itemised
// payment_details wins and the summary is only ever split, never trusted whole.
check(
  'a simple sale registers its one method',
  saleMethodsUsed({ payment_method: 'Wing', payment_details: null }).join('|') === 'Wing',
)
check(
  'a split sale registers each method, not the joined summary',
  saleMethodsUsed({
    payment_method: 'Cash + ABA Bank',
    payment_details: JSON.stringify([{ method: 'Cash', amount_usd: 3 }, { method: 'ABA Bank', amount_usd: 7 }]),
  }).join('|') === 'Cash|ABA Bank',
)
check(
  'a split sale with no details falls back to splitting the summary',
  saleMethodsUsed({ payment_method: 'Cash + ABA Bank', payment_details: null }).join('|') === 'Cash|ABA Bank',
)
check('an empty sale registers nothing', saleMethodsUsed({}).length === 0)
check('a blank method registers nothing', saleMethodsUsed({ payment_method: '   ' }).length === 0)
check(
  'malformed payment_details does not throw and falls back',
  saleMethodsUsed({ payment_method: 'Cash', payment_details: '{{{' }).join('|') === 'Cash',
)

// --- the merge ------------------------------------------------------------
// Order is the shop's own. A configured list is something an admin arranged --
// most-used first, usually -- so a newly-seen method appends and never
// reshuffles what is already there.
{
  const merged = mergePaymentMethods(['Cash', 'Card'], ['ACLEDA'])
  check('a new method appends', merged.methods.join('|') === 'Cash|Card|ACLEDA')
  check('the merge reports what it added', merged.added.join('|') === 'ACLEDA')
  check('the merge reports that it changed', merged.changed === true)
}
{
  // The whole point of the case-insensitive key: "aba bank" typed at a till
  // must NOT become a second entry beside the configured "ABA Bank", and the
  // admin's capitalisation is the one that survives.
  const merged = mergePaymentMethods(['ABA Bank'], ['aba bank', 'ABA BANK'])
  check('a case variant does not duplicate', merged.methods.join('|') === 'ABA Bank')
  check('an unchanged list reports changed === false', merged.changed === false)
  check('an unchanged list adds nothing', merged.added.length === 0)
}
{
  // changed === false is what stops the caller writing. That matters beyond
  // tidiness: every settings write bumps `settings.updated_at`, which is what
  // /settings/meta polling watches, so a no-op write on every single sale
  // would make every client think settings changed on every sale.
  const merged = mergePaymentMethods(['Cash'], ['Cash'])
  check('a method already present is not re-added', merged.changed === false)
}
{
  const merged = mergePaymentMethods(['Cash'], ['Wing', 'Wing', 'wing'])
  check('the same new method twice lands once', merged.methods.join('|') === 'Cash|Wing')
  check('added is deduplicated too', merged.added.join('|') === 'Wing')
}

// --- retired methods must stay retired ------------------------------------
// A method an admin deliberately removed from the checkout list still appears
// on every old sale that used it. Without this filter the write-back would
// resurrect it the next time such a sale was touched, and removing it from
// Settings would look broken.
check('the retired set is non-empty', RETIRED_PAYMENT_METHODS.size > 0)
for (const retired of RETIRED_PAYMENT_METHODS) {
  const merged = mergePaymentMethods(['Cash'], [retired])
  check(`a retired method (${retired}) is not resurrected`, merged.changed === false)
  const cased = mergePaymentMethods(['Cash'], [String(retired).toUpperCase()])
  check(`a retired method resists case (${retired})`, cased.changed === false)
}

// --- bounds ---------------------------------------------------------------
// A settings value is read on the checkout path. Neither a runaway list nor a
// pasted paragraph may get in.
{
  const many = Array.from({ length: MAX_CONFIGURED_METHODS + 40 }, (_, index) => `Method ${index}`)
  const merged = mergePaymentMethods(['Cash'], many)
  check('the list is capped', merged.methods.length <= MAX_CONFIGURED_METHODS)
}
{
  const long = 'x'.repeat(MAX_METHOD_LENGTH + 50)
  const merged = mergePaymentMethods(['Cash'], [long])
  check(
    'an over-long method is rejected or truncated, never stored whole',
    merged.methods.every((method) => method.length <= MAX_METHOD_LENGTH),
  )
}

console.log(`\nPASS ${checks} checks`)
