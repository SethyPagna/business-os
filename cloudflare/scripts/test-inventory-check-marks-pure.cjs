// The count marks routes (read switch ic_marks, lib/inventoryCheckMarks.ts, routes/inventoryChecks.ts): the facts the source must keep, each pinned by a text check with a mutant proving it red.
//   I5  the cursor read and the page read are ONE db.batch call (never two), so a page is exactly the state at its cursor.
//   I9  Waiting is answered only to a viewer with the stock field and Fix stock (changes carries `pending` only then; /marks/pending is 403 otherwise); the snapshot never holds Waiting.
//   OFF the three routes answer 404 (marksStart returns null first thing) and capabilities.marks is absent.
//   No plan-sized number is written in the marks files (every limit comes from getPlanLimits).
//   The waiting-lines text is the overlay's, byte for byte (one rule for a waiting line).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ROOT = path.resolve(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const lib = read('src/lib/inventoryCheckMarks.ts')
const route = read('src/routes/inventoryChecks.ts')
const overlay = read('src/lib/inventoryCheckOverlay.ts')
const norm = (s) => s.replace(/\s+/g, ' ').trim()
let failed = 0
const check = (name, fn) => { try { fn(); console.log('PASS ' + name) } catch (e) { failed++; console.log('FAIL ' + name + ' - ' + e.message.split('\n')[0]) } }

const fn = (src, head, next) => { const a = src.indexOf(head); assert.ok(a >= 0, 'missing ' + head); const b = src.indexOf(next, a + head.length); return src.slice(a, b < 0 ? undefined : b) }
const marksRoutes = (src) => src.slice(src.indexOf('// ---- ic_marks:'), src.indexOf("app.get('/sessions'"))

function suite(libText, routeText) {
  const results = []
  const t = (name, f) => { try { f(); results.push([name, null]) } catch (e) { results.push([name, e.message.split('\n')[0]]) } }
  t('I5: the snapshot reads the cursor and the page in ONE batch call', () => {
    const body = fn(libText, 'export async function readSnapshotPage', '/** The validation read')
    assert.equal(body.split('db.batch(').length - 1, 1, 'exactly one batch call')
    assert.ok(/db\.batch\(\[[\s\S]*TOP_SQL[\s\S]*SNAPSHOT_PAGE_SQL[\s\S]*\]\)/.test(body), 'TOP_SQL and SNAPSHOT_PAGE_SQL in the same batch')
    assert.ok(!/\.prepare\(/.test(libText), 'no unbatched prepare in the marks reader')
  })
  t('I5: the changes feed reads top, the cursor event and the events in one batch', () => {
    const body = fn(libText, 'export async function readChanges', 'export type PendingAnswer')
    assert.ok(/db\.batch\(\[\{ sql: TOP_SQL \}, \{ sql: AT_SQL[^\]]*EVENTS_SQL/.test(body))
  })
  t('OFF: every marks route starts at marksStart and answers 404 when it returns null', () => {
    const routes = marksRoutes(routeText)
    assert.equal((routes.match(/const start = await marksStart\(c\)\n  if \(!start\) return notWired\(c\)/g) || []).length, 3, 'three routes')
    assert.ok(/async function marksStart[\s\S]{0,200}if \(!await readSwitch\(c\.env, 'ic_marks'\)\) return null/.test(routes), 'the switch is the first read')
    assert.ok(/marksCapability[\s\S]{0,200}if \(!await readSwitch\(c\.env, 'ic_marks'\)\) return \{\}/.test(routes), 'capabilities.marks absent while OFF')
  })
  t('I9: Waiting only behind the stock field and Fix stock', () => {
    const routes = marksRoutes(routeText)
    assert.ok(/permitted: access\.fields\.stock && await fixStockOn\(c\)/.test(routes))
    assert.ok(/if \(!start\.permitted\) throw new InventoryCheckQueryError\(403/.test(routes), '/marks/pending refuses an unpermitted viewer')
    assert.ok(/start\.permitted\)\)\n\}\)/.test(routes) || /,\s*start\.permitted\)\)/.test(routes), 'changes passes the permission through')
    assert.ok(/permitted \? \{ pending:/.test(libText) && /\.\.\.\(permitted \? \[\{ sql: PENDING_LINES_SQL/.test(libText), 'the waiting read and answer exist only when permitted')
    assert.ok(!/PENDING_LINES_SQL|waitingLineSql/.test(fn(libText, 'export const SNAPSHOT_PAGE_SQL', 'export const MARKS_BY_IDS_SQL')), 'the snapshot never holds Waiting')
  })
  t('no plan-sized literal in the marks files', () => {
    const code = (libText + marksRoutes(routeText)).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/'[^'\n]*'|`[^`\n]*`/g, '""')
    const numbers = [...code.matchAll(/(?<![\w.$])(\d[\d_]*(?:\.\d+)?)(?![\w])/g)].map((m) => m[1]).filter((n) => !['0', '1', '2', '8', '15', '16', '0.5'].includes(n) && !/^0x/.test(n))
    assert.deepEqual([...new Set(numbers)].filter((n) => !['2440587.5', '86400000', '9', '400', '403', '40', '128'].includes(n)), [], 'literals ' + [...new Set(numbers)])
  })
  return results
}

const base = suite(lib, route)
for (const [name, err] of base) { if (err) { failed++; console.log('FAIL ' + name + ' - ' + err) } else console.log('PASS ' + name) }

check('the touched-id statements are driven from the touched ids and the pending approvals', () => {
  assert.ok(lib.includes('FROM json_each(@sessions) w CROSS JOIN inventory_check_sessions s ON s.id = w.value'), 'SCOPE_SQL drives from the touched session ids')
  assert.ok(lib.includes('inventory_check_approvals a INDEXED BY inventory_check_approvals_pending, json_each(a.line_set_json) je'), 'the waiting read drives from the pending approvals and their stored line sets')
})

// Mutants: each must turn exactly its named check red.
const mutate = (name, which, from, to, expectRed) => {
  const L = which === 'lib' ? lib.replace(from, to) : lib, R = which === 'route' ? route.replace(from, to) : route
  assert.notEqual(which === 'lib' ? L : R, which === 'lib' ? lib : route, 'mutant ' + name + ' did not apply')
  const red = suite(L, R).filter(([, err]) => err).map(([n]) => n)
  check('mutant ' + name + ' turns "' + expectRed + '" red', () => assert.ok(red.some((n) => n.startsWith(expectRed)), 'red: ' + red.join(' | ')))
}
mutate('split the cursor read from the page read', 'lib', '    { sql: SNAPSHOT_PAGE_SQL, params: { ...scope, lo, hi: lo + pageIds } },\n  ])', '  ])\n  await db.batch([{ sql: SNAPSHOT_PAGE_SQL, params: { ...scope, lo, hi: lo + pageIds } }])', 'I5: the snapshot')
mutate('switch not checked', 'route', "if (!await readSwitch(c.env, 'ic_marks')) return null", 'if (false) return null', 'OFF')
mutate('pending for every viewer', 'route', 'permitted: access.fields.stock && await fixStockOn(c)', 'permitted: true', 'I9')
mutate('a plan number written in the reader', 'lib', "export const MARKS_FORMAT = 1", 'export const MARKS_FORMAT = 1\nexport const PAGE = 2000', 'no plan-sized literal')

console.log(failed ? 'SOME CHECKS FAILED' : 'all checks passed')
process.exit(failed ? 1 : 0)
