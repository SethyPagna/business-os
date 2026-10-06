// DATA-AUDIT lane B (stock & cost): every ops/queries/audit-b-*.sql runs here on a real migrated SQLite
// (cloudflare/scripts/audit-b-world.cjs, D1's depth and bind limits) against
//   - a CLEAN control world: every zero-expected column must read exactly 0 (and the sweep must say so for each query,
//     so a dead instrument cannot look like a clean database: see memory sweep-needs-a-positive-control), and
//   - planted inconsistencies: each defect is a plain UPDATE/DELETE/INSERT on top of the clean world, and the one named
//     column must rise to the exact planted count while every other zero-expected column stays 0 (a plant that moves two
//     columns is a plant of two defects, said so in its row).
// Each query also passes the ops read-only guard (identically for LF and CRLF), carries the header the lead needs (purpose,
// owner rule, columns, expected values, measured cost) and keeps every LIKE/GLOB pattern within D1's 50 bytes.
// Run (from cloudflare/): node scripts/test-audit-b-queries-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { World, cleanWorld, activeWorld, SHOP, WAREHOUSE, LEGACY } = require('./audit-b-world.cjs')

const root = path.resolve(__dirname, '../..')
const QUERIES = path.join(root, 'ops/queries')
const NAMES = fs.readdirSync(QUERIES).filter((f) => /^audit-b-.*\.sql$/.test(f)).map((f) => f.slice(0, -4)).sort()

let guardModule
async function guard() { return guardModule || (guardModule = await import(pathToFileURL(path.join(root, 'ops/scripts/ops-sql-guard.mjs')).href)) }

const sources = new Map()
function source(name) { if (!sources.has(name)) sources.set(name, fs.readFileSync(path.join(QUERIES, name + '.sql'), 'utf8')) }
async function loaded(name) { source(name); return (await guard()).guardSql(sources.get(name)) }

/** Run one query on a world: { rows, rules }. */
async function run(w, name) {
  const { sql, rules } = await loaded(name)
  const rows = w.raw.prepare(sql).all().map((r) => ({ ...r }))
  return { rows, rules, sql }
}
const zeroCols = (rules) => (Array.isArray(rules.expectZero) ? rules.expectZero : [])
/** The zero-expected columns that are not 0, as { column: value }. */
function violations(result) {
  const out = {}
  for (const col of zeroCols(result.rules)) for (const row of result.rows) if (Number(row[col]) !== 0) out[col] = (out[col] || 0) + Number(row[col])
  return out
}

let checks = 0
async function check(name, fn) { await fn(); checks += 1; console.log('PASS ' + name) }

/** plant(worldMutator) -> assert the query reports exactly `expected` (column -> value) on the zero-expected columns. */
async function planted(name, label, mutate, expected, { base = cleanWorld } = {}) {
  const w = base()
  mutate(w)
  const result = await run(w, name)
  const got = violations(result)
  expected = Object.fromEntries(Object.entries(expected).filter(([, v]) => v !== 0)) // a stated 0 documents a column that must NOT move
  assert.deepEqual(got, expected, `${name} / ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`)
  w.raw.close()
  return result
}

const SECTIONS = []
const section = (name, fn) => SECTIONS.push([name, fn])

async function main() {
  const g = await guard()
  await check('the lane-B query set is present (in run order)', () => {
    assert.deepEqual(NAMES, NAMES.slice().sort())
    assert.ok(NAMES.length >= 1, 'no audit-b queries yet')
  })
  await check('every audit-b query passes the ops guard, for LF and CRLF, with a complete header and D1-safe patterns', async () => {
    for (const name of NAMES) {
      source(name)
      const text = sources.get(name)
      assert.ok(/^[a-z0-9][a-z0-9-]{0,63}$/.test(name))
      const { sql, rules } = g.guardSql(text)
      const lf = text.replace(/\r\n/g, '\n')
      assert.equal(g.guardSql(lf.replace(/\n/g, '\r\n')).sql, sql, name)
      assert.ok(!/\bUNION\b[\s\S]*\bUNION\b[\s\S]*\bUNION\b[\s\S]*\bUNION\b/i.test(sql.replace(/'[^']*'/g, '')), name + ': more than three compound operators')
      assert.ok(sql.length <= g.MAX_SQL_CHARS, name + ' canonical text ' + sql.length)
      assert.ok(rules.maxRows !== null, name + ': no ops:max-rows')
      for (const p of [...sql.matchAll(/\b(?:GLOB|LIKE)\s+'((?:[^']|'')*)'/gi)].map((m) => m[1])) assert.ok(Buffer.byteLength(p) <= 50, name + ': pattern over 50 bytes: ' + p)
      const header = lf.split('\n').filter((l) => l.startsWith('--')).join('\n')
      for (const word of ['Owner', 'Measured cost']) assert.ok(header.includes(word), `${name}: header lacks "${word}"`)
      assert.ok(!/(^|\s)(INSERT|UPDATE|DELETE|DROP|ALTER|PRAGMA)\s/i.test(sql), name)
      assert.ok(!/\?|@\w|:\w+\b/.test(sql.replace(/'[^']*'/g, '').replace(/\b\d{1,2}:\d{2}/g, '')), name + ': a bound parameter (the ops task binds none)')
    }
  })
  await check('on both clean control worlds (bare, and with sales / returns / transfer / revert history) every audit-b query reports 0 on every zero-expected column', async () => {
    for (const name of NAMES) {
      for (const build of [cleanWorld, activeWorld]) {
        const w = build()
        const result = await run(w, name)
        assert.ok(result.rows.length >= (result.rules.minRows || 0), name + ': too few rows')
        assert.ok(zeroCols(result.rules).length > 0, name + ' declares no zero-expected column')
        assert.deepEqual(violations(result), {}, name + ' is not clean on the ' + build.name)
        w.raw.close()
      }
    }
  })
  for (const [name, fn] of SECTIONS) await check(name, fn)
  console.log(`${checks} audit-b query checks passed`)
}

module.exports = { section, planted, run, violations, check, cleanWorld, activeWorld, World, SHOP, WAREHOUSE, LEGACY, assert }
if (require.main === module) {
  // The sections live in audit-b-test-sections.cjs so the file stays readable; they register themselves on load.
  require('./audit-b-test-sections.cjs')
  main().catch((error) => { console.error(error); process.exitCode = 1 })
}
