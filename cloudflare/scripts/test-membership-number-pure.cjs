// Regression test for the ONE membership-number authority:
// cloudflare/src/lib/membershipNumber.ts, plus migration
// 0110_customers_membership_lc_backfill.sql, run against an in-memory SQLite
// with every real migration applied. The REAL source is transpiled and run --
// nothing here reimplements the logic.
//
// What it pins:
//   1. the house format LC-##### (and that a legacy LCMN- number is NOT one)
//   2. the gap-fill order -- the smallest free number is handed out first
//   3. concurrent minting -- two writers computing the same next number, the
//      UNIQUE index from 0015 arbitrating, and the loser getting the NEXT one
//   4. one minter: no source file mints its own membership number any more
//   5. migration 0110 backfilling existing rows into the same sequence
//
// Run (from cloudflare/): node scripts/test-membership-number-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')

function loadReal(relPath, requireOverrides = {}) {
  const sourcePath = path.join(SRC, relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: sourcePath,
  })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const moduleObj = { exports: {} }
    // eslint-disable-next-line no-new-func
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
    )
    return moduleObj.exports
  } finally {
    Module._load = originalLoad
  }
}

const membership = loadReal('lib/membershipNumber.ts')

let checks = 0
const check = (fn) => { fn(); checks += 1 }

// --- 1. the house format --------------------------------------------------

check(() => assert.equal(membership.MEMBERSHIP_PREFIX, 'LC-', 'the house prefix is LC- (Leang Cosmetic)'))
check(() => assert.equal(membership.formatMembershipNumber(1), 'LC-00001'))
check(() => assert.equal(membership.formatMembershipNumber(4966), 'LC-04966'))
check(() => assert.equal(membership.formatMembershipNumber(99999), 'LC-99999'))
// Past the padded width the format grows rather than wrapping or truncating.
check(() => assert.equal(membership.formatMembershipNumber(100000), 'LC-100000'))
check(() => assert.throws(() => membership.formatMembershipNumber(0), /positive integer/))
check(() => assert.throws(() => membership.formatMembershipNumber(-1), /positive integer/))

check(() => assert.equal(membership.parseMembershipSequence('LC-00042'), 42))
check(() => assert.equal(membership.parseMembershipSequence('  lc-42  '), 42))
check(() => assert.equal(membership.parseMembershipSequence('LC-100000'), 100000))
// The legacy random format is deliberately NOT part of the sequence: such a
// row keeps its number and simply doesn't reserve a sequence slot.
check(() => assert.equal(membership.parseMembershipSequence('LCMN-A1B2C3D4'), null))
check(() => assert.equal(membership.parseMembershipSequence('LC-00000'), null))
check(() => assert.equal(membership.parseMembershipSequence('LC-'), null))
check(() => assert.equal(membership.parseMembershipSequence('LC-12A'), null))
check(() => assert.equal(membership.parseMembershipSequence(null), null))
check(() => assert.equal(membership.parseMembershipSequence(''), null))

// --- 2. the gap-fill rule -------------------------------------------------

check(() => assert.equal(membership.firstFreeMembershipSequence([]), 1, 'an empty shop starts at 1'))
check(() => assert.equal(membership.firstFreeMembershipSequence([1, 2, 3]), 4, 'no gaps -> append'))
check(() => assert.equal(membership.firstFreeMembershipSequence([1, 2, 4]), 3, 'a hole is filled before the sequence grows'))
check(() => assert.equal(membership.firstFreeMembershipSequence([2, 3, 4]), 1, 'the very first number counts as a hole'))
check(() => assert.equal(membership.firstFreeMembershipSequence([4, 1, 2]), 3, 'order of the input does not matter'))

check(() => assert.deepEqual(membership.allocateMembershipSequences([], 3), [1, 2, 3]))
check(() => assert.deepEqual(
  membership.allocateMembershipSequences([1, 3, 6], 4), [2, 4, 5, 7],
  'a batch fills every hole in ascending order, then continues past the end',
))

const allocate = membership.createMembershipNumberAllocator(['LC-00001', 'LC-00003', null, '', 'LCMN-DEADBEEF'])
check(() => assert.equal(allocate(), 'LC-00002', 'the allocator fills the hole first'))
check(() => assert.equal(allocate(), 'LC-00004', 'and remembers what it just handed out'))
check(() => assert.equal(allocate(), 'LC-00005'))

