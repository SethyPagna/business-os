'use strict'
// Round 3 made every count writer's batch name migration 0318's and 0319's indexes in INDEXED BY, and six tests that build their schema from a fixed list of migration files held neither, so every count they made failed with
// "no such index". This pins the class: every index the count writers name in INDEXED BY is created by some migration, and every literal list of migration files under scripts/ that is about the count tables (it holds 0259, or
// any of those migrations) holds ALL of them. Single or double quotes, and every subfolder of scripts/.
//
// Not covered: a test that builds its schema in a loop over the migrations directory (it holds every file below its stopping point, so it can only miss the ones above it: run it, and a loop that stops early is the form
// this scan cannot see), and a list built by code (a spread, a filter, a concatenation of two arrays): only literal lists of file names are read.
//
// Run: node scripts/test-count-schema-lists-hold-writer-indexes-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
// The auto-close is appended to the batch of every count writer, so the indexes of THIS module are needed by all of them (the approvals indexes of the other modules only by the writers that reach approvals).
const WRITER_SOURCES = ['src/lib/inventoryCheckTasks.ts']
const COUNT_TABLES = '0259_inventory_check_sessions.sql'
// Lists of migration file names that build no schema. Each is named with its reason, and must still exist, so a stale entry fails.
const NO_SCHEMA = { 'test-deploy-kit-pure.cjs': 'writes empty fixture files with these names to test the deploy guard; it runs no migration' }
const migrationsDir = path.join(root, 'migrations')
const migrations = fs.readdirSync(migrationsDir).filter(file => file.endsWith('.sql')).sort()
const migrationText = new Map(migrations.map(file => [file, fs.readFileSync(path.join(migrationsDir, file), 'utf8')]))

const indexesNamed = (text) => [...text.matchAll(/INDEXED BY ([A-Za-z0-9_]+)/g)].map(match => match[1])
const createdBy = (index) => migrations.filter(file => new RegExp(`CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?${index}\\b`).test(migrationText.get(file)))
const NAME = /(['"])\d{4}_[A-Za-z0-9_]+\.sql\1/.source
const LIST = new RegExp(`\\[\\s*${NAME}(?:\\s*,\\s*${NAME})*\\s*,?\\s*\\]`, 'g')
const ITEM = /['"](\d{4}_[A-Za-z0-9_]+\.sql)['"]/g

/** The lists that hold the count tables or one of `required` and miss some of `required`. */
const incomplete = (lists, required) => lists.filter(({ files }) => files.some(file => file === COUNT_TABLES || required.includes(file)) && required.some(file => !files.includes(file)))
/** The literal lists of migration files in a source text. */
const listsIn = (file, text) => [...text.matchAll(LIST)].map(match => ({ file, files: [...match[0].matchAll(ITEM)].map(item => item[1]) }))
const scriptFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
  ? (entry.name === 'node_modules' ? [] : scriptFiles(path.join(dir, entry.name)))
  : entry.name.endsWith('.cjs') ? [path.join(dir, entry.name)] : [])

let passed = 0
const check = (name, run) => { run(); passed++; console.log(`PASS ${name}`) }

const named = new Set(WRITER_SOURCES.flatMap(source => indexesNamed(fs.readFileSync(path.join(root, source), 'utf8'))))
const required = [...new Set([...named].flatMap(index => { const files = createdBy(index); assert.equal(files.length, 1, `${index} is created by exactly one migration: ${files}`); return files }))].sort()

const lists = []
for (const full of scriptFiles(__dirname)) {
  if (full === __filename) continue
  lists.push(...listsIn(path.relative(__dirname, full).split(path.sep).join('/'), fs.readFileSync(full, 'utf8')))
}

check('every index a count writer names in INDEXED BY is created by one migration, and the three of this feature are among them', () => {
  for (const index of ['inventory_check_sessions_kind_task', 'inventory_check_sessions_open_task', 'inventory_check_sessions_task_board', 'inventory_check_items_product_latest']) assert.ok(named.has(index), `${index} is named by a writer`)
  assert.deepEqual(required.filter(file => /^03(18|19)_/.test(file)), ['0318_inventory_check_task_index.sql', '0319_inventory_check_open_task_index.sql'])
})

check('the scan finds the lists (the six that broke in round 3 among them) and every list about the count tables holds all of the required migrations', () => {
  const holding = lists.filter(({ files }) => files.some(file => required.includes(file)))
  const names = new Set(holding.map(({ file }) => file))
  for (const file of ['test-inventory-check-sessions.cjs', 'test-inventory-check-session-list-native.cjs', 'test-inventory-check-submissions-http.cjs', 'test-inventory-check-lot-counts-http.cjs', 'test-inventory-check-lots-read-http.cjs', 'test-inventory-check-approvals-http.cjs']) assert.ok(names.has(file), `${file} holds a literal list of migrations`)
  for (const file of Object.keys(NO_SCHEMA)) assert.ok(lists.some(item => item.file === file), `${file} is exempt but holds no such list any more`)
  const bad = incomplete(lists.filter(({ file }) => !(file in NO_SCHEMA)), required)
  assert.deepEqual(bad.map(({ file, files }) => `${file}: missing ${required.filter(item => !files.includes(item)).join(', ')}`), [], `required: ${required.join(', ')}`)
})

check('the check is not vacuous: a list that drops 0318, 0319 or the task index is reported, a complete one and an unrelated one are not', () => {
  const complete = { file: 'x', files: [COUNT_TABLES, ...required] }
  for (const drop of required) assert.equal(incomplete([{ file: 'x', files: complete.files.filter(file => file !== drop) }], required).length, 1, `without ${drop}`)
  assert.equal(incomplete([complete, { file: 'y', files: ['0001_init.sql'] }], required).length, 0, 'a list that holds none of them is not about the count tables')
  assert.equal(incomplete([{ file: 'z', files: [required[0]] }], required).length, 1, 'a list that holds only one of them is reported')
  assert.equal(incomplete([{ file: 'w', files: [COUNT_TABLES] }], required).length, 1, 'a list that holds the count tables and none of the others is reported')
})

check('the scan reads either quote style, a list under a subfolder, and a list that holds the tables only', () => {
  const single = `const A = ['${COUNT_TABLES}', '${required[0]}']`, double = `const A = ["${COUNT_TABLES}", "${required[0]}"]`
  assert.deepEqual(listsIn('s', single).map(item => item.files), [[COUNT_TABLES, required[0]]])
  assert.deepEqual(listsIn('d', double).map(item => item.files), [[COUNT_TABLES, required[0]]], 'a double-quoted list is read')
  assert.equal(incomplete(listsIn('d', double), required).length, 1, 'and reported when incomplete')
  assert.equal(incomplete(listsIn('t', `const A = ["${COUNT_TABLES}"]`), required).length, 1, 'a list holding only 0259 is reported')
  assert.ok(lists.some(({ file }) => file.includes('/')), 'the scan walked at least one subfolder of scripts/')
})

console.log(`${passed} groups passed; required migrations: ${required.join(', ')}; ${lists.length} literal lists scanned`)
