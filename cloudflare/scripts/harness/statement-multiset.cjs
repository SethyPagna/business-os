'use strict'
// Compares the D1 statements of one request in two worlds (proof-twin-order-only.cjs), as a MULTISET and not by position.
//
// harness/read-cost-world.cjs records a statement when it COMPLETES, and a route that runs Promise.all([...]) has several in flight, so two worlds running the same route
// can log the same statements in different orders (a shape's metadata SELECT landing at index 10 in one and 6 in the other). Comparing by index then reports
// "statement 10 differs outside an ORDER BY statement" for statements that are the same set. Here every statement of the lane is matched to one statement of the base:
// first by identical text, then, for the rest, a statement that differs only inside an ORDER BY clause (both carry one, and the first 60 characters of the squashed text agree,
// as the patches replace exactly those constants). A statement with no counterpart, in either direction, is a real difference and throws.

const squash = (sql) => String(sql).replace(/\s+/g, ' ')
const head = (sql) => squash(sql).slice(0, 60)
const orderBy = (sql) => /ORDER BY/.test(sql)

// lane, base: arrays of SQL text. Returns { differing } (the lane statements whose text is not byte-equal to their match).
function matchStatements(lane, base, label = 'request') {
  if (lane.length !== base.length) throw new Error(`${label}: ${lane.length} statements in the lane, ${base.length} in the base`)
  const unmatchedBase = new Map()
  for (const sql of base) unmatchedBase.set(sql, (unmatchedBase.get(sql) || 0) + 1)
  const laneLeft = []
  for (const sql of lane) {
    const left = unmatchedBase.get(sql)
    if (left) { if (left === 1) unmatchedBase.delete(sql); else unmatchedBase.set(sql, left - 1) } else laneLeft.push(sql)
  }
  const baseLeft = [...unmatchedBase.entries()].flatMap(([sql, count]) => Array(count).fill(sql))
  for (const sql of laneLeft) {
    const at = baseLeft.findIndex((was) => orderBy(sql) && orderBy(was) && head(sql) === head(was))
    if (at < 0) throw new Error(`${label}: a lane statement has no counterpart outside an ORDER BY statement: ${squash(sql).slice(0, 160)}`)
    baseLeft.splice(at, 1)
  }
  return { differing: laneLeft.length }
}

module.exports = { matchStatements }
