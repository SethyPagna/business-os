// Registration-coverage wrapper for migrations/0167_removal_cost_snapshot_backfill.sql.
//
// scripts/verify-0167-removal-cost-backfill.cjs already contains the full
// offline (better-sqlite3, no remote D1) fixture verification -- pre/post
// full-table hashing, an idempotent second-run check, and the exact
// production shape (movement id 47026 backfilled from its same-name twin).
// That file is intentionally NOT named test-*.cjs (its filename predates the
// test-migration-<NNNN>*-pure.cjs convention and it also supports an
// optional real-sqlite-file argv mode for manual replica checks), so the
// blanket sweep `for f in test-*.cjs; do node "$f"; done` never runs it and
// CI silently skips 0167's own regression coverage. This thin wrapper is the
// test-*.cjs companion required by
// scripts/test-migration-registration-coverage-pure.cjs: it just runs the
// verify script's fixture mode (no argv, so no real file is ever touched) as
// a child process and fails loudly if it exits non-zero.
//
// Run: node scripts/test-migration-0167-removal-cost-backfill-pure.cjs
const path = require('path')
const { spawnSync } = require('child_process')

const verifyScript = path.join(__dirname, 'verify-0167-removal-cost-backfill.cjs')
const result = spawnSync(process.execPath, [verifyScript], { encoding: 'utf8' })

if (result.status !== 0) {
  console.error(result.stdout)
  console.error(result.stderr)
  throw new Error(`verify-0167-removal-cost-backfill.cjs exited ${result.status}`)
}

console.log(result.stdout.trim())
console.log('PASS test-migration-0167-removal-cost-backfill-pure.cjs (wraps verify-0167-removal-cost-backfill.cjs fixture mode)')
