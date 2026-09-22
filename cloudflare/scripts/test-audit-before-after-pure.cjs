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
const loadingModules = new Map()
function loadReal(sourcePath, requireOverrides = {}) {
  const outputText = transpileFile(sourcePath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    if (request.startsWith('.')) {
      const resolved = path.resolve(path.dirname(sourcePath), request) + '.ts'
      if (fs.existsSync(resolved)) {
        // A cycle (lib/a -> lib/b -> lib/a) must see the partially-filled
        // module, exactly as CommonJS itself does; without this the loader
        // recursed until the transpiler blew the stack.
        if (loadingModules.has(resolved)) return loadingModules.get(resolved)
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
  loadingModules.set(sourcePath, moduleObj.exports)
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
    )
  } finally {
    Module._load = originalLoad
    loadingModules.delete(sourcePath)
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

check('E8: future encryption/signing key shapes are masked before one exists', () => {
  for (const key of ['encryption_key', 'signing_key', 'webhook_key', 'key', 'passphrase']) {
    assert.equal(isSecretShapedAuditKey(key), true, key + ' must never reach an audit row')
    assert.equal(changedFields({ [key]: 'old' }, { [key]: 'new' }), null, key + ' must not produce a diff')
  }
  // Positive control: shapes that merely CONTAIN the letters are ordinary
  // fields and must still be recorded, or the rule is masking real edits.
  for (const key of ['keyboard_label', 'turkey', 'monkey_bar', 'key_visual_note']) {
    assert.equal(isSecretShapedAuditKey(key), false, key + ' is an ordinary field')
    assert.ok(changedFields({ [key]: 'old' }, { [key]: 'new' }), key + ' must still be recorded')
  }
})

check('a value too large to render is stored as its length and digest, not twice', () => {
  const small = 'x'.repeat(29)
  const big = 'y'.repeat(8887)
  const other = 'z'.repeat(8887)
  const change = changedFields({ receipt_template: small }, { receipt_template: big })
  assert.equal(change.before.receipt_template, small, 'a small side is still stored verbatim')
  assert.match(String(change.after.receipt_template), /^\(8887 chars, #[0-9a-f]{8}\)$/)
  // Discriminating: two same-length but different blobs must not summarize
  // to the same text, or the digest is decorative.
  const otherChange = changedFields({ receipt_template: big }, { receipt_template: other })
  assert.notEqual(String(otherChange.before.receipt_template), String(otherChange.after.receipt_template))
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

  response = await route.request('/rules/1', { method: 'DELETE' }, {}, ctx)
  assert.equal(response.status, 200, await response.text())
  rows = auditRowsFor(db, 'promotion_rule')
  check('promotions DELETE: the removed rule is preserved as the before image', () => {
    const last = rows[rows.length - 1]
    assert.equal(last.action, 'delete')
    assert.equal(last.new_value, null)
    const before = JSON.parse(last.old_value)
    assert.equal(before.title, 'Buy 3 save $2')
    assert.equal(before.scope_type, 'category')
    assert.equal(before.category, 'Drinks')
    assert.ok(!('id' in before), 'bookkeeping columns stay out')
    assert.ok(renderer.buildAuditFieldDiff(last.old_value, last.new_value).length > 0,
      'the renderer must have rows to show for a delete')
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
    ['routes/settings.ts', /'update', 'settings', null, \{ keys: attemptedKeys \},[\s\S]{0,200}?changedFields\(/, 'settings save'],
    ['routes/fees.ts', /'update', 'fee', id, \{[\s\S]{0,200}?\}, changedFields\(/, 'expense edit'],
    ['routes/fees.ts', /'delete', 'fee', id, \{ before: existing, after: null \},[\s\S]{0,120}?changedFields\(/, 'expense delete'],
    ['routes/returns.ts', /'update', 'return', id, \{[\s\S]{0,200}?\}, changedFields\(/, 'return edit'],
  ]
  for (const entry of expectations) {
    const source = fs.readFileSync(workerSrc(entry[0]), 'utf8')
    assert.match(source, entry[1], entry[0] + ': ' + entry[2] + ' no longer records a before/after')
  }
})

check('the cost-override row is not duplicated, and the diff is derived not hand-listed', () => {
  const products = fs.readFileSync(workerSrc('routes/products.ts'), 'utf8')
  const excluded = products.match(/const PRODUCT_AUDIT_EXCLUDED_COLUMNS = new Set\(\[([\s\S]*?)\]\)/)
  assert.ok(excluded, 'products.ts must declare which columns the plain-field diff holds back')
  assert.match(excluded[1], /cost_price_usd/, 'cost belongs to the cost_override row (lib/productWrites.ts)')
  assert.ok(!/purchase_price/.test(excluded[1]),
    'purchase_price has no other writer; holding it back would reopen the gap this lane closes')
  assert.match(products, /Object\.keys\(cleanPayload\(body, await tableColumns\(c\.env, 'products'\)\)\)/,
    'the diff must be derived from the columns the PUT writes, not a hand-written allowlist that drifts')
  assert.match(products, /keys: wroteProductRenameAudit[\s\S]{0,120}?filter\(\(column\) => column !== 'name'\)/,
    'name drops out only when a rename row was ACTUALLY written')
})

// 6. Real routes/products.ts, end to end, on the migrated schema.
//
// Two defects this pins, both found by an adversarial read of the first
// version of this lane:
//   E1 -- a DEFAULT-scope rename (rename this row only, the common case) was
//         recorded nowhere: the 'rename'/'product_group' row only fires under
//         __rename_scope === 'group', but `name` was dropped from the field
//         diff for ANY name change.
//   E2 -- the field diff used a hand-written 16-column allowlist while the
//         product form submits ~20 more (discounts, thresholds, expiry,
//         tag_label, custom_fields), so changing five of them wrote no row.
// ---------------------------------------------------------------------------
function productsFixture() {
  const database = openDb(MIGRATION_SQLS)
  const raw = database.db
  raw.exec('DELETE FROM audit_logs;')
  const DB = {
    prepare(sql) {
      let values = []
      const statement = {
        bind(...args) { values = args; return statement },
        async all() { return { results: raw.prepare(sql).all(...values) } },
        async first() { return raw.prepare(sql).get(...values) ?? null },
        async run() {
          const result = raw.prepare(sql).run(...values)
          return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
        },
      }
      return statement
    },
    async batch(statements) {
      raw.exec('BEGIN IMMEDIATE')
      try {
        const results = []
        for (const statement of statements) results.push(await statement.run())
        raw.exec('COMMIT')
        return results
      } catch (error) { raw.exec('ROLLBACK'); throw error }
    },
  }

  // Everything that touches the write path is the real module -- including
  // lib/audit.ts itself, which is the whole point: a stubbed audit would
  // prove nothing about what lands in old_value/new_value.
  const real = new Set([
    'acquisitionCostAccess', 'audit',
    'productWrites', 'moneyPrecision', 'productMerge', 'productIdentity', 'productDetailRule', 'db',
    'sqlBinding', 'searchMatch', 'batchCode', 'actorSnapshot', 'pendingActions', 'reviewGate',
    'reviewApply', 'conflictControl', 'renameCascade', 'schemaProbe', 'catalogCostRecompute',
  ])
  const noop = new Proxy(function () {}, { get: () => noop, apply: () => undefined, construct: () => ({}) })
  class ProductImageAssetError extends Error {}
  const services = {
    auth: { requireAuth: async (c, next) => { c.set('user', c.env.TEST_USER); await next() } },
    permissions: {
      getPermissionTier: () => 'full', getActionTier: () => 'full',
      hasPermission: () => true, isActionBlocked: () => false, isAdminControlUser: () => true,
    },
    cache: { bumpVersion: async () => {}, bumpVersions: async () => {} },
    broadcastHub: { broadcast: async () => {} },
    media: { sanitizeMediaList: () => [] },
    importImageMatch: { MAX_IMAGES_PER_PRODUCT: 3 },
    productImagePermission: {
      ProductImageAssetError, productImageFieldsChanged: () => false,
      productImageFieldsChangedResolved: async () => false,
      resolveProductImageFields: async () => {}, omitUnchangedProductImageFields: () => {},
    },
  }
  const localCache = new Map()
  function load(relative) {
    if (localCache.has(relative)) return localCache.get(relative)
    const mod = { exports: {} }
    localCache.set(relative, mod.exports)
    const filename = path.join(cloudflareRoot, 'src', relative)
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: filename,
    }).outputText
    const localRequire = (request) => {
      if (request === 'hono') return require('hono')
      const name = request.split('/').pop()
      if (relative === 'lib/acquisitionCostAccess.ts' && name === 'permissions') return load('lib/permissions.ts')
      if (services[name]) return services[name]
      if (real.has(name)) return load('lib/' + name + '.ts')
      if (request.startsWith('.')) return noop
      return require(request)
    }
    new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
    localCache.set(relative, mod.exports)
    return mod.exports
  }
  const route = load('routes/products.ts').default
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} }
  const admin = { id: 9, username: 'sethy', name: 'Sethy Owner', tier: 'full', permissions: JSON.stringify({ product_cost_view: true, product_cost_edit: true }) }
  const request = async (method, url, body) => {
    const response = await route.request(url, {
      method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    }, { DB: DB, TEST_USER: admin }, ctx)
    const text = await response.text()
    return { status: response.status, body: text && response.headers.get('content-type') && response.headers.get('content-type').includes('application/json') ? JSON.parse(text) : text }
  }
  return { raw: raw, request: request }
}

function productAuditRows(raw, action) {
  return raw.prepare("SELECT action, entity, entity_id, details, old_value, new_value FROM audit_logs WHERE entity IN ('product','product_group') AND action = ? ORDER BY id").all(action)
}

async function productsRoute() {
  const fixture = productsFixture()
  const raw = fixture.raw
  const request = fixture.request
  raw.prepare("INSERT INTO products(id, name, barcode, unit, category, is_active, discount_enabled, discount_percent, low_stock_threshold, expiry_alert_days, tag_label, selling_price_usd, purchase_price_usd, cost_price_usd, updated_at) VALUES (1, 'Coke 330ml', '8851', 'pcs', 'Drinks', 1, 0, 0, 10, 30, NULL, 1.25, 0.9, 0.8, NULL)").run()

  // E1 reproduction, verbatim from the verifier: a rename with NO
  // __rename_scope, alongside two ordinary field edits.
  let response = await request('PUT', '/1', { name: 'Coke 330 ml', barcode: '7777', unit: 'bottle' })
  assert.equal(response.status, 200, JSON.stringify(response.body))
  let updates = productAuditRows(raw, 'update')
  check('E1: a default-scope product rename is recorded, not silently dropped', () => {
    assert.equal(productAuditRows(raw, 'rename').length, 0, 'no product_group row fires at default scope -- that is the premise')
    assert.equal(updates.length, 1, 'exactly one plain-field row')
    assert.deepEqual(JSON.parse(updates[0].old_value), { name: 'Coke 330ml', barcode: '8851', unit: 'pcs' })
    assert.deepEqual(JSON.parse(updates[0].new_value), { name: 'Coke 330 ml', barcode: '7777', unit: 'bottle' })
    assert.deepEqual(renderer.buildAuditFieldDiff(updates[0].old_value, updates[0].new_value).map((r) => r.label),
      ['Barcode', 'Name', 'Unit'])
  })

  // E2 reproduction: five columns the old 16-name allowlist did not contain.
  response = await request('PUT', '/1', {
    discount_enabled: 1, discount_percent: 15, low_stock_threshold: 4, expiry_alert_days: 7, tag_label: 'damaged',
  })
  assert.equal(response.status, 200, JSON.stringify(response.body))
  updates = productAuditRows(raw, 'update')
  check('E2: columns outside the old allowlist are recorded too', () => {
    assert.equal(updates.length, 2)
    assert.deepEqual(JSON.parse(updates[1].old_value),
      { discount_enabled: 0, discount_percent: 0, low_stock_threshold: 10, expiry_alert_days: 30, tag_label: null })
    assert.deepEqual(JSON.parse(updates[1].new_value),
      { discount_enabled: 1, discount_percent: 15, low_stock_threshold: 4, expiry_alert_days: 7, tag_label: 'damaged' })
  })

  // Control: a resave of identical values still writes nothing at all.
  response = await request('PUT', '/1', { discount_percent: 15, tag_label: 'damaged' })
  assert.equal(response.status, 200, JSON.stringify(response.body))
  check('E2 CONTROL: an unchanged product resave still writes no row at all', () => {
    assert.equal(productAuditRows(raw, 'update').length, 2)
  })

  // purchase_price_* is NOT held back: the cost_override row covers
  // cost_price_* only, so excluding it would leave the same gap.
  response = await request('PUT', '/1', { purchase_price_usd: 1.1 })
  assert.equal(response.status, 200, JSON.stringify(response.body))
  updates = productAuditRows(raw, 'update')
  check('purchase_price is recorded here because nothing else records it', () => {
    assert.equal(updates.length, 3)
    assert.deepEqual(JSON.parse(updates[2].old_value), { purchase_price_usd: 0.9 })
    assert.deepEqual(JSON.parse(updates[2].new_value), { purchase_price_usd: 1.1 })
  })
}

// 7. Real routes/users.ts self-service profile: an avatar change alone used
//    to write a row that said nothing changed (E7).
// ---------------------------------------------------------------------------
async function usersProfileRoute() {
  const db = openDb(MIGRATION_SQLS)
  db.exec('DELETE FROM audit_logs;')
  db.exec("INSERT INTO users (id, username, name, password, phone, email, avatar_path, is_active) VALUES (31, 'za', 'Za Sethy', 'x', '012345678', 'za@example.com', '/avatars/old.png', 1);")
  const auditLib = loadReal(workerSrc('lib/audit.ts'), { './db': { getDb: () => db } })
  const route = loadReal(workerSrc('routes/users.ts'), {
    hono: require('hono'),
    bcryptjs: { compareSync: () => true, hashSync: (value) => 'hashed:' + value },
    '../lib/db': { getDb: () => db },
    './db': { getDb: () => db },
    '../lib/auth': {
      requireAuth: async (c, next) => { c.set('user', { id: 31, username: 'za', name: 'Za Sethy' }); return next() },
      revokeUserSessions: async () => {},
    },
    '../lib/audit': auditLib,
    './audit': auditLib,
    '../lib/permissions': { isAdminControlUser: () => true },
    '../lib/cache': { bumpVersion: async () => {} },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
    '../index': {},
  }).default
  const ctx = { waitUntil: (p) => (p && p.catch ? p.catch(() => {}) : p), passThroughOnException() {} }
  const response = await route.request('/users/31/profile', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'za', name: 'Za Sethy', phone: '012345678', email: 'za@example.com',
      avatar_path: '/avatars/new.png', adminOverride: true,
    }),
  }, {}, ctx)
  assert.equal(response.status, 200, await response.text())
  const rows = db.prepare("SELECT old_value, new_value FROM audit_logs WHERE entity = 'user' ORDER BY id").all({})
  check('E7: an avatar-only profile save records the avatar, not an empty diff', () => {
    assert.equal(rows.length, 1)
    assert.deepEqual(JSON.parse(rows[0].old_value), { avatar_path: '/avatars/old.png' })
    assert.deepEqual(JSON.parse(rows[0].new_value), { avatar_path: '/avatars/new.png' })
    assert.deepEqual(renderer.buildAuditFieldDiff(rows[0].old_value, rows[0].new_value).map((r) => r.label), ['Avatar Path'])
    const rawRow = JSON.stringify(rows[0])
    assert.ok(!rawRow.includes('password') && !rawRow.includes('hashed:'), 'no password material in the row')
  })
}

async function main() {
  await auditWriteScenario()
  await feesRoute()
  await promotionsRoute()
  await productsRoute()
  await usersProfileRoute()
  console.log('\nOK ' + passed + ' checks')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
