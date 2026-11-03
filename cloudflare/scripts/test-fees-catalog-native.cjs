'use strict'
// The Expenses page's label and type catalogs (6.0.1053): an operator can ADD a label or a type, rename it, re-type it and
// archive it; nothing is deleted; every change is atomic with its audit rows; permissions are enforced by the Worker.
// Runs the REAL routes/fees.ts + routes/feesCatalog.ts over the full migration chain (harness/fees_world.cjs).
//
// The base (736929e91) could do none of the adds: GET /labels was a DISTINCT over fees.label, the types a fixed list.
// Mutation controls at the bottom: each plausible wrong implementation is patched into the source and must turn a check red.
//
// Run (from cloudflare/): node scripts/test-fees-catalog-native.cjs
const assert = require('node:assert/strict')
const { createFeesWorld } = require('./harness/fees_world.cjs')

let passed = 0
let quiet = false
async function check(name, run) { await run(); if (!quiet) { passed += 1; console.log(`PASS ${name}`) } }

function seedBranch(w) {
  w.sql.exec("INSERT INTO branches (id, name, role, is_active) VALUES (1, 'Store', 'shop', 1)")
}
function insertFee(w, row) {
  const fee = { fee_type: 'other', label: null, amount_usd: 1, amount_khr: 0, fee_date: '2026-10-10', branch_id: 1, created_at: '2026-10-10 03:00:00', updated_at: '2026-10-10 03:00:00', ...row }
  const info = w.sql.prepare(`INSERT INTO fees (fee_type, label, amount_usd, amount_khr, fee_date, branch_id, created_at, updated_at, created_by)
    VALUES (@fee_type, @label, @amount_usd, @amount_khr, @fee_date, @branch_id, @created_at, @updated_at, 2)`).run(fee)
  return Number(info.lastInsertRowid)
}
const auditRows = (w, where = '1=1', ...params) => w.all(`SELECT * FROM audit_logs WHERE ${where} ORDER BY id`, ...params)
const feeRow = (w, id) => w.get('SELECT * FROM fees WHERE id = ?', id)

