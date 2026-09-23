// Records/history lane, phase 1: every update write must carry a REAL
// before/after so the Audit Log page renders Field | Before | After.
//
// The Audit Log already had the renderer -- frontend/src/utils/auditLogFieldDiff.ts's
// buildAuditFieldDiff(old_value, new_value) -- but almost every update route
// wrote new_value only (a copy of `details`) and left old_value NULL, so the
// page had nothing to diff and fell back to a raw JSON blob. Worse, a user
// account edit wrote an audit row with NO details at all: "user #4 was
// updated", never which permission, role or active flag moved.
//
// This file proves, with no network and no wrangler:
//   1. lib/audit.ts's ONE shared changedFields() helper records exactly the
//      fields that moved -- and, as the control, returns null (no diff, no
//      row content) when a save changes nothing;
//   2. secrets never reach an audit row: password/token/hash-shaped keys are
//      dropped outright, and a caller-declared redacted key records only that
//      it changed;
//   3. audit() writes old_value alongside new_value, and stays byte-compatible
//      for the 120+ call sites that pass no change at all;
//   4. the bytes written are exactly what the EXISTING renderer parses -- the
//      real frontend module is loaded here and asserted against, which is what
//      makes "zero new UI" a claim rather than a hope;
//   5. two real routes end to end (fees PUT/DELETE, promotions PUT) produce
//      one audit row whose old_value/new_value hold only the changed fields.
//
// RED before the fix: changedFields/auditChangeColumns do not exist in
// lib/audit.ts, and audit()'s INSERT has no old_value column, so section 1
// throws on the missing export and section 3 reads old_value NULL.
//
// Run: node scripts/test-audit-before-after-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('node:module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const cloudflareRoot = path.join(__dirname, '..')
const repoRoot = path.join(cloudflareRoot, '..')
const MIGRATION_SQLS = loadAll()

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

function transpileFile(sourcePath) {
  return ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  }).outputText
}

