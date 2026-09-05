const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

check('contact rename preview exposes collision + live-link counts and immutable history boundary', () => {
  const source = read('src/routes/contacts.ts')
  assert.match(source, /:id\/rename-impact/)
  assert.match(source, /code: 'merge_required'/)
  assert.match(source, /code: 'portal_account_collision'/)
  assert.match(source, /rename_choice_required/)
  assert.match(source, /historical_snapshots_preserved: \['audit_logs', 'action history payloads'\]/)
  assert.match(source, /lower\(trim\(name\)\) = lower\(trim\(@name\)\)/, 'collisions use normalized exact equality')
})

check('supplier/customer rename modes are explicit and name snapshots are scoped by stable ids', () => {
  const source = read('src/routes/contacts.ts')
  assert.match(source, /renameScope !== 'carry' && renameScope !== 'record_only'/)
  assert.match(source, /WHERE customer_id = @id/)
  assert.match(source, /WHERE supplier_id = @id/)
  assert.match(source, /supplier_invoices SET supplier_name = @name WHERE supplier_id = @id/)
})

check('contact rename validates first then commits the contact and every live carry atomically', () => {
  const source = read('src/routes/contacts.ts')
  const start = source.indexOf("app.put(`${config.path}/:id`")
  const end = source.indexOf("app.delete(`${config.path}/:id`", start)
  const edit = source.slice(start, end)
  assert.ok(start >= 0 && end > start, 'contact edit route is present')
  assert.ok(edit.indexOf('const duplicateBlock') < edit.indexOf('await db.batch(statements)'), 'duplicate validation precedes the atomic write')
  assert.match(edit, /const statements: Array<\{ sql: string; params: Record<string, unknown> \}> = \[\]/)
  assert.match(edit, /if \(statements\.length\) await db\.batch\(statements\)/)
  assert.doesNotMatch(edit, /applyRenameCarry/, 'no supplier write can happen before the contact batch')
  const supplierCarry = edit.slice(edit.indexOf("config.table === 'suppliers'"), edit.indexOf("config.table === 'delivery_contacts'"))
  assert.doesNotMatch(supplierCarry.match(/statements\.push\([\s\S]*?\n\s*\)/)?.[0] || '', /\bLIKE\b/i, 'legacy name-only supplier SQL is exact, never fuzzy')
})

check('payment method replacement previews then updates exact summaries/details only on linked scope', () => {
  const source = read('src/routes/settings.ts')
  assert.match(source, /payment-methods\/impact/)
  assert.match(source, /payment-methods\/replace/)
  assert.match(source, /scope === 'linked'/)
  assert.match(source, /paymentMethodKey\(label\)/, 'the shared JS identity discovers every exact historical spelling, including Unicode case variants')
  assert.match(source, /PAYMENT_METHOD_VARIANT_LIMIT/, 'the distinct spelling set is bounded independently of linked sale count')
  assert.match(source, /json_each\(@sourceVariants\)/, 'SQL matches only the reviewed exact source spellings')
  assert.match(source, /json_each\(@identityVariants\)/, 'summary/detail rebuilding canonicalizes source and existing target variants together')
  const replace = source.match(/app\.post\('\/payment-methods\/replace'[\s\S]*?return c\.json\(\{ success: true/)?.[0] || ''
  assert.match(replace, /expectedSaleRevisionSum/, 'the linked transaction rejects sales changed during its bounded scan')
  assert.match(replace, /expectedRaw: setting\.raw/, 'the configuration write is guarded by the exact reviewed raw value')
  assert.doesNotMatch(replace, /LIKE/i)
})

check('inventory reasons and expense labels use preview + exact normalized replacement', () => {
  const inventory = read('src/routes/inventory.ts')
  const fees = read('src/routes/fees.ts')
  assert.match(inventory, /reasons\/impact/)
  assert.match(inventory, /reasons\/replace/)
  assert.match(inventory, /lower\(trim\(COALESCE\(reason,''\)\)\) = @from/)
  assert.match(fees, /labels\/impact/)
  assert.match(fees, /labels\/replace/)
  assert.match(fees, /lower\(trim\(COALESCE\(label,''\)\)\) = @from/)
})

check('return reason presets share one settings row and exact linked replacement is opt-in', () => {
  const returns = read('src/routes/returns.ts')
  assert.match(returns, /RETURN_REASON_PRESETS_KEY = 'return_reason_presets'/)
  assert.match(returns, /reason-presets/)
  assert.match(returns, /reasons\/impact/)
  assert.match(returns, /reasons\/replace/)
  assert.match(returns, /replaceScope === 'linked'/)
  assert.match(returns, /lower\(trim\(COALESCE\(reason, ''\)\)\) = @from/)
  assert.match(returns, /historical_snapshots_preserved: \['audit_logs', 'action history payloads', 'inventory movements'\]/)
  assert.doesNotMatch(returns.match(/app\.post\('\/reasons\/replace'[\s\S]*?return c\.json\(\{ success: true/)?.[0] || '', /LIKE/i)
})

check('reference-data cascades never alter product or batch cost', () => {
  const cascade = read('src/lib/renameCascade.ts')
  const contacts = read('src/routes/contacts.ts')
  const editStart = contacts.indexOf("app.put(`${config.path}/:id`")
  const editEnd = contacts.indexOf("app.delete(`${config.path}/:id`", editStart)
  assert.doesNotMatch(cascade, /(?:cost_price|unit_cost)/i)
  assert.doesNotMatch(contacts.slice(editStart, editEnd), /(?:cost_price|unit_cost)/i)
})

check('user account row and linked snapshots share one fail-loud D1 batch', () => {
  const users = read('src/routes/users.ts')
  const identity = read('src/lib/userIdentity.ts')
  assert.match(users, /await db\.batch\(\[\s*updateUserStatement,[\s\S]*buildUserRenameStatements/)
  assert.match(users, /await db\.batch\(\[\s*updateProfileStatement,[\s\S]*buildUserRenameStatements/)
  assert.doesNotMatch(identity, /catch\s*\{/)
})

console.log(`\n${passed} reference-data integrity checks passed.`)
