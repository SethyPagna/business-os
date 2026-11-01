#!/usr/bin/env node
// GET shapes, second third. See test-read-budget-gets-a-native.cjs.
'use strict'

const { runGetPass } = require('./read-budget/runner.cjs')

runGetPass({ partIndex: 1, label: 'test-read-budget-gets-b' }).catch((e) => { console.error(`test-read-budget-gets-b-native: crashed: ${e && e.stack}`); process.exitCode = 1 })