// Loads a real .ts module. An explicit override always wins; anything else
// that is a relative import of a real source file is transpiled and loaded
// the same way (cached), so a helper's own helpers resolve without every
// scenario having to enumerate the whole tree.
const moduleCache = new Map()
function loadReal(sourcePath, requireOverrides = {}) {
  const outputText = transpileFile(sourcePath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    if (request.startsWith('.')) {
      const resolved = path.resolve(path.dirname(sourcePath), request) + '.ts'
      if (fs.existsSync(resolved)) {
        if (!moduleCache.has(resolved)) {
          Module._load = originalLoad
          try { moduleCache.set(resolved, loadReal(resolved, requireOverrides)) } finally { Module._load = patchedLoad }
        }
        return moduleCache.get(resolved)
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
    )
  } finally {
    Module._load = originalLoad
  }
  return moduleObj.exports
}

const workerSrc = (rel) => path.join(cloudflareRoot, 'src', rel)

// The REAL renderer the Audit Log page uses. Loaded, not reimplemented: a
// local copy of its rules would agree with itself and prove nothing.
const renderer = loadReal(path.join(repoRoot, 'frontend', 'src', 'utils', 'auditLogFieldDiff.ts'))
assert.equal(typeof renderer.buildAuditFieldDiff, 'function', 'auditLogFieldDiff.ts must export buildAuditFieldDiff')

// ---------------------------------------------------------------------------
// 1. The shared changedFields() helper.
// ---------------------------------------------------------------------------
function freshAuditModule() {
  const db = openDb(MIGRATION_SQLS)
  const mod = loadReal(workerSrc('lib/audit.ts'), { './db': { getDb: () => db } })
  return { db, mod }
}
const auditModule = freshAuditModule().mod
assert.equal(typeof auditModule.changedFields, 'function', 'lib/audit.ts must export changedFields')
assert.equal(typeof auditModule.auditChangeColumns, 'function', 'lib/audit.ts must export auditChangeColumns')
const changedFields = auditModule.changedFields
const auditChangeColumns = auditModule.auditChangeColumns
const isSecretShapedAuditKey = auditModule.isSecretShapedAuditKey

check('records only the fields that actually moved', () => {
  const change = changedFields(
    { name: 'Coke 330ml', selling_price_usd: 1, barcode: '8851', unit: 'pcs' },
    { name: 'Coke 330ml', selling_price_usd: 1.25, barcode: '8851', unit: 'can' },
  )
  assert.deepEqual(change, {
    before: { selling_price_usd: 1, unit: 'pcs' },
    after: { selling_price_usd: 1.25, unit: 'can' },
  })
})

check('CONTROL: an unchanged save produces no diff at all (null, so no row content)', () => {
  assert.equal(changedFields(
    { name: 'Coke 330ml', selling_price_usd: 1, notes: null },
    { name: 'Coke 330ml', selling_price_usd: 1, notes: null },
  ), null)
})

check('CONTROL: the helper is discriminating -- a one-cent move is still a change', () => {
  const change = changedFields({ amount_usd: 2.5 }, { amount_usd: 2.51 })
  assert.deepEqual(change, { before: { amount_usd: 2.5 }, after: { amount_usd: 2.51 } })
})

check('a boolean flag and the 0/1 D1 stores for it are the same value', () => {
  assert.equal(changedFields({ is_active: 1 }, { is_active: true }), null)
  assert.equal(changedFields({ is_active: 0 }, { is_active: false }), null)
  const flipped = changedFields({ is_active: 1 }, { is_active: false })
  assert.deepEqual(flipped, { before: { is_active: 1 }, after: { is_active: 0 } })
})

check('permissions objects differing only in key order are not a change', () => {
  assert.equal(changedFields(
    { permissions: { sales: 'full', products: 'view' } },
    { permissions: { products: 'view', sales: 'full' } },
  ), null)
  const real = changedFields(
    { permissions: { sales: 'full', products: 'view' } },
    { permissions: { sales: 'full', products: 'full' } },
  )
  assert.ok(real, 'a real permission change must be recorded')
  assert.deepEqual(real.after.permissions, { sales: 'full', products: 'full' })
})

check('empty string, null and undefined all read as "not set"', () => {
  assert.equal(changedFields({ notes: '' }, { notes: null }), null)
  assert.equal(changedFields({ phone: null }, { phone: undefined }), null)
  const set = changedFields({ notes: null }, { notes: 'counter float' })
  assert.deepEqual(set, { before: { notes: null }, after: { notes: 'counter float' } })
})

check('bookkeeping keys the renderer ignores are never written', () => {
  assert.equal(changedFields(
    { id: 1, created_at: 'a', updated_at: 'a', client_request_id: 'r1' },
    { id: 1, created_at: 'a', updated_at: 'b', client_request_id: 'r2' },
  ), null)
})

check('SECURITY: password, hash, token and credential keys never reach an audit row', () => {
  const change = changedFields(
    { username: 'za', password: 'hunter2', password_hash: 'BCRYPTOLD', api_key: 'k-old', session_token: 't-old', avatar_blob: 'AAAA' },
    { username: 'za2', password: 'hunter3', password_hash: 'BCRYPTNEW', api_key: 'k-new', session_token: 't-new', avatar_blob: 'BBBB' },
  )
  assert.deepEqual(change, { before: { username: 'za' }, after: { username: 'za2' } })
  const serialized = JSON.stringify(auditChangeColumns(change))
  const secrets = ['hunter2', 'hunter3', 'BCRYPTOLD', 'BCRYPTNEW', 'k-old', 'k-new', 't-old', 't-new', 'AAAA', 'BBBB']
  for (const secret of secrets) {
    assert.ok(!serialized.includes(secret), 'audit row leaked ' + secret)
  }
})

check('SECURITY: a redacted key records THAT it changed, never either value', () => {
  const change = changedFields(
    { drive_sync_refresh_token: 'old-token-value', shop_name: 'Shop' },
    { drive_sync_refresh_token: 'new-token-value', shop_name: 'Shop 2' },
    { redact: (key) => key === 'drive_sync_refresh_token' },
  )
  assert.deepEqual(change, {
    before: { drive_sync_refresh_token: '(hidden)', shop_name: 'Shop' },
    after: { drive_sync_refresh_token: '(hidden, changed)', shop_name: 'Shop 2' },
  })
  const serialized = JSON.stringify(change)
  assert.ok(!serialized.includes('old-token-value') && !serialized.includes('new-token-value'))
})

check('isSecretShapedAuditKey names the shapes settings widens its own rule with', () => {
  assert.equal(isSecretShapedAuditKey('telegram_bot_token'), true)
  assert.equal(isSecretShapedAuditKey('admin_password'), true)
  assert.equal(isSecretShapedAuditKey('shop_name'), false)
  assert.equal(isSecretShapedAuditKey('selling_price_usd'), false)
})

check('a delete records the whole removed record as before, with a null after', () => {
  const change = changedFields({ label: 'Packing tape', amount_usd: 2.5, notes: null }, null, {
    keys: ['label', 'amount_usd', 'notes'],
  })
  assert.deepEqual(change, { before: { label: 'Packing tape', amount_usd: 2.5 }, after: null })
  assert.deepEqual(auditChangeColumns(change), {
    old_value: JSON.stringify({ label: 'Packing tape', amount_usd: 2.5 }),
    new_value: null,
  })
})

check('the keys option confines the diff to the columns a route owns', () => {
  const change = changedFields(
    { name: 'A', cost_price_usd: 1, stock_quantity: 5 },
    { name: 'B', cost_price_usd: 9, stock_quantity: 7 },
    { keys: ['name'] },
  )
  assert.deepEqual(change, { before: { name: 'A' }, after: { name: 'B' } })
})

// ---------------------------------------------------------------------------
// 2. audit() writes old_value, and is unchanged for callers that pass none.
// ---------------------------------------------------------------------------
function lastAuditRow(db) {
  return db.prepare('SELECT action, entity, entity_id, details, old_value, new_value FROM audit_logs ORDER BY id DESC LIMIT 1').get({})
}

async function auditWriteScenario() {
  const harness = freshAuditModule()
  const db = harness.db
  const mod = harness.mod
  db.prepare("INSERT INTO users (id, username, name, password, is_active) VALUES (4, 'za', 'Za Sethy', 'x', 1)").run({})

  // Backward compatibility: no change argument at all.
  await mod.audit({ DB: db }, 4, 'ignored', 'update', 'branch', 3, { name: 'Shop' })
  const legacy = lastAuditRow(db)
  check('audit() without a change writes old_value NULL and new_value = details, exactly as before', () => {
    assert.equal(legacy.old_value, null)
    assert.equal(legacy.new_value, JSON.stringify({ name: 'Shop' }))
    assert.equal(legacy.details, JSON.stringify({ name: 'Shop' }))
  })

  const change = changedFields(
    { username: 'za', role_id: 2, is_active: 1, permissions: { sales: 'full' } },
    { username: 'za', role_id: 3, is_active: 0, permissions: { sales: 'view' } },
  )
  await mod.audit({ DB: db }, 4, 'ignored', 'update', 'user', 9, null, change)
  const withChange = lastAuditRow(db)
  check('audit() with a change writes both columns, and leaves details alone', () => {
    assert.deepEqual(JSON.parse(withChange.old_value), { role_id: 2, is_active: 1, permissions: { sales: 'full' } })
    assert.deepEqual(JSON.parse(withChange.new_value), { role_id: 3, is_active: 0, permissions: { sales: 'view' } })
    assert.equal(withChange.details, null)
  })

  // 3. The renderer the Audit Log page actually runs.
  check('the REAL Audit Log renderer turns those bytes into Field | Before | After rows', () => {
    const rows = renderer.buildAuditFieldDiff(withChange.old_value, withChange.new_value)
    assert.deepEqual(rows.map((row) => [row.key, row.before, row.after, row.changeType]), [
      ['is_active', '1', '0', 'changed'],
      ['permissions', 'Sales: full', 'Sales: view', 'changed'],
      ['role_id', '2', '3', 'changed'],
    ])
    assert.deepEqual(rows.map((row) => row.label), ['Is Active', 'Permissions', 'Role Id'])
  })
  check('CONTROL: a details-only row can only claim every field was ADDED', () => {
    // This is the defect this lane removes, pinned so it cannot come back
    // unnoticed: with old_value NULL the renderer has no before image, so an
    // ordinary edit reads as if the branch had just been given a name.
    assert.deepEqual(renderer.buildAuditFieldDiff(legacy.old_value, legacy.new_value)
      .map((row) => [row.key, row.before, row.after, row.changeType]), [
      ['name', null, 'Shop', 'added'],
    ])
  })

  const deleteChange = changedFields({ label: 'Packing tape', amount_usd: 2.5 }, null, { keys: ['label', 'amount_usd'] })
  await mod.audit({ DB: db }, 4, null, 'delete', 'fee', 11, { before: 'kept' }, deleteChange)
  const deleted = lastAuditRow(db)
  check('a delete row renders every field as removed', () => {
    const rows = renderer.buildAuditFieldDiff(deleted.old_value, deleted.new_value)
    assert.deepEqual(rows.map((row) => [row.key, row.before, row.after, row.changeType]), [
      ['amount_usd', '2.5', null, 'removed'],
      ['label', 'Packing tape', null, 'removed'],
    ])
  })
}

// ---------------------------------------------------------------------------
// 4. Real routes, end to end.
// ---------------------------------------------------------------------------
function auditRowsFor(db, entity) {
  return db.prepare('SELECT action, entity, entity_id, details, old_value, new_value FROM audit_logs WHERE entity = @entity ORDER BY id').all({ entity })
}

async function feesRoute() {
  const db = openDb(MIGRATION_SQLS)
  // The migration chain seeds real historical expenses; this scenario owns
  // the table so the audit-row counts below mean what they say.
  db.exec('DELETE FROM fees; DELETE FROM audit_logs;')
  db.exec("INSERT INTO branches (id, name, is_active) VALUES (2, 'Shop', 1);")
  db.exec("INSERT INTO delivery_contacts (id, name) VALUES (9, 'Courier A');")
  db.exec("INSERT INTO fees (id, fee_type, label, amount_usd, amount_khr, fee_date, branch_id, notes, created_at, updated_at) VALUES (1, 'expense', 'Packing tape', 2.5, 0, '2026-09-11', 2, 'counter', '2026-09-11 00:00:00', '2026-09-11 00:00:00');")
  const auditLib = loadReal(workerSrc('lib/audit.ts'), { './db': { getDb: () => db } })
  const route = loadReal(workerSrc('routes/fees.ts'), {
    hono: require('hono'),
    '../lib/db': { getDb: () => db },
    '../lib/auth': {
      requireAuth: async (c, next) => { c.set('user', { id: 4, username: 'za', name: 'Za Sethy' }); return next() },
    },
    '../lib/audit': auditLib,
    '../lib/permissions': { getPermissionTier: () => 'full', getActionTier: () => 'full' },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
    '../lib/conflictControl': loadReal(workerSrc('lib/conflictControl.ts')),
    '../lib/reviewGate': { maybeQueueForReview: async () => null },
    '../lib/businessDateWindow': { businessToday: () => '2026-09-11' },
    '../lib/telegram': { sendTelegramEvent: async () => {}, telegramMoney: () => '$2.50' },
    '../lib/branchRoles': { branchCanSell: () => true },
    '../lib/batchCode': { normalizeTypedDate: (value) => String(value || '').slice(0, 10) || null },
    '../lib/actorSnapshot': loadReal(workerSrc('lib/actorSnapshot.ts')),
    '../lib/feeOperationReceipt': loadReal(workerSrc('lib/feeOperationReceipt.ts')),
    '../lib/moneyPrecision': loadReal(workerSrc('lib/moneyPrecision.ts')),
    '../index': {},
  }).default
  const ctx = { waitUntil: (p) => p, passThroughOnException() {} }
  const put = (body) => route.request('/1', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, {}, ctx)

  const unchanged = { fee_type: 'expense', label: 'Packing tape', amount_usd: 2.5, amount_khr: 0, fee_date: '2026-09-11', branch_id: 2, notes: 'counter' }
  let response = await put(unchanged)
  assert.equal(response.status, 200, await response.text())
  let rows = auditRowsFor(db, 'fee')
  check('fees PUT CONTROL: a save that changes nothing records no before/after', () => {
    assert.equal(rows.length, 1)
    assert.equal(rows[0].old_value, null)
    assert.equal(rows[0].new_value, null)
    assert.deepEqual(renderer.buildAuditFieldDiff(rows[0].old_value, rows[0].new_value), [])
    assert.ok(rows[0].details.includes('"before"'), 'details keeps its existing shape for existing consumers')
  })

  response = await put(Object.assign({}, unchanged, { amount_usd: 4.75, label: 'Packing tape (roll)' }))
  assert.equal(response.status, 200, await response.text())
  rows = auditRowsFor(db, 'fee')
  check('fees PUT: one row, carrying exactly the two fields that moved', () => {
    assert.equal(rows.length, 2, 'exactly one audit row per edit -- no duplicate')
    assert.deepEqual(JSON.parse(rows[1].old_value), { label: 'Packing tape', amount_usd: 2.5 })
    assert.deepEqual(JSON.parse(rows[1].new_value), { label: 'Packing tape (roll)', amount_usd: 4.75 })
    assert.deepEqual(renderer.buildAuditFieldDiff(rows[1].old_value, rows[1].new_value).map((r) => r.label),
      ['Amount Usd', 'Label'])
  })

  response = await route.request('/1', { method: 'DELETE' }, {}, ctx)
  assert.equal(response.status, 200, await response.text())
  rows = auditRowsFor(db, 'fee')
  check('fees DELETE: the removed expense is preserved as the before image', () => {
    const last = rows[rows.length - 1]
    assert.equal(last.action, 'delete')
    assert.equal(last.new_value, null)
    const before = JSON.parse(last.old_value)
    assert.equal(before.label, 'Packing tape (roll)')
    assert.equal(before.amount_usd, 4.75)
    assert.ok(!('created_by' in before) && !('id' in before), 'bookkeeping columns stay out')
  })
}

async function promotionsRoute() {
  const db = openDb(MIGRATION_SQLS)
  db.exec('DELETE FROM promotion_rules; DELETE FROM audit_logs;')
  db.exec("INSERT INTO promotion_rules (id, title, show_title, rule_type, min_quantity, save_usd, save_khr, percent_off, min_spend_usd, min_spend_khr, label_style, scope_type, product_ids, category, brand, badge_color, starts_at, ends_at, is_active) VALUES (1, 'Buy 3 save $1', 1, 'quantity_save', 3, 1, 0, 0, 0, 0, 'save', 'category', '[]', 'Drinks', NULL, '#e11d48', NULL, NULL, 1);")
  const auditLib = loadReal(workerSrc('lib/audit.ts'), { './db': { getDb: () => db } })
  const route = loadReal(workerSrc('routes/promotions.ts'), {
    hono: require('hono'),
    '../lib/db': { getDb: () => db },
    '../lib/auth': {
      requireAuth: async (c, next) => { c.set('user', { id: 4, username: 'za', name: 'Za Sethy' }); return next() },
    },
    '../lib/audit': auditLib,
    '../lib/permissions': { hasPermission: () => true, getPermissionTier: () => 'full', getActionTier: () => 'full' },
    '../lib/cache': { bumpVersion: async () => {} },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
    '../lib/promotionRules': loadReal(workerSrc('lib/promotionRules.ts')),
    '../lib/batchCode': loadReal(workerSrc('lib/batchCode.ts')),
    '../lib/actorSnapshot': loadReal(workerSrc('lib/actorSnapshot.ts')),
    '../index': {},
  }).default
  const ctx = { waitUntil: (p) => p, passThroughOnException() {} }
  const put = (body) => route.request('/rules/1', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, {}, ctx)

  const base = { title: 'Buy 3 save $1', show_title: 1, rule_type: 'quantity_save', min_quantity: 3, save_usd: 1, save_khr: 0, scope_type: 'category', category: 'Drinks', badge_color: '#e11d48', is_active: 1 }
  let response = await put(base)
  assert.equal(response.status, 200, await response.text())
  let rows = auditRowsFor(db, 'promotion_rule')
  check('promotions PUT CONTROL: resaving the same rule records no before/after', () => {
    assert.equal(rows.length, 1)
    assert.equal(rows[0].old_value, null)
    assert.deepEqual(renderer.buildAuditFieldDiff(rows[0].old_value, rows[0].new_value), [])
  })

  response = await put(Object.assign({}, base, { title: 'Buy 3 save $2', save_usd: 2, is_active: 0 }))
  assert.equal(response.status, 200, await response.text())
  rows = auditRowsFor(db, 'promotion_rule')
  check('promotions PUT: the row names the rule fields that moved', () => {
    assert.equal(rows.length, 2)
    const before = JSON.parse(rows[1].old_value)
    const after = JSON.parse(rows[1].new_value)
    assert.deepEqual(Object.keys(before).sort(), ['is_active', 'save_usd', 'title'])
    assert.deepEqual([before.title, after.title], ['Buy 3 save $1', 'Buy 3 save $2'])
    assert.deepEqual([before.save_usd, after.save_usd], [1, 2])
    assert.deepEqual([before.is_active, after.is_active], [1, 0])
    assert.ok(!('updated_at' in before), 'the row describes the edit, not its own timestamp')
  })
}

// ---------------------------------------------------------------------------
// 5. Every route in this lane's scope must actually pass a change to audit().
// A route that quietly loses its before/after again would leave the Audit Log
// showing an empty table with nothing failing anywhere else.
// ---------------------------------------------------------------------------
check('every route in scope still threads a before/after into its audit write', () => {
  const expectations = [
    ['routes/users.ts', /'update', 'user', id, null, changedFields\(/, 'admin user edit'],
    ['routes/users.ts', /'update', 'user', targetId, \{ mode: 'profile' \}, changedFields\(/, 'self-service profile edit'],
    ['routes/users.ts', /roleChange = auditChangeColumns\(changedFields\(/, 'role edit (in its own batch)'],
    ['routes/products.ts', /'update', 'product', id, null, productFieldChange/, 'product plain field edit'],
    ['routes/contacts.ts', /changedFields\(current, payload, \{ keys: contactDiffKeys \}\)/, 'contact edit'],
    ['routes/promotions.ts', /'update', 'promotion_rule', id,[\s\S]{0,200}?changedFields\(/, 'promotion rule edit'],
    ['routes/promotions.ts', /'update', 'promotion', id, \{ title: input\.title \},[\s\S]{0,40}?changedFields\(/, 'announcement edit'],
    ['routes/settings.ts', /paymentMethodChange = auditChangeColumns\(changedFields\(/, 'payment-method rename'],
    ['routes/fees.ts', /'update', 'fee', id, \{[\s\S]{0,200}?\}, changedFields\(/, 'expense edit'],
    ['routes/fees.ts', /'delete', 'fee', id, \{ before: existing, after: null \},[\s\S]{0,120}?changedFields\(/, 'expense delete'],
  ]
  for (const entry of expectations) {
    const source = fs.readFileSync(workerSrc(entry[0]), 'utf8')
    assert.match(source, entry[1], entry[0] + ': ' + entry[2] + ' no longer records a before/after')
  }
})

check('the cost-override and group-rename rows are not duplicated by the plain product diff', () => {
  const products = fs.readFileSync(workerSrc('routes/products.ts'), 'utf8')
  const allowlist = products.match(/const PRODUCT_FIELD_AUDIT_COLUMNS = \[([\s\S]*?)\] as const/)
  assert.ok(allowlist, 'products.ts must declare its plain-field allowlist')
  assert.ok(!/cost_price_usd|cost_price_khr/.test(allowlist[1]),
    'cost belongs to the cost_override row (lib/productWrites.ts); listing it here would record the same change twice')
  assert.match(products, /appliedGroupRename \|\| renamedProductName[\s\S]{0,160}?filter\(\(column\) => column !== 'name'\)/,
    'a group rename already has its own product_group row; the name must drop out of the plain diff')
})

async function main() {
  await auditWriteScenario()
  await feesRoute()
  await promotionsRoute()
  console.log('\nOK ' + passed + ' checks')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
