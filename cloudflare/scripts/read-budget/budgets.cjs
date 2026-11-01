'use strict'
// budgets.json and the arithmetic on it. No Miniflare here, so the pure coverage test stays light.
const fs = require('node:fs')
const path = require('node:path')

const BUDGETS_FILE = path.join(__dirname, 'budgets.json')
const FREE_CALL_LIMIT = 50

const loadBudgets = () => JSON.parse(fs.readFileSync(BUDGETS_FILE, 'utf8'))
const today = () => process.env.READ_BUDGET_TODAY || new Date().toISOString().slice(0, 10)
const roundUp = (measured) => Math.max(Math.ceil(measured * 1.1), measured < 80 ? measured + 8 : 0)

// The cold-call ceiling in force: a shape with a dated target keeps its measured ceiling until the date, then the target binds.
function callsLimit(entry, on = today()) {
  if (entry.target) return on >= entry.target.by ? entry.target.cold_calls_max : entry.cold_calls_max
  return Math.min(entry.cold_calls_max, FREE_CALL_LIMIT)
}

module.exports = { BUDGETS_FILE, FREE_CALL_LIMIT, loadBudgets, today, roundUp, callsLimit }
