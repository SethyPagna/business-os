// N13 -- the actor snapshot ("who did this") written into every history
// surface must be the account USERNAME, resolved server-side, and a client's
// own actor string must be inert.
//
// This test has three parts, and each one fails on the pre-N13 tree:
//   1. BEHAVIOUR of the shared kernel (lib/actorSnapshot.ts), compiled from
//      the real source: given a session carrying BOTH a username and a full
//      name, and a request body carrying a forged name, the stored value is
//      the username.
//   2. BEHAVIOUR of the audit path against the REAL migration chain: the
//      username is re-read from `users` by id, so the name a caller passes
//      positionally (all 130+ audit() call sites pass one) cannot win.
//   3. A per-writer CENSUS: every writer named in N13 -- inventory movements,
//      audit_logs, returns' cashier, sales' cashier, transfers, write-offs
//      (damaged_stock_lots) and the stock-in session movements -- goes through
//      the kernel, and none of them still reads a full name or a body field.
//
// Run: node scripts/test-actor-snapshot-pure.cjs
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
  console.log(`PASS ${label}`)
}

const read = (rel) => fs.readFileSync(path.join(cloudflareRoot, rel), 'utf8')

// ---- 1. compile the real kernel -------------------------------------------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actor-snapshot-'))
fs.copyFileSync(path.join(cloudflareRoot, 'src', 'lib', 'actorSnapshot.ts'), path.join(tmpDir, 'actorSnapshot.ts'))
execSync(
  `npx tsc "${path.join(tmpDir, 'actorSnapshot.ts')}" --outDir "${tmpDir}" --module commonjs --target es2022 --strict --skipLibCheck${ignoreConfigFlag}`,
  { cwd: cloudflareRoot, stdio: 'pipe' },
)
const kernel = require(path.join(tmpDir, 'actorSnapshot.js'))
ok(typeof kernel.actorSnapshot === 'function', 'kernel compiled and exports actorSnapshot')

// The discriminating input: a session where username and full name DIFFER, so
// "username" and "full name" produce different answers. The old three-way
// fallbacks (`user.name || user.username`) return 'Za Sethy' here.
const session = { id: 77, username: 'za', name: 'Za Sethy', is_active: 1 }
const forgedBody = { cashier_name: 'Administrator', userName: 'Administrator' }

assert.equal(kernel.actorSnapshot(session), 'za')
ok(true, 'actorSnapshot() returns the USERNAME, not the full name (za, not "Za Sethy")')
assert.equal(kernel.actorSnapshot({ username: '  za  ', name: 'Za Sethy' }), 'za')
ok(true, 'username is trimmed')
assert.equal(kernel.actorSnapshot({ name: 'Za Sethy' }), null)
ok(true, 'a session with no username yields null -- it never falls back to the full name')
assert.equal(kernel.actorSnapshot(null), null)
assert.equal(kernel.actorSnapshot(undefined), null)
ok(true, 'no session yields null')
// The kernel takes the session only; the body is not one of its inputs, so a
// forged actor string has no path into the stored value.
assert.equal(kernel.actorSnapshot(session), 'za')
assert.notEqual(kernel.actorSnapshot(session), forgedBody.cashier_name)
ok(true, 'a forged body.cashier_name ("Administrator") cannot reach the kernel result')
assert.equal(kernel.actorId(session), 77)
assert.equal(kernel.actorId(null), null)
assert.equal(kernel.actorId({ id: 0 }), null)
ok(true, 'actorId() pairs the id with the username, or null')

// ---- 2. the audit resolution path against the real migration chain ---------
const db = openDb(loadAll())
ok(true, 'full migration chain applied')
db.prepare('INSERT INTO users (id, username, name, password, is_active) VALUES (@id, @username, @name, @password, 1)')
  .bind({ id: 77, username: 'za', name: 'Za Sethy', password: 'x' }).run()

const row = db.prepare(kernel.ACTOR_USERNAME_SQL).bind({ user_id: 77 }).get()
assert.equal(row && row.username, 'za')
ok(true, 'ACTOR_USERNAME_SQL reads the account username by id off the real schema')
// The value every audit() caller passes positionally today is the full name.
assert.equal(kernel.resolveActorUsername(row, 'Za Sethy'), 'za')
ok(true, 'resolveActorUsername ignores a full name passed by the caller')
assert.equal(kernel.resolveActorUsername(row, 'Administrator'), 'za')
ok(true, 'resolveActorUsername ignores a forged caller value')
const missing = db.prepare(kernel.ACTOR_USERNAME_SQL).bind({ user_id: 999 }).get()
assert.equal(kernel.resolveActorUsername(missing, 'za'), 'za')
ok(true, 'a deleted account falls back to the value the caller already resolved')
assert.equal(kernel.resolveActorUsername(missing, null), null)
ok(true, 'a deleted account with nothing to fall back on stores null, never a fabricated name')

// ---- 3. per-writer census --------------------------------------------------
// Every expression that used to put a FULL NAME (or a client string) into an
// actor column. If any of these survive in a writer, that writer is still
// storing the wrong identity.
const BANNED = [
  /\b\w+\s*:\s*user\??\.name\b/,
  /\b\w+\s*:\s*ctx\.user\??\.name\b/,
  /user\??\.name\s*\|\|\s*user\??\.username/,
  /\b\w+_?[Nn]ame\s*:\s*body\.cashier_name/,
  /\b\w+\s*:\s*body\.(cashier_name|user_name|userName)\b/,
]

