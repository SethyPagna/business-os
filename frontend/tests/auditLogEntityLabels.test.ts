// The Audit Log's record-type vocabulary, pinned against the entities that
// actually write a before/after row.
//
// The owner, Sep 22 2026: "...as well as in the actual audit log, all +
// filters + sections etc... like sales do before and after, by who etc..."
//
// Three failure modes this file exists to catch, all of which were live before
// this lane:
//
//   1. A record type that writes before/after but that the page cannot NAME.
//      Entities were rendered by Title-Casing the raw column, so the Khmer
//      pack showed "Delivery Contact" on the one control whose whole job is
//      letting someone pick the kind of record they are looking for.
//   2. A record type that writes before/after but whose pair does not RENDER.
//      Each entity below gets a real fixture row -- built from the column list
//      its Worker route actually audits -- through the real diff builder and
//      the real adapter. Nothing here is assumed from the entity name.
//   3. A record type that carries NO pair. Those still appear in the filter,
//      so they still need a name, and their detail float must show the row
//      with no change table rather than an empty screen.
//
// The drift guard is the last case: if a new Worker file starts writing
// before/after, this test fails until its entity is named and given a fixture
// here, so the page cannot silently acquire a record type it has no word for.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { AUDIT_ENTITY_LABELS, auditEntityLabel, titleCaseIdentifier } from '../src/utils/auditVocabulary.ts'
import { ENTITY_RECORDS_ADAPTER, auditRowsToRecords } from '../src/utils/entityRecords.ts'

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
const label = (key: string, fallback: string): string => (typeof en[key] === 'string' ? en[key] : fallback)
const labelKm = (key: string, fallback: string): string => (typeof km[key] === 'string' ? km[key] : fallback)

/**
 * Code only. A file that NAMES changedFields() in a comment is describing the
 * helper, not calling it; counting prose would make the drift guard fire on
 * documentation and train the next reader to widen the allow-list.
 */
const stripComments = (source: string): string => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n')

