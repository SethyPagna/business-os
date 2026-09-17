// P11-14 (dashboard all-time scope timed out): the Dashboard analytics card
// (totals) and its trend chart (periodData) used to be computed from TWO
// independent calls -- getSalesTotals(env, filters) and
// getSalesPeriodSeries(env, filters, granularity) -- even though both take
// the identical filters. Each call reads its own full snapshot via
// readSalesReportSnapshot, which keyset-pages sales/sale_items/returns/
// return_items TWICE per read as a concurrent-write guard. So the pair cost
// FOUR full paginated reads of the same rows every request. Over an all-time
// window with years of imported sales history that serialized into enough D1
// round trips to blow the Worker's request budget before finishing -- which
// is what showed up as a hang ("dashboard, all time scope failed. timedout").
//
// The fix shares ONE snapshot read between totals and the period series
// (getSalesTotalsAndPeriodSeries in lib/salesAnalytics.ts), halving the
// read cost for that request. This is a pure source-shape lock: it proves
// the unbounded double-read was removed, not a wall-clock measurement (per
// the task brief, timing is not a reliable CI signal).
//
// Run (from cloudflare/): node scripts/test-dashboard-alltime-shared-snapshot-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

let passed = 0
const check = (label, cond) => { assert.ok(cond, label); passed++; console.log(`PASS ${label}`) }

const analyticsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'salesAnalytics.ts'), 'utf8')
const compatSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'compat.ts'), 'utf8')

// Slices a function's BODY (the braces after its signature, which may itself
// contain an object-literal return-type annotation with its own braces --
// e.g. `): Promise<{ a: X; b: Y }> {` -- so the body's opening brace is found
// by depth-matching from the declaration's own name, not the first `{` seen).
function sliceFunctionBody(src, declaration) {
  const start = src.indexOf(declaration)
  assert.ok(start !== -1, `${declaration} found in source`)
  const openParen = src.indexOf('(', start)
  let parenDepth = 0
  let afterParams = openParen
  for (let i = openParen; i < src.length; i += 1) {
    if (src[i] === '(') parenDepth += 1
    else if (src[i] === ')') { parenDepth -= 1; if (parenDepth === 0) { afterParams = i + 1; break } }
  }
  // Walk the return-type annotation (e.g. `: Promise<{ a: X; b: Y }>`),
  // tracking angle-bracket depth and any object-literal braces INSIDE it
  // separately, so the body's own opening brace -- the first `{` seen once
  // both depths are back to zero -- is found correctly.
  let angleDepth = 0
  let typeCurlyDepth = 0
  let braceStart = -1
  for (let i = afterParams; i < src.length; i += 1) {
    const ch = src[i]
    if (ch === '<') angleDepth += 1
    else if (ch === '>') angleDepth -= 1
    else if (ch === '{') {
      if (angleDepth === 0 && typeCurlyDepth === 0) { braceStart = i; break }
      typeCurlyDepth += 1
    } else if (ch === '}') typeCurlyDepth -= 1
  }
  assert.ok(braceStart !== -1, `${declaration} body brace found`)
  let depth = 0
  let end = braceStart
  for (let i = braceStart; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') { depth -= 1; if (depth === 0) { end = i; break } }
  }
  return src.slice(braceStart, end)
}

// 1. The combined helper exists and is exported.
check(
  'salesAnalytics.ts exports getSalesTotalsAndPeriodSeries',
  /export async function getSalesTotalsAndPeriodSeries\(/.test(analyticsSrc),
)

// 2. Its body reads the snapshot exactly ONCE (not once per sub-computation).
{
  const body = sliceFunctionBody(analyticsSrc, 'export async function getSalesTotalsAndPeriodSeries')
  const readCalls = (body.match(/readSalesReportSnapshot\(/g) || []).length
  check('getSalesTotalsAndPeriodSeries calls readSalesReportSnapshot exactly once', readCalls === 1)
  check('getSalesTotalsAndPeriodSeries reuses the snapshot for both totals and the period series',
    /salesTotalsFromSnapshot\(snapshot\)/.test(body) && /salesPeriodRowsFromSnapshot\(snapshot, granularity\)/.test(body))
}

// 3. getSalesPeriodSeries itself no longer carries the old, unreachable
//    dead-code SQL implementation that used to sit after its early return
//    (unionBuckets/deriveTotals/VOID_ONLY_LEVEL are still used by OTHER
//    functions in the file, so this checks getSalesPeriodSeries's own body,
//    not the whole file).
{
  const body = sliceFunctionBody(analyticsSrc, 'export async function getSalesPeriodSeries')
  check('getSalesPeriodSeries has no leftover unreachable dead code', !/unionBuckets\(|deriveTotals\(|VOID_ONLY_LEVEL/.test(body))
  check('getSalesPeriodSeries reads exactly one snapshot', (body.match(/readSalesReportSnapshot\(/g) || []).length === 1)
}

// 4. The Dashboard's /analytics Promise.all uses the combined call, and does
//    NOT also fire the old separate getSalesPeriodSeries call for the same
//    window (that would silently reintroduce the redundant second read).
{
  const body = sliceFunctionBody(compatSrc, 'async function dashboardAnalytics')
  check('dashboardAnalytics calls getSalesTotalsAndPeriodSeries', /getSalesTotalsAndPeriodSeries\(env, filters, granularity/.test(body))
  check('dashboardAnalytics does not also call getSalesPeriodSeries redundantly', !/getSalesPeriodSeries\(/.test(body))
}

console.log(`\n${passed} passed`)
