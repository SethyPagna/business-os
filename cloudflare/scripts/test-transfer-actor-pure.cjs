// N13 (sibling parity) -- the Branches TRANSFER history names the account
// username, the same way the Stock Change ledger and the /movements drill do.
//
// stock_transfers carries the durable relationship (user_id) and a
// DISPLAY-NAME snapshot (user_name) taken at write time -- the same pair
// inventory_movements has, and lib/userIdentity.ts already lists it among the
// username-snapshot tables its rename cascade rewrites. So the account is the
// source of truth here too, and a row written before the username rule
// snapshots the full name.
//
// Before this change the two transfer-list statements in routes/compat.ts read
// `SELECT st.*`, which emits the raw snapshot: the Branches transfer history
// showed 'ung sethy pagna' while the ledger two clicks away showed 'james' --
// one question, two answers.
//
// Discriminating by construction: transfer 1 stores user_id 2 with the
// superseded full name, and user 2's account is 'james'. A statement that
// selects the snapshot returns 'ung sethy pagna' here; only the resolved one
// returns 'james'. Transfer 2 has NO user_id (a legacy/imported row) and
// transfer 3's account has been deleted -- both must keep their snapshots, so
// "resolve everything to NULL" fails too.
//
// Run (from cloudflare/): node scripts/test-transfer-actor-pure.cjs
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const tscVersion = execSync('npx tsc --version', { cwd: cloudflareRoot, encoding: 'utf8' }).trim()
const ignoreConfigFlag = /^Version\s+(?:[6-9]|\d{2,})\./.test(tscVersion) ? ' --ignoreConfig' : ''

let checks = 0
function ok(cond, label) {
  assert.ok(cond, label)
  checks += 1
  console.log('PASS ' + label)
}

// ---- the real helper, compiled ---------------------------------------------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transfer-actor-'))
fs.copyFileSync(
  path.join(cloudflareRoot, 'src', 'lib', 'movementActorName.ts'),
  path.join(tmpDir, 'movementActorName.ts'),
)
execSync(
  'npx tsc "' + path.join(tmpDir, 'movementActorName.ts') + '"' +
  ' --outDir "' + tmpDir + '" --module commonjs --target es2022 --strict --skipLibCheck' + ignoreConfigFlag,
  { cwd: cloudflareRoot, stdio: 'pipe' },
)
const actorLib = require(path.join(tmpDir, 'movementActorName.js'))

assert.equal(typeof actorLib.resolvedActorNameSql, 'function',
  'movementActorName.ts must expose the generic table-agnostic actor expression the transfer list needs')
// The movement expression must BE the generic one, or the two tables answer
// "who" differently the first time the precedence rule is touched.
assert.equal(
  actorLib.movementActorNameSql('m').replace(/\s+/g, ' ').trim(),
  actorLib.resolvedActorNameSql('m').replace(/\s+/g, ' ').trim(),
  'movementActorNameSql must be resolvedActorNameSql with the default columns -- one rule, one implementation',
)
ok(true, 'the actor expression is one implementation, parameterised by table alias and column names')

// ---- the fixture ------------------------------------------------------------
const db = openDb(loadAll())
db.exec(`
  INSERT INTO branches (id,name,is_active) VALUES (1,'Shop',1),(2,'Warehouse',1);
  -- user 2's account is 'james'; the transfer row below snapshots the
  -- superseded FULL NAME, which is exactly the historical shape the owner is
  -- looking at on the Branches page.
  INSERT INTO users (id,username,name,password) VALUES (2,'james','Ung Sethy Pagna','x');
  INSERT INTO stock_transfers (id,from_branch_id,to_branch_id,product_id,product_name,quantity,notes,user_id,user_name,created_at) VALUES
    (1,2,1,10,'Collision Test Serum',4,'restock the shop',2,'ung sethy pagna','2026-09-01 03:00:00'),
    (2,2,1,10,'Collision Test Serum',2,'legacy import',NULL,'Old system','2026-08-01 03:00:00'),
    (3,1,2,10,'Collision Test Serum',1,'return to warehouse',99,'Deleted Operator','2026-07-01 03:00:00');
`)

