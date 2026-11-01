#!/usr/bin/env node
// Write shapes on the Free plan: calls <= min(ceiling, 50) on a cold isolate, rows read and written within budget, and a request the Free config
// refuses (expect.refused) is refused before any write (a row-count diff over the touched tables).
'use strict'

const { runWritePass } = require('./read-budget/runner.cjs')

runWritePass({ label: 'test-read-budget-writes' }).catch((e) => { console.error(`test-read-budget-writes-native: crashed: ${e && e.stack}`); process.exitCode = 1 })
