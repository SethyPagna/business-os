// Guard: keeps `tsc --noEmit --noUnusedLocals --noUnusedParameters` diagnostics
// in cloudflare/ at or below a known budget, mirroring
// frontend/tests/unusedLocalsBudget.test.ts. This does NOT turn the flags on
// in cloudflare/tsconfig.json -- ad hoc scan only, same as the p10 lane used.
//
// As of the p10-debloat lane, all 4 remaining diagnostics are either an
// explicit file-ownership exclusion for this lane or one of three specific
// "kept-live" flags a prior program (Program 8) already investigated and
// deliberately did not remove:
//
// - src/routes/products.ts(3531,31) 'ids' -- excluded file (products.ts is on
//   the p10 lane's explicit do-not-touch list; a sibling lane owns it).
// - src/lib/salesAnalytics.ts(1707,9) 'recognizedStoreDeliveryUsd' -- computed
//   alongside recognizedTaxUsd/recognizedDeliveryUsd/recognizedDeliveryCostUsd,
//   which ARE returned in the totals payload; this one alone is not. Looks
//   like a real reporting gap (a recognized store-delivery figure that should
//   be exposed alongside its siblings but isn't wired into the response), not
//   routine dead code -- left for a feature owner, re-verified still
//   unreferenced anywhere in src/ or scripts/ as of this scan.
// - src/routes/inventory.ts(2392,9) 'movementBatchId' -- computed in the
//   single-item branch transfer handler per the "0084 blank-honest stamping"
//   comment right above it (one lot truthfully owning the whole movement
//   should stamp it), but never applied to the movement row. Same shape as
//   above: looks like a missing stamp, not dead code -- left for a feature
//   owner, re-verified still unreferenced anywhere in src/ or scripts/.
// - src/routes/returns.ts(90,7) 'ReplacementCustomerStateConflictError' --
//   an Error subclass declared but never thrown/caught anywhere in src/ or
//   scripts/; re-verified still unreferenced.
//
// Any new name that appears in the scan and is NOT one of the above must
// either be removed (if genuinely dead) or added to this list with a reason,
// and BUDGET updated to match -- the budget only moves when this comment is
// updated to say why.
//
// Run: node scripts/test-unused-locals-budget-pure.cjs
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const assert = require('node:assert/strict')

const root = path.join(__dirname, '..')

const EXCLUDED_SIBLING_FILES = ['cloudflare/src/routes/products.ts'].join(', ')

const BUDGET = 4

const result = spawnSync(
  process.execPath,
  [
    path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--noEmit',
    '--noUnusedLocals',
    '--noUnusedParameters',
    '-p',
    'tsconfig.json',
  ],
  { cwd: root, encoding: 'utf8' },
)

const output = `${result.stdout || ''}${result.stderr || ''}`
const diagnosticLines = output
  .split(/\r?\n/)
  .filter((line) => /error TS6133:|error TS6196:/.test(line))

assert.ok(
  diagnosticLines.length <= BUDGET,
  `tsc --noUnusedLocals --noUnusedParameters reported ${diagnosticLines.length} diagnostics in ` +
    `cloudflare/, over the p10-debloat budget of ${BUDGET}. The excluded sibling-owned file ` +
    `(${EXCLUDED_SIBLING_FILES}) and the three kept-live flags documented at the top of this file ` +
    `explain the current budget -- if this is a genuinely new dead local, remove it and lower ` +
    `BUDGET; if it's another sibling-owned or deliberately-kept case, add it to the comment and ` +
    `raise BUDGET by exactly the number of new lines.\n${diagnosticLines.join('\n')}`,
)

console.log(`PASS unused-locals budget (cloudflare): ${diagnosticLines.length} diagnostic(s), budget ${BUDGET}`)