async function scenarioTypes(w) {
  const U = w.users
  await check('types: five built-ins, nothing custom to start with', async () => {
    const r = await w.request('GET', '/api/fees/types', undefined, U.full)
    assert.equal(r.status, 200)
    assert.deepEqual(r.json.types.map((t) => t.value), ['tax', 'delivery', 'change', 'expense', 'other'])
    assert.ok(r.json.types.every((t) => t.builtin === true))
  })
  await check('types: an operator can ADD a type (the base had a fixed list of five)', async () => {
    const r = await w.request('POST', '/api/fees/types', { name: '  Shop   rent ' }, U.full)
    assert.equal(r.status, 201, JSON.stringify(r.json))
    assert.equal(r.json.name, 'Shop rent')
    const list = await w.request('GET', '/api/fees/types', undefined, U.full)
    assert.deepEqual(list.json.types.filter((t) => !t.builtin).map((t) => [t.name, t.id !== null, t.archived]), [['Shop rent', true, false]])
    const audit = auditRows(w, "entity = 'fee_type' AND action = 'create'")
    assert.equal(audit.length, 1)
    assert.equal(JSON.parse(audit[0].details).name, 'Shop rent')
    assert.equal(Number(audit[0].entity_id), list.json.types.find((t) => t.name === 'Shop rent').id, 'the audit row names the new type id')
  })
  await check('types: refusals add nothing (duplicate, built-in name, invalid)', async () => {
    const before = w.get('SELECT COUNT(*) n FROM fee_types').n
    const dup = await w.request('POST', '/api/fees/types', { name: 'SHOP RENT' }, U.full)
    assert.deepEqual([dup.status, dup.json.code], [409, 'type_exists'])
    const builtin = await w.request('POST', '/api/fees/types', { name: 'Tax' }, U.full)
    assert.deepEqual([builtin.status, builtin.json.code], [409, 'type_exists'])
    for (const name of ['', '   ', 'x'.repeat(41), 'bad\u0007name', 5, null]) {
      const bad = await w.request('POST', '/api/fees/types', { name }, U.full)
      assert.deepEqual([bad.status, bad.json.code], [400, 'type_name_invalid'], JSON.stringify(name))
    }
    assert.equal(w.get('SELECT COUNT(*) n FROM fee_types').n, before)
  })
  await check('types: an expense saves under the catalog spelling; a name the catalog does not know is refused (it used to save as "other")', async () => {
    const created = await w.request('POST', '/api/fees', { client_request_id: 'cat-type-0001', fee_type: 'shop RENT', label: 'Landlord', amount_usd: 100, fee_date: '2026-10-10', branch_id: 1 }, U.full)
    assert.equal(created.status, 201, JSON.stringify(created.json))
    assert.equal(created.json.fee.fee_type, 'Shop rent')
    const countBefore = w.get('SELECT COUNT(*) n FROM fees').n
    const unknown = await w.request('POST', '/api/fees', { client_request_id: 'cat-type-0002', fee_type: 'not a type', amount_usd: 1, fee_date: '2026-10-10', branch_id: 1 }, U.full)
    assert.deepEqual([unknown.status, unknown.json.code], [400, 'fee_type_unknown'], JSON.stringify(unknown.json))
    assert.equal(w.get('SELECT COUNT(*) n FROM fees').n, countBefore, 'nothing was written')
    const other = await w.request('POST', '/api/fees', { client_request_id: 'cat-type-0004', fee_type: 'Other', amount_usd: 1, fee_date: '2026-10-10', branch_id: 1 }, U.full)
    assert.deepEqual([other.status, other.json.fee.fee_type], [201, 'other'], 'the built-in other still saves')
    const blank = await w.request('POST', '/api/fees', { client_request_id: 'cat-type-0005', amount_usd: 1, fee_date: '2026-10-10', branch_id: 1 }, U.full)
    assert.deepEqual([blank.status, blank.json.fee.fee_type], [201, 'other'], 'no type at all still defaults to other, as before')
  })
  await check('types: rename rewrites the exact expenses, bumps their version, audits each one and the type', async () => {
    const id = Number(w.get("SELECT id FROM fees WHERE fee_type = 'Shop rent'").id)
    const labelRow = w.request('POST', '/api/fees/labels', { label: 'Landlord', fee_type: 'Shop rent' }, U.full)
    await labelRow
    const before = feeRow(w, id)
    const r = await w.request('POST', '/api/fees/types/rename', { from: 'shop rent', to: 'Premises' }, U.full)
    assert.equal(r.status, 200, JSON.stringify(r.json))
    assert.equal(r.json.changed, 1)
    const after = feeRow(w, id)
    assert.equal(after.fee_type, 'Premises')
    assert.notEqual(after.updated_at, before.updated_at, 'an open edit form now meets the normal write conflict')
    assert.equal(w.get("SELECT fee_type FROM fee_labels WHERE name = 'Landlord'").fee_type, 'Premises', 'a label default follows the rename')
    const rowAudit = auditRows(w, "entity = 'fee' AND entity_id = ? AND action = 'update'", String(id))
    assert.equal(rowAudit.length, 1)
    assert.deepEqual([JSON.parse(rowAudit[0].old_value), JSON.parse(rowAudit[0].new_value)], [{ fee_type: 'Shop rent' }, { fee_type: 'Premises' }])
    assert.equal(JSON.parse(rowAudit[0].details).via, 'type_rename')
    const summary = auditRows(w, "entity = 'fee_type' AND action = 'rename'")
    assert.deepEqual([JSON.parse(summary[0].details).from, JSON.parse(summary[0].details).to, JSON.parse(summary[0].details).changed], ['Shop rent', 'Premises', 1])
    // the expenses the rename did not name are untouched
    assert.equal(w.get("SELECT COUNT(*) n FROM fees WHERE fee_type = 'other'").n, 2, 'only the two built-in other expenses stay: the rename touched nothing else')
  })
  await check('types: rename refusals (built-in, unknown, clash with a type, clash with a legacy type) change nothing', async () => {
    insertFee(w, { fee_type: 'Legacy mix', label: 'Misc' })
    await w.request('POST', '/api/fees/types', { name: 'Utilities' }, U.full)
    const snapshot = JSON.stringify(w.all('SELECT * FROM fees ORDER BY id'))
    const cases = [
      [{ from: 'tax', to: 'Taxes' }, 400, 'type_builtin'],
      [{ from: 'Nope', to: 'Else' }, 404, 'type_not_found'],
      [{ from: 'Premises', to: 'utilities' }, 409, 'type_exists'],
      [{ from: 'Premises', to: 'Delivery' }, 409, 'type_exists'],
      [{ from: 'Premises', to: 'legacy MIX' }, 409, 'type_exists'],
      [{ from: 'Premises', to: '' }, 400, 'type_name_invalid'],
    ]
    for (const [body, status, code] of cases) {
      const r = await w.request('POST', '/api/fees/types/rename', body, U.full)
      assert.deepEqual([r.status, r.json.code], [status, code], JSON.stringify(body))
    }
    assert.equal(JSON.stringify(w.all('SELECT * FROM fees ORDER BY id')), snapshot)
  })
  await check('types: archive hides a type from new choices but keeps it on the expenses that carry it', async () => {
    const id = Number(w.get("SELECT id FROM fees WHERE fee_type = 'Premises'").id)
    const archived = await w.request('POST', '/api/fees/types/archive', { name: 'Premises' }, U.full)
    assert.deepEqual([archived.status, archived.json.archived], [200, true])
    assert.ok(!(await w.request('GET', '/api/fees/types', undefined, U.full)).json.types.some((t) => t.name === 'Premises'))
    assert.ok((await w.request('GET', '/api/fees/types?include_archived=1', undefined, U.full)).json.types.some((t) => t.name === 'Premises' && t.archived))
    const fresh = await w.request('POST', '/api/fees', { client_request_id: 'cat-type-0003', fee_type: 'Premises', amount_usd: 2, fee_date: '2026-10-10', branch_id: 1 }, U.full)
    assert.deepEqual([fresh.status, fresh.json.code], [400, 'fee_type_archived'], 'a NEW choice of an archived type is refused, not coerced to other')
    const row = feeRow(w, id)
    const kept = await w.request('PUT', `/api/fees/${id}`, { fee_type: 'Premises', label: 'Landlord', amount_usd: 100, expectedUpdatedAt: row.updated_at }, U.full)
    assert.equal(kept.status, 200, JSON.stringify(kept.json))
    assert.equal(kept.json.fee.fee_type, 'Premises', 'history stays editable')
    const filtered = await w.request('GET', '/api/fees?fee_type=premises', undefined, U.full)
    assert.deepEqual(filtered.json.fees.map((f) => f.id), [id], 'an archived type still filters')
    const addArchived = await w.request('POST', '/api/fees/types', { name: 'PREMISES' }, U.full)
    assert.deepEqual([addArchived.status, addArchived.json.code], [409, 'type_archived'], 'adding the name of an archived type says so (and the page has Khmer text for it)')
    const restored = await w.request('POST', '/api/fees/types/restore', { name: 'premises' }, U.full)
    assert.deepEqual([restored.status, restored.json.archived], [200, false])
    assert.deepEqual(auditRows(w, "entity = 'fee_type' AND action IN ('archive','restore')").map((a) => a.action), ['archive', 'restore'])
  })
  await check('types: ?uses=1 counts expenses and lists a legacy type the catalog does not know; adding it adopts it', async () => {
    const r = await w.request('GET', '/api/fees/types?uses=1', undefined, U.full)
    const legacy = r.json.types.find((t) => t.name === 'Legacy mix')
    assert.deepEqual([legacy.registered, legacy.uses, legacy.id], [false, 1, null])
    assert.equal(r.json.types.find((t) => t.name === 'Premises').uses, 1)
    const adopted = await w.request('POST', '/api/fees/types', { name: 'legacy mix' }, U.full)
    assert.equal(adopted.status, 201)
    assert.equal(feeRow(w, Number(w.get("SELECT id FROM fees WHERE label = 'Misc'").id)).fee_type, 'Legacy mix', 'adoption never rewrites a row')
  })
}