// --- 3. minting against a real database ------------------------------------

const rawDb = openDb(loadAll())
const db = {
  prepare(sql) {
    const stmt = rawDb.prepare(sql)
    return {
      get: async (p) => stmt.get(p),
      all: async (p) => stmt.all(p) || [],
      run: async (p) => {
        const r = stmt.run(p)
        return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
      },
    }
  },
  batch: (items) => rawDb.batch(items),
}

const insertCustomer = (name, membershipNumber) => rawDb
  .prepare('INSERT INTO customers (name, membership_number) VALUES (@name, @membership_number)')
  .run({ name, membership_number: membershipNumber })

async function main() {
  // The unique index from migration 0015 must actually exist on this schema --
  // it is the ONE uniqueness guarantee everything else leans on.
  const index = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_customers_membership_lower_pg'",
  ).get()
  check(() => assert.ok(index, 'migration 0015 UNIQUE index on lower(membership_number) must exist'))

  assert.equal(await membership.mintMembershipNumber(db), 'LC-00001', 'first customer of an empty shop')
  checks += 1

  insertCustomer('First', 'LC-00001')
  insertCustomer('Second', 'LC-00002')
  insertCustomer('Third', 'LC-00003')
  assert.equal(await membership.mintMembershipNumber(db), 'LC-00004', 'contiguous sequence appends')
  checks += 1

  // Delete the middle customer: the number it held is now free and must be
  // reused before the sequence grows -- this is the whole point of gap-filling.
  rawDb.prepare("DELETE FROM customers WHERE membership_number = 'LC-00002'").run({})
  assert.equal(await membership.mintMembershipNumber(db), 'LC-00002', 'a freed number is reused')
  checks += 1

  // A legacy LCMN- row does not reserve a sequence slot.
  insertCustomer('Legacy', 'LCMN-A1B2C3D4')
  assert.equal(await membership.mintMembershipNumber(db), 'LC-00002', 'a non-house number holds no slot')
  checks += 1

  // portal_accounts ids fold in as extra taken numbers.
  assert.equal(
    await membership.mintMembershipNumber(db, ['LC-00002']), 'LC-00004',
    'a number held by a storefront account is not handed out again',
  )
  checks += 1

  // --- concurrent minting -------------------------------------------------
  // Two cashiers registering a walk-in at the same instant both compute the
  // same next number; the UNIQUE index rejects the loser, and the retry hands
  // it the following one instead of an error.
  const first = await membership.mintMembershipNumber(db)
  const second = await membership.mintMembershipNumber(db)
  assert.equal(first, second, 'two mints with no write between them DO collide -- that is why the retry exists')
  checks += 1

  const winner = await membership.withMintedMembershipNumber(db, async (number) => {
    insertCustomer('Walk-in A', number)
    return number
  })
  assert.equal(winner, 'LC-00002', 'the first writer takes the gap')
  checks += 1

  let attempts = 0
  const loser = await membership.withMintedMembershipNumber(db, async (number) => {
    attempts += 1
    insertCustomer('Walk-in B', number)
    return number
  })
  assert.equal(attempts, 1, 'no retry needed once the gap is filled')
  assert.equal(loser, 'LC-00004', 'the next writer gets the next free number, not a duplicate')
  checks += 2

  // Force the race for real: mint, let someone else take that exact number,
  // then run the write. The retry must recover rather than throw.
  const stolen = await membership.mintMembershipNumber(db)
  let raceAttempts = 0
  const recovered = await membership.withMintedMembershipNumber(db, async (number) => {
    raceAttempts += 1
    if (raceAttempts === 1) insertCustomer('Interloper', stolen)
    insertCustomer(`Racer ${raceAttempts}`, number)
    return number
  })
  assert.equal(raceAttempts, 2, 'the collision is caught and the mint retried')
  assert.notEqual(recovered, stolen, 'the retry lands on a different number')
  assert.equal(membership.parseMembershipSequence(recovered) !== null, true, 'and it is still a house number')
  checks += 3

  const collisionError = new Error('D1_ERROR: UNIQUE constraint failed: index \'idx_customers_membership_lower_pg\'')
  assert.equal(membership.isMembershipCollision(collisionError), true)
  assert.equal(membership.isMembershipCollision(new Error('UNIQUE constraint failed: customers.membership_number')), true)
  assert.equal(membership.isMembershipCollision(new Error('UNIQUE constraint failed: customers.phone_normalized')), false)
  assert.equal(membership.isMembershipCollision(new Error('no such column: membership_number')), false)
  checks += 4

  // Every number in the table is unique and every house number parses.
  const all = await db.prepare('SELECT membership_number FROM customers').all()
  const seen = new Set()
  for (const row of all) {
    assert.equal(seen.has(row.membership_number), false, `duplicate membership number ${row.membership_number}`)
    seen.add(row.membership_number)
  }
  checks += 1
}

