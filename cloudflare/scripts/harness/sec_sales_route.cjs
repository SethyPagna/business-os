// SEC-SALES route harness: the REAL Hono sales router over the fully migrated
// node:sqlite fixture that test-sale-create-atomic-pure.cjs already builds.
// Its preamble is compiled here rather than copied, so there is one loader
// and one fixture. Each SEC-SALES test proves its bypass on the parent
// implementation with SEC_SALES_BASELINE=1, which reads every route/lib
// source from the release candidate the loophole review audited instead of
// the working tree (read-only `git show`; no checkout, no disk rewrite).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { execFileSync } = require('node:child_process')

const BASELINE_REF = '4ab47676eeb25299dad5235fdf2e9d071ffb97ac'
const srcRoot = path.join(__dirname, '..', '..', 'src')
const atomicFile = path.join(__dirname, '..', 'test-sale-create-atomic-pure.cjs')
const atomicSource = fs.readFileSync(atomicFile, 'utf8')
const boundary = atomicSource.indexOf(';(async () => {')
assert.ok(boundary > 0, 'test-sale-create-atomic-pure.cjs preamble boundary moved')

globalThis.__secSalesSource = (sourcePath) => {
  if (process.env.SEC_SALES_BASELINE !== '1') return fs.readFileSync(sourcePath, 'utf8')
  const relative = path.relative(srcRoot, sourcePath).replaceAll('\\', '/')
  try {
    return execFileSync('git', ['show', `${BASELINE_REF}:cloudflare/src/${relative}`], { cwd: srcRoot, encoding: 'utf8' })
  } catch {
    // A module this lane added does not exist at the baseline; the baseline
    // route never imports it, so reaching here means the caller asked for it.
    return fs.readFileSync(sourcePath, 'utf8')
  }
}

const harness = new Module(atomicFile, module)
harness.filename = atomicFile
harness.paths = module.paths
harness._compile(atomicSource.slice(0, boundary)
  .replace("fs.readFileSync(sourcePath, 'utf8')", 'globalThis.__secSalesSource(sourcePath)')
  // Library modules reach D1 through './db' too (report reads, shift policy).
  .replace('const overrides = {', "const overrides = { './db': { getDb: (env) => env.DB },")
  + '\nmodule.exports={fixture,request,postSale,creationState,app,executionCtx,USER,load,setUser(value){currentUser=value},setAutoShift(value){autoShift=value}};', atomicFile)
const h = harness.exports
// The atomic preamble's positive-path admission opens a shift before every
// sale; SEC-SALES suites register (or withhold) shifts explicitly with
// openShift below.
h.setAutoShift(false)

const baseline = process.env.SEC_SALES_BASELINE === '1'

async function call(db, method, route, body) {
  const response = await h.app.request(route, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { DB: db }, h.executionCtx)
  const text = await response.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = { raw: text } }
  return { status: response.status, body: parsed }
}

/** Register today's shift for `user` exactly as POST /api/shifts/open stores it. */
function openShift(raw, user, { branchId = 1, closed = false, cancelled = false, scopeMode = 'per_account', businessDate } = {}) {
  const date = businessDate || raw.prepare("SELECT date('now','+7 hours') AS d").get().d
  raw.prepare(`INSERT INTO shift_sessions (shift_code, scope_mode, user_id, user_name, branch_id, branch_name, business_date,
      opened_at, opening_float_usd, opening_float_khr, closed_at, cancelled_at, cancelled_by_user_id, cancel_reason)
    VALUES (@code, @scope, @user, @name, @branch, 'Shop', @date, datetime('now','-1 hour'), 0, 0,
      ${closed ? "datetime('now','-1 minute')" : 'NULL'}, ${cancelled ? "datetime('now','-1 minute'), 1, 'Cancelled by administrator'" : 'NULL, NULL, NULL'})`)
    .run({ code: `T-${user.id}-${date}-${Math.random().toString(36).slice(2, 8)}`, scope: scopeMode, user: user.id, name: user.username, branch: branchId, date })
}

module.exports = { ...h, call, openShift, baseline, BASELINE_REF }