async function scenarioLabels(w) {
  const U = w.users
  await check('labels: ADD a label with no expense yet (the base listed only labels already on a row)', async () => {
    const r = await w.request('POST', '/api/fees/labels', { label: ' Packing   tape ', fee_type: 'expense' }, U.full)
    assert.equal(r.status, 201, JSON.stringify(r.json))
    assert.equal(r.json.label, 'Packing tape')
    const list = await w.request('GET', '/api/fees/labels', undefined, U.full)
    const entry = list.json.labels.find((l) => l.label === 'Packing tape')
    assert.deepEqual([entry.uses, entry.fee_type, entry.registered, entry.archived], [0, 'expense', true, false])
    const audit = auditRows(w, "entity = 'fee_label' AND action = 'create' AND details LIKE '%Packing tape%'")
    assert.equal(audit.length, 1)
    assert.equal(Number(audit[0].entity_id), entry.id)
  })
  await check('labels: refusals add nothing (duplicate, too long, empty, unknown or archived type)', async () => {
    const before = w.get('SELECT COUNT(*) n FROM fee_labels').n
    const cases = [
      [{ label: 'PACKING TAPE' }, 409, 'label_exists'],
      [{ label: 'one two three four five six seven' }, 400, 'label_too_long'],
      [{ label: 'x'.repeat(61) }, 400, 'label_too_long'],
      [{ label: '   ' }, 400, 'label_required'],
      [{ label: 'Fresh', fee_type: 'bogus' }, 400, 'fee_type_invalid'],
    ]
    for (const [body, status, code] of cases) {
      const r = await w.request('POST', '/api/fees/labels', body, U.full)
      assert.deepEqual([r.status, r.json.code], [status, code], JSON.stringify(body))
    }
    await w.request('POST', '/api/fees/types/archive', { name: 'Legacy mix' }, U.full)
    const archivedType = await w.request('POST', '/api/fees/labels', { label: 'Fresh', fee_type: 'Legacy mix' }, U.full)
    assert.deepEqual([archivedType.status, archivedType.json.code], [400, 'fee_type_invalid'])
    assert.match(archivedType.json.error, /archived or does not exist/)
    await w.request('POST', '/api/fees/types/restore', { name: 'Legacy mix' }, U.full)
    assert.equal(w.get('SELECT COUNT(*) n FROM fee_labels').n, before)
  })
  await check('labels: a label that exists only on expenses is registered, not duplicated, and no row is touched', async () => {
    const id = insertFee(w, { label: 'Ice', fee_type: 'expense' })
    const before = JSON.stringify(feeRow(w, id))
    const r = await w.request('POST', '/api/fees/labels', { label: 'ice' }, U.full)
    assert.deepEqual([r.status, r.json.uses], [201, 1])
    assert.equal(JSON.stringify(feeRow(w, id)), before)
    const entries = (await w.request('GET', '/api/fees/labels', undefined, U.full)).json.labels.filter((l) => l.label.toLowerCase() === 'ice')
    assert.equal(entries.length, 1)
    assert.equal(entries[0].label, 'ice', 'the registered spelling is what the operator typed')
  })
  await check('labels: rename moves the expenses, keeps the catalog row (same id) and audits every changed expense', async () => {
    const a = insertFee(w, { label: 'Boxes', fee_type: 'expense' })
    const b = insertFee(w, { label: 'boxes', fee_type: 'expense' })
    const c = insertFee(w, { label: 'Boxes extra', fee_type: 'expense' })
    await w.request('POST', '/api/fees/labels', { label: 'Boxes' }, U.full)
    const idBefore = w.get("SELECT id FROM fee_labels WHERE name = 'Boxes'").id
    const r = await w.request('POST', '/api/fees/labels/replace', { from: 'BOXES', to: 'Cartons' }, U.full)
    assert.deepEqual([r.status, r.json.changed, r.json.merged, r.json.label], [200, 2, false, 'Cartons'], JSON.stringify(r.json))
    assert.deepEqual([feeRow(w, a).label, feeRow(w, b).label, feeRow(w, c).label], ['Cartons', 'Cartons', 'Boxes extra'])
    assert.equal(w.get("SELECT id FROM fee_labels WHERE name = 'Cartons'").id, idBefore, 'a rename keeps the catalog identity')
    assert.equal(w.get("SELECT COUNT(*) n FROM fee_labels WHERE lower(name) = 'boxes'").n, 0)
    for (const id of [a, b]) {
      const rows = auditRows(w, "entity = 'fee' AND entity_id = ? AND action = 'update'", String(id))
      assert.equal(rows.length, 1, `expense ${id} has its own record`)
      assert.equal(JSON.parse(rows[0].new_value).label, 'Cartons')
      assert.equal(JSON.parse(rows[0].details).via, 'label_rename')
    }
    assert.equal(auditRows(w, "entity = 'fee' AND entity_id = ?", String(c)).length, 0, 'a different label is not recorded')
    const summary = auditRows(w, "entity = 'fee_label' AND action = 'replace'")
    assert.deepEqual([JSON.parse(summary.at(-1).details).from, JSON.parse(summary.at(-1).details).to, JSON.parse(summary.at(-1).details).changed], ['Boxes', 'Cartons', 2])
    const labels = (await w.request('GET', '/api/fees/labels', undefined, U.full)).json.labels
    assert.ok(labels.some((l) => l.label === 'Cartons' && l.uses === 2) && !labels.some((l) => l.label === 'Boxes'))
  })
  await check('labels: merging into an existing label stores THAT label\'s spelling and archives the source', async () => {
    const id = insertFee(w, { label: 'Wraps', fee_type: 'expense' })
    const r = await w.request('POST', '/api/fees/labels/replace', { from: 'Wraps', to: 'PACKING TAPE' }, U.full)
    assert.deepEqual([r.status, r.json.merged, r.json.label], [200, true, 'Packing tape'], JSON.stringify(r.json))
    assert.equal(feeRow(w, id).label, 'Packing tape')
    assert.ok(w.get("SELECT archived_at FROM fee_labels WHERE name = 'Wraps'").archived_at, 'the merged-away label is archived, never deleted')
  })
  await check('labels: merging into a label used only by expenses (not registered) works the same', async () => {
    insertFee(w, { label: 'Charcoal', fee_type: 'expense' })
    const id = insertFee(w, { label: 'Coal', fee_type: 'expense' })
    const r = await w.request('POST', '/api/fees/labels/replace', { from: 'Coal', to: 'charcoal' }, U.full)
    assert.deepEqual([r.status, r.json.merged], [200, true])
    assert.equal(feeRow(w, id).label, 'Charcoal')
  })
  await check('labels: a case-only rename is a rename (it fixes capitals)', async () => {
    insertFee(w, { label: 'tea', fee_type: 'expense' })
    const r = await w.request('POST', '/api/fees/labels/replace', { from: 'tea', to: 'Tea' }, U.full)
    assert.deepEqual([r.status, r.json.merged, r.json.label, r.json.changed], [200, false, 'Tea', 1])
  })
  await check('labels: renames onto an archived label, to a long label, from a missing label are refused and change nothing', async () => {
    await w.request('POST', '/api/fees/labels/archive', { label: 'Tea' }, U.full)
    insertFee(w, { label: 'Sugar', fee_type: 'expense' })
    const snapshot = JSON.stringify(w.all('SELECT * FROM fees ORDER BY id'))
    const auditCount = w.get('SELECT COUNT(*) n FROM audit_logs').n
    const cases = [
      [{ from: 'Sugar', to: 'tea' }, 409, 'label_archived'],
      [{ from: 'Sugar', to: 'a b c d e f g' }, 400, 'label_too_long'],
      [{ from: 'Ghost', to: 'Spirit' }, 404, 'label_not_found'],
    ]
    for (const [body, status, code] of cases) {
      const r = await w.request('POST', '/api/fees/labels/replace', body, U.full)
      assert.deepEqual([r.status, r.json.code], [status, code], JSON.stringify(body))
    }
    assert.equal(JSON.stringify(w.all('SELECT * FROM fees ORDER BY id')), snapshot)
    assert.equal(w.get('SELECT COUNT(*) n FROM audit_logs').n, auditCount)
  })
  await check('labels: classify re-types every exact match, records each, remembers the default; archived and unknown types are refused', async () => {
    const a = insertFee(w, { label: 'Bike courier', fee_type: 'expense' })
    const b = insertFee(w, { label: 'Bike courier', fee_type: 'delivery' })
    const r = await w.request('POST', '/api/fees/labels/classify', { label: 'bike courier', fee_type: 'delivery' }, U.full)
    assert.deepEqual([r.status, r.json.changed, r.json.fee_type], [200, 1, 'delivery'], JSON.stringify(r.json))
    assert.deepEqual([feeRow(w, a).fee_type, feeRow(w, b).fee_type], ['delivery', 'delivery'])
    assert.equal(auditRows(w, "entity = 'fee' AND entity_id = ? AND action = 'update'", String(a)).length, 1)
    assert.equal(auditRows(w, "entity = 'fee' AND entity_id = ?", String(b)).length, 0, 'an expense that did not change has no record')
    assert.equal(w.get("SELECT fee_type FROM fee_labels WHERE name = 'Bike courier'").fee_type, 'delivery')
    const bad = await w.request('POST', '/api/fees/labels/classify', { label: 'Bike courier', fee_type: 'bogus' }, U.full)
    assert.deepEqual([bad.status, bad.json.code], [400, 'fee_type_invalid'], 'a classify refusal carries a code the page can translate')
    assert.match(bad.json.error, /archived or does not exist/, 'and the sentence covers an archived or unknown type, not a length')
    const noLabel = await w.request('POST', '/api/fees/labels/classify', { label: '  ', fee_type: 'tax' }, U.full)
    assert.deepEqual([noLabel.status, noLabel.json.code], [400, 'label_required'])
    await w.request('POST', '/api/fees/types/archive', { name: 'Utilities' }, U.full)
    const archivedType = await w.request('POST', '/api/fees/labels/classify', { label: 'Bike courier', fee_type: 'Utilities' }, U.full)
    assert.deepEqual([archivedType.status, archivedType.json.code], [400, 'fee_type_invalid'])
    await w.request('POST', '/api/fees/types/restore', { name: 'Utilities' }, U.full)
    const custom = await w.request('POST', '/api/fees/labels/classify', { label: 'Bike courier', fee_type: 'utilities' }, U.full)
    assert.deepEqual([custom.status, custom.json.fee_type, feeRow(w, a).fee_type], [200, 'Utilities', 'Utilities'])
  })
  await check('labels: archive hides a label from the default list and restore brings it back; expenses never change', async () => {
    const id = insertFee(w, { label: 'Soap', fee_type: 'expense' })
    const before = JSON.stringify(feeRow(w, id))
    const archived = await w.request('POST', '/api/fees/labels/archive', { label: 'soap' }, U.full)
    assert.deepEqual([archived.status, archived.json.archived], [200, true])
    assert.ok(!(await w.request('GET', '/api/fees/labels', undefined, U.full)).json.labels.some((l) => l.label === 'Soap'))
    assert.ok((await w.request('GET', '/api/fees/labels?include_archived=1', undefined, U.full)).json.labels.some((l) => l.label === 'Soap' && l.archived && l.uses === 1))
    assert.equal(JSON.stringify(feeRow(w, id)), before)
    const again = await w.request('POST', '/api/fees/labels/archive', { label: 'Soap' }, U.full)
    assert.equal(again.json.changed, 0, 'archiving twice records nothing')
    const restored = await w.request('POST', '/api/fees/labels/restore', { label: 'Soap' }, U.full)
    assert.deepEqual([restored.json.archived, restored.json.changed], [false, 1])
    assert.ok((await w.request('GET', '/api/fees/labels', undefined, U.full)).json.labels.some((l) => l.label === 'Soap'))
    assert.deepEqual(auditRows(w, "entity = 'fee_label' AND action IN ('archive','restore') AND details LIKE '%Soap%'").map((a) => a.action), ['archive', 'restore'])
    const missing = await w.request('POST', '/api/fees/labels/archive', { label: 'Never used' }, U.full)
    assert.deepEqual([missing.status, missing.json.code], [404, 'label_not_found'])
  })
  await check('labels: an archived type no longer supplies a default; the dominant type on the expenses does', async () => {
    await w.request('POST', '/api/fees/labels', { label: 'Lease', fee_type: 'Utilities' }, U.full)
    assert.equal((await w.request('GET', '/api/fees/labels', undefined, U.full)).json.labels.find((l) => l.label === 'Lease').fee_type, 'Utilities')
    await w.request('POST', '/api/fees/types/archive', { name: 'Utilities' }, U.full)
    assert.equal((await w.request('GET', '/api/fees/labels', undefined, U.full)).json.labels.find((l) => l.label === 'Lease').fee_type, 'other')
    await w.request('POST', '/api/fees/types/restore', { name: 'Utilities' }, U.full)
  })
}