// ---- the statements the route actually runs ---------------------------------
//
// Read out of routes/compat.ts rather than retyped, so this test cannot pass
// against a statement the Worker does not run. Both the legacy bare-array
// shape and the paged shape are checked: the Branches page uses the paged one,
// and an older client still reaches the other.
const compatSrc = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'compat.ts'), 'utf8')
const statements = [...compatSrc.matchAll(/SELECT st\.\*[\s\S]*?ORDER BY st\.created_at DESC, st\.id DESC[\s\S]*?\n\s*`/g)]
  .map((match) => match[0].replace(/`\s*$/, ''))
assert.equal(statements.length, 2,
  `routes/compat.ts must still hold the two transfer-list statements this test reads; found ${statements.length}`)

// The template holes are filled from the SAME helper the Worker calls, so a
// route that stopped calling it produces a statement that still selects the
// raw snapshot and the assertions below go red.
function runStatement(sql) {
  const runnable = sql
    .replace(/\$\{where\}/g, 'WHERE 1 = 1')
    .replace(/\$\{resolvedActorNameSql\('st'\)\}/g, actorLib.resolvedActorNameSql('st'))
    .replace(/\$\{RESOLVED_ACTOR_NAME_COLUMN\}/g, actorLib.RESOLVED_ACTOR_NAME_COLUMN)
    .replace(/LIMIT @pageSize OFFSET @offset/g, 'LIMIT 500')
  assert.ok(!/\$\{/.test(runnable), `an unfilled template hole reached the database:\n${runnable}`)
  return db.prepare(runnable).all({})
}

for (const [index, sql] of statements.entries()) {
  const shape = index === 0 ? 'the legacy bare-array list' : 'the paged list'
  // Selected under an alias, because `st.*` already emits a user_name column
  // and two columns of one name in a result row is undefined behaviour.
  assert.ok(
    sql.includes("${resolvedActorNameSql('st')} AS ${RESOLVED_ACTOR_NAME_COLUMN}"),
    `${shape} must select the resolved actor under the helper alias, not shadow st.user_name`,
  )
  const rows = runStatement(sql).map((row) => actorLib.withResolvedActorName(row))
  assert.deepEqual(
    rows.map((row) => [Number(row.id), row.user_name]),
    [
      [1, 'james'],
      [2, 'Old system'],
      [3, 'Deleted Operator'],
    ],
    `${shape} must name the ACCOUNT for an attributed transfer and keep the snapshot where there is no account`,
  )
  assert.ok(!(actorLib.RESOLVED_ACTOR_NAME_COLUMN in rows[0]),
    `${shape} must drop the helper column before the row leaves the Worker`)
  ok(true, `${shape} resolves the account username and folds it onto user_name`)
}

// ...and the route must actually fold it. A statement that resolves and a
// response that returns the raw row would satisfy every assertion above,
// because this test does the folding itself.
const foldCount = (compatSrc.match(/withResolvedActorName/g) || []).length
assert.ok(foldCount >= 3,
  'routes/compat.ts must import withResolvedActorName and map BOTH transfer responses through it')
assert.match(compatSrc, /return c\.json\(\(rows \|\| \[\]\)\.map\(\(row\) => withResolvedActorName\(row\)\)\)/,
  'the legacy bare-array transfer response still returns the raw rows')
assert.match(compatSrc, /items: \(items \|\| \[\]\)\.map\(\(row\) => withResolvedActorName\(row\)\)/,
  'the paged transfer response still returns the raw rows')
ok(true, 'both transfer responses fold the resolved actor onto user_name before answering')

console.log('\nOK ' + checks + ' checks')
