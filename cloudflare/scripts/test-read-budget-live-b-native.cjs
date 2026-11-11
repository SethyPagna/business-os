#!/usr/bin/env node
// GET shapes in the LIVE switch state (budgets.json passes.live: Paid, the switches production runs with), second third: each shape on a fresh isolate, cold calls
// within the live ceiling and the Free hard limit, known failures not worse. The free pass (test-read-budget-gets-*) certifies a different state; see W4 in the D1 audit.
'use strict'

const { runLivePass } = require('./read-budget/runner.cjs')

runLivePass({ partIndex: 1, label: 'test-read-budget-live-b' }).catch((e) => { console.error(`test-read-budget-live-b-native: crashed: ${e && e.stack}`); process.exitCode = 1 })