// B2 (review of b90dbca6d): a type renamed after a form was opened, a stale draft or a retried request must be REFUSED, never booked as "other".
async function scenarioStaleType(patches = []) {
  const w = createFeesWorld({ patches })
  seedBranch(w)
  const U = w.users
  await check('B2: add Rent, rename it to Premises, then POST "Rent": 400 fee_type_unknown and nothing is written', async () => {
    assert.equal((await w.request('POST', '/api/fees/types', { name: 'Rent' }, U.full)).status, 201)
    const first = await w.request('POST', '/api/fees', { client_request_id: 'stale-0001', fee_type: 'Rent', amount_usd: 300, fee_date: '2026-10-10', branch_id: 1 }, U.full)
    assert.deepEqual([first.status, first.json.fee.fee_type], [201, 'Rent'])
    assert.equal((await w.request('POST', '/api/fees/types/rename', { from: 'Rent', to: 'Premises' }, U.full)).status, 200)
    const snapshot = JSON.stringify([w.all('SELECT * FROM fees ORDER BY id'), w.all('SELECT * FROM fee_operation_receipts ORDER BY 1'), w.get('SELECT COUNT(*) n FROM audit_logs').n])
    const stale = await w.request('POST', '/api/fees', { client_request_id: 'stale-0002', fee_type: 'Rent', amount_usd: 300, fee_date: '2026-10-11', branch_id: 1 }, U.full)
    assert.deepEqual([stale.status, stale.json.code], [400, 'fee_type_unknown'], JSON.stringify(stale.json))
    assert.match(stale.json.error, /renamed/)
    assert.equal(JSON.stringify([w.all('SELECT * FROM fees ORDER BY id'), w.all('SELECT * FROM fee_operation_receipts ORDER BY 1'), w.get('SELECT COUNT(*) n FROM audit_logs').n]), snapshot, 'no expense, no receipt, no audit row')
    assert.equal(w.get("SELECT COUNT(*) n FROM fees WHERE fee_type = 'other'").n, 0, 'nothing was booked as other')
    const retry = await w.request('POST', '/api/fees', { client_request_id: 'stale-0002', fee_type: 'Premises', amount_usd: 300, fee_date: '2026-10-11', branch_id: 1 }, U.full)
    assert.deepEqual([retry.status, retry.json.fee.fee_type], [201, 'Premises'], 'the same request with the current name saves')
  })
  await check('B2: an edit that names a stale type is refused; an expense keeps the type it already has, also an unregistered legacy one', async () => {
    const id = Number(w.get("SELECT id FROM fees WHERE fee_type = 'Premises' ORDER BY id LIMIT 1").id)
    const row = feeRow(w, id)
    const stale = await w.request('PUT', `/api/fees/${id}`, { fee_type: 'Rent', amount_usd: 301, expectedUpdatedAt: row.updated_at }, U.full)
    assert.deepEqual([stale.status, stale.json.code], [400, 'fee_type_unknown'])
    assert.equal(feeRow(w, id).amount_usd, 300, 'the refused edit changed nothing')
    const legacy = insertFee(w, { fee_type: 'Old import type', label: 'Misc', amount_usd: 4 })
    const legacyRow = feeRow(w, legacy)
    const same = await w.request('PUT', `/api/fees/${legacy}`, { fee_type: 'old IMPORT type', label: 'Misc 2', amount_usd: 5, expectedUpdatedAt: legacyRow.updated_at }, U.full)
    assert.deepEqual([same.status, same.json.fee.fee_type, same.json.fee.label], [200, 'Old import type', 'Misc 2'], 'an edit that leaves the type alone no longer turns a legacy type into other')
    const other = await w.request('PUT', `/api/fees/${legacy}`, { fee_type: 'Nonsense', expectedUpdatedAt: feeRow(w, legacy).updated_at }, U.full)
    assert.deepEqual([other.status, other.json.code], [400, 'fee_type_unknown'])
  })
  await check('B2: a stale type in a list filter finds nothing; it no longer shows the other expenses', async () => {
    insertFee(w, { fee_type: 'other', label: 'Plain' })
    const stale = await w.request('GET', '/api/fees?fee_type=Rent', undefined, U.full)
    assert.deepEqual([stale.status, stale.json.total], [200, 0])
    assert.ok((await w.request('GET', '/api/fees?fee_type=other', undefined, U.full)).json.total >= 1)
  })
  await check('B2: a label default or a classify naming a stale type is refused with a code', async () => {
    for (const [url, body] of [['/api/fees/labels', { label: 'Fresh', fee_type: 'Rent' }], ['/api/fees/labels/classify', { label: 'Misc 2', fee_type: 'Rent' }]]) {
      const r = await w.request('POST', url, body, U.full)
      assert.deepEqual([r.status, r.json.code], [400, 'fee_type_invalid'], url)
    }
  })
}

