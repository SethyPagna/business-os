// Tests for lib/contactDuplicates.ts, added this session alongside the
// admin "Possible Duplicates" panel's dismiss/merge actions. Same
// transpile-in-memory approach as test-contact-options.cjs/
// test-import-engine-pure.cjs (no bundler available in this sandbox) --
// db calls are stubbed with a minimal fake matching how this file always
// calls it (`db.prepare(sql).all(params)` / `.get(params)` / `.run(params)`),
// not a full D1Compat re-implementation.
//
// Run: node scripts/test-contact-duplicates-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'contactDuplicates.ts')
const source = fs.readFileSync(sourcePath, 'utf8')

const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'contactDuplicates.ts',
})

// contactOptions.ts is a real import (parseStoredContactOptions) --
// resolve it the same way node would from this in-memory module's own
// directory, so collectContactPhones' Contact-Options parsing is exercised
// for real rather than stubbed.
// contactOptions.ts is itself TypeScript with no compiled .js sibling, so
// plain require() can't resolve it -- transpile it the same way and hand
// back its exports whenever contactDuplicates.ts's own require('./contactOptions')
// asks for it; anything else falls through to the real require.
function transpileTs(tsPath) {
  const tsSource = fs.readFileSync(tsPath, 'utf8')
  const { outputText: tsOutput } = ts.transpileModule(tsSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(tsPath),
  })
  const mod = { exports: {} }
  const w = new Function('exports', 'require', 'module', '__filename', '__dirname', tsOutput)
  w(mod.exports, require, mod, tsPath, path.dirname(tsPath))
  return mod.exports
}
const contactOptionsExports = transpileTs(path.join(path.dirname(sourcePath), 'contactOptions.ts'))

const moduleObj = { exports: {} }
function fakeRequire(specifier) {
  if (specifier === './contactOptions' || specifier === './contactOptions.ts') return contactOptionsExports
  return require(specifier)
}
const wrapper = new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)
wrapper(moduleObj.exports, fakeRequire, moduleObj, sourcePath, path.dirname(sourcePath))

const {
  classifyContactDuplicates,
  findDuplicateContactClusters,
  dismissDuplicateCluster,
  normalizeContactName,
  normalizePhone,
} = moduleObj.exports