const WRITERS = [
  ['inventory_movements.user_name (adjust / transfer / move)', 'src/routes/inventory.ts'],
  ['inventory_movements.user_name (delete / adjustment)', 'src/routes/products.ts'],
  ['inventory_movements.user_name + stock_transfers.user_name (branch transfer)', 'src/routes/branches.ts'],
  ['inventory_movements.user_name (batch receive / correction)', 'src/routes/batches.ts'],
  ['sales.cashier_name (POS checkout)', 'src/routes/sales.ts'],
  ['returns.cashier_name + return movements', 'src/routes/returns.ts'],
  // returnsStock.ts takes the actor from its caller, so the kernel call lives
  // in returns.ts (pinned separately below); here it only has to be clean.
  ['damaged_stock_lots.created_by_user_name (write-off)', 'src/lib/returnsStock.ts', false],
  ['stock-in session movements + action_history', 'src/lib/stockSession.ts'],
  ['undo/redo appliers', 'src/lib/undoAppliers.ts'],
  ['grouped sale status', 'src/lib/saleBulkStatus.ts'],
  ['grouped sale update', 'src/lib/saleBulkUpdate.ts'],
  ['grouped return action', 'src/lib/returnBulkAction.ts'],
  ['bulk delete jobs', 'src/lib/bulkDeleteEngine.ts'],
  ['settlement action', 'src/lib/saleSettlementAction.ts'],
]

for (const [label, rel, usesKernel = true] of WRITERS) {
  const src = read(rel)
  const offenders = src.split('\r\n').map((line, i) => [i + 1, line])
    // Comments are allowed to quote the old shape -- these files explain what
    // they replaced. Only real code counts.
    .filter(([, line]) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .filter(([, line]) => BANNED.some((re) => re.test(line)))
  assert.deepEqual(offenders, [], `${rel} still snapshots a full name / client value:\n${offenders.map(([n, l]) => `  ${n}: ${l.trim()}`).join('\n')}`)
  if (usesKernel) assert.ok(/actorSnapshot\(/.test(src), `${rel} does not use the shared actorSnapshot() kernel`)
  ok(true, `writer routes its actor through actorSnapshot(): ${label} (${rel})`)
}

// Write-offs: the damaged-lot writer takes its actor as an argument, so pin
// every call site instead of the writer.
const returnsSrc = read('src/routes/returns.ts')
const damagedLotCalls = returnsSrc.split('createDamagedLot(db, {').slice(1)
assert.ok(damagedLotCalls.length >= 3, `expected the three createDamagedLot call sites, found ${damagedLotCalls.length}`)
let newWriteOffs = 0
let restoredWriteOffs = 0
for (const [i, chunk] of damagedLotCalls.entries()) {
  const head = chunk.slice(0, 600)
  if (/userName:\s*actorSnapshot\(user\)/.test(head)) { newWriteOffs += 1; continue }
  // The rollback path re-creates the ORIGINAL lot after a failed edit; it must
  // restore that lot's own stored actor, not re-stamp the current session.
  if (/userName:\s*lot\.created_by_user_name/.test(head)) { restoredWriteOffs += 1; continue }
  assert.fail(`createDamagedLot call site #${i + 1} neither stamps actorSnapshot(user) nor restores the original lot's actor`)
}
assert.ok(newWriteOffs >= 2, `expected at least two write-off creation sites stamping the session username, found ${newWriteOffs}`)
ok(true, `write-off (damaged_stock_lots) actor: ${newWriteOffs} creation site(s) store the session username, ${restoredWriteOffs} rollback site(s) restore the original snapshot`)

// sales.ts is the one writer that trusted the CLIENT rather than a wrong
// server field, so it gets its own explicit pin.
const salesSrc = read('src/routes/sales.ts')
const salesCode = salesSrc.split('\r\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\r\n')
assert.ok(!/cashier_name:\s*body\.cashier_name/.test(salesCode), 'sales.ts still trusts body.cashier_name')
assert.ok(/cashier_name:\s*actorSnapshot\(user\)/.test(salesSrc), 'sales.ts sale insert does not derive cashier_name from the session')
assert.ok(/cashier_id:\s*actorId\(user\)/.test(salesSrc), 'sales.ts sale insert does not derive cashier_id from the session (id and name must agree, or the rename cascade splits them)')
ok(true, 'POST /api/sales derives BOTH cashier_id and cashier_name from the session')

// audit_logs is written from 130+ call sites that pass a name positionally, so
// the resolution has to live inside audit() itself.
const auditSrc = read('src/lib/audit.ts')
assert.ok(/ACTOR_USERNAME_SQL/.test(auditSrc), 'lib/audit.ts does not resolve the actor username server-side')
assert.ok(/resolveActorUsername/.test(auditSrc), 'lib/audit.ts does not use resolveActorUsername')
ok(true, 'audit_logs actor is resolved from users.id inside audit(), covering every call site')

console.log(`\nOK ${checks} checks`)
