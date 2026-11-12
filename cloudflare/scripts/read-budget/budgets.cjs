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

// Each GET pass is data in budgets.json "passes": a plan tier and the read switches stored for the whole pass.
//   free: the state the Free plan is meant to run in (the ceilings in "shapes" bind it).
//   live: the state production runs in (Paid, the switches last flipped); every shape's cold calls must stay within its cold_calls_max and the Free hard limit,
//         except a route listed in known_failures, which may not get worse and must be removed once it is fixed.
// The next switch flip edits "passes" and nothing else.
function passOf(budgets, name) {
  const pass = budgets.passes && budgets.passes[name]
  if (!pass) throw new Error(`budgets.json has no "${name}" pass`)
  return pass
}

// problems of one shape's cold calls in the live pass; [] when it is within its ceiling or is a known failure that did not get worse
function liveProblems(pass, id, calls) {
  const limit = Math.min(pass.cold_calls_max, FREE_CALL_LIMIT)
  const known = (pass.known_failures || []).find((k) => k.id === id)
  if (!Number.isFinite(calls)) return [`no call count for the live pass${known ? ' (known failure)' : ''}`]
  if (!known) return calls > limit ? [`live cold calls ${calls} > ${limit}${calls > FREE_CALL_LIMIT ? ` (over the Free limit of ${FREE_CALL_LIMIT})` : ''}; fix the route or record it in passes.live.known_failures with a reason`] : []
  if (calls > known.cold_calls) return [`known failure got worse: live cold calls ${calls} > recorded ${known.cold_calls}`]
  if (calls <= limit) return [`known failure is fixed (live cold calls ${calls} <= ${limit}): remove it from passes.live.known_failures`]
  return []
}

module.exports = { BUDGETS_FILE, FREE_CALL_LIMIT, loadBudgets, today, roundUp, callsLimit, passOf, liveProblems }