// --- 4. one minter, not four ----------------------------------------------

const MINTING_SOURCES = [
  'routes/contacts.ts',
  'lib/importEngine.ts',
  'lib/portalAccounts.ts',
]
for (const relPath of MINTING_SOURCES) {
  const source = fs.readFileSync(path.join(SRC, relPath), 'utf8')
  // A minter is a line that BUILDS a number out of entropy. Comments
  // explaining the old `LCMN-` generator are fine; a template literal that
  // produces one is not.
  check(() => assert.equal(
    /`LCMN-\$\{/.test(source), false,
    `${relPath} must not mint its own membership number -- lib/membershipNumber.ts is the one authority`,
  ))
  check(() => assert.match(
    source, /from '.*membershipNumber'/,
    `${relPath} must take its membership numbers from lib/membershipNumber.ts`,
  ))
}

const frontendHelper = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'contacts', 'customerMembershipNumber.ts'), 'utf8',
)
check(() => assert.equal(
  /export function generateCustomerMembershipNumber/.test(frontendHelper), false,
  'the browser must not compose membership numbers -- a pre-filled value defeats the server sequence',
))
check(() => assert.match(frontendHelper, /CUSTOMER_MEMBERSHIP_PREFIX = 'LC'/, 'the frontend shows the LC- house format'))

// --- 5. the backfill migration --------------------------------------------

const { DatabaseSync } = require('node:sqlite')
const backfillSql = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '0110_customers_membership_lc_backfill.sql'), 'utf8',
)

function runBackfill(seed) {
  const scratch = new DatabaseSync(':memory:')
  scratch.exec('CREATE TABLE customers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, membership_number TEXT, updated_at TEXT)')
  scratch.exec("CREATE UNIQUE INDEX idx_customers_membership_lower_pg ON customers (lower(membership_number)) WHERE membership_number IS NOT NULL AND TRIM(membership_number) != ''")
  for (const [id, number] of seed) {
    scratch.prepare('INSERT INTO customers (id, name, membership_number) VALUES (?, ?, ?)').run(id, `c${id}`, number)
  }
  scratch.exec(backfillSql)
  return scratch.prepare('SELECT id, membership_number FROM customers ORDER BY id').all()
    .map((row) => row.membership_number)
}

check(() => assert.deepEqual(runBackfill([]), [], 'an empty table is a no-op, not an error'))
check(() => assert.deepEqual(
  runBackfill([[1, null], [2, null], [3, null]]), ['LC-00001', 'LC-00002', 'LC-00003'],
  'production shape: every customer NULL -> LC-00001.. in id order, oldest first',
))
check(() => assert.deepEqual(
  runBackfill([[1, 'LC-00001'], [2, null], [3, 'LC-00003'], [4, null], [5, null]]),
  ['LC-00001', 'LC-00002', 'LC-00003', 'LC-00004', 'LC-00005'],
  'existing house numbers are kept and their slots reserved; the hole is filled first',
))
check(() => assert.deepEqual(
  runBackfill([[1, 'LCMN-ABCD1234'], [2, ''], [3, 'LC-00002']]),
  ['LC-00001', 'LC-00003', 'LC-00002'],
  'a legacy LCMN- number and a blank are both re-issued from the free list',
))
// The recursive candidate CTE must not run out at production scale.
const bulk = runBackfill(Array.from({ length: 5000 }, (_, index) => [index + 1, null]))
check(() => assert.equal(bulk.length, 5000))
check(() => assert.equal(bulk[0], 'LC-00001'))
check(() => assert.equal(bulk[4965], 'LC-04966', 'the 4966 production customers land on LC-00001..LC-04966'))
check(() => assert.equal(bulk[4999], 'LC-05000'))
check(() => assert.equal(new Set(bulk).size, 5000, 'no number is issued twice'))

main().then(() => {
  console.log(`PASS ${checks} membership-number checks (LC- format, gap-fill, concurrency, one minter, 0110 backfill)`)
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
