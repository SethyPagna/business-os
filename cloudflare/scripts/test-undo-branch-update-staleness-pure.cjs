// FX-undo: the branch.update undo/redo applier must refuse, not clobber, when
// the branch changed after the recorded edit -- for EVERY field it restores
// (location, phone, manager, notes, is_default; name and is_active are fixed by
// the canonical identity guard) -- and it must never leave zero or two
// default branches.
//
// Before the fix the applier's only guard was the identity guard (name +
// is_active), so undoing an old phone edit silently reverted a later manager
// edit, and undoing "make Warehouse default" left no default branch at all.
//
// Real SQLite over the real migrated schema (harness/d1compat.cjs +
// load_migrations.cjs), the REAL transpiled lib/undoAppliers.ts and
// lib/branchWrites.ts (harness/load_undo_appliers.cjs). The forward edit is
// written through the same branchUpdateStatements the live PUT uses, and the
// history row carries exactly the payload shape Branches.tsx records.
//
// Run: node scripts/test-undo-branch-update-staleness-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { loadUndoAppliers } = require('./harness/load_undo_appliers.cjs')

const USER = { id: 42, name: 'Admin' }
const SHOP = 1
const WAREHOUSE = 2
const COLUMNS = ['name', 'location', 'phone', 'manager', 'notes', 'is_default', 'is_active']

function freshWorld({ withWarehouse = true } = {}) {
  const d1 = openDb(loadAll())
  const { undoAppliers, branchWrites } = loadUndoAppliers(d1)
  d1.db.prepare(`INSERT INTO branches (id, name, location, phone, manager, notes, is_default, is_active)
    VALUES (1, 'Shop', 'Old Market', '012 111', 'Dara', 'front till', 1, 1)`).run()
  if (withWarehouse) {
    d1.db.prepare(`INSERT INTO branches (id, name, location, phone, manager, notes, is_default, is_active)
      VALUES (2, 'Warehouse', 'Depot Rd', '012 222', 'Sok', 'bulk', 0, 1)`).run()
  }
  return { d1, undoAppliers, branchWrites }
}

function read(d1, id) {
  const row = d1.db.prepare(`SELECT ${COLUMNS.join(', ')} FROM branches WHERE id = ?`).get(id)
  return row ? Object.fromEntries(COLUMNS.map((c) => [c, row[c]])) : null
}

// Branches.tsx buildBranchPayload: every field, blanks as '', flags as 0/1,
// plus the actor keys the form sends along.
function formPayload(row) {
  return {
    name: row.name || '', location: row.location || '', phone: row.phone || '', manager: row.manager || '',
    notes: row.notes || '', is_default: row.is_default ? 1 : 0, is_active: row.is_active ?? 1,
    userId: USER.id, userName: USER.name,
  }
}

// A live PUT /branches/:id: write through the shared statements, then record
// the history row exactly as Branches.tsx does (undo = before, redo = after).
async function liveEdit(world, id, changes, { record = true } = {}) {
  const { d1, branchWrites } = world
  const before = read(d1, id)
  const after = { ...before, ...changes }
  const identity = d1.db.prepare('SELECT * FROM branches WHERE id = ?').get(id)
  const directory = d1.db.prepare('SELECT * FROM branches ORDER BY id').all()
  await d1.batch(branchWrites.branchUpdateStatements(id, formPayload(after), identity, directory))
  if (!record) return null
  const info = d1.db.prepare(`INSERT INTO action_history (scope, entity, entity_id, label, reversible, status, undo_payload, redo_payload, created_by_id, created_by_name)
    VALUES ('branches', 'branch', @entity, 'Edit branch', 1, 'undoable', @undo, @redo, @by, @byName)`).run({
    entity: String(id),
    undo: JSON.stringify({ applier: 'branch.update', id, fields: formPayload(before) }),
    redo: JSON.stringify({ applier: 'branch.update', id, fields: formPayload(after) }),
    by: USER.id, byName: USER.name,
  })
  return Number(info.lastInsertRowid)
}

// What routes/actionHistory.ts does: hand the applier the payload for the
// row's next transition, then flip the status on success.
async function replay(world, historyId, direction) {
  const { d1, undoAppliers } = world
  const row = d1.db.prepare('SELECT undo_payload, redo_payload FROM action_history WHERE id = ?').get(historyId)
  const payload = JSON.parse(direction === 'undo' ? row.undo_payload : row.redo_payload)
  const applier = undoAppliers.resolveUndoApplier(payload)
  assert.equal(applier?.name, 'branch.update')
  await applier.run(payload, { env: {}, user: USER, direction, historyId })
  d1.db.prepare('UPDATE action_history SET status = ? WHERE id = ?').run(direction === 'undo' ? 'redoable' : 'undoable', historyId)
}

