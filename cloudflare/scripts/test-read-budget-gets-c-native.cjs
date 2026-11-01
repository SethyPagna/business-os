#!/usr/bin/env node
// GET shapes, last third. See test-read-budget-gets-a-native.cjs.
'use strict'

const { runGetPass } = require('./read-budget/runner.cjs')

runGetPass({ partIndex: 2, label: 'test-read-budget-gets-c' }).catch((e) => { console.error(`test-read-budget-gets-c-native: crashed: ${e && e.stack}`); process.exitCode = 1 })