let failed = 0
const test = (name: string, fn: () => void): void => {
  try { fn(); console.log(`PASS ${name}`) }
  catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const ctx = {
  label,
  t: (key: string) => en[key] || key,
  fmtUSD: (value: number | string) => `$${Number(value).toFixed(2)}`,
  fmtKHR: (value: number | string) => `${value}៛`,
}

const recordFor = (entity: string, before: unknown, after: unknown) => auditRowsToRecords([{
  id: 1,
  action: 'update',
  entity,
  user_name: 'dara',
  created_at: '2026-09-22 08:00:00',
  old_value: before === null ? null : JSON.stringify(before),
  new_value: after === null ? null : JSON.stringify(after),
}])[0]

/**
 * Every audit_logs entity that carries a before/after pair, the Worker file
 * that writes it, and a fixture built from a column that file genuinely
 * audits (products.ts PRODUCT_FIELD_AUDIT_COLUMNS, fees.ts FEE_AUDIT_COLUMNS,
 * contacts.ts contactDiffKeys, returns.ts returnUpdateValues, promotions.ts
 * the rule input, users.ts the user/role diffs, settings.ts the key list).
 */
const BEFORE_AFTER: Array<{
  entity: string
  writtenBy: string
  before: Record<string, unknown>
  after: Record<string, unknown>
  /** A label that must appear once the pair is rendered. */
  expects: string
}> = [
  { entity: 'product', writtenBy: 'products.ts', before: { selling_price_usd: 3 }, after: { selling_price_usd: 4 }, expects: en.label_selling_price },
  { entity: 'customer', writtenBy: 'contacts.ts', before: { phone: '012' }, after: { phone: '011' }, expects: en.phone },
  { entity: 'supplier', writtenBy: 'contacts.ts', before: { address: 'Zone A' }, after: { address: 'Zone B' }, expects: en.address },
  { entity: 'delivery_contact', writtenBy: 'contacts.ts', before: { name: 'Dara' }, after: { name: 'Dara S' }, expects: en.name },
  // is_active is deliberately NOT Title-Cased: the field vocabulary names it
  // with the pack word the rest of the app uses for the same column.
  { entity: 'user', writtenBy: 'users.ts', before: { is_active: 1 }, after: { is_active: 0 }, expects: en.active },
  { entity: 'role', writtenBy: 'users.ts', before: { name: 'Cashier' }, after: { name: 'Senior cashier' }, expects: en.name },
  { entity: 'promotion_rule', writtenBy: 'promotions.ts', before: { title: 'Songkran' }, after: { title: 'Songkran 2026' }, expects: en.title },
  { entity: 'settings', writtenBy: 'settings.ts', before: { exchange_rate: 4000 }, after: { exchange_rate: 4100 }, expects: en.exchange_rate },
  { entity: 'fee', writtenBy: 'fees.ts', before: { amount_usd: 5 }, after: { amount_usd: 6 }, expects: en.amount_usd },
  { entity: 'return', writtenBy: 'returns.ts', before: { reason: 'Damaged box' }, after: { reason: 'Wrong item' }, expects: en.reason },
]

/**
 * Record types the Audit Log shows that do NOT carry a before/after pair --
 * their history lives elsewhere (a sale's in sale_record_events, a transfer's
 * in the transfer row itself) or the route records only the action. They are
 * still selectable in the filter, so they still need a name in both packs,
 * and opening one must render the row, not a blank float.
 */
const NAMED_ONLY = ['sale', 'sale_item', 'stock', 'stock_transfer', 'stock_session', 'shift_session', 'product_batch', 'branch']

test('every entity with a before/after pair is written by the Worker file it claims', () => {
  for (const item of BEFORE_AFTER) {
    const source = read(`../../cloudflare/src/routes/${item.writtenBy}`)
    const writesEntity = item.entity === 'customer' || item.entity === 'supplier' || item.entity === 'delivery_contact'
      // contacts.ts audits under config.entity; the three configs declare it.
      ? source.includes(`entity: '${item.entity}'`)
      : source.includes(`'${item.entity}'`)
    assert.ok(writesEntity, `${item.writtenBy} no longer writes the entity '${item.entity}'`)
    assert.match(stripComments(source), /changedFields\(|auditChangeColumns\(/, `${item.writtenBy} no longer writes a before/after pair at all`)
  }
})

test('every record type here is named in BOTH packs', () => {
  for (const entity of [...BEFORE_AFTER.map((item) => item.entity), ...NAMED_ONLY]) {
    const entry = AUDIT_ENTITY_LABELS[entity]
    assert.ok(entry, `the audit vocabulary has no name for '${entity}'`)
    const [key, fallback] = entry
    assert.equal(typeof en[key], 'string', `English is missing ${key} (for ${entity})`)
    assert.equal(typeof km[key], 'string', `Khmer is missing ${key} (for ${entity})`)
    assert.notEqual(km[key], en[key], `Khmer ${key} is still the English string`)
    assert.equal(auditEntityLabel(entity, label), en[key])
    assert.equal(auditEntityLabel(entity, labelKm), km[key])
    assert.ok(fallback, `${entity} has no English fallback`)
  }
})

test('POSITIVE CONTROL: an unnamed entity reads as Title Case, never blank or raw', () => {
  // If auditEntityLabel answered the same way for everything, the case above
  // would prove nothing.
  assert.equal(auditEntityLabel('teleporter_log', label), 'Teleporter Log')
  assert.equal(titleCaseIdentifier('delivery_contact'), 'Delivery Contact')
  assert.notEqual(auditEntityLabel('delivery_contact', labelKm), 'Delivery Contact')
  assert.equal(auditEntityLabel('', label), '')
})

test('every entity with a pair renders Field | Before | After from a real fixture row', () => {
  for (const item of BEFORE_AFTER) {
    const rows = ENTITY_RECORDS_ADAPTER.fieldRows(recordFor(item.entity, item.before, item.after), ctx)
    assert.ok(rows.length >= 1, `${item.entity} produced no before/after row`)
    const labels = rows.map((row) => row.label)
    assert.ok(labels.includes(item.expects), `${item.entity} rendered ${labels.join(', ')} instead of ${item.expects}`)
    for (const row of rows) {
      assert.ok(String(row.before ?? '').length > 0, `${item.entity} rendered an empty Before`)
      assert.ok(String(row.after ?? '').length > 0, `${item.entity} rendered an empty After`)
      assert.notEqual(String(row.before), String(row.after), `${item.entity} rendered an unchanged pair as a change`)
    }
  }
})

test('every field label a fixture produces is readable in the Khmer pack too', () => {
  const kmCtx = { ...ctx, label: labelKm, t: (key: string) => km[key] || key }
  for (const item of BEFORE_AFTER) {
    const [row] = ENTITY_RECORDS_ADAPTER.fieldRows(recordFor(item.entity, item.before, item.after), kmCtx)
    assert.notEqual(row.label, item.expects, `${item.entity}'s field label '${row.label}' is still the English word in the Khmer pack`)
  }
})

test('a record type with no pair still renders: the row, and no change table', () => {
  for (const entity of NAMED_ONLY) {
    const record = recordFor(entity, null, null)
    assert.ok(record, `${entity} produced no record at all`)
    assert.equal(record.actor_username, 'dara', `${entity} lost the actor`)
    assert.equal(ENTITY_RECORDS_ADAPTER.fieldRows(record, ctx).length, 0)
  }
})

test('POSITIVE CONTROL: an unchanged save renders no change rows at all', () => {
  assert.equal(ENTITY_RECORDS_ADAPTER.fieldRows(
    recordFor('product', { selling_price_usd: 3 }, { selling_price_usd: 3 }),
    ctx,
  ).length, 0)
})

test('DRIFT GUARD: no Worker file writes before/after without a fixture here', () => {
  // Every file that builds an audit field pair, found rather than assumed.
  const roots = ['../../cloudflare/src/routes', '../../cloudflare/src/lib']
  const writers: string[] = []
  for (const root of roots) {
    const dir = fileURLToPath(new URL(root, import.meta.url))
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts')) continue
      const source = stripComments(readFileSync(`${dir}/${name}`, 'utf8'))
      if (/changedFields\(|auditChangeColumns\(/.test(source)) writers.push(name)
    }
  }
  // audit.ts defines the helpers; every other writer must appear in the
  // fixture table above, and the table must not name a file that stopped
  // writing pairs.
  const covered = new Set(BEFORE_AFTER.map((item) => item.writtenBy))
  const unexpected = writers.filter((name) => name !== 'audit.ts' && !covered.has(name))
  assert.deepEqual(unexpected, [], `these Worker files now write a before/after pair: ${unexpected.join(', ')} -- add their entity to BEFORE_AFTER and to AUDIT_ENTITY_LABELS`)
  for (const name of covered) {
    assert.ok(writers.includes(name), `the fixture table claims ${name} writes a pair, and it no longer does`)
  }
  assert.ok(writers.length >= 8, `expected the known writers, found ${writers.join(', ')}`)
})

test('the Audit Log page names actions and record types from the shared vocabulary', () => {
  const page = read('../src/components/utils-settings/AuditLog.tsx')
  assert.match(page, /import \{ auditActionLabel, auditEntityLabel, type LabelFn \}/)
  assert.match(page, /const labelFor = \(key: string\) => auditEntityLabel\(key, vocab\)/)
  assert.match(page, /return auditActionLabel\(key, vocab\)/)
  // The Title-Case-the-raw-column renderer is gone from both places it lived.
  assert.doesNotMatch(page, /const labelFor = \(key: string\) => key\.replace/)
  assert.doesNotMatch(page, /if \(!raw\) return 'System'/)
  // And the detail float still renders the pair as field, before, after.
  assert.match(page, /fieldDiffRows\.map\(\(row\) => \([\s\S]{0,400}\{row\.label\}/)
  assert.match(page, /\{row\.before\}[\s\S]{0,200}\{row\.after\}/)
})

if (failed) { console.error(`${failed} audit entity label case(s) failed`); process.exit(1) }
console.log('audit log entity labels: all cases pass')
