'use strict'
// The grouped Inventory Check shapes (ic-history.cjs) on a world with a deterministic check history. Each shape is measured cold then warm exactly as runGetPass does (the ANALYZE pass
// restarts the isolate first), and its rows are compared with its budgets.json entry.
// Two controls on the same world prove the history is exercised: the shape's name-order twin (the reference the design's bound is written against), and the shape itself BEFORE the history
// is seeded (a "checked" grouping must read more rows with 3,020 item rows to look up, and must name a different first group).
const { bootWorld } = require('./world.cjs')
const { passOf } = require('./budgets.cjs')
const { loadBudgets, getProblems, prepareWorld, measureGet, getSwitches, switchFence } = require('./runner.cjs')
const { seedIcHistory, getHistoryShapes } = require('./ic-history.cjs')

// The last page of the branch-1 name list is read from its first page, so the shapes name a page that exists.
async function shapesFor(world) {
  const first = await world.send('GET', '/api/inventory-checks/products?branchId=1&sortBy=name&sortDirection=asc&page=1&pageSize=20')
  if (first.status !== 200) throw new Error('history world: name page ' + first.status)
  const last = first.json.totalPages
  return getHistoryShapes({ lastPage: last, lastPageName: last })
}

const groupKeys = (m) => ((m.warm.json && m.warm.json.grouping && m.warm.json.grouping.groups) || []).map((g) => g.key).join(',')

// observe(shape, grouped, control, baseline) sees every measurement (baseline only when !analyze). Returns the problems found against budgets.json.
async function runHistoryPass({ analyze = false, label, observe } = {}) {
  const budgets = loadBudgets()
  const byId = new Map(budgets.shapes.map((e) => [e.id, e]))
  const world = await bootWorld({ tier: passOf(budgets, 'free').tier, switches: getSwitches(budgets) })
  const reds = []
  const fence = switchFence()
  let n = 0
  try {
    await prepareWorld(world)
    const shapes = await shapesFor(world)
    const baseline = new Map()
    if (!analyze) for (const shape of shapes) baseline.set(shape.id, await measureGet(world, shape, { cold: true }))
    await seedIcHistory(world, world.ctx)
    if (analyze) { await world.analyze(); await world.restart(); await world.login() }
    for (const shape of shapes) {
      const entry = byId.get(shape.id)
      if (analyze) await fence(world, shape)
      const control = await measureGet(world, { ...shape, id: shape.id + '-control', url: shape.control }, { cold: true })
      const grouped = await measureGet(world, shape, { cold: true })
      const before = baseline.get(shape.id)
      if (observe) observe(shape, grouped, control, before)
      n += 1
      if (!entry) { reds.push(`${shape.id}: no budget in budgets.json`); continue }
      const problems = getProblems(entry, grouped, { analyze })
      if (shape.flat) {
        // Answered flat by design (a typed search): no grouping block, and the rows read are the name twin's, not the history's.
        if (grouped.warm.json && grouped.warm.json.grouping) problems.push('positive control: a typed search was answered grouped')
        if (grouped.warm.rowsRead > control.warm.rowsRead * 1.05 + 50) problems.push(`flat search read ${grouped.warm.rowsRead} rows against ${control.warm.rowsRead} for its name twin`)
      } else if (before && /grouped-checked/.test(shape.id)) {
        if (!(grouped.warm.rowsRead > before.warm.rowsRead)) problems.push(`positive control: ${grouped.warm.rowsRead} rows with the history is not above ${before.warm.rowsRead} without it`)
        if (!/last-page/.test(shape.id) && groupKeys(grouped) === groupKeys(before)) problems.push(`positive control: the groups are the same with and without the history (${groupKeys(grouped)})`)
      }
      if (problems.length) reds.push(`${shape.id} (${entry.route}): ${problems.join('; ')}`)
    }
  } finally { await world.dispose() }
  console.log(`${label}: ${n} grouped shapes measured${analyze ? ' with ANALYZE' : ''}, ${reds.length} over budget`)
  for (const line of reds) console.error('RED ' + line)
  if (reds.length) process.exitCode = 1
  return reds
}

module.exports = { runHistoryPass, shapesFor }
