// Guards against the exact defect fixed by
// test-migration-0167-removal-cost-backfill-pure.cjs: a migration whose
// verification script exists but is never picked up by the sweep in
// AGENTS.md/CLAUDE.md ("for f in test-*.cjs; do node "$f" ...") because its
// filename doesn't start with test-migration-<NNNN> or isn't listed in the
// ALLOWLIST below with a stated reason.
//
// Rule: every cloudflare/migrations/NNNN_*.sql from 0165 upward must have a
// companion cloudflare/scripts/test-migration-<NNNN>*-pure.cjs (a single
// test file may cover more than one number, e.g. test-migration-0165-0166-
// pure.cjs covers both 0165 and 0166 -- the migration number just has to
// appear in the filename), a verified NAMED_COMPANIONS entry, OR an explicit
// ALLOWLIST entry with a reason.
// 0165 is the floor because it is the oldest migration already under this
// convention: earlier migrations (0164 and below) are pinned by
// differently-named scripts (verify-0164-supplier-clusters.cjs etc.) that
// predate this guard and are out of scope here.
//
// Run: node scripts/test-migration-registration-coverage-pure.cjs
const fs = require('fs')
const path = require('path')
const assert = require('assert')

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')
const SCRIPTS_DIR = __dirname
const FLOOR = 165

// Migration numbers >= FLOOR that are deliberately exempt from needing a
// test-migration-<NNNN>*-pure.cjs companion, with the reason recorded here
// instead of left as a silent gap. Empty today -- every migration from 0165
// up has real coverage (see the assertion below).
const ALLOWLIST = {
  // Example shape, not a real exemption:
  // 9999: 'covered instead by scripts/test-something-else-pure.cjs because ...',
}

// These are real test-*.cjs sweep companions, not coverage exemptions.
// Require the named file to exist so deleting/renaming it fails this guard.
const NAMED_COMPANIONS = {
  184: 'test-product-cost-previous-migration-native.cjs',
  // 0188/0190/0191 are unapplied, unwired foundations (transfer receipt
  // retirement, dataset operation journal and its generation transition); their
  // schema and triggers are exercised by these native/pure companions.
  188: 'test-transfer-receipt-retirement-native.cjs',
  190: 'test-dataset-operation-native.cjs',
  191: 'test-dataset-operation-transition-native.cjs',
  // 0192 creates stock_mutation_receipts, the per-line idempotency table for
  // the two single-line stock kernels. Its companion applies the real
  // migration chain and drives runAdjustAction / runReceiveBatchAction
  // through a repeat, a control and the no-table fallback.
  192: 'test-stock-mutation-receipt-pure.cjs',
  // 0194 creates telegram_scheduled_sends, the one-send-per-shift record for
  // T10's Reports overview. Its companion applies the real migration and
  // drives schedule / queue delivery / drain through duplicates, races,
  // retries, reopen + reclose and the toggle.
  194: 'test-telegram-shift-overview-pure.cjs',
}

function listMigrationNumbers() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => {
      const m = f.match(/^(\d{4})_/)
      return m ? Number(m[1]) : null
    })
    .filter((n) => n !== null && n >= FLOOR)
    .sort((a, b) => a - b)
}

function listCoveredNumbers() {
  const files = fs.readdirSync(SCRIPTS_DIR).filter((f) => /^test-migration-.*-pure\.cjs$/.test(f))
  const covered = new Set()
  for (const [number, file] of Object.entries(NAMED_COMPANIONS)) {
    assert.match(file, /^test-.*\.cjs$/, 'companion must be picked up by the Worker sweep')
    assert.ok(fs.existsSync(path.join(SCRIPTS_DIR, file)), `missing migration ${number} companion: ${file}`)
    const source = fs.readFileSync(path.join(SCRIPTS_DIR, file), 'utf8')
    assert.ok(source.includes(`${String(number).padStart(4, '0')}_`), `companion must reference migration ${number}`)
    covered.add(Number(number))
  }
  for (const file of files) {
    // Pull every 4-digit run out of the filename, e.g.
    // "test-migration-0165-0166-pure.cjs" -> [165, 166].
    const matches = file.match(/\d{4}/g) || []
    for (const m of matches) covered.add(Number(m))
  }
  return covered
}

function findUncovered(migrationNumbers, coveredNumbers) {
  return migrationNumbers.filter((n) => !coveredNumbers.has(n) && !(n in ALLOWLIST))
}

// --- Positive control -------------------------------------------------
// A guard that always reports "all covered" is worthless. Prove the
// detector actually fires: fabricate a migration number nothing covers and
// nothing allowlists, and assert findUncovered() flags exactly it.
{
  const fakeNumbers = [9601, 9602]
  const fakeCovered = new Set([9601]) // 9602 is deliberately left uncovered
  const flagged = findUncovered(fakeNumbers, fakeCovered)
  assert.deepStrictEqual(flagged, [9602], 'positive control: the detector must flag an uncovered fake migration number')
  console.log('PASS positive control -- an uncovered fake migration number (9602) is correctly flagged')
}

// --- Real sweep ---------------------------------------------------------
const migrationNumbers = listMigrationNumbers()
assert.ok(migrationNumbers.length > 0, 'expected at least one migration numbered >= 0165 in migrations/')
const coveredNumbers = listCoveredNumbers()
const uncovered = findUncovered(migrationNumbers, coveredNumbers)

assert.deepStrictEqual(
  uncovered,
  [],
  `migration(s) ${uncovered.map((n) => String(n).padStart(4, '0')).join(', ')} have no test-migration-<NNNN>*-pure.cjs companion and no ALLOWLIST entry -- add a test file or an allowlist reason`,
)
console.log(`PASS every migration from 0${FLOOR} up (${migrationNumbers.length} migrations) has a numbered or verified named companion, or an allowlisted reason`)
