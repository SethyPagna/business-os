'use strict'
// Round 3 made every count writer's batch name migration 0318's and 0319's indexes in INDEXED BY, and six tests that build their schema from a fixed list of migration files held neither, so every count they made failed with
// "no such index". This pins the class: every index the count writers name in INDEXED BY is created by some migration, and every literal list of migration files in scripts/ that holds ONE of those migrations holds ALL of them.
//
// Not covered: a test that builds its schema in a loop over the migrations directory (it holds every file below its stopping point, so it can only miss the ones above it: run it).
//
// Run: node scripts/test-count-schema-lists-hold-writer-indexes-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
// The auto-close is appended to the batch of every count writer, so the indexes of THIS module are needed by all of them (the approvals indexes of the other modules only by the writers that reach approvals).
const WRITER_SOURCES = ['src/lib/inventoryCheckTasks.ts']
const migrationsDir = path.join(root, 'migrations')
const migrations = fs.readdirSync(migrationsDir).filter(file => file.endsWith('.sql')).sort()
const migrationText = new Map(migrations.map(file => [file, fs.readFileSync(path.join(migrationsDir, file), 'utf8')]))

const indexesNamed = (text) => [...text.matchAll(/INDEXED BY ([A-Za-z0-9_]+)/g)].map(match => match[1])
const createdBy = (index) => migrations.filter(file => new RegExp(`CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?${index}\\b`).test(migrationText.get(file)))
const LIST = /\[\s*'\d{4}_[A-Za-z0-9_]+\.sql'(?:\s*,\s*'\d{4}_[A-Za-z0-9_]+\.sql')*\s*,?\s*\]/g

/** The migrations a list must also hold, when it holds any of `required`: the lists that miss some. */
const incomplete = (lists, required) => lists.filter(({ files }) => files.some(file => required.includes(file)) && required.some(file => !files.includes(file)))

let passed = 0
const check = (name, run) => { run(); passed++; console.log(`PASS ${name}`) }

const named = new Set(WRITER_SOURCES.flatMap(source => indexesNamed(fs.readFileSync(path.join(root, source), 'utf8'))))
const required = [...new Set([...named].flatMap(index => { const files = createdBy(index); assert.equal(files.length, 1, `${index} is created by exactly one migration: ${files}`); return files }))].sort()

const lists = []
for (const file of fs.readdirSync(__dirname).filter(name => name.endsWith('.cjs'))) {
  if (file === path.basename(__filename)) continue
  for (const match of fs.readFileSync(path.join(__dirname, file), 'utf8').matchAll(LIST)) lists.push({ file, files: [...match[0].matchAll(/'(\d{4}_[A-Za-z0-9_]+\.sql)'/g)].map(item => item[1]) })
}

check('every index a count writer names in INDEXED BY is created by one migration, and the three of this feature are among them', () => {
  for (const index of ['inventory_check_sessions_kind_task', 'inventory_check_sessions_open_task', 'inventory_check_sessions_task_board', 'inventory_check_items_product_latest']) assert.ok(named.has(index), `${index} is named by a writer`)
  assert.deepEqual(required.filter(file => /^03(18|19)_/.test(file)), ['0318_inventory_check_task_index.sql', '0319_inventory_check_open_task_index.sql'])
})

check('the scan finds the lists (the six that broke in round 3 among them) and every list that holds one of the migrations holds all of them', () => {
  const holding = lists.filter(({ files }) => files.some(file => required.includes(file)))
  const names = new Set(holding.map(({ file }) => file))
  for (const file of ['test-inventory-check-sessions.cjs', 'test-inventory-check-session-list-native.cjs', 'test-inventory-check-submissions-http.cjs', 'test-inventory-check-lot-counts-http.cjs', 'test-inventory-check-lots-read-http.cjs', 'test-inventory-check-approvals-http.cjs']) assert.ok(names.has(file), `${file} holds a literal list of migrations`)
  const bad = incomplete(lists, required)
  assert.deepEqual(bad.map(({ file, files }) => `${file}: missing ${required.filter(item => !files.includes(item)).join(', ')}`), [], `required: ${required.join(', ')}`)
})

check('the check is not vacuous: a list that drops 0318, 0319 or the task index is reported, a complete one and an unrelated one are not', () => {
  const complete = { file: 'x', files: ['0259_inventory_check_sessions.sql', ...required] }
  for (const drop of required) assert.equal(incomplete([{ file: 'x', files: complete.files.filter(file => file !== drop) }], required).length, 1, `without ${drop}`)
  assert.equal(incomplete([complete, { file: 'y', files: ['0259_inventory_check_sessions.sql'] }], required).length, 0, 'a list that holds none of them is not about the writers')
  assert.equal(incomplete([{ file: 'z', files: [required[0]] }], required).length, 1, 'a list that holds only one of them is reported')
})

console.log(`${passed} groups passed; required migrations: ${required.join(', ')}; ${lists.length} literal lists scanned`)