async function assertConflict(promise, pattern) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.statusCode, 409, `expected a 409 conflict, got: ${error.message}`)
    assert.match(error.message, pattern)
    return true
  })
}

function defaults(d1) {
  return d1.db.prepare('SELECT id FROM branches WHERE is_default = 1 ORDER BY id').all().map((r) => Number(r.id))
}

let passed = 0
const failed = []
// Every check runs even after a failure, so a red run names each broken case.
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failed.push(name)
    console.log(`FAIL ${name}\n  ${String((error && error.message) || error).split('\n')[0]}`)
  }
}

async function main() {
  await check('control: an undo/redo with no later edit restores and reapplies every field', async () => {
    const world = freshWorld()
    const h = await liveEdit(world, SHOP, { phone: '099 999', manager: 'Vanna', notes: '' })
    await replay(world, h, 'undo')
    assert.deepEqual(read(world.d1, SHOP), { name: 'Shop', location: 'Old Market', phone: '012 111', manager: 'Dara', notes: 'front till', is_default: 1, is_active: 1 })
    await replay(world, h, 'redo')
    assert.deepEqual(read(world.d1, SHOP), { name: 'Shop', location: 'Old Market', phone: '099 999', manager: 'Vanna', notes: null, is_default: 1, is_active: 1 })
  })

  await check('H-platform trigger: undoing a phone edit refuses when a later edit changed the manager', async () => {
    const world = freshWorld()
    const a = await liveEdit(world, SHOP, { phone: '099 999' })
    await liveEdit(world, SHOP, { manager: 'Later Manager' })
    await assertConflict(replay(world, a, 'undo'), /edited after this change \(manager\)/)
    const row = read(world.d1, SHOP)
    assert.equal(row.manager, 'Later Manager', 'the later edit survives')
    assert.equal(row.phone, '099 999', 'nothing was reverted')
  })

  for (const [field, value] of [['location', 'New Site'], ['phone', '077 777'], ['manager', 'Chan'], ['notes', 'moved shelf']]) {
    await check(`undo refuses when only ${field} changed after the edit`, async () => {
      const world = freshWorld()
      const other = field === 'notes' ? 'location' : 'notes'
      const a = await liveEdit(world, SHOP, { [other]: 'edited by A' })
      await liveEdit(world, SHOP, { [field]: value })
      const snapshot = read(world.d1, SHOP)
      await assertConflict(replay(world, a, 'undo'), new RegExp(`\\(${field}\\)`))
      assert.deepEqual(read(world.d1, SHOP), snapshot)
    })
  }

  await check('undo refuses when a later edit moved the default flag', async () => {
    const world = freshWorld()
    const a = await liveEdit(world, SHOP, { notes: 'edited by A' })
    await liveEdit(world, WAREHOUSE, { is_default: 1 })
    const snapshot = [read(world.d1, SHOP), read(world.d1, WAREHOUSE)]
    await assertConflict(replay(world, a, 'undo'), /\(is_default\)/)
    assert.deepEqual([read(world.d1, SHOP), read(world.d1, WAREHOUSE)], snapshot)
  })

  await check('a clearing-a-field later edit is detected too (blank vs value)', async () => {
    const world = freshWorld()
    const a = await liveEdit(world, SHOP, { phone: '099 999' })
    await liveEdit(world, SHOP, { location: '' })
    await assertConflict(replay(world, a, 'undo'), /\(location\)/)
    assert.equal(read(world.d1, SHOP).location, null)
  })

  await check('redo refuses when the branch was edited after the undo', async () => {
    const world = freshWorld()
    const a = await liveEdit(world, SHOP, { location: 'A site' })
    await replay(world, a, 'undo')
    await liveEdit(world, SHOP, { notes: 'after the undo' })
    await assertConflict(replay(world, a, 'redo'), /\(notes\)/)
    assert.equal(read(world.d1, SHOP).location, 'Old Market')
    assert.equal(read(world.d1, SHOP).notes, 'after the undo')
  })

  await check('a change that lands between the check and the write aborts the whole batch', async () => {
    const world = freshWorld()
    const a = await liveEdit(world, SHOP, { phone: '099 999' })
    const batch = world.d1.batch.bind(world.d1)
    world.d1.batch = async (statements) => {
      world.d1.batch = batch
      world.d1.db.prepare("UPDATE branches SET manager = 'Raced' WHERE id = 1").run()
      return batch(statements)
    }
    await assertConflict(replay(world, a, 'undo'), /changed while the change was being undone/)
    assert.equal(read(world.d1, SHOP).manager, 'Raced')
    assert.equal(read(world.d1, SHOP).phone, '099 999')
  })

  await check('undoing "make Warehouse default" hands the default back to Shop (never zero defaults)', async () => {
    const world = freshWorld()
    const a = await liveEdit(world, WAREHOUSE, { is_default: 1 })
    assert.deepEqual(defaults(world.d1), [WAREHOUSE])
    await replay(world, a, 'undo')
    assert.deepEqual(defaults(world.d1), [SHOP])
    await replay(world, a, 'redo')
    assert.deepEqual(defaults(world.d1), [WAREHOUSE])
  })

  await check('an undo that would leave no default branch at all is refused', async () => {
    const world = freshWorld({ withWarehouse: false })
    world.d1.db.prepare('UPDATE branches SET is_default = 0 WHERE id = 1').run()
    const a = await liveEdit(world, SHOP, { is_default: 1 })
    await assertConflict(replay(world, a, 'undo'), /no default branch/)
    assert.deepEqual(defaults(world.d1), [SHOP])
  })

  await check('control: an undo that leaves the default flag alone neither needs nor repairs a default elsewhere', async () => {
    const world = freshWorld()
    world.d1.db.prepare('UPDATE branches SET is_default = 0').run()
    const a = await liveEdit(world, WAREHOUSE, { phone: '099 999' })
    await replay(world, a, 'undo')
    assert.equal(read(world.d1, WAREHOUSE).phone, '012 222')
    assert.deepEqual(defaults(world.d1), [], 'a metadata undo does not invent a default')
  })

  await check('an older snapshot missing fields keeps those columns instead of blanking them', async () => {
    const world = freshWorld()
    const a = await liveEdit(world, SHOP, { location: 'A site' })
    // Pre-dates phone/notes in the payload: neither side records them.
    for (const column of ['undo_payload', 'redo_payload']) {
      const row = world.d1.db.prepare(`SELECT ${column} AS p FROM action_history WHERE id = ?`).get(a)
      const payload = JSON.parse(row.p)
      delete payload.fields.phone
      delete payload.fields.notes
      world.d1.db.prepare(`UPDATE action_history SET ${column} = ? WHERE id = ?`).run(JSON.stringify(payload), a)
    }
    await replay(world, a, 'undo')
    assert.deepEqual(read(world.d1, SHOP), { name: 'Shop', location: 'Old Market', phone: '012 111', manager: 'Dara', notes: 'front till', is_default: 1, is_active: 1 })
  })

  await check('a history row with no recorded result to compare against is refused, not replayed blind', async () => {
    const world = freshWorld()
    const a = await liveEdit(world, SHOP, { phone: '099 999' })
    world.d1.db.prepare("UPDATE action_history SET redo_payload = '{}' WHERE id = ?").run(a)
    await assertConflict(replay(world, a, 'undo'), /no recorded result/)
    assert.equal(read(world.d1, SHOP).phone, '099 999')
    await assertConflict(
      world.undoAppliers.resolveUndoApplier({ applier: 'branch.update' }).run(
        { applier: 'branch.update', id: SHOP, fields: formPayload(read(world.d1, SHOP)) },
        { env: {}, user: USER, direction: 'undo' },
      ),
      /no recorded result/,
    )
  })

  await check('retired branch descriptions undo and redo without restoring activation or old names', async () => {
    const world = freshWorld()
    world.d1.db.exec(`UPDATE branches SET name='Old Shop',role='shop',canonical_key='shop',is_active=0,is_default=0,successor_branch_id=2 WHERE id=1;
      UPDATE branches SET name='LC Store',role='shop',canonical_key='warehouse',is_default=1 WHERE id=2;`)
    const history = await liveEdit(world, SHOP, { notes: 'legacy description' })
    await replay(world, history, 'undo')
    assert.equal(read(world.d1, SHOP).notes, 'front till')
    await replay(world, history, 'redo')
    assert.equal(read(world.d1, SHOP).notes, 'legacy description')
    assert.equal(read(world.d1, SHOP).name, 'Old Shop')
    assert.equal(read(world.d1, SHOP).is_active, 0)
    assert.deepEqual(defaults(world.d1), [WAREHOUSE])
    await liveEdit(world, SHOP, { notes: 'later description' }, { record: false })
    await assertConflict(replay(world, history, 'undo'), /notes/)
    assert.equal(read(world.d1, SHOP).notes, 'later description')
  })

  console.log(`\n${passed} check(s) passed, ${failed.length} failed.`)
  if (failed.length) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
