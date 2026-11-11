'use strict'
// KHQR round 8: ONE invariant on the stored online method M, enforced the same way by every writer of
// `online_order_payment_method`, `pos_payment_methods` and `pos_payment_method_kinds` (lib/onlineMethodInvariant.ts).
//   (a) M (methodFold) is in the list   (b) M is not cash-kind   (c) no other list entry folds to M's key
//   (d) a write that changes M's identity, merges into or out of M, or changes M's kind is an administrator's
//   (e) a changed identity is not a name recent ordinary sales use
//
// Writers: POST /api/settings (method, list, kinds), POST /payment-methods/replace (settings_only, linked), POST /payment-methods/backfill (list CAS),
//          the sale fold in routes/sales.ts (list CAS, by source), backup restore (lib/backup.ts, by the shared function + source).
// Cases: the matrix (writer x clause), the round-7 probes E1, E2, E3, E5, E6 (and E4, the in-batch race of D2) as named cases, the races by a source hook that lands
// a write between the route's read and its batch, and a JS/SQL differential on the guard statement itself.
//
// Mutants (in-memory source edits, src/ untouched): MUTANT=<name> node scripts/test-online-method-invariant-native.cjs must go RED. Names: see MUTANTS below.
//
// Run (from cloudflare/): node scripts/test-online-method-invariant-native.cjs
const fs = require('node:fs')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const { bootWorld, createReporter } = require('./harness/real_worker_world.cjs')
const { loadTsLib } = require('./harness/load_ts_lib.cjs')

const inv = loadTsLib('onlineMethodInvariant')
const MUTANT = process.env.MUTANT || ''
const R = '/api/settings/payment-methods/replace'
const S = '/api/settings'
const LIST = ['Cash', 'ABA KHQR', 'Bakong']