// N7 (review): a label saved with a double space, a tab or edge spaces lists once and must answer to rename, classify and archive (they used to 404:
// the list folded the spaces in JS while the SQL match did not). N5: every act on a label, also on one only expenses knew, is recorded under the
// label's own catalog id. N8: the device on the per-expense rows is the one that sent the request, not the freshest session.
async function scenarioOldSpacing(patches = []) {
  const w = createFeesWorld({ patches })
  seedBranch(w)
  const U = w.users
  const spaced = (label, extra = {}) => insertFee(w, { fee_type: 'expense', label, ...extra })
  await check('N7: labels with double, edge, tab and no-break spaces list as ONE entry with the collapsed spelling', async () => {
    spaced('Wax  paper'); spaced('wax paper'); spaced('  Wax paper '); spaced('Wax\tpaper'); spaced('Wax\u00a0paper')
    const entries = (await w.request('GET', '/api/fees/labels', undefined, U.full)).json.labels.filter((l) => l.label.toLowerCase().replace(/\s+/g, ' ') === 'wax paper')
    assert.equal(entries.length, 1, JSON.stringify(entries))
    assert.deepEqual([entries[0].uses, /\s{2}|^\s|\s$|\t|\u00a0/.test(entries[0].label)], [5, false])
    const impact = (await w.request('GET', '/api/fees/labels/impact?from=Wax%20%20paper&to=Parchment', undefined, U.full)).json
    assert.equal(impact.linked_records, 5, 'the preview counts every spelling')
  })
  await check('N7: rename moves every spelling (and audits each one that changed); an expense already spelled right is not rewritten', async () => {
    const r = await w.request('POST', '/api/fees/labels/replace', { from: 'Wax  paper', to: 'Parchment' }, U.full)
    assert.deepEqual([r.status, r.json.changed, r.json.merged, r.json.label], [200, 5, false, 'Parchment'], JSON.stringify(r.json))
    assert.equal(w.get("SELECT COUNT(*) n FROM fees WHERE label = 'Parchment'").n, 5)
    assert.equal(auditRows(w, "entity = 'fee' AND details LIKE '%label_rename%'").length, 5)
  })
  await check('N7: archive and classify answer to a double-spaced label; the catalog row is registered under the collapsed name', async () => {
    const a = spaced('Foam   sheet'); spaced('foam sheet', { fee_type: 'delivery' })
    const archived = await w.request('POST', '/api/fees/labels/archive', { label: 'Foam sheet' }, U.full)
    assert.deepEqual([archived.status, archived.json.archived, archived.json.label], [200, true, 'Foam sheet'], JSON.stringify(archived.json))
    assert.equal(w.get("SELECT name FROM fee_labels WHERE name_key = 'foam sheet'").name, 'Foam sheet')
    assert.ok((await w.request('GET', '/api/fees/labels?include_archived=1', undefined, U.full)).json.labels.some((l) => l.label === 'Foam sheet' && l.archived && l.uses === 2))
    await w.request('POST', '/api/fees/labels/restore', { label: 'foam sheet' }, U.full)
    const c = await w.request('POST', '/api/fees/labels/classify', { label: 'Foam  sheet', fee_type: 'tax' }, U.full)
    assert.deepEqual([c.status, c.json.changed], [200, 2])
    assert.equal(feeRow(w, a).fee_type, 'tax')
  })
  await check('N7: the key in JS and in SQL are one function (random whitespace, case and accents)', async () => {
    const { feeNameKey, feeNameKeySql } = w.load('routes/fees.ts')
    const samples = ['Tape', '  tape ', 'TAPE  ROLL', 'a\tb', 'a\nb', 'a\r\n b', 'a\u00a0\u00a0b', '\u00a0edge\u00a0', 'Caf\u00e9 \u00c9', 'x'.padEnd(60, ' ') + 'y', '', ' ', 'a' + ' '.repeat(100) + 'b']
    for (const text of samples) {
      const viaSql = w.sql.prepare('SELECT ' + feeNameKeySql('?') + ' AS k').get(text).k
      assert.equal(viaSql, feeNameKey(text), JSON.stringify(text))
    }
  })
  await check('N5: acts on a label only expenses knew are recorded under the new catalog row id (no entity_id NULL)', async () => {
    spaced('Glue'); spaced('Twine'); spaced('Rope'); spaced('Cord'); spaced('Cord')
    await w.request('POST', '/api/fees/labels/archive', { label: 'Glue' }, U.full)
    await w.request('POST', '/api/fees/labels/restore', { label: 'Glue' }, U.full)
    await w.request('POST', '/api/fees/labels/classify', { label: 'Twine', fee_type: 'tax' }, U.full)
    await w.request('POST', '/api/fees/labels/replace', { from: 'Rope', to: 'Hemp' }, U.full)
    await w.request('POST', '/api/fees/labels/replace', { from: 'Cord', to: 'Glue' }, U.full)
    const id = (name) => Number(w.get('SELECT id FROM fee_labels WHERE name = ?', name).id)
    const forLabel = (name) => auditRows(w, "entity = 'fee_label' AND entity_id = ?", String(id(name))).map((a) => a.action)
    assert.deepEqual(forLabel('Glue'), ['archive', 'restore'], 'archive then restore of Glue')
    assert.deepEqual(forLabel('Twine'), ['classify'])
    assert.deepEqual(forLabel('Hemp'), ['replace'], 'the rename is recorded under the row that now carries the new name')
    const cord = Number(w.get("SELECT id FROM fee_labels WHERE name_key = 'cord'").id)
    assert.deepEqual(auditRows(w, "entity = 'fee_label' AND entity_id = ?", String(cord)).map((a) => a.action), ['replace'], 'a merge is recorded under the archived source row')
    assert.equal(w.get("SELECT COUNT(*) n FROM audit_logs WHERE entity = 'fee_label' AND entity_id IS NULL").n, 0, 'no label act is recorded without its entity')
    assert.equal(w.get("SELECT COUNT(*) n FROM audit_logs WHERE entity = 'fee_label' AND record_id IS NULL").n, 0)
  })
  await check('N8: the device on the per-expense rows is the one that sent THIS request, not the freshest session', async () => {
    w.sql.prepare("INSERT INTO user_sessions (user_id, token_hash, device_name, device_tz, last_seen_at, expires_at) VALUES (?, 'h', 'Old phone', 'UTC', '2099-01-01 00:00:00', '2100-01-01')").run(U.full.id)
    const hookKey = Symbol.for('business-os.request-device.v1')
    const id = spaced('Sponge')
    try {
      globalThis[hookKey] = { current: () => ({ userId: U.full.id, deviceName: 'Counter tablet', deviceTz: 'Asia/Phnom_Penh' }) }
      const r = await w.request('POST', '/api/fees/labels/replace', { from: 'Sponge', to: 'Scourer' }, U.full)
      assert.equal(r.status, 200, JSON.stringify(r.json))
      const row = auditRows(w, "entity = 'fee' AND entity_id = ?", String(id))[0]
      assert.deepEqual([row.device_name, row.device_tz], ['Counter tablet', 'Asia/Phnom_Penh'])
      const summary = auditRows(w, "entity = 'fee_label' AND action = 'replace'").at(-1)
      assert.deepEqual([summary.device_name, summary.device_tz], ['Counter tablet', 'Asia/Phnom_Penh'], 'the same device as the label row')
      globalThis[hookKey] = { current: () => ({ userId: U.admin.id, deviceName: 'Someone else', deviceTz: 'UTC' }) }
      const id2 = spaced('Brush')
      await w.request('POST', '/api/fees/labels/replace', { from: 'Brush', to: 'Bristle' }, U.full)
      assert.equal(auditRows(w, "entity = 'fee' AND entity_id = ?", String(id2))[0].device_name, 'Old phone', 'a request of another account does not lend its device (the old fallback)')
    } finally {
      delete globalThis[hookKey]
    }
  })
}

