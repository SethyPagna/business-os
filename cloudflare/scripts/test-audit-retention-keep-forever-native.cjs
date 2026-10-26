'use strict'
// Owner, 14 Oct 2026: the audit rows of sales, payments (settle and refunds), returns, every stock change,
// permission/role/user changes and reverts are kept forever (an undo or redo only when what it undid is kept); every other row follows the retention setting (floor 21
// days). Lead decision, 14 Oct: where deletion cannot be undone the record stays too (system-wide writes, sales
// ownership and receivables, cost and price edits, shift and cash records, review approvals that apply stock or money).
// This seeds a 400-day-old row for EVERY entity/action pair the Worker writes (scripts/harness/audit_retention_classes.cjs,
// read from the writers) AND for every pair of the rule as written by hand (OWNER_KEPT / OWNER_PRUNED in the same
// file, independent of the table), plus a recent row of each, runs the daily purge (the scheduled handler) and the
// password-gated DELETE, and asserts the exact survivors of each.
//
// Drives the REAL Worker (every middleware, route and lib) under Miniflare on a fully migrated D1.
//
// Run (from cloudflare/): node scripts/test-audit-retention-keep-forever-native.cjs
const { randomBytes } = require('node:crypto')
const { bootWorld, createReporter } = require('./harness/real_worker_world.cjs')
const { ROWS, OWNER_KEPT, OWNER_PRUNED } = require('./harness/audit_retention_classes.cjs')

const PURGE = '/api/system/audit-logs/retention'

// Rows that are not an entity/action pair of the table: legacy rows with no entity, spelling variants of the entity,
// and the review decisions whose section decides.
const SPECIAL = [
  { label: 'legacy row, no entity, table sales', entity: null, table: 'sales', action: 'update', kept: true },
  { label: 'legacy row, no entity, action sale_settlement', entity: null, table: null, action: 'sale_settlement', kept: true },
  { label: 'legacy row, no entity, action return', entity: '', table: '', action: 'return', kept: true },
  { label: 'legacy row, no entity, action stock_adjust', entity: null, table: null, action: 'stock_adjust', kept: true },
  { label: 'legacy row, no entity, table roles', entity: '', table: 'roles', action: 'update', kept: true },
  { label: 'legacy row, no entity, action login', entity: null, table: null, action: 'login', kept: false },
  { label: 'entity in capitals with spaces', entity: ' SALE ', table: null, action: 'update', kept: true },
  { label: 'pending_action approve, expenses section', entity: 'pending_action', table: 'pending_action', action: 'approve', details: '{"section":"fees"}', kept: true },
  { label: 'pending_action reject, products section', entity: 'pending_action', table: 'pending_action', action: 'reject', details: '{"section":"products"}', kept: false },
  { label: 'user update (account change)', entity: 'users', table: 'users', action: 'update', kept: true },
  { label: 'an undo of an unlisted entity (brand) follows retention', entity: 'brand', table: 'brand', action: 'brand_rename_undo', kept: false },
  { label: 'a redo of an unlisted entity (brand) follows retention', entity: 'brand', table: 'brand', action: 'action_redo', kept: false },
  { label: 'a branch edit undo follows retention', entity: 'branch', table: 'branch', action: 'action_undo', kept: false },
  { label: 'a product undo (it may have undone stock or a price) is kept', entity: 'product', table: 'product', action: 'action_undo', kept: true },
  { label: 'an undo of an unknown entity is kept', entity: 'action_history', table: 'action_history', action: 'action_undo', kept: true },
  { label: 'an expense undo is kept', entity: 'fee', table: 'fee', action: 'action_undo', kept: true },
  { label: 'an action that only contains undo', entity: 'brand', table: 'brand', action: 'undo_nothing', kept: false },
]

const pairCase = (kept, prefix) => ([entity, action, details]) => ({ label: `${prefix}${entity}/${action}${details ? ' ' + details : ''}`, entity, table: entity, action, details, kept })
const cases = [
  ...ROWS.map(([entity, action, kept, details]) => ({ label: `${entity}/${action}${details ? ' ' + details : ''}`, entity, table: entity, action, details, kept })),
  ...SPECIAL,
  ...OWNER_KEPT.map(pairCase(true, 'rule (kept): ')),
  ...OWNER_PRUNED.map(pairCase(false, 'rule (control, expires): ')),
]