let failed = 0
async function runTest(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

async function main() {

  await runTest('classifyContactDuplicates: phone_conflict outranks exact_match outranks name_only', async () => {
  const matches = classifyContactDuplicates(
    { name: 'Sok Dara', phones: ['012345678'] },
    [
      { id: 1, name: 'Someone Else', phone: '012345678', address: null }, // shared phone, different name -> phone_conflict
      { id: 2, name: 'Sok Dara', phone: '012345678', address: null }, // shared phone, same name -> exact_match
      { id: 3, name: 'Sok Dara', phone: '099999999', address: null }, // same name only -> name_only
      { id: 4, name: 'Totally Different', phone: '011111111', address: null }, // no match at all
    ],
  )
  assert.strictEqual(matches.length, 3, 'the fourth candidate (no name or phone overlap) should not appear at all')
  assert.deepStrictEqual(matches.map((m) => m.severity), ['phone_conflict', 'exact_match', 'name_only'], 'results should be sorted worst-severity-first')
  assert.strictEqual(matches[0].id, 1)
  assert.strictEqual(matches[1].id, 2)
  assert.strictEqual(matches[2].id, 3)
})

  await runTest('normalizeContactName/normalizePhone: case/whitespace/formatting tolerant', async () => {
  assert.strictEqual(normalizeContactName('  Sok   Dara '), 'sok dara')
  assert.strictEqual(normalizePhone('(012) 345-678'), '012345678')
  assert.strictEqual(normalizePhone('   '), null)
})

// -- findDuplicateContactClusters / dismissDuplicateCluster: fake db ------

function makeFakeDb({ contactRows, dismissalRows = [] }) {
  const calls = { inserts: [] }
  const db = {
    prepare(sql) {
      return {
        async all(params) {
          if (/FROM contact_duplicate_dismissals/.test(sql)) return dismissalRows
          if (/FROM \w+ ORDER BY id ASC/.test(sql)) return contactRows
          throw new Error(`unexpected .all() query in test: ${sql}`)
        },
        async get() {
          throw new Error(`unexpected .get() query in test: ${sql}`)
        },
        async run(params) {
          calls.inserts.push({ sql, params })
          return { success: true }
        },
      }
    },
  }
  return { db, calls }
}

  await runTest('findDuplicateContactClusters: groups by shared phone and by shared name, worst-severity-first', async () => {
  const contactRows = [
    { id: 1, name: 'Sok Dara', phone: '012345678', address: null, membership_number: null },
    { id: 2, name: 'Chan Sopheak', phone: '012345678', address: null, membership_number: null }, // same phone, different name -> phone_conflict cluster
    { id: 3, name: 'Ly Ratha', phone: '099999999', address: null, membership_number: null },
    { id: 4, name: 'ly ratha', phone: '011111111', address: null, membership_number: null }, // same normalized name, no shared phone -> name_only cluster
  ]
  const { db } = makeFakeDb({ contactRows })
  const clusters = await findDuplicateContactClusters(db, 'customers', 'address')
  const phoneCluster = clusters.find((c) => c.type === 'phone')
  const nameCluster = clusters.find((c) => c.type === 'name')
  assert.ok(phoneCluster, 'should surface the shared-phone cluster')
  assert.strictEqual(phoneCluster.severity, 'phone_conflict')
  assert.deepStrictEqual(phoneCluster.contacts.map((c) => c.id).sort(), [1, 2])
  assert.ok(nameCluster, 'should surface the shared-name cluster')
  assert.strictEqual(nameCluster.severity, 'name_only')
  assert.deepStrictEqual(nameCluster.contacts.map((c) => c.id).sort(), [3, 4])
  assert.strictEqual(clusters[0], phoneCluster, 'phone_conflict must sort ahead of name_only')
})

  await runTest('findDuplicateContactClusters: a dismissed cluster does not resurface', async () => {
  const contactRows = [
    { id: 3, name: 'Ly Ratha', phone: '099999999', address: null, membership_number: null },
    { id: 4, name: 'ly ratha', phone: '011111111', address: null, membership_number: null },
  ]
  const dismissalRows = [{ cluster_type: 'name', cluster_value: 'ly ratha' }]
  const { db } = makeFakeDb({ contactRows, dismissalRows })
  const clusters = await findDuplicateContactClusters(db, 'customers', 'address')
  assert.strictEqual(clusters.length, 0, 'the dismissed name cluster should be filtered out entirely')
})

  await runTest('dismissDuplicateCluster: upserts with the given table/type/value/reviewer', async () => {
  const { db, calls } = makeFakeDb({ contactRows: [] })
  await dismissDuplicateCluster(db, 'suppliers', 'name', 'acme co', { id: 7, name: 'Admin User' })
  assert.strictEqual(calls.inserts.length, 1)
  const { sql, params } = calls.inserts[0]
  assert.ok(/INSERT INTO contact_duplicate_dismissals/.test(sql))
  assert.ok(/ON CONFLICT\(contact_table, cluster_type, cluster_value\) DO UPDATE/.test(sql), 'dismissing the same cluster twice should update, not fail on the unique index')
  assert.strictEqual(params.table, 'suppliers')
  assert.strictEqual(params.type, 'name')
  assert.strictEqual(params.value, 'acme co')
  assert.strictEqual(params.dismissedById, 7)
  assert.strictEqual(params.dismissedByName, 'Admin User')
})

  if (failed > 0) {
    console.error(`${failed} test(s) failed`)
    process.exit(1)
  } else {
    console.log('All contactDuplicates.ts tests passed')
  }
}

main()