const MANAGE_CALLS = [
  ['POST', '/api/fees/types', { name: 'Perm type' }],
  ['POST', '/api/fees/types/rename', { from: 'Utilities', to: 'Perm rename' }],
  ['POST', '/api/fees/types/archive', { name: 'Utilities' }],
  ['POST', '/api/fees/types/restore', { name: 'Utilities' }],
  ['POST', '/api/fees/labels', { label: 'Perm label' }],
  ['POST', '/api/fees/labels/replace', { from: 'Sugar', to: 'Perm label' }],
  ['POST', '/api/fees/labels/classify', { label: 'Sugar', fee_type: 'tax' }],
  ['POST', '/api/fees/labels/archive', { label: 'Sugar' }],
  ['POST', '/api/fees/labels/restore', { label: 'Sugar' }],
]

async function scenarioPermissions(w) {
  const U = w.users
  const fingerprint = () => JSON.stringify([w.all('SELECT * FROM fees ORDER BY id'), w.all('SELECT * FROM fee_labels ORDER BY id'), w.all('SELECT * FROM fee_types ORDER BY id'), w.get('SELECT COUNT(*) n FROM audit_logs').n])
  await check('permissions: every catalog write is refused (403, nothing changed) without fees:edit, without fees, and signed out', async () => {
    const before = fingerprint()
    for (const user of [U.noEdit, U.nothing, null]) {
      for (const [method, url, body] of MANAGE_CALLS) {
        const r = await w.request(method, url, body, user)
        assert.equal(r.status, user === null ? 401 : 403, `${user?.username ?? 'anonymous'} ${method} ${url}`)
      }
    }
    assert.equal(fingerprint(), before)
  })
  await check('permissions: reads need fees:view; the catalog reads are refused without it', async () => {
    for (const url of ['/api/fees/types', '/api/fees/labels', '/api/fees/labels/impact?from=a&to=b', '/api/fees/types/impact?name=a']) {
      assert.equal((await w.request('GET', url, undefined, U.noView)).status, 403, url)
      assert.equal((await w.request('GET', url, undefined, U.nothing)).status, 403, url)
      assert.equal((await w.request('GET', url, undefined, U.noEdit)).status === 403, false, `${url}: fees:view without edit may read`)
    }
  })
  await check('permissions: Review Required and admin can manage (every non-delete fees write applies directly)', async () => {
    for (const user of [U.review, U.admin]) {
      const r = await w.request('POST', '/api/fees/types', { name: `T ${user.username}` }, user)
      assert.equal(r.status, 201, user.username)
    }
  })
}

