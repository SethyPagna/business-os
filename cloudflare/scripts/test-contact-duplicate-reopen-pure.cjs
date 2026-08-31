// Proves that "keeping" a contact conflict (dismissing a duplicate cluster as
// not-a-duplicate) is REVERSIBLE -- a kept cluster can always be reopened and
// resolved, never a one-way hide. This backs the user rule: a conflict can
// always be resolved in Conflicts.
//
// Two layers, no app harness (route handlers here are not fetch-tested):
//   (1) ROUND-TRIP -- build the REAL schema from the full migration chain, then
//       run the EXACT dismiss / filter / undismiss SQL the lib issues and model
//       the sweep's include/exclude the same way, asserting: open -> dismiss
//       hides it -> includeDismissed shows it flagged -> undismiss reopens it.
//       Includes the NAME casing case (a dismissal stores the display casing it
//       was shown with, but a later reopen sends the current display name) to
//       prove the casing-tolerant delete still finds the row.
//   (2) SOURCE GUARD -- assert the lib + route still carry the reopen wiring, so
//       a later edit cannot quietly drop it and still pass layer (1).
//
// Run (from cloudflare/): node scripts/test-contact-duplicate-reopen-pure.cjs

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const db = openDb(loadAll())
const run = (sql, params) => db.prepare(sql).run(params)
const all = (sql, params) => db.prepare(sql).all(params)

// normalizeContactName, mirrored from cloudflare/src/lib/contactDuplicates.ts.
const normalizeContactName = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const SOH = ''

// The EXACT statements the lib issues (dismissDuplicateCluster /
// undismissDuplicateCluster / the sweep's dismissal read).
const DISMISS_UPSERT = `
  INSERT INTO contact_duplicate_dismissals (contact_table, cluster_type, cluster_value, dismissed_by_id, dismissed_by_name, dismissed_at)
  VALUES (@table, @type, @value, @dismissedById, @dismissedByName, CURRENT_TIMESTAMP)
  ON CONFLICT(contact_table, cluster_type, cluster_value) DO UPDATE SET
    dismissed_by_id = @dismissedById, dismissed_by_name = @dismissedByName, dismissed_at = CURRENT_TIMESTAMP`
const DISMISSAL_READ = `SELECT cluster_type, cluster_value FROM contact_duplicate_dismissals WHERE contact_table = @table`
const UNDISMISS_PHONE = `DELETE FROM contact_duplicate_dismissals WHERE contact_table = @table AND cluster_type = 'phone' AND cluster_value = @value`
const UNDISMISS_NAME_READ = `SELECT cluster_value FROM contact_duplicate_dismissals WHERE contact_table = @table AND cluster_type = 'name'`
const UNDISMISS_NAME_DELETE = `DELETE FROM contact_duplicate_dismissals WHERE contact_table = @table AND cluster_type = 'name' AND cluster_value = @value`

const dismiss = (table, type, value) => run(DISMISS_UPSERT, { table, type, value, dismissedById: null, dismissedByName: null })
const undismiss = (table, type, value) => {
  if (type === 'phone') { run(UNDISMISS_PHONE, { table, value }); return }
  const rows = all(UNDISMISS_NAME_READ, { table })
  const target = normalizeContactName(value)
  for (const row of rows) {
    if (normalizeContactName(row.cluster_value) === target) run(UNDISMISS_NAME_DELETE, { table, value: row.cluster_value })
  }
}

// Model findDuplicateContactClusters' dismissed filter exactly: build the
// dismissed Set the way the lib does (normalized name / raw phone), then decide
// which of the two seeded clusters survive for a given includeDismissed.
function sweep(table, includeDismissed) {
  const dismissalRows = all(DISMISSAL_READ, { table })
  const dismissed = new Set(dismissalRows.map((r) => `${r.cluster_type}${SOH}${r.cluster_type === 'name' ? normalizeContactName(r.cluster_value) : r.cluster_value}`))
  const clusters = []
  // seeded phone cluster: two rows share PHONE '012000111'
  {
    const isDismissed = dismissed.has(`phone${SOH}012000111`)
    if (!(isDismissed && !includeDismissed)) clusters.push({ type: 'phone', value: '012000111', dismissed: isDismissed || undefined })
  }
  // seeded name cluster: two rows share normalized name 'ly ratha'
  {
    const isDismissed = dismissed.has(`name${SOH}${normalizeContactName('Ly Ratha')}`)
    if (!(isDismissed && !includeDismissed)) clusters.push({ type: 'name', value: 'Ly Ratha', dismissed: isDismissed || undefined })
  }
  return clusters
}

