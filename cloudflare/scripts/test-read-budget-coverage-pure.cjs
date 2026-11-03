#!/usr/bin/env node
// budgets.json against the Worker it guards: every route the bundled Worker registers has a measured shape or a named
// exemption, and a class; every ceiling is within the Free limits, or carries a dated target; every raise is explained.
// The measured shapes are what the three native read-budget files run (cloudflare/scripts/read-budget/).
'use strict'

const assert = require('assert')
const { execFileSync } = require('child_process')
const path = require('path')
const { registeredRoutes } = require('./read-budget/routes.cjs')
const { getShapes } = require('./read-budget/shapes.cjs')
const { writeShapes } = require('./read-budget/writes.cjs')
const { seedContext } = require('./read-budget/seed.cjs')
const { loadBudgets, today, FREE_CALL_LIMIT } = require('./read-budget/budgets.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const BUDGETS_PATH = 'cloudflare/scripts/read-budget/budgets.json'
const RATCHETED = ['rows_max', 'rows_max_analyze', 'rows_written_max', 'cold_calls_max']
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const CLASSES = new Set(['P', 'N', 'H'])
const HEAVY_ROWS = 50000
const budgets = loadBudgets()
const on = today()
const key = (x) => `${x.method} ${x.route}`
// A shape's "raised" is one note, or an array of notes when several of its fields rose.
const notesOf = (s) => [].concat(s.raised || [])

// The budgets before this change: HEAD while the file has uncommitted edits, else its parent commit. Null when git cannot say
// (a shallow checkout, the commit that introduced the file).
function previousBudgets() {
  const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 })
  try {
    const edited = git(['status', '--porcelain', '--', BUDGETS_PATH]).trim() !== ''
    return JSON.parse(git(['show', `${edited ? 'HEAD' : 'HEAD~1'}:${BUDGETS_PATH}`]))
  } catch { return null }
}

let checks = 0
function check(name, fn) {
  return Promise.resolve().then(fn).then(() => { checks += 1 }, (e) => { console.error(`FAIL ${name}\n  ${e.message}`); process.exitCode = 1 })
}