// The previous schema (migration 0292 not applied yet): this Worker must still serve the five types and the labels on expenses,
// save an expense under a built-in type and refuse any other name (there is no custom type before the migration).
async function scenarioBeforeMigration() {
  const w = createFeesWorld({ through: 291 })
  seedBranch(w)
  const U = w.users
  await check('before migration 0292: types, labels and the list answer; an unknown type is refused; the sale rows still work', async () => {
    assert.equal(w.get("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('fee_types','fee_labels')").n, 0)
    const types = await w.request('GET', '/api/fees/types?uses=1', undefined, U.full)
    assert.deepEqual([types.status, types.json.types.map((t) => t.value)], [200, ['tax', 'delivery', 'change', 'expense', 'other']])
    insertFee(w, { label: 'Tape', fee_type: 'expense' })
    const labels = await w.request('GET', '/api/fees/labels', undefined, U.full)
    assert.deepEqual([labels.status, labels.json.labels.map((l) => [l.label, l.uses, l.registered])], [200, [['Tape', 1, false]]])
    const created = await w.request('POST', '/api/fees', { client_request_id: 'pre-0292-0001', fee_type: 'Rent', amount_usd: 1, fee_date: '2026-10-10', branch_id: 1 }, U.full)
    assert.deepEqual([created.status, created.json.code], [400, 'fee_type_unknown'])
    assert.equal((await w.request('GET', '/api/fees?fee_type=Rent', undefined, U.full)).status, 200)
    const builtin = await w.request('POST', '/api/fees', { client_request_id: 'pre-0292-0002', fee_type: 'tax', amount_usd: 1, fee_date: '2026-10-10', branch_id: 1 }, U.full)
    assert.deepEqual([builtin.status, builtin.json.fee.fee_type], [201, 'tax'])
    assert.equal((await w.request('GET', '/api/fees?source=all&from=2026-10-01&to=2026-10-31', undefined, U.full)).status, 200)
  })
}