// Seed: a phone-sharing pair and a (differently-cased) name-sharing pair.
run(`INSERT INTO customers (id, name, phone) VALUES (@id, @name, @phone)`, { id: 101, name: 'Sok Dara', phone: '012000111' })
run(`INSERT INTO customers (id, name, phone) VALUES (@id, @name, @phone)`, { id: 102, name: 'Dara Sok', phone: '012000111' })
run(`INSERT INTO customers (id, name, phone) VALUES (@id, @name, @phone)`, { id: 201, name: 'Ly Ratha', phone: '012777888' })
run(`INSERT INTO customers (id, name, phone) VALUES (@id, @name, @phone)`, { id: 202, name: 'ly ratha', phone: '012999000' })

let failed = 0
function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed += 1; console.error(`FAIL ${name}`); console.error(e && e.message ? e.message : e) }
}

check('both clusters are open before any keep', () => {
  const open = sweep('customers', false)
  assert.strictEqual(open.length, 2, 'phone + name clusters both open')
  assert.ok(open.every((c) => !c.dismissed), 'nothing flagged kept yet')
})

check('keeping (dismiss) a phone cluster hides it from the open sweep', () => {
  dismiss('customers', 'phone', '012000111')
  const open = sweep('customers', false)
  assert.strictEqual(open.length, 1, 'only the name cluster remains open')
  assert.strictEqual(open[0].type, 'name')
})

check('includeDismissed brings the kept cluster back, flagged dismissed', () => {
  const withKept = sweep('customers', true)
  assert.strictEqual(withKept.length, 2, 'both surface when kept are included')
  const phone = withKept.find((c) => c.type === 'phone')
  assert.ok(phone && phone.dismissed === true, 'kept phone cluster is flagged so the panel can offer Reopen')
})

check('reopen (undismiss) a phone cluster returns it to the open queue', () => {
  undismiss('customers', 'phone', '012000111')
  const open = sweep('customers', false)
  assert.strictEqual(open.length, 2, 'reopened -- both clusters open again')
  assert.ok(open.every((c) => !c.dismissed), 'nothing left flagged kept')
})

check('reopen matches on normalized name despite casing drift', () => {
  // Dismiss stores the display casing shown at dismiss time ("Ly Ratha")...
  dismiss('customers', 'name', 'Ly Ratha')
  assert.strictEqual(sweep('customers', false).filter((c) => c.type === 'name').length, 0, 'name cluster kept')
  // ...but a later reopen sends a differently-cased current name -- must still
  // find and drop the stored dismissal (the casing-tolerant delete).
  undismiss('customers', 'name', 'LY  RATHA')
  const nameRows = all(UNDISMISS_NAME_READ, { table: 'customers' })
  assert.strictEqual(nameRows.length, 0, 'the stored dismissal was removed despite casing/spacing difference')
  assert.strictEqual(sweep('customers', false).filter((c) => c.type === 'name').length, 1, 'name cluster is open again')
})

// ---- Layer 2: source guards -----------------------------------------------
const libSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'contactDuplicates.ts'), 'utf8')
const routeSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'contacts.ts'), 'utf8')

check('lib still exports the reopen + includeDismissed wiring', () => {
  assert.ok(/export async function undismissDuplicateCluster/.test(libSrc), 'undismissDuplicateCluster export present')
  assert.ok(/includeDismissed/.test(libSrc), 'findDuplicateContactClusters still honours includeDismissed')
  assert.ok(/dismissed: true/.test(libSrc), 'kept clusters are still flagged dismissed')
})

check('route still exposes /duplicates/undismiss and reads includeDismissed', () => {
  assert.ok(/duplicates\/undismiss/.test(routeSrc), 'undismiss route present')
  assert.ok(/undismissDuplicateCluster\(/.test(routeSrc), 'route calls undismissDuplicateCluster')
  assert.ok(/includeDismissed/.test(routeSrc), 'GET /duplicates parses includeDismissed')
})

if (failed > 0) { console.error(`\n${failed} check(s) failed`); process.exit(1) }
console.log('\nAll contact-duplicate reopen checks passed')