// ---- in-memory mutants -------------------------------------------------------------------------------------------------------------------------------------
const MUTANTS = {
  no_final_guard_post: ['routes/settings.ts', 'if (onlineGuard) statements.push(onlineGuard)', ''],
  no_final_guard_replace: ['routes/settings.ts', 'statements.push(onlineMethodFinalGuard(onlineAfter, onlineVerdict.tolerated))', ''],
  no_replace_inuse: ['routes/settings.ts', 'if (onlineVerdict.identityChanged) {', 'if (false) {'],
  ascii_only_identity: ['lib/onlineMethodInvariant.ts', 'return methodFold(a) === methodFold(b) || paymentMethodKey(a) === paymentMethodKey(b)', 'return methodFold(a) === methodFold(b)'],
  no_judge: ['lib/onlineMethodInvariant.ts', 'refused: post.find((violation) => !already.has(violation)) ?? null,', 'refused: null,'],
  no_backfill_cas: ['routes/settings.ts', 'WHERE settings.value = @expectedRaw`,\r\n  ).run({ value: JSON.stringify(merged.methods)', '`,\r\n  ).run({ value: JSON.stringify(merged.methods)'],
  no_kind_admin: ['routes/settings.ts', 'if (onlineKindChanged(before, after) && !isAdminControlUser(user)) {', 'if (false) {'],
  sql_pin_off: ['lib/onlineMethodInvariant.ts', "WHEN NOT (${ONLINE_METHOD_RAW_SQL} = @expectedMethod", "WHEN 0 AND (${ONLINE_METHOD_RAW_SQL} = @expectedMethod"],
  raw_pin_trimmed: ['lib/onlineMethodInvariant.ts', "WHEN NOT (${ONLINE_METHOD_RAW_SQL} = @expectedMethod", "WHEN NOT (${ONLINE_METHOD_NORMALIZED_SQL} = @expectedMethod"],
}
function transformFor(extras) {
  return (file, source) => {
    let out = source
    if (MUTANT) {
      const m = MUTANTS[MUTANT]
      if (!m) throw new Error('unknown MUTANT ' + MUTANT)
      if (file === m[0]) {
        if (!out.includes(m[1])) throw new Error(`mutant ${MUTANT}: anchor missing in ${file}`)
        out = out.replace(m[1], () => m[2])
      }
    }
    for (const extra of extras || []) {
      if (extra.file !== file) continue
      if (!extra.at.test(out)) throw new Error('hook anchor missing: ' + extra.at)
      out = out.replace(extra.at, (_m, eol, rest) => `${eol}${extra.line}${eol}${rest}`)
    }
    return out === source ? undefined : out
  }
}
const POST_AT = { file: 'routes/settings.ts', at: /(\r?\n)(  const db = getDb\(c\.env\)\r?\n  const statements: Array<\{ sql: string; params: Record<string, unknown> \}> = changedKeys\.map)/ }
const REPLACE_AT = { file: 'routes/settings.ts', at: /(\r?\n)(  const db = getDb\(c\.env\)\r?\n  \/\/ Snapshot the monotonic sale revision)/ }
const BACKFILL_AT = { file: 'routes/settings.ts', at: /(\r?\n)(  const written = await db\.prepare\()/ }
// One world serves every race: the injected line runs the statements a case stores under race_hook_<name> (one settings row), between the route's reads and its batch.
const hookLine = (name) => `  { const __h = await getDb(c.env).prepare("SELECT value FROM settings WHERE key = 'race_hook_${name}'").get<{ value: string }>(); if (__h && __h.value) await getDb(c.env).batch((JSON.parse(__h.value) as string[]).map((sql) => ({ sql, params: {} }))) }`
const HOOKS = [{ ...POST_AT, line: hookLine('post') }, { ...REPLACE_AT, line: hookLine('replace') }, { ...BACKFILL_AT, line: hookLine('backfill') }]
const sqlq = (text) => "'" + String(text).replace(/'/g, "''") + "'"
const upsertSql = (key, value) => `INSERT INTO settings (key,value) VALUES (${sqlq(key)},${sqlq(value)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`

async function boot(adminPassword, extras) {
  const world = await bootWorld({ adminPassword, transformSources: (MUTANT || extras) ? transformFor(extras) : undefined })
  await world.account('mgr', { roleCode: 'mgr_role', permissions: { settings: true, sales_policy: true } })
  return world
}
const helpers = (world) => {
  const get = async (key) => (await world.first('SELECT value FROM settings WHERE key = ?', key))?.value ?? null
  const put = (key, value) => world.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value)
  const del = (key) => world.run('DELETE FROM settings WHERE key = ?', key)
  const reset = async ({ list = LIST, online = 'ABA KHQR', kinds = null, sales = [] } = {}) => {
    await put('pos_payment_methods', typeof list === 'string' ? list : JSON.stringify(list))
    if (online === null) await del('online_order_payment_method'); else await put('online_order_payment_method', online)
    if (kinds === null) await del('pos_payment_method_kinds'); else await put('pos_payment_method_kinds', typeof kinds === 'string' ? kinds : JSON.stringify(kinds))
    await world.run('DELETE FROM online_orders')
    await world.run('DELETE FROM sales')
    let n = 0
    for (const method of sales) await world.run("INSERT INTO sales (receipt_number, total_usd, payment_method, payment_details, created_at) VALUES (?, 5, ?, ?, datetime('now'))", `R-INV-${++n}`, method, JSON.stringify([{ method, amount_usd: 5, amount_khr: 0 }]))
  }
  const state = async () => JSON.stringify({ online: await get('online_order_payment_method'), list: await get('pos_payment_methods'), kinds: await get('pos_payment_method_kinds') })
  return { get, put, del, reset, state }
}
const codeOf = (r) => [r.status, (r.json && r.json.code) || null]

async function main() {
  const adminPassword = randomBytes(12).toString('base64url')
  const { check, finish } = createReporter()

  // ---- pure: the module's own judgement ---------------------------------------------------------------------------------------------------------------------
  await check('pure: the identity test sees a non-ASCII capital through BOTH folds (E1) and stray whitespace is read through', async (t) => {
    t.eq('ÉPay is épay', inv.sameOnlineIdentity('ÉPay', 'épay'), true)
    t.eq('ASCII case', inv.sameOnlineIdentity('ABA KHQR', ' aba khqr '), true)
    t.eq('a different method', inv.sameOnlineIdentity('ABA KHQR', 'Bakong'), false)
    t.eq('no method stored is nobody', inv.sameOnlineIdentity('', 'Bakong'), false)
    t.eq('a trailing TAB is read through', inv.normalizeOnlineMethod('ABA KHQR\t'), 'ABA KHQR')
    t.eq('violations: unlisted, cash and doubled', [inv.onlineMethodViolations({ method: 'Nope', listRaw: '["Cash"]', kindsRaw: '' }), inv.onlineMethodViolations({ method: 'Cash', listRaw: '["Cash"]', kindsRaw: '' }), inv.onlineMethodViolations({ method: 'Wing', listRaw: '["Wing","wing"]', kindsRaw: '' })], [['not_listed'], ['cash_kind'], ['duplicate']])
    t.eq('methodFold, not toLowerCase: ÉPay is not in ["épay"]', inv.onlineMethodViolations({ method: 'ÉPay', listRaw: '["épay"]', kindsRaw: '' }), ['not_listed'])
    const stale = { method: 'Wing', listRaw: '["Cash"]', kindsRaw: '' }
    t.eq('a stale unlisted method is tolerated while its identity is kept', inv.judgeOnlineMethodWrite(stale, { ...stale, kindsRaw: '{"Cash":"cash"}' }), { refused: null, tolerated: ['not_listed'], identityChanged: false })
    t.eq('a changed identity is judged in full', inv.judgeOnlineMethodWrite(stale, { ...stale, method: 'Wing2' }).refused, 'not_listed')
    t.eq('a clause the write newly breaks is refused', inv.judgeOnlineMethodWrite({ method: 'Wing', listRaw: '["Wing"]', kindsRaw: '' }, { method: 'Wing', listRaw: '["Wing"]', kindsRaw: '{"Wing":"cash"}' }).refused, 'cash_kind')
    t.eq('restore: a backup whose method is unlisted loses the method', inv.onlineMethodAfterRestore({ method: 'Nope', listRaw: '["Cash"]', kindsRaw: '' }).clear, true)
    t.eq('restore: a sound backup keeps it', inv.onlineMethodAfterRestore({ method: 'ABA KHQR', listRaw: '["Cash","ABA KHQR"]', kindsRaw: '' }).clear, false)
    t.eq('restore: no method stored is sound', inv.onlineMethodAfterRestore({ method: '', listRaw: '', kindsRaw: '' }).clear, false)
  })

  await check('source: backup restore judges the restored rows, and both whole-list writers (backfill, the sale fold) are compare-and-set on their read', async (t) => {
    const src = (p) => fs.readFileSync(path.join(__dirname, '..', 'src', p), 'utf8')
    t.ok('restore collects the three rows in pass 1 and judges them after pass 2', /restoredOnlineRows\.set\(/.test(src('lib/backup.ts')) && /onlineMethodAfterRestore\(/.test(src('lib/backup.ts')))
    t.ok('backfill is a CAS', /WHERE settings\.value = @expectedRaw/.test(src('routes/settings.ts')))
    t.ok('the sale fold is a CAS', /WHERE settings\.value = @expectedRaw/.test(src('routes/sales.ts')))
    t.ok('the writers import the one module', ['routes/settings.ts', 'lib/backup.ts'].every((f) => /from '(\.\.\/lib|\.)\/onlineMethodInvariant'/.test(src(f))))
  })

  // ---- the matrix: writer x clause (one world, state reset per case) ------------------------------------------------------------------------------------------
  const world = await boot(adminPassword)
  const h = helpers(world)
  const MGR = { as: 'mgr' }
  try {
    const cases = [
      // POST /api/settings, method
      { id: 'POST method (a): set M to an unlisted name', setup: {}, call: ['POST', S, { online_order_payment_method: 'Nowhere' }], expect: [400, 'invalid_online_order_payment_method'], same: true },
      { id: 'POST method (a)/E1: M "ÉPay" with the list holding only "épay" (methodFold differs)', setup: { list: ['Cash', 'épay'], online: null }, call: ['POST', S, { online_order_payment_method: 'ÉPay' }], expect: [400, 'invalid_online_order_payment_method'], same: true },
      { id: 'POST method (b): set M cash by the token rule', setup: {}, call: ['POST', S, { online_order_payment_method: 'Cash' }], expect: [400, 'online_order_method_is_cash'], same: true },
      { id: 'POST method (b): same-save kinds make M cash', setup: {}, call: ['POST', S, { online_order_payment_method: 'ABA KHQR', pos_payment_method_kinds: JSON.stringify({ 'ABA KHQR': 'cash' }) }], expect: [400, 'online_order_method_is_cash'], same: true },
      { id: 'POST method (d): a manager changes M', setup: {}, call: ['POST', S, { online_order_payment_method: 'Bakong' }, MGR], expect: [403, 'online_method_admin_only'], same: true },
      { id: 'POST method (e): M set onto a name recent ordinary sales use', setup: { list: [...LIST, 'Drawer'], sales: ['Drawer'] }, call: ['POST', S, { online_order_payment_method: 'Drawer' }], expect: [409, 'online_method_in_use_by_sales'], same: true },
      { id: 'POST method control: an unused listed dedicated name is stored', setup: {}, call: ['POST', S, { online_order_payment_method: 'Bakong' }], expect: [200, null] },
      // POST /api/settings, list
      { id: 'POST list (a): the list drops M', setup: {}, call: ['POST', S, { pos_payment_methods: JSON.stringify(['Cash', 'Bakong']) }, MGR], expect: [400, 'invalid_online_order_payment_method'], same: true },
      { id: 'POST list+method (a)/(b) in one save: list without the new M', setup: {}, call: ['POST', S, { pos_payment_methods: JSON.stringify(['Cash', 'ABA KHQR']), online_order_payment_method: 'Bakong' }], expect: [400, 'invalid_online_order_payment_method'], same: true },
      { id: 'POST list control: dropping another method is fine', setup: {}, call: ['POST', S, { pos_payment_methods: JSON.stringify(['Cash', 'ABA KHQR']) }, MGR], expect: [200, null] },
      { id: 'POST list control: a stale unlisted M never traps an unrelated list edit', setup: { list: ['Cash', 'Bakong'], online: 'ABA KHQR' }, call: ['POST', S, { pos_payment_methods: JSON.stringify(['Cash', 'Bakong', 'Wing']) }, MGR], expect: [200, null] },
      // POST /api/settings, kinds
      { id: 'POST kinds (b): a manager makes M cash', setup: {}, call: ['POST', S, { pos_payment_method_kinds: JSON.stringify({ 'ABA KHQR': 'cash' }) }, MGR], expect: [400, 'online_order_method_is_cash'], same: true },
      { id: 'POST kinds (b): another spelling of M', setup: {}, call: ['POST', S, { pos_payment_method_kinds: JSON.stringify({ ' aba khqr ': 'cash' }) }], expect: [400, 'online_order_method_is_cash'], same: true },
      { id: 'POST kinds (b): the token rule takes a pin away', setup: { list: ['Cash', 'Cash Online', 'Bakong'], online: 'Cash Online', kinds: { 'Cash Online': 'digital' } }, call: ['POST', S, { pos_payment_method_kinds: JSON.stringify({}) }, MGR], expect: [400, 'online_order_method_is_cash'], same: true },
      { id: 'POST kinds (d): a manager changes the kind of a stale cash-kind M', setup: { kinds: { 'ABA KHQR': 'cash' } }, call: ['POST', S, { pos_payment_method_kinds: JSON.stringify({ 'ABA KHQR': 'digital' }) }, MGR], expect: [403, 'online_method_admin_only'], same: true },
      { id: 'POST kinds (d) control: the administrator repairs it', setup: { kinds: { 'ABA KHQR': 'cash' } }, call: ['POST', S, { pos_payment_method_kinds: JSON.stringify({ 'ABA KHQR': 'digital' }) }], expect: [200, null] },
      { id: 'POST kinds control: a stale cash-kind M does not trap an unrelated kinds edit', setup: { kinds: { 'ABA KHQR': 'cash' } }, call: ['POST', S, { pos_payment_method_kinds: JSON.stringify({ 'ABA KHQR': 'cash', Bakong: 'digital' }) }, MGR], expect: [200, null] },
      { id: 'POST kinds control: kinds for another method', setup: {}, call: ['POST', S, { pos_payment_method_kinds: JSON.stringify({ Bakong: 'cash' }) }, MGR], expect: [200, null] },
      { id: 'POST kinds (c) control: a stale doubled entry does not trap an unrelated kinds edit', setup: { list: '["Cash","ABA KHQR","aba khqr"]' }, call: ['POST', S, { pos_payment_method_kinds: JSON.stringify({ Bakong: 'cash' }) }], expect: [200, null] },
      // E5: stray whitespace in the stored method
      { id: 'E5: a stored method with a trailing TAB does not block an unrelated kinds save', setup: { online: 'ABA KHQR\t' }, call: ['POST', S, { pos_payment_method_kinds: JSON.stringify({ Bakong: 'cash' }) }], expect: [200, null] },
      { id: 'E5: ... nor a list save', setup: { online: 'ABA KHQR\t' }, call: ['POST', S, { pos_payment_methods: JSON.stringify([...LIST, 'Wing']) }, MGR], expect: [200, null] },
      { id: 'E5: ... and a TAB method that IS cash-kind newly is still refused', setup: { online: 'ABA KHQR\t' }, call: ['POST', S, { pos_payment_method_kinds: JSON.stringify({ 'ABA KHQR': 'cash' }) }], expect: [400, 'online_order_method_is_cash'], same: true },
      { id: 'E5: the administrator renames a TAB method and the setting follows', setup: { online: 'ABA KHQR\t' }, call: ['POST', R, { from: 'ABA KHQR', to: 'ABA Pay', scope: 'settings_only' }], expect: [200, null], after: { online: 'ABA Pay' } },
      // replace: merge / rename
      { id: 'replace (c)/(d): another method merged INTO M', setup: {}, call: ['POST', R, { from: 'Cash', to: 'ABA KHQR', scope: 'settings_only' }], expect: [409, 'online_method_merge_refused'], same: true },
      { id: 'replace (c)/(d): M merged into another method', setup: {}, call: ['POST', R, { from: 'ABA KHQR', to: 'Bakong', scope: 'settings_only' }], expect: [409, 'online_method_merge_refused'], same: true },
      { id: 'replace (d): a manager renames M', setup: {}, call: ['POST', R, { from: 'ABA KHQR', to: 'Wing', scope: 'settings_only' }, MGR], expect: [403, 'online_method_admin_only'], same: true },
      { id: 'replace (b): M renamed to a cash name', setup: {}, call: ['POST', R, { from: 'ABA KHQR', to: 'Cash Drawer', scope: 'settings_only' }], expect: [409, 'online_order_method_is_cash'], same: true },
      { id: 'E1 replace: a MANAGER merges Cash into "épay" (a non-ASCII case variant of M ÉPay)', setup: { list: ['Cash', 'ÉPay', 'Bakong'], online: 'ÉPay' }, call: ['POST', R, { from: 'Cash', to: 'épay', scope: 'settings_only' }, MGR], expect: [403, 'online_method_admin_only'], same: true },
      { id: 'E1 replace: an ADMIN merges Cash into "épay"', setup: { list: ['Cash', 'ÉPay', 'Bakong'], online: 'ÉPay' }, call: ['POST', R, { from: 'Cash', to: 'épay', scope: 'settings_only' }], expect: [409, 'online_method_merge_refused'], same: true },
      { id: 'E1 replace: a MANAGER merges "épay" (M as the source) into Bakong', setup: { list: ['Cash', 'ÉPay', 'Bakong'], online: 'ÉPay' }, call: ['POST', R, { from: 'épay', to: 'Bakong', scope: 'settings_only' }, MGR], expect: [403, 'online_method_admin_only'], same: true },
      { id: 'E1 replace: an admin renames "épay" -> Wing: the loop would take ÉPay off the list while M keeps its name', setup: { list: ['Cash', 'ÉPay', 'Bakong'], online: 'ÉPay' }, call: ['POST', R, { from: 'épay', to: 'Wing', scope: 'settings_only' }], expect: [409, 'online_method_merge_refused'], same: true },
      { id: 'E2 replace: M renamed onto a name recent ordinary sales use (settings only)', setup: { list: ['Cash', 'ABA KHQR'], sales: ['Drawer'] }, call: ['POST', R, { from: 'ABA KHQR', to: 'Drawer', scope: 'settings_only' }], expect: [409, 'online_method_in_use_by_sales'], same: true },
      { id: 'E2 replace: ... and linked', setup: { list: ['Cash', 'ABA KHQR'], sales: ['Drawer'] }, call: ['POST', R, { from: 'ABA KHQR', to: 'Drawer', scope: 'linked', currentPassword: adminPassword }], expect: [409, 'online_method_in_use_by_sales'], same: true },
      { id: 'E2 control: renamed to a name no recent sale uses', setup: { list: ['Cash', 'ABA KHQR'], sales: ['Drawer'] }, call: ['POST', R, { from: 'ABA KHQR', to: 'Wallet', scope: 'settings_only' }], expect: [200, null], after: { online: 'Wallet' } },
      { id: 'replace control: spelling-only rename of M, linked (identity kept, no in-use probe)', setup: { list: ['Cash', 'ABA KHQR'], sales: ['aba khqr'] }, call: ['POST', R, { from: 'ABA KHQR', to: 'Aba Khqr', scope: 'linked', currentPassword: adminPassword }], expect: [200, null], after: { online: 'Aba Khqr' } },
      { id: 'replace control: a manager renames an unrelated method', setup: {}, call: ['POST', R, { from: 'Bakong', to: 'Bakong Pay', scope: 'settings_only' }, MGR], expect: [200, null] },
      { id: 'replace control: a stale unlisted M never traps an unrelated rename', setup: { list: ['Cash', 'Bakong'], online: 'ABA KHQR' }, call: ['POST', R, { from: 'Bakong', to: 'Bakong Pay', scope: 'settings_only' }, MGR], expect: [200, null] },
    ]
    for (const c of cases) {
      await check(c.id, async (t) => {
        await h.reset(c.setup)
        const before = await h.state()
        const [method, route, body, opts] = c.call
        const r = await world.api(method, route, body, opts)
        t.eq('answer', codeOf(r), c.expect)
        if (c.same) t.eq('nothing stored', await h.state(), before)
        if (c.after) for (const [k, v] of Object.entries(c.after)) t.eq(`stored ${k}`, await h.get(k === 'online' ? 'online_order_payment_method' : k), v)
      })
    }
  } finally { /* disposed after the guard cases, which use the same world */ }

  // ---- the guard statement itself: pins, (a) and (c) in SQL, tolerance, and a JS/SQL differential ----------------------------------------------------------------
  const gworld = world
  const gh = h
  const inline = (sql, params) => sql.replace(/@(\w+)/g, (_m, name) => {
    const v = params[name]
    return typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`
  })
  const runGuard = async (state, tolerated = []) => {
    const g = inv.onlineMethodFinalGuard(state, tolerated)
    try { await gworld.first(inline(g.sql, g.params)); return 'ok' } catch (error) { return inv.onlineMethodGuardCode(error) || String(error).slice(0, 120) }
  }
  try {
    await check('guard SQL: pins (all three keys, M raw), (a) and (c) in SQL, tolerance, and no method stored', async (t) => {
      await gh.reset({ list: ['Cash', 'ABA KHQR', 'Bakong'], online: 'ABA KHQR', kinds: { Bakong: 'cash' } })
      const ok = { method: 'ABA KHQR', listRaw: JSON.stringify(['Cash', 'ABA KHQR', 'Bakong']), kindsRaw: JSON.stringify({ Bakong: 'cash' }) }
      t.eq('judged state is the stored state', await runGuard(ok), 'ok')
      t.eq('method moved', await runGuard({ ...ok, method: 'Bakong' }), 'online_method_changed')
      t.eq('list moved', await runGuard({ ...ok, listRaw: '["Cash"]' }), 'online_method_changed')
      t.eq('kinds moved', await runGuard({ ...ok, kindsRaw: '{}' }), 'online_method_changed')
      await gh.reset({ list: ['Cash', 'Bakong'], online: 'ABA KHQR' })
      const stale = { method: 'ABA KHQR', listRaw: JSON.stringify(['Cash', 'Bakong']), kindsRaw: '' }
      t.eq('(a) in SQL: unlisted', await runGuard(stale), 'online_method_not_listed')
      t.eq('(a) tolerated', await runGuard(stale, ['not_listed']), 'ok')
      await gh.reset({ list: '["Cash","ABA KHQR","aba khqr"]', online: 'ABA KHQR' })
      const doubled = { method: 'ABA KHQR', listRaw: '["Cash","ABA KHQR","aba khqr"]', kindsRaw: '' }
      t.eq('(c) in SQL: doubled', await runGuard(doubled), 'online_method_duplicated')
      t.eq('(c) tolerated', await runGuard(doubled, ['duplicate']), 'ok')
      await gh.reset({ list: ['Cash'], online: '' })
      t.eq('no method stored: nothing to judge', await runGuard({ method: '', listRaw: '["Cash"]', kindsRaw: '' }), 'ok')
      await gh.reset({ list: ['Cash', 'ABA KHQR'], online: 'ABA KHQR\t' })
      t.eq('E5: the pin is on the RAW value, the clauses read it normalised', await runGuard({ method: 'ABA KHQR\t', listRaw: '["Cash","ABA KHQR"]', kindsRaw: '' }), 'ok')
      t.eq('E5: a pin on the trimmed value is not the stored value', await runGuard({ method: 'ABA KHQR', listRaw: '["Cash","ABA KHQR"]', kindsRaw: '' }), 'online_method_changed')
    })

    await check('guard SQL vs the JS judgement: (a) and (c) agree on every state of a grid (non-ASCII, case, whitespace, unreadable lists)', async (t) => {
      const methods = ['ABA KHQR', 'aba khqr', 'ÉPay', 'épay', 'ABA KHQR\t', ' ABA KHQR ', 'Wing', '']
      const lists = ['["Cash","ABA KHQR"]', '["Cash","aba khqr"]', '["Cash","ÉPay"]', '["Cash","épay"]', '["Cash","ABA KHQR","aba khqr"]', '["Cash"]', '', 'not json', '{"a":"ABA KHQR"}', '["Cash",5,"Wing"]']
      let compared = 0
      for (const method of methods) {
        for (const listRaw of lists) {
          await gh.reset({ list: listRaw, online: method })
          const js = inv.onlineMethodViolations({ method, listRaw, kindsRaw: '' }).filter((v) => v !== 'cash_kind')
          const sql = await runGuard({ method, listRaw, kindsRaw: '' })
          const want = js.includes('not_listed') ? 'online_method_not_listed' : js.includes('duplicate') ? 'online_method_duplicated' : 'ok'
          t.eq(`${JSON.stringify(method)} x ${JSON.stringify(listRaw)}`, sql, want)
          compared += 1
        }
      }
      t.ok(`compared ${compared} states`, compared === methods.length * lists.length)
    })
  } finally { await world.dispose() }

  // ---- races: a write lands between the route's reads and its batch (source hook, in memory) ---------------------------------------------------------------------
  const races = [
    { id: 'E4/D2 race: a kinds-only save judged on M "ABA KHQR" while M moves to Bakong', at: 'post', sql: [upsertSql('online_order_payment_method', 'Bakong')], setup: {}, call: ['POST', S, { pos_payment_method_kinds: JSON.stringify({ Bakong: 'cash' }) }, MGR],
      expect: [409, 'write_conflict'], after: { online: 'Bakong', kinds: null } },
    { id: 'E6 race: M set to Bakong while the kinds map becomes {Bakong: cash}', at: 'post', sql: [upsertSql('pos_payment_method_kinds', '{"Bakong":"cash"}')], setup: {}, call: ['POST', S, { online_order_payment_method: 'Bakong' }],
      expect: [409, 'write_conflict'], after: { online: 'ABA KHQR', kinds: '{"Bakong":"cash"}' } },
    { id: 'list race: a list save dropping Bakong while M moves to Bakong', at: 'post', sql: [upsertSql('online_order_payment_method', 'Bakong')], setup: {}, call: ['POST', S, { pos_payment_methods: JSON.stringify(['Cash', 'ABA KHQR']) }, MGR],
      expect: [409, 'write_conflict'], after: { online: 'Bakong', list: JSON.stringify(LIST) } },
    { id: 'E3 race: a MANAGER merges Cash into Bakong while an administrator sets M to Bakong', at: 'replace', sql: [upsertSql('online_order_payment_method', 'Bakong')], setup: {}, call: ['POST', R, { from: 'Cash', to: 'Bakong', scope: 'settings_only' }, MGR],
      expect: [409, 'write_conflict'], after: { online: 'Bakong', list: JSON.stringify(LIST) } },
    { id: 'rename race: M renamed to Wing while the kinds map becomes {Wing: cash}', at: 'replace', sql: [upsertSql('pos_payment_method_kinds', '{"Wing":"cash"}')], setup: {}, call: ['POST', R, { from: 'ABA KHQR', to: 'Wing', scope: 'settings_only' }],
      expect: [409, 'write_conflict'], after: { online: 'ABA KHQR', list: JSON.stringify(LIST) } },
    { id: 'backfill race: a stale whole-list copy must not undo a rename that landed after its read', at: 'backfill', sql: [upsertSql('pos_payment_methods', '["Cash","Online"]'), upsertSql('online_order_payment_method', 'Online')], setup: { sales: ['Wing Pay'] }, call: ['POST', '/api/settings/payment-methods/backfill', {}],
      expect: [409, 'write_conflict'], after: { online: 'Online', list: '["Cash","Online"]' } },
  ]
  const raceWorld = await boot(adminPassword, HOOKS)
  const rh = helpers(raceWorld)
  try {
    for (const r of races) {
      await check(r.id, async (t) => {
        await raceWorld.run("DELETE FROM settings WHERE key LIKE 'race_hook_%'")
        await rh.reset(r.setup)
        await rh.put('race_hook_' + r.at, JSON.stringify(r.sql))
        const [method, route, body, opts] = r.call
        const res = await raceWorld.api(method, route, body, opts)
        await raceWorld.run("DELETE FROM settings WHERE key LIKE 'race_hook_%'")
        t.eq('answer', codeOf(res), r.expect)
        for (const [k, v] of Object.entries(r.after)) t.eq(`stored ${k}`, await rh.get(k === 'online' ? 'online_order_payment_method' : k === 'list' ? 'pos_payment_methods' : 'pos_payment_method_kinds'), v)
      })
    }
    await check('backfill control: with no race the missing method is appended', async (t) => {
      await rh.reset({ list: ['Cash', 'ABA KHQR'], sales: ['Wing Pay'] })
      const res = await raceWorld.api('POST', '/api/settings/payment-methods/backfill', {})
      t.eq('answer', res.status, 200)
      t.eq('list', await rh.get('pos_payment_methods'), JSON.stringify(['Cash', 'ABA KHQR', 'Wing Pay']))
    })
  } finally { await raceWorld.dispose() }
  finish('online method invariant')
}
main().catch((error) => { console.error(error); process.exit(1) })