async function seed(world, tag) {
  const statements = []
  cases.forEach((row, index) => {
    for (const [age, kind] of [[400, 'old'], [1, 'new']]) {
      statements.push(world.db.prepare(
        "INSERT INTO audit_logs (action, entity, table_name, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, datetime('now', ?))",
      ).bind(row.action, row.entity, row.table, `${tag}-${kind}-${index}`, row.details || null, `-${age} days`))
    }
  })
  for (let i = 0; i < statements.length; i += 50) await world.db.batch(statements.slice(i, i + 50))
}

async function survivors(world, tag) {
  const rows = await world.query('SELECT entity_id FROM audit_logs WHERE entity_id LIKE ?', `${tag}-%`)
  return new Set(rows.map((row) => row.entity_id))
}

function compare(t, ids, tag, kind) {
  const missingKept = []
  const keptPurged = []
  const recentLost = []
  cases.forEach((row, index) => {
    const old = ids.has(`${tag}-old-${index}`)
    if (row.kept && !old) missingKept.push(row.label)
    if (!row.kept && old) keptPurged.push(row.label)
    if (!ids.has(`${tag}-new-${index}`)) recentLost.push(row.label)
  })
  t.eq(`${kind}: kept-forever rows that were deleted`, missingKept, [])
  t.eq(`${kind}: ordinary old rows that survived`, keptPurged, [])
  t.eq(`${kind}: recent rows that were deleted`, recentLost, [])
  const total = cases.length * 2
  const expected = cases.filter((row) => row.kept).length + cases.length
  t.eq(`${kind}: survivors (of ${total} seeded)`, ids.size, expected)
}

async function main() {
  const adminPassword = randomBytes(12).toString('base64url')
  const world = await bootWorld({ adminPassword })
  const { check, finish } = createReporter()
  try {
    await world.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('audit_log_retention_days', '21')")

    await check('the daily purge keeps the kept-forever classes and deletes the rest of the old rows', async (t) => {
      await seed(world, 'daily')
      await world.run("DELETE FROM settings WHERE key = 'audit_log_retention_last_run'")
      const worker = await world.mf.getWorker()
      // The cron runs ONE rotation step per tick: tick until the audit step
      // has had its turn (a full rotation is at most 13 ticks).
      // Each tick is its OWN firing: a real cron gives every firing a distinct
      // scheduledTime, and the rotation drops a second delivery of the same slot
      // as a duplicate. Reusing one time would skip every tick after the first.
      const firstFiring = Date.now()
      for (let tick = 0; tick < 13; tick += 1) {
        await worker.scheduled({ scheduledTime: new Date(firstFiring + tick * 15 * 60 * 1000), cron: '*/15 * * * *' })
        for (let i = 0; i < 40; i += 1) {
          if (await world.first("SELECT 1 AS x FROM settings WHERE key = 'audit_log_retention_last_run'")) break
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
        if (await world.first("SELECT 1 AS x FROM settings WHERE key = 'audit_log_retention_last_run'")) break
      }
      t.ok('the purge ran', !!(await world.first("SELECT 1 AS x FROM settings WHERE key = 'audit_log_retention_last_run'")))
      compare(t, await survivors(world, 'daily'), 'daily', 'daily purge')
    })

    await check('the password-gated DELETE keeps the kept-forever classes and deletes the rest of the old rows', async (t) => {
      await seed(world, 'manual')
      const response = await world.api('DELETE', `${PURGE}?olderThanDays=21&confirm=true`, { currentPassword: adminPassword })
      t.eq('status', response.status, 200)
      compare(t, await survivors(world, 'manual'), 'manual', 'manual DELETE')
    })

    await check('both paths agree on a second pass (nothing kept is touched, nothing new is deleted)', async (t) => {
      const before = [...(await survivors(world, 'manual'))].sort()
      const response = await world.api('DELETE', `${PURGE}?olderThanDays=21&confirm=true`, { currentPassword: adminPassword })
      t.eq('status', response.status, 200)
      t.eq('survivors unchanged', [...(await survivors(world, 'manual'))].sort(), before)
    })
  } finally {
    finish('audit retention keeps what the owner said to keep')
    await world.dispose()
  }
}

main().catch((error) => { console.error(error); process.exit(1) })
