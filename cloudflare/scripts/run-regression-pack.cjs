#!/usr/bin/env node
// The Worker-side regression pack: a curated subset of test-*.cjs, one file
// per defect class from the last four release programs (Precision v1,
// iOS/PWA hardening, Program 3, Program 4). See
// docs/testing/regression-classes.md for the full table (class, owner
// report date, fix commit, discriminating check performed). Runs each file
// isolated (its own node process, matching the sweep pattern used by every
// other cloudflare/scripts/test-*.cjs) and prints RED/OK per file.
//
// This is an explicit list, not a directory sweep -- a sweep already exists
// (`for f in test-*.cjs; do ...`, see AGENTS.md/CLAUDE.md) and is the right
// tool for "is anything broken"; this script answers the narrower question
// "are the specific classes seen before still guarded", fast, by name.
'use strict'

const { spawnSync } = require('child_process')
const path = require('path')

// class -> test file (see docs/testing/regression-classes.md for the fix commit each pins)
const PACK = [
  ['P4-1 "Failed to load tagged stock" (migration column vs code)', 'test-tagged-stock-migration-columns-pure.cjs'],
  ['P4-4 hot-endpoint sequential D1 round-trip ceilings', 'test-hot-endpoint-roundtrip-budget-pure.cjs'],
  ['P4-4 audit() is one D1 round trip, not three', 'test-audit-single-roundtrip-pure.cjs'],
  ['P3-11 stock removed entirely books a loss at cost', 'test-removal-losses-pure.cjs'],
  ['Two stock ledgers (branch_stock / lot) stay reconciled', 'test-lot-ledger-reconcile-pure.cjs'],
  ['No negative revenue/profit in any stats reader', 'test-stats-non-negative-pure.cjs'],
  ['Deploy stamp is never blank and a dirty tree is never stamped clean', 'test-build-provenance-pure.cjs'],
  ['P3-1 stock-in edits/reverts mirror into the supplier record', 'test-supplier-attribution-pure.cjs'],
  ['Every applied migration id in the chain is reachable fresh', 'test-migration-chain-fresh-pure.cjs'],
]

let failed = 0
for (const [label, file] of PACK) {
  const full = path.join(__dirname, file)
  const started = Date.now()
  const result = spawnSync(process.execPath, [full], { stdio: 'inherit' })
  const ok = result.status === 0
  const ms = Date.now() - started
  console.log(`${ok ? 'OK  ' : 'RED '} ${file}  (${label})  ${ms} ms`)
  if (!ok) failed += 1
}

console.log(`\nregression pack: ${PACK.length - failed}/${PACK.length} green`)
if (failed > 0) process.exitCode = 1
