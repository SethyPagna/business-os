// Lane LE (branch cutover): POST /api/inventory/move-row refuses a retired
// branch. The moved units arrive as a fresh lot at that branch, so a stale tab
// naming Old Shop must be refused before and inside the batch -- the route had
// no active check (design G12 section 3.1, "request-chosen" row).
//
// Active branch: behaviour unchanged (the assertion is a no-op SELECT).
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const Database = require('better-sqlite3')

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8').replace(/\r\n/g, '\n')
function load(rel) {
  const out = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const module = { exports: {} }
  new Function('exports', 'require', 'module', out)(module.exports, require, module)
  return module.exports
}
const receiving = load('lib/receivingBranch.ts')

const source = read('routes/inventory.ts')
const block = source.slice(source.indexOf("app.post('/move-row'"), source.indexOf("app.post('/move-row'") + 14000)
const moveRow = block.slice(0, block.indexOf("\napp.", 20))

let passed = 0
function check(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`) }

check('move-row pre-checks the branch is active and maps the refusal to 409 receiving_branch_inactive', () => {
  assert.match(moveRow, /await requireReceivingBranch\(db, branchId\)/)
  assert.match(moveRow, /if \(isReceivingBranchError\(error\)\) return c\.json\(RECEIVING_BRANCH_INACTIVE, 409\)/)
})

check('the same assertion rides FIRST in the write batch, so a branch retired after the pre-read aborts every write', () => {
  const batch = moveRow.slice(moveRow.indexOf('await db.batch(['))
  assert.match(batch, /await db\.batch\(\[\s*receivingBranchAssertion\(branchId\),\s*\.\.\.removal\.statements/)
  assert.match(moveRow, /if \(isReceivingBranchError\(err\)\) return c\.json\(RECEIVING_BRANCH_INACTIVE, 409\)/)
})

check('the assertion passes for an active branch and aborts (recognised error) for a retired or missing one', () => {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE branches (id INTEGER PRIMARY KEY, name TEXT, role TEXT, is_active INTEGER NOT NULL DEFAULT 1);
    INSERT INTO branches VALUES (1,'LC Store','shop',1),(2,'Old Shop','shop',0);`)
  const run = (id) => { const s = receiving.receivingBranchAssertion(id); return db.prepare(s.sql).get(s.params) }
  assert.deepStrictEqual(run(1), { receiving_branch_guard: 1 })
  for (const id of [2, 9]) {
    let error
    try { run(id) } catch (e) { error = e }
    assert.ok(error, `branch ${id} must abort`)
    assert.ok(receiving.isReceivingBranchError(error), `branch ${id}: ${error.message}`)
  }
  db.close()
})

console.log(`${passed} checks passed`)
