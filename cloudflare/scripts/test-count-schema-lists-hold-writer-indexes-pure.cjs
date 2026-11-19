'use strict'
// Round 3 made every count writer's batch name migration 0318's and 0319's indexes in INDEXED BY, and six tests that build their schema from a fixed list of migration files held neither, so every count they made failed with
// "no such index". This pins the class: every index the count writers name in INDEXED BY is created by some migration, and every literal list of migration files under scripts/ that is about the count tables (it holds 0259, or
// any of those migrations) holds ALL of them. Single or double quotes, every subfolder of scripts/, and a list with a // or /* */ comment inside it (comments are stripped before the lists are read).
//
// Not covered: a test that builds its schema in a loop over the migrations directory (it holds every file below its stopping point, so it can only miss the ones above it: run it, and a loop that stops early is the form
// this scan cannot see), and a list built by code (a spread, a filter, a concatenation of two arrays): only literal lists of file names are read. Lists are read from BOTH the raw text and the text with its comments stripped, and the union is
// checked. The stripper is a small scanner that knows quoted strings (not regex literals), so a regex literal such as /^\/*/ can make it blank everything up to the next end-of-comment, but the raw text still holds
// every list that has no comment inside it: only a list with a comment inside it, after such a literal, can be missed. The union also reads a list that sits inside a comment (a commented-out list is checked like a live one).
//
// Run: node scripts/test-count-schema-lists-hold-writer-indexes-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
// The auto-close is appended to the batch of every count writer, so the indexes of THIS module are needed by all of them (the approvals indexes of the other modules only by the writers that reach approvals).
const WRITER_SOURCES = ['src/lib/inventoryCheckTasks.ts']
const COUNT_TABLES = '0259_inventory_check_sessions.sql'
// Lists of migration file names that build no schema: ONE list each, identified by its file and its exact file names (the fixture that writes empty files with these names to test the deploy guard; it runs no migration).
// The exact list must still exist, so a stale entry fails, and any other list in the same file is scanned like every other.
const NO_SCHEMA = [{ file: 'test-deploy-kit-pure.cjs', files: ['0251_loyalty_reset.sql', '0255_product_review.sql', '0256_validated_cost.sql', '0257_confirmation.sql', '0259_inventory_check_sessions.sql'] }]
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
/** The text with its // and /* *\/ comments blanked out (newlines kept). A quote opens a string, which a newline closes (a template literal runs on), so a // inside a string is not a comment. */
function withoutComments(text) {
  let out = '', quote = '', i = 0
  while (i < text.length) {
    const ch = text[i], next = text[i + 1]
    if (quote) {
      if (ch === '\\') { out += ch + (next ?? ''); i += 2; continue }
      if (ch === quote || (ch === '\n' && quote !== '`')) quote = ''
      out += ch; i++; continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; out += ch; i++; continue }
    if (ch === '/' && next === '/') { while (i < text.length && text[i] !== '\n') i++; out += ' '; continue }
    if (ch === '/' && next === '*') { const end = text.indexOf('*/', i + 2); const stop = end < 0 ? text.length : end + 2; out += text.slice(i, stop).replace(/[^\n]/g, ' '); i = stop; continue }
    out += ch; i++
  }
  return out
}
/** The literal lists of migration files in a source text: those of the raw text and those of the comment-stripped text, each distinct list once. */
const listsIn = (file, text) => {
  const seen = new Set()
  return [text, withoutComments(text)].flatMap(source => [...source.matchAll(LIST)].map(match => ({ file, files: [...match[0].matchAll(ITEM)].map(item => item[1]) })))
    .filter(list => { const key = list.files.join('|'); if (seen.has(key)) return false; seen.add(key); return true })
}
/** The one list an exemption names: same file, same file names in the same order. */
const isExempt = (list, exemptions = NO_SCHEMA) => exemptions.some(({ file, files }) => list.file === file && list.files.length === files.length && list.files.every((name, index) => name === files[index]))
/** The exemptions whose exact list is not among `lists` any more. */
const staleExemptions = (lists, exemptions = NO_SCHEMA) => exemptions.filter(exemption => !lists.some(list => isExempt(list, [exemption])))
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
  assert.deepEqual(staleExemptions(lists).map(({ file }) => file), [], 'an exempt list is gone or changed: the exemption is stale')
  const bad = incomplete(lists.filter(list => !isExempt(list)), required)
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

check('the exemption is one list: emptying it or changing it makes it stale, and another incomplete 0259 list in the same file is still reported', () => {
  const exempt = NO_SCHEMA[0], kit = (files) => ({ file: exempt.file, files })
  assert.deepEqual(staleExemptions([kit(exempt.files)]), [], 'the exact list satisfies its exemption')
  assert.equal(staleExemptions([kit([])]).length, 1, 'an emptied list is stale')
  assert.equal(staleExemptions([kit(exempt.files.slice(1))]).length, 1, 'a changed list is stale')
  assert.equal(staleExemptions([{ file: 'other.cjs', files: exempt.files }]).length, 1, 'the same names in another file are not the exempt list')
  assert.equal(staleExemptions([]).length, 1, 'no list at all is stale')
  const other = kit([COUNT_TABLES, required[0]])
  assert.equal(isExempt(other), false, 'another list of the same file is not exempt')
  assert.equal(incomplete([other, kit(exempt.files)].filter(list => !isExempt(list)), required).length, 1, 'an incomplete 0259 list added to that file is reported')
})

check('comments inside a list are stripped, so a list with a comment is read (and reported when incomplete); comments and strings are told apart', () => {
  const lineComment = `const A = [
    '${COUNT_TABLES}', // the tables
    '${required[0]}',
  ]`
  const blockComment = `const B = ['${COUNT_TABLES}', /* why: the tables */ '${required[0]}']`
  for (const text of [lineComment, blockComment]) {
    assert.deepEqual(listsIn('c', text).map(item => item.files), [[COUNT_TABLES, required[0]]], 'the list is read through its comment')
    assert.equal(incomplete(listsIn('c', text), required).length, 1, 'and reported when incomplete')
  }
  assert.deepEqual(listsIn('u', `const U = 'http://x//y'; const L = ['${COUNT_TABLES}', '${required[0]}']`).map(item => item.files), [[COUNT_TABLES, required[0]]], 'a // inside a string is not a comment')
  assert.equal(listsIn('k', `// const A = ['${COUNT_TABLES}']\n/* const B = ['${COUNT_TABLES}'] */`).length, 1, 'a list that sits in a comment is read too (once: the same names are one list)')
  // N4 (round 7): a regex literal that opens a comment for the stripper hides the lines after it up to the next end-of-comment; the raw text still gives the incomplete list that follows it.
  const fooled = `const LEAD = /^\\/*/\nconst X = 1\nconst Y = 2\nconst A = ['${COUNT_TABLES}', '${required[0]}']\n/* end */`
  assert.equal(withoutComments(fooled).includes(COUNT_TABLES), false, 'the stripper is fooled by the regex literal (the premise)')
  assert.deepEqual(listsIn('f', fooled).map(item => item.files), [[COUNT_TABLES, required[0]]], 'the list is still read, from the raw text')
  assert.equal(incomplete(listsIn('f', fooled), required).length, 1, 'and reported when incomplete')
})

console.log(`${passed} groups passed; required migrations: ${required.join(', ')}; ${lists.length} literal lists scanned`)
