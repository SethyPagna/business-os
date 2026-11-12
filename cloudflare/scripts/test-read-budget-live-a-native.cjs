#!/usr/bin/env node
// GET shapes in the LIVE switch state (budgets.json passes.live: Paid, the switches production runs with), first third: each shape on a fresh isolate, cold calls
// within the live ceiling and the Free hard limit, known failures not worse. The free pass (test-read-budget-gets-*) certifies a different state; see W4 in the D1 audit.
'use strict'

const { runLivePass } = require('./read-budget/runner.cjs')

runLivePass({ partIndex: 0, label: 'test-read-budget-live-a' }).catch((e) => { console.error(`test-read-budget-live-a-native: crashed: ${e && e.stack}`); process.exitCode = 1 })
