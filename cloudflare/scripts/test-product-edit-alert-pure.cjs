// Owner, 5 Oct 2026 (evening): every product edit by a non-administrator sends a concise bilingual Telegram alert.
// Pure: the real formatter (lib/productEditAlert.ts) and the real language layer (lib/telegramLang.ts); no bot token, no network.
// The route wiring (who is announced, the Record, the stub transport) is pinned in test-employee-products-default-native.cjs.
//
//   fields    changed columns become short words, de-duplicated, in order; cost columns are never named
//   lines     Product / Changed / By, an empty By is dropped by the caller's filter
//   bilingual the heading and every label line carry both languages once localised
//   wiring    the 'products' event type has a category switch (default on), a topic and a settings key
//
// Run (from cloudflare/scripts): node test-product-edit-alert-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')

function loadReal(relPath, requireOverrides = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: sourcePath,
  })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath))
  } finally { Module._load = originalLoad }
  return moduleObj.exports
}

const alert = loadReal('lib/productEditAlert.ts')
const lang = loadReal('lib/telegramLang.ts')
const KHMER = /[ក-៿]/
const norm = (text) => text.replace(/\r/g, '')

// fields -------------------------------------------------------------------------
assert.deepEqual(alert.productEditAlertFields(['name', 'category']), ['name', 'category'])
assert.deepEqual(alert.productEditAlertFields(['selling_price_usd', 'selling_price_khr', 'wholesale_price_usd']), ['selling price', 'wholesale price'], 'USD and KHR of one price are one word')
assert.deepEqual(alert.productEditAlertFields(['name'], true), ['name', 'images'], 'an image change is announced')
assert.deepEqual(alert.productEditAlertFields(['image_gallery'], true), ['images'], 'no duplicate word')
for (const cost of ['cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'purchase_price_khr']) {
  assert.deepEqual(alert.productEditAlertFields([cost, 'name']), ['name'], cost + ' is never named')
}
assert.deepEqual(alert.productEditAlertFields(['cost_price_usd']), [], 'a cost-only change names nothing')
assert.deepEqual(alert.productEditAlertFields(['some_new_column']), ['some new column'], 'an unknown column still prints, readably')

// lines ---------------------------------------------------------------------------
const lines = alert.formatProductEditAlertLines({ product: 'Glow Serum', changed: ['name', 'category'], by: 'Sophea' })
assert.deepEqual(lines, ['Product: Glow Serum', 'Changed: name, category', 'By: Sophea'])
assert.equal(alert.formatProductEditAlertLines({ product: 'X', changed: [] }).filter(Boolean).length, 1, 'no change list and no actor print just the product')

// merge alert ---------------------------------------------------------------------
assert.equal(alert.PRODUCT_MERGE_ALERT_HEADING, '🔀 Products merged')
assert.deepEqual(alert.formatProductMergeAlertLines({ kept: 'Glow Serum', merged: 'Glow Serum 30ml', by: 'Sophea' }), ['Product: Glow Serum', 'Merged: Glow Serum 30ml', 'By: Sophea'])
assert.deepEqual(alert.formatProductMergeAlertLines({ by: 'Sophea' }).filter(Boolean), ['By: Sophea'], 'a bulk merge names only who ran it')

// bilingual ------------------------------------------------------------------------
assert.equal(alert.PRODUCT_EDIT_ALERT_HEADING, '✏️ Product edited')
assert.ok(lang.TELEGRAM_HEADINGS[alert.PRODUCT_EDIT_ALERT_HEADING], 'the heading has a Khmer entry')
assert.ok(KHMER.test(lang.TELEGRAM_HEADINGS[alert.PRODUCT_EDIT_ALERT_HEADING]))
assert.ok(KHMER.test(lang.TELEGRAM_HEADINGS[alert.PRODUCT_MERGE_ALERT_HEADING]), 'the merge heading has a Khmer entry')
for (const key of ['product', 'changed', 'merged', 'by']) {
  assert.ok(lang.TELEGRAM_LABELS[key] && KHMER.test(lang.TELEGRAM_LABELS[key].km) && !KHMER.test(lang.TELEGRAM_LABELS[key].en), 'label ' + key)
}
lang.setTelegramLanguage('both')
const heading = lang.localizeTelegramHeading(alert.PRODUCT_EDIT_ALERT_HEADING)
assert.ok(heading.includes('Product edited') && KHMER.test(heading), heading)
for (const line of lines) {
  const out = lang.localizeTelegramLine(line)
  assert.ok(KHMER.test(out), 'the label of "' + line + '" is bilingual: ' + out)
}
lang.setTelegramLanguage('en')
assert.ok(!KHMER.test(lang.localizeTelegramLine(lines[0])), 'English-only mode stays English')
lang.setTelegramLanguage('both')

// wiring (read from the source, the transport itself is never loaded) -----------------
const telegram = norm(fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'telegram.ts'), 'utf8'))
assert.match(telegram, /'sales' \| 'status' \| 'returns' \| 'fees' \| 'stock_in' \| 'stock_out' \| 'products'/, 'the event type exists')
assert.match(telegram, /products: isEnabled\(values\.telegram_products_enabled, true\)/, 'default on')
assert.match(telegram, /products: 'telegram_topic_alerts'/, 'goes to the Alerts topic')
assert.match(telegram, /'telegram_products_enabled'/, 'the switch is a known settings key')
const route = norm(fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'products.ts'), 'utf8'))
assert.match(route, /!isAdminControlUser\(user\) && \(productFieldChange \|\| productImagesChanged\)/, 'only non-administrators are announced')
assert.match(route, /announceProductAlert\(c, user, PRODUCT_EDIT_ALERT_HEADING/, 'edits are announced through the one helper')
assert.match(route, /announceProductAlert\(c, user, PRODUCT_MERGE_ALERT_HEADING/, 'merges are announced through the same helper')
assert.match(route, /if \(!user \|\| isAdminControlUser\(user\)\) return\s+c\.executionCtx\.waitUntil/, 'the helper never announces an administrator')
assert.match(route, /MERGE_ALERT_PAIR_PATH = \/\\\/possible-duplicates\\\/merge\$\//, 'only the committing pair endpoint, never a preview')

console.log('ok')