(async () => {
  await scenarioBeforeMigration()
  const w = createFeesWorld()
  seedBranch(w)
  await scenarioTypes(w)
  await scenarioLabels(w)
  await scenarioPermissions(w)
  await scenarioStaleType()
  await scenarioOldSpacing()

  // ---- mutation controls: the plausible wrong implementations must turn a check red --------------------------------
  const mutants = [
    ['rename forgets the per-expense audit row', { file: 'src/routes/feesCatalog.ts', from: "    feeRowsAuditStatement(user, 'label', merge ? 'label_merge' : 'label_rename', toName, rows.auditWhere, { fromKey, toName }),\n", to: '' }],
    ['a rename matches by prefix, so "Boxes extra" moves too', { file: 'src/routes/feesCatalog.ts', from: "const rows = { where: `${LABEL_KEY_SQL} = @fromKey AND", to: "const rows = { where: `${LABEL_KEY_SQL} LIKE @fromKey || '%' AND" }],
    ['the permission gate is dropped from type add', { file: 'src/routes/feesCatalog.ts', from: "app.post('/types', async (c) => {\n  const user = c.get('user')\n  if (!canManage(user)) return c.json(NO_PERMISSION, 403)", to: "app.post('/types', async (c) => {\n  const user = c.get('user')" }],
    ['an archived type is silently coerced to other instead of refused', { file: 'src/routes/fees.ts', from: "  return { ok: false, code: 'fee_type_archived' }", to: "  return { ok: true, type: 'other' }" }],
    ['a built-in name can be added as a custom type', { file: 'src/routes/feesCatalog.ts', from: "if ((FEE_TYPES as readonly string[]).includes(key)) return fail(c, 409, 'type_exists', 'That is a built-in expense type.')\n  const existing", to: "const existing" }],
    ['an unknown type is saved as other again (a renamed type is booked under the wrong type)', { file: 'src/routes/fees.ts', from: ": { ok: false, code: 'fee_type_unknown' }", to: ": { ok: true, type: 'other' }" }],
    ['an edit that leaves a legacy type alone turns it into other', { file: 'src/routes/fees.ts', from: "return current != null && feeNameKey(current) === feeNameKey(text) ? { ok: true, type: current as FeeType } : ", to: 'return ' }],
    ['the label key forgets repeated whitespace (old double-spaced labels answer 404 again)', { file: 'src/routes/feesCatalog.ts', from: "const LABEL_KEY_SQL = feeNameKeySql('label')\n", to: "const LABEL_KEY_SQL = \"lower(trim(COALESCE(label,'')))\"\n" }],
    ['the per-expense audit row takes the freshest session instead of the request device', { file: 'src/routes/feesCatalog.ts', from: 'a_request_user_id: device ? device.userId : null,', to: 'a_request_user_id: null,' }],
    ['a classify of an unregistered label is recorded without its entity id', { file: 'src/routes/feesCatalog.ts', from: "'classify', 'fee_label', null, { label: name, fee_type: feeType, changed: changing }, undefined, labelEntityIn(key)),", to: "'classify', 'fee_label', null, { label: name, fee_type: feeType, changed: changing })," }],
    ['archive hard-deletes the label row', { file: 'src/routes/feesCatalog.ts', from: "{ sql: 'UPDATE fee_labels SET archived_at = @archivedAt, updated_at = @now WHERE name_key = @key', params: { archivedAt: archiving ? now : null, now, key } },", to: "{ sql: 'DELETE FROM fee_labels WHERE name_key = @key AND @archivedAt IS NOT NULL', params: { archivedAt: archiving ? now : null, now, key } }," }],
  ]
  quiet = true
  for (const [name, patch] of mutants) {
    let red = false
    try {
      const m = createFeesWorld({ patches: [patch] })
      seedBranch(m)
      await scenarioTypes(m)
      await scenarioLabels(m)
      await scenarioPermissions(m)
      await scenarioStaleType([patch])
      await scenarioOldSpacing([patch])
    } catch {
      red = true
    }
    quiet = false
    assert.ok(red, `mutant survived: ${name}`)
    passed += 1
    console.log(`PASS mutant killed: ${name}`)
    quiet = true
  }
  quiet = false
  console.log(`\n${passed} catalog checks passed.`)
})().catch((error) => { console.error(error); process.exit(1) })
