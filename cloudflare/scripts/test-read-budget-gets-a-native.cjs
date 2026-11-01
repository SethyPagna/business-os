#!/usr/bin/env node
// GET shapes, first third: each shape on a fresh isolate (cold calls <= min(ceiling, 50)) and again with the Cache API missing (rows read and written
// within the budget). Warm-miss is also the number a workers.dev client gets, where the Cache API stores nothing. Budgets: read-budget/budgets.json.
// The shapes are split by a hash of their id into three files so that each stays under four minutes (a cold isolate costs ~1.5 s).
'use strict'

const { runGetPass } = require('./read-budget/runner.cjs')

runGetPass({ partIndex: 0, label: 'test-read-budget-gets-a' }).catch((e) => { console.error(`test-read-budget-gets-a-native: crashed: ${e && e.stack}`); process.exitCode = 1 })
