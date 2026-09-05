// Owner ask N6, clause 3: a SUPPLIER return is goods going back to a supplier.
// No customer money moves. It must never be counted, anywhere, into a figure a
// customer-facing stat calls a refund.
//
// It was, in exactly one place: compat.ts's dashboard summary tile
// (today_return_count / today_return_usd) filtered on the date and the status
// but NOT on return_scope, so every supplier return in the window was added to
// what the Dashboard renders as customer refunds. Every sibling returns
// aggregate in the codebase already carried the predicate.
//
// This test runs the REAL query text lifted out of compat.ts (so it cannot
// drift from what ships) and carries two positive controls:
//   * the fixture control -- the same SQL with the scope line removed really
//     does return the supplier return, so the fixture discriminates;
//   * the sweep control -- the source sweep is re-run over a MUTATED copy of
//     compat.ts with the predicate deleted, and must go red. A sweep that
//     cannot fail is not a sweep.
//
// Run (from cloudflare/): node scripts/test-returns-activity-scope-pure.cjs
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')

const SRC = path.join(__dirname, '..', 'src')
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8')

// The real local-day window helper, transpiled -- not a re-spelling of it.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'returns-scope-'))
fs.writeFileSync(path.join(tmpDir, 'businessDateWindow.ts'), read('lib', 'businessDateWindow.ts'))
const tscBin = path.join(__dirname, '..', 'node_modules', 'typescript', 'bin', 'tsc')
execSync(`node ${tscBin} --module commonjs --target es2020 --outDir ${tmpDir} ${path.join(tmpDir, 'businessDateWindow.ts')}`, { stdio: 'inherit' })
const win = require(path.join(tmpDir, 'businessDateWindow.js'))

let passed = 0
const check = (label, cond) => { assert.ok(cond, label); passed++; console.log(`PASS ${label}`) }

const compat = read('routes', 'compat.ts')

// ---- 1. Lift the shipped query out of compat.ts ----------------------------
function todayReturnsSql(source) {
  const marker = 'SELECT COUNT(*) AS count, COALESCE(SUM(total_refund_usd), 0) AS total_usd'
  const at = source.indexOf(marker)
  if (at < 0) throw new Error('compat.ts dashboard-summary returns query not found')
  const end = source.indexOf('`)', at)
  return source.slice(at, end)
    .replace("${localDateRangeClause('created_at')}", win.localDateRangeClause('created_at'))
    .replace("${saleBranchClause('returns')}", '')
    .trim()
}
const shipped = todayReturnsSql(compat)
check('the shipped dashboard-summary returns query scopes to CUSTOMER returns',
  /COALESCE\(return_scope, 'customer'\) = 'customer'/.test(shipped))

const db = new Database(':memory:')
db.exec('CREATE TABLE returns (id INTEGER PRIMARY KEY, created_at TEXT, status TEXT, return_scope TEXT, total_refund_usd REAL, branch_id INTEGER);')
const ins = db.prepare('INSERT INTO returns (id, created_at, status, return_scope, total_refund_usd, branch_id) VALUES (?,?,?,?,?,?)')
ins.run(1, '2026-08-10 05:00:00', 'completed', 'customer', 25, 1)   // a real customer refund
ins.run(2, '2026-08-10 05:00:00', 'completed', 'supplier', 50, 1)   // goods back to a supplier -- no customer money
ins.run(3, '2026-08-10 05:00:00', 'cancelled', 'customer', 10, 1)   // voided return
ins.run(4, '2026-09-10 05:00:00', 'completed', 'customer', 99, 1)   // outside the window
const P = { startDate: '2026-08-01', endDate: '2026-08-31' }

const got = db.prepare(shipped).get(P)
check(`the shipped query reports only the customer refund (${got.count} x $${got.total_usd})`,
  got.count === 1 && got.total_usd === 25)

// FIXTURE POSITIVE CONTROL: the pre-fix query, same rows.
const preFix = shipped.replace(/\s*AND COALESCE\(return_scope, 'customer'\) = 'customer'/, '')
check('POSITIVE CONTROL: the scope line really is what changes the answer', preFix !== shipped)
const before = db.prepare(preFix).get(P)
check(`POSITIVE CONTROL: without it the supplier return is counted as a customer refund (${before.count} x $${before.total_usd})`,
  before.count === 2 && before.total_usd === 75)

// ---- 2. Sweep every refund aggregate in the codebase -----------------------
// A statement qualifies if it sums total_refund_usd out of `returns`. It
// passes if its own text carries the predicate, or if the WHERE fragment it
// interpolates is built with it (the indirect sites below are resolved by
// reading that fragment's own definition, not by trusting a name).
const INDIRECT = {
  'routes/reports.ts': /const base = `COALESCE\(return_scope, 'customer'\) = 'customer'/,
  'routes/returns.ts': /`COALESCE\(return_scope, 'customer'\) = @scope`/,
}
function offenders(files) {
  const bad = []
  for (const [rel, source] of Object.entries(files)) {
    const indirectOk = INDIRECT[rel] ? INDIRECT[rel].test(source) : false
    const re = /SUM\(total_refund_usd\)/g
    let m
    while ((m = re.exec(source))) {
      const from = source.lastIndexOf('`', m.index)
      const stmt = source.slice(from < 0 ? 0 : from, Math.min(source.length, m.index + 900))
      if (!/FROM returns/.test(stmt)) continue
      const whereOnly = stmt.slice(stmt.indexOf('FROM returns'))
      if (/return_scope/.test(whereOnly)) continue
      if (indirectOk && /\$\{(base|where)\}/.test(whereOnly)) continue
      bad.push(`${rel}@${m.index}`)
    }
  }
  return bad
}
const FILES = {
  'routes/compat.ts': compat,
  'routes/reports.ts': read('routes', 'reports.ts'),
  'routes/returns.ts': read('routes', 'returns.ts'),
  'routes/sales.ts': read('routes', 'sales.ts'),
}
const found = offenders(FILES)
check(`no refund aggregate anywhere is missing its scope predicate (${Object.keys(FILES).length} files swept; offenders: ${JSON.stringify(found)})`,
  found.length === 0)
check('the sweep looked at real statements, not an empty set',
  Object.values(FILES).reduce((n, s) => n + (s.match(/SUM\(total_refund_usd\)/g) || []).length, 0) >= 6)

// SWEEP POSITIVE CONTROL: delete the predicate from a copy and re-sweep.
const mutated = {
  ...FILES,
  'routes/compat.ts': compat
    .replace("        AND COALESCE(return_scope, 'customer') = 'customer'\r\n", '')
    .replace("        AND COALESCE(return_scope, 'customer') = 'customer'\n", ''),
}
check('POSITIVE CONTROL: the mutation actually removed the line', mutated['routes/compat.ts'].length < compat.length)
check(`POSITIVE CONTROL: the sweep goes RED on the pre-fix source, so it can see what it forbids (${JSON.stringify(offenders(mutated))})`,
  offenders(mutated).length === 1)

// ---- 3. The activity/kernel boundary --------------------------------------
// The tile is RETURN-DATE activity. The kernel reverses a refund in its SALE's
// bucket. Both are correct answers to different questions and neither may be
// subtracted from the other -- pinned here as the comment that says so,
// because the number itself cannot carry the warning.
check('compat.ts names the dashboard returns tile as return-date ACTIVITY, not a revenue reversal',
  /RETURN-DATE ACTIVITY, customer scope only/.test(compat)
  && /nothing may subtract it from a revenue figure/.test(compat))

console.log(`\nALL ${passed} CHECKS PASSED`)
