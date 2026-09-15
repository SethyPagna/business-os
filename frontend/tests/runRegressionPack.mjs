// The `npm run test:regression` gate.
//
// A curated subset of tests/*.test.ts, one file per defect class from the
// last four release programs (Precision v1, iOS/PWA hardening, Program 3,
// Program 4 -- see docs/testing/regression-classes.md for the full table:
// class, owner report date, fix commit, discriminating check performed).
// This is deliberately an explicit list, not a substring filter over
// tests/ -- a filter can silently start matching an unrelated file (or stop
// matching a renamed one) with no red to notice it. Every file here still
// runs as part of the full `npm run test:utils` chain too; this script only
// gives a fast, named way to re-run exactly the regression pack.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// class -> test file (see docs/testing/regression-classes.md for the fix commit each pins)
const PACK = [
  ['P4-2 same-name supplier resolves directly, no duplicate row', 'contactDuplicateDecision.test.ts'],
  ['P3-3 tagged damaged/broken child rows keep-or-remove choice', 'stockConditionTag.test.ts'],
  ['P4-4 sticky headers drop backdrop-blur when background is opaque', 'stickyHeaderBlurRemoval.test.ts'],
  ['P4-4 precache eager/deferred split stays under its size budget', 'precacheEagerDeferredSplit.test.ts'],
  ['Dates render day-first everywhere', 'dateFormatDayFirst.test.ts'],
  ['P3-5 add/remove/set stock reasons on every writer', 'fastStockInReasons.test.ts'],
  ['No negative revenue/profit in the Reports hub', 'reportsHub.test.ts'],
  ['No negative revenue/profit on the branch products surface', 'branchProductsSurface.test.ts'],
]

let failed = 0
for (const [label, file] of PACK) {
  const full = path.join(here, file)
  const started = Date.now()
  const result = spawnSync('node', [full], { stdio: 'inherit' })
  const ok = result.status === 0
  const ms = Date.now() - started
  console.log(`${ok ? 'OK  ' : 'RED '} ${file}  (${label})  ${ms} ms`)
  if (!ok) failed += 1
}

console.log(`\nregression pack: ${PACK.length - failed}/${PACK.length} green`)
if (failed > 0) process.exitCode = 1
