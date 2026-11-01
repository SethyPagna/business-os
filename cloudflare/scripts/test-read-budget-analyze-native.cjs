#!/usr/bin/env node
// Every GET shape again after ANALYZE on the seeded copy: planner statistics turned the Inventory Check name page into a ~220M-row read, so each
// shape has its own rows_max_analyze. A 20 s deadline per request reports a runaway shape as over budget instead of timing the file out.
'use strict'

const { runGetPass } = require('./read-budget/runner.cjs')

runGetPass({ analyze: true, label: 'test-read-budget-analyze' }).catch((e) => { console.error(`test-read-budget-analyze-native: crashed: ${e && e.stack}`); process.exitCode = 1 })