async function main() {
  const routes = (await registeredRoutes()).filter((r) => r.method !== 'HEAD')
  const shapes = budgets.shapes
  const exemptions = budgets.exemptions

  await check('budgets.json is well formed: unique ids, known classes, a status and a reason for every exemption', () => {
    assert.strictEqual(new Set(shapes.map((s) => s.id)).size, shapes.length, 'duplicate shape id')
    assert.strictEqual(new Set(exemptions.map(key)).size, exemptions.length, 'duplicate exemption')
    for (const s of shapes) {
      assert.ok(CLASSES.has(s.class), `${s.id}: class ${s.class}`)
      for (const field of ['cold_calls_max', 'rows_max', 'rows_max_analyze', 'rows_written_max', 'status']) assert.ok(Number.isInteger(s[field]) && s[field] >= 0, `${s.id}: ${field}`)
      assert.ok(s.expect === 'ok' || (s.expect && typeof s.expect.refused === 'string'), `${s.id}: expect`)
      assert.strictEqual(s.expect === 'ok', s.status < 400, `${s.id}: expect ${JSON.stringify(s.expect)} does not match status ${s.status}`)
    }
    for (const e of exemptions) assert.ok(CLASSES.has(e.class) && budgets.reasons[e.reason], `${key(e)}: exemption needs a class and a reason listed in "reasons"`)
  })

  await check('every route the Worker registers has a budgeted shape or a named exemption, and each of those is a registered route', () => {
    const registered = new Set(routes.flatMap((r) => (r.method === 'ALL' ? [key(r), ...METHODS.map((m) => `${m} ${r.route}`)] : [key(r)])))
    const budgeted = new Set(shapes.map(key))
    const exempt = new Set(exemptions.map(key))
    const sharedPaths = new Set([...shapes, ...exemptions].map((x) => x.route))
    // A route registered for every method (app.all, a path-level middleware) is covered by any budget on the same path.
    const unbudgeted = routes.filter((r) => !budgeted.has(key(r)) && !exempt.has(key(r)) && !(r.method === 'ALL' && sharedPaths.has(r.route))).map(key)
    assert.deepStrictEqual(unbudgeted, [], `routes with no budget and no exemption (measure a shape, or add an exemption with a reason):\n  ${unbudgeted.join('\n  ')}`)
    const stale = [...shapes.map(key), ...exemptions.map(key)].filter((k) => !registered.has(k))
    assert.deepStrictEqual([...new Set(stale)], [], 'budgets for routes the Worker no longer registers')
    const both = exemptions.filter((e) => budgeted.has(key(e))).map(key)
    assert.deepStrictEqual(both, [], 'a route is both budgeted and exempt')
  })

  await check('the shapes the tests run and the shapes budgeted are the same set', () => {
    const run = [...getShapes(seedContext()), ...writeShapes(seedContext())].map((s) => s.id).sort()
    assert.deepStrictEqual(shapes.map((s) => s.id).sort(), run)
  })

  await check('class H exactly when the ceiling is above 50,000 rows or the shape is long-range; P stays under it', () => {
    const longRange = new Set(getShapes(seedContext()).filter((s) => s.longRange).map((s) => s.id))
    for (const s of shapes) {
      const heavy = s.rows_max > HEAVY_ROWS || s.rows_max_analyze > HEAVY_ROWS || longRange.has(s.id)
      assert.strictEqual(s.class === 'H', heavy, `${s.id}: class ${s.class}, rows_max ${s.rows_max}, analyze ${s.rows_max_analyze}, long range ${longRange.has(s.id)}`)
    }
  })

  await check('a ceiling above 50 cold calls carries a dated target, and from its date the target binds', () => {
    for (const s of shapes) {
      assert.strictEqual(s.cold_calls_max > FREE_CALL_LIMIT, Boolean(s.target), `${s.id}: cold_calls_max ${s.cold_calls_max}, target ${JSON.stringify(s.target)}`)
      if (!s.target) continue
      assert.ok(s.target.cold_calls_max <= 45 && /^P\d\.\d/.test(s.target.slice) && /^\d{4}-\d{2}-\d{2}$/.test(s.target.by), `${s.id}: malformed target`)
      if (on >= s.target.by) assert.ok(s.cold_calls_max <= s.target.cold_calls_max, `${s.id}: ${s.target.slice} was due ${s.target.by}: ${s.cold_calls_max} cold calls, target ${s.target.cold_calls_max}`)
    }
  })

  await check('the read switches the GET shapes are measured with name a known switch and state, and the gate says what that certifies', () => {
    const KNOWN = { report_atomic: ['on'], report_atomic_long: ['on'], expense_reads: ['on'] }
    const switches = budgets.switches || {}
    for (const [name, state] of Object.entries(switches)) assert.ok(KNOWN[name] && KNOWN[name].includes(state), `unknown switch or state ${name}=${state}`)
    for (const s of shapes) assert.ok(!('switches' in s), `${s.id}: switches are stored once for the whole GET pass (budgets.json "switches"), not per shape`)
    // The ceilings of the GET shapes bind the path those switches choose. A deploy without the stored row runs the old path, whose ceilings are not enforced here.
    console.log(`read-budget: GET shapes are measured with read switches ${JSON.stringify(switches)} stored (the old path runs until the owner flips them); write shapes with none`)
  })

  await check('from the programme date every shape reads at most 100,000 rows', () => {
    const { rows_ceiling: ceiling, by } = budgets.programme
    const over = shapes.filter((s) => Math.max(s.rows_max, s.rows_max_analyze) > ceiling).map((s) => `${s.id} ${Math.max(s.rows_max, s.rows_max_analyze)}`)
    console.log(`read-budget: ${over.length} of ${shapes.length} shapes are above ${ceiling} rows until ${by}`)
    if (on >= by) assert.deepStrictEqual(over, [], `due ${by}, ceiling ${ceiling}:\n  ${over.join('\n  ')}`)
  })

  await check('a Free-config refusal names the slice that lifts it, and a raised ceiling says why (printed for the reviewer)', () => {
    const refused = shapes.filter((s) => s.expect !== 'ok' && s.method !== 'GET')
    for (const s of refused) assert.ok(s.expect.until === null || /^P\d\.\d/.test(s.expect.until), `${s.id}: until`)
    console.log(`read-budget: ${refused.filter((s) => s.expect.until).length} write shapes refused on the Free config until a named slice: ${refused.filter((s) => s.expect.until).map((s) => `${s.id}->${s.expect.until}`).join(', ') || 'none'}`)
    for (const s of shapes.filter((x) => x.raised)) for (const note of notesOf(s)) {
      assert.ok(Number.isInteger(note.from) && typeof note.reason === 'string' && note.reason.length > 8, `${s.id}: raised needs from and reason`)
      const field = note.field || 'rows_max'
      console.log(`RAISED ${s.id} ${field}: ${note.from} -> ${s[field]}. ${note.reason}`)
    }
  })

  await check('ratchet: no ceiling went up against the previous budgets without a "raised" note that names the old value', () => {
    const previous = previousBudgets()
    if (!previous) return console.log('read-budget: no previous budgets.json to compare with (new file or shallow checkout); ratchet not checked')
    const before = new Map(previous.shapes.map((s) => [s.id, s]))
    for (const s of shapes) {
      const old = before.get(s.id)
      if (!old) continue
      for (const field of RATCHETED) {
        if (!(s[field] > old[field])) continue
        const note = notesOf(s).find((n) => (n.field || 'rows_max') === field)
        assert.ok(note, `${s.id}: ${field} rose from ${old[field]} to ${s[field]} with no "raised" note for it`)
        assert.strictEqual(note.from, old[field], `${s.id}: raised.from ${note.from} is not the previous ${field} ${old[field]}`)
      }
    }
  })

  if (process.exitCode) console.error(`test-read-budget-coverage-pure: FAILED (${checks} passed)`)
  else console.log(`test-read-budget-coverage-pure: ${checks} checks passed`)
}

main().catch((e) => { console.error(`test-read-budget-coverage-pure: crashed: ${e && e.stack}`); process.exitCode = 1 })
