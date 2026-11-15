#!/usr/bin/env node
// Grouped Inventory Check list (groupBy=checked|category, ic_simple): rows read on a world with 30 days of check history, against budgets.json, and each shape above its name-order twin
// on the same world (the positive control: the history is exercised). Then the same shapes after ANALYZE. Shapes: read-budget/ic-history.cjs.
'use strict'

const { runHistoryPass } = require('./read-budget/history-pass.cjs')

;(async () => {
  await runHistoryPass({ label: 'test-read-budget-ic-history' })
  await runHistoryPass({ analyze: true, label: 'test-read-budget-ic-history' })
})().catch((e) => { console.error(`test-read-budget-ic-history-native: crashed: ${e && e.stack}`); process.exitCode = 1 })
