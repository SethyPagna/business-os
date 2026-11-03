'use strict'
// PERM-UI (3 Nov 2026): the server half of the browser role matrix (frontend/e2e/role-matrix.spec.ts), on the REAL Worker under
// Miniflare with a fully migrated D1 (harness/al_money_native.cjs): a real login per role and the real session cookie.
//
// The matrix found controls the UI offered to roles that lacked the grant. For each, the question here is the other side: does the
// Worker refuse the call, and leave state unchanged, when the role really lacks the grant?
//
//   Add Return        POST /api/returns, /returns/supplier, /returns/quote   with returns:add off      -> 403, no return written
//   Settings Save     POST /api/settings                                      at the View tier         -> 403, setting unchanged
//   Promotions door   POST /api/promotions                                    for the Employee default -> 403 (the page was a UI door;
//                     reads stay open because POS prices from the same rules)
//   Manager Dashboard GET /api/dashboard/startup as the seeded Manager: 200, every key Dashboard.tsx isDashboardSummaryPayload
//                     reads is present, and the cost-derived keys are absent (the Worker's projection) -- the shape the page now accepts.
//                     The Employee default (no `dashboard`) is refused.
//   Bulk delete      POST /api/{products,customers,suppliers}/bulk-delete-jobs and /:id/cancel with the single-delete grant off (PERM-UI review E1):
//                     403, no job row, nothing deleted. A job deletes exactly what DELETE /:id deletes, so it needs the same grant.
// The Products controls (Delete, bulk Delete, Add variant, Edit) are pinned in test-employee-products-default-native.cjs.
//
// Roles are built from the seeds (lib/roleDefaults.ts), not copied. Each refusal has a discriminating twin: the same call passes the
// gate for a role that holds the grant, so a 403 here is the grant, not a broken route.
//
// MUTANT=<name> bundles ONE deliberate defect into the Worker (the check that guards it must go red); BASE_COMMIT=<sha> runs the same checks against older source.
//
// Run (from cloudflare/scripts): node test-role-matrix-server-refusals-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { transformSync } = require('esbuild')
const H = require('./harness/al_money_native.cjs')

const read = (relative) => fs.readFileSync(path.join(__dirname, relative), 'utf8').replace(/\r\n/g, '\n')
const seed = new Function('module', 'exports', transformSync(read('../src/lib/roleDefaults.ts'), { loader: 'ts', format: 'cjs' }).code + '; return module.exports')
const moduleBox = { exports: {} }
const DEFAULTS = (seed(moduleBox, moduleBox.exports), moduleBox.exports).DEFAULT_ROLE_PERMISSIONS
assert.ok(DEFAULTS.manager && DEFAULTS.employee, 'the seeded roles are read from lib/roleDefaults.ts')

// The keys the Dashboard insists on, read out of the validator in Dashboard.tsx rather than listed here.
const dashboardSource = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/dashboard/Dashboard.tsx'), 'utf8').replace(/\r\n/g, '\n')
const validatorStart = dashboardSource.indexOf('function isDashboardSummaryPayload')
const validatorBody = dashboardSource.slice(validatorStart, dashboardSource.indexOf('\n}\n', validatorStart))
const REQUIRED_SUMMARY_KEYS = [...new Set([...validatorBody.matchAll(/payload\.([a-z_]+)/g)].map((match) => match[1]))]
assert.ok(REQUIRED_SUMMARY_KEYS.length >= 7 && REQUIRED_SUMMARY_KEYS.includes('product_count'), 'the Dashboard validator was found: ' + REQUIRED_SUMMARY_KEYS.join(','))
const COST_SUMMARY_KEYS = ['cost_in', 'cost_out', 'cost_in_khr', 'cost_out_khr', 'stock_value_usd', 'stock_value_khr']

// Each mutant removes one gate the checks below pin. The two-line anchors keep each rewrite unique in its file.
const MUTANTS = {
  'returns-create-ungated': [{ file: 'src/routes/returns.ts', from: `}) as typeof db.prepare
  const user = c.get('user')
  if (getActionTier(user, 'returns', 'add') === 'none' ||`, to: `}) as typeof db.prepare
  const user = c.get('user')
  if (false ||` }],
  'settings-tier-ignored': [{ file: 'src/routes/settings.ts', from: `    return !hasPermission(user, 'settings')
  })`, to: `    return false
  })` }],
  'products-bulk-delete-ignores-delete': [{ file: 'src/routes/products.ts', from: `return getActionTier(user, 'products', 'delete') === 'none' ? 'none' : tier`, to: `return tier` }],
  'contacts-bulk-delete-job-ignores-delete': [{ file: 'src/routes/contacts.ts', from: `if (getActionTier(user, 'contacts', 'delete') === 'none') {
      return c.json({ error: 'You do not have permission to perform this action' }, 403)
    }

    const body = (await`, to: `if (false) {
      return c.json({ error: 'You do not have permission to perform this action' }, 403)
    }

    const body = (await` }],
  'contacts-bulk-delete-cancel-ignores-delete': [{ file: 'src/routes/contacts.ts', from: `|| getActionTier(user, 'contacts', 'delete') !== 'full') {`, to: `|| false) {` }],
  'dashboard-cost-keys-leak': [{ file: 'src/routes/compat.ts', from: `app.use('/dashboard', acquisitionCostResponses)
app.use('/dashboard/*', acquisitionCostResponses)
`, to: '' }],
}
let failed = 0
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.log(`FAIL ${name}\n  ${String(error && error.stack || error).split('\n').slice(0, 24).join('\n  ')}`) }
}
const DENIED = 'You do not have permission to perform this action'

async function main() {
  const mutant = process.env.MUTANT ? MUTANTS[process.env.MUTANT].map((patch, index) => ({ name: `mutant:${process.env.MUTANT}:${index}`, ...patch })) : null
  const h = await H.startWorker({ patches: mutant || (process.env.BASE_COMMIT ? H.basePatches(process.env.BASE_COMMIT) : []) })
  try {
    // A supplier return also demands both cost grants (checked first), so the roles meant to isolate returns:add hold them.
    const COSTS = { product_cost_view: true, product_cost_edit: true }
    const noReturnAdd = await h.addEmployee(2001, 'rm-returns-no-add', { returns: true, 'returns:add': false, ...COSTS })
    const returnAdd = await h.addEmployee(2002, 'rm-returns-add', { returns: true, ...COSTS })
    const returnAddNoCosts = await h.addEmployee(2008, 'rm-returns-add-no-costs', { returns: true })
    const settingsView = await h.addEmployee(2003, 'rm-settings-view', { settings: 'view' })
    const settingsFull = await h.addEmployee(2004, 'rm-settings-full', { settings: true })
    const manager = await h.addEmployee(2005, 'rm-manager', DEFAULTS.manager)
    const managerWithCost = await h.addEmployee(2006, 'rm-manager-cost', { ...DEFAULTS.manager, product_cost_view: true })
    const employee = await h.addEmployee(2007, 'rm-employee', DEFAULTS.employee)
    const productsNoDelete = await h.addEmployee(2009, 'rm-products-no-delete', { products: true, 'products:delete': false })
    const productsFull = await h.addEmployee(2010, 'rm-products-full', { products: true })
    const contactsNoDelete = await h.addEmployee(2011, 'rm-contacts-no-delete', { contacts: true, contacts_suppliers: true, 'contacts:delete': false })
    const contactsFull = await h.addEmployee(2012, 'rm-contacts-full', { contacts: true, contacts_suppliers: true })
    const count = async (table) => (await h.one(`SELECT COUNT(*) AS n FROM ${table}`)).n
    const as = (cookie) => ({ cookie })

    await check('Add Return: with returns:add off the Worker refuses a customer return, a supplier return and a return quote with 403 and writes nothing; a role holding it passes the gate', async () => {
      const before = [await count('returns'), await count('action_history'), await count('audit_logs')]
      for (const [url, body] of [['/api/returns', { items: [] }], ['/api/returns/supplier', { items: [] }], ['/api/returns/quote', { items: [] }]]) {
        const refused = await h.call('POST', url, body, `no returns:add ${url}`, as(noReturnAdd))
        assert.equal(refused.status, 403, `${url} -> ${refused.status} ${JSON.stringify(refused.body)}`)
        assert.equal(refused.body.error, DENIED)
      }
      assert.deepEqual([await count('returns'), await count('action_history'), await count('audit_logs')], before, 'a refused return changes nothing')
      for (const [who, url] of [[returnAdd, '/api/returns'], [returnAdd, '/api/returns/supplier'], [returnAddNoCosts, '/api/returns'], [undefined, '/api/returns']]) {
        const passed = await h.call('POST', url, { items: [] }, `holds returns:add ${url}`, who ? as(who) : {})
        assert.notEqual(passed.status, 403, `${url} passes the permission gate for a role that holds returns:add (got ${passed.status} ${JSON.stringify(passed.body)})`)
      }
      // A supplier return is refused for its cost grants first, with its own message: still 403, still nothing written.
      const noCosts = await h.call('POST', '/api/returns/supplier', { items: [] }, 'returns:add but no cost grants', as(returnAddNoCosts))
      assert.equal(noCosts.status, 403)
      assert.equal(noCosts.body.code, 'product_cost_edit_required')
    })

    await check('Settings Save: a View-tier role may read Settings but the Worker refuses its save with 403 and the setting stays; a Full role saves', async () => {
      const KEY = 'default_landing_page' // a plain Settings key: no per-bucket grant (sales_policy, business_identity ...) stands in for the tier
      const stored = async () => (await h.one('SELECT value FROM settings WHERE key=?', KEY))?.value ?? null
      const before = await stored()
      assert.equal((await h.call('GET', '/api/settings', undefined, 'view tier reads', as(settingsView))).status, 200, 'View is a read-only tier, not a closed door')
      const refused = await h.call('POST', '/api/settings', { [KEY]: 'VIEW-ONLY-WROTE-THIS' }, 'view tier saves', as(settingsView))
      assert.equal(refused.status, 403, JSON.stringify(refused.body))
      assert.equal(await stored(), before, 'the refused save left the setting alone')
      const saved = await h.call('POST', '/api/settings', { [KEY]: 'sales' }, 'full tier saves', as(settingsFull))
      assert.equal(saved.status, 200, JSON.stringify(saved.body))
      assert.equal(await stored(), 'sales', 'discriminating: the same save lands for a Full role')
    })

    await check('Promotions door: the Employee default may not write a promotion rule (403, nothing written); the page was only a UI door, and rule reads stay open for POS pricing', async () => {
      const before = await count('promotion_rules')
      const refused = await h.call('POST', '/api/promotions', { title: 'Employee rule', rule_type: 'fixed_off' }, 'employee creates rule', as(employee))
      assert.equal(refused.status, 403, JSON.stringify(refused.body))
      assert.equal(await count('promotion_rules'), before)
      assert.equal((await h.call('GET', '/api/promotions', undefined, 'employee reads rules', as(employee))).status, 200, 'POS prices from the same rules')
    })

    await check('Manager Dashboard: the seeded Manager gets 200 with every key the Dashboard validator reads and none of the cost-derived keys; a cost holder gets them; the Employee default is refused', async () => {
      const startup = await h.call('GET', '/api/dashboard/startup', undefined, 'manager dashboard', as(manager))
      assert.equal(startup.status, 200, JSON.stringify(startup.body))
      const summary = startup.body.summary
      assert.ok(summary && typeof summary === 'object', 'the startup carries a summary')
      for (const key of REQUIRED_SUMMARY_KEYS) assert.ok(Object.hasOwn(summary, key), `the Manager's summary carries ${key}, which the Dashboard requires`)
      for (const key of COST_SUMMARY_KEYS) assert.equal(Object.hasOwn(summary, key), false, `${key} is removed for a caller without product_cost_view`)
      assert.ok(startup.body.analytics && Object.hasOwn(startup.body.analytics.totals, 'revenue_usd'), 'the analytics half the page also validates is whole')
      const costed = await h.call('GET', '/api/dashboard/startup', undefined, 'cost holder dashboard', as(managerWithCost))
      assert.equal(costed.status, 200, JSON.stringify(costed.body))
      for (const key of COST_SUMMARY_KEYS) assert.ok(Object.hasOwn(costed.body.summary, key), `discriminating: ${key} reaches a Manager who holds product_cost_view`)
      const refused = await h.call('GET', '/api/dashboard/startup', undefined, 'employee dashboard', as(employee))
      assert.equal(refused.status, 403, JSON.stringify(refused.body))
    })

    await check('Bulk delete: a role whose single Delete is off is refused the bulk-delete job and its cancel for products, customers and suppliers (403, no job, nothing deleted); a role holding both runs it', async () => {
      await h.db.batch([
        h.db.prepare('INSERT INTO customers(id,name,phone) VALUES(?,?,?)').bind(7201, 'RM Bulk Customer A', '0127201'),
        h.db.prepare('INSERT INTO customers(id,name,phone) VALUES(?,?,?)').bind(7202, 'RM Bulk Customer B', '0127202'),
        h.db.prepare('INSERT INTO customers(id,name,phone) VALUES(?,?,?)').bind(7203, 'RM Bulk Customer C', '0127203'),
        h.db.prepare('INSERT INTO suppliers(id,name) VALUES(?,?)').bind(7301, 'RM Bulk Supplier A'),
        h.db.prepare('INSERT INTO suppliers(id,name) VALUES(?,?)').bind(7302, 'RM Bulk Supplier B'),
        h.db.prepare('INSERT INTO suppliers(id,name) VALUES(?,?)').bind(7303, 'RM Bulk Supplier C'),
      ])
      for (const id of [7101, 7102, 7103]) await H.seedProduct(h, id, 'RM Bulk Product ' + id, 5, 0)
      // [route, table, the two rows the refused calls aim at, the row the permitted twin deletes]
      const KINDS = [
        { path: '/api/products', table: 'products', ids: [7101, 7102], twin: 7103, noDelete: productsNoDelete, full: productsFull, alive: (id) => `SELECT COUNT(*) AS n FROM products WHERE id = ${id} AND is_active = 1` },
        { path: '/api/customers', table: 'customers', ids: [7201, 7202], twin: 7203, noDelete: contactsNoDelete, full: contactsFull, alive: (id) => `SELECT COUNT(*) AS n FROM customers WHERE id = ${id}` },
        { path: '/api/suppliers', table: 'suppliers', ids: [7301, 7302], twin: 7303, noDelete: contactsNoDelete, full: contactsFull, alive: (id) => `SELECT COUNT(*) AS n FROM suppliers WHERE id = ${id}` },
      ]
      const problems = []
      for (const kind of KINDS) {
        const alive = async (ids) => { let n = 0; for (const id of ids) n += (await h.db.prepare(kind.alive(id)).first()).n; return n }
        const jobsBefore = await count('bulk_delete_jobs')
        const refused = await h.call('POST', kind.path + '/bulk-delete-jobs', { ids: kind.ids, reason: 'role matrix' }, kind.table + ' bulk job, single Delete off', as(kind.noDelete))
        if (refused.status !== 403) problems.push(`${kind.table}: bulk-delete-jobs with Delete off answered ${refused.status} ${JSON.stringify(refused.body)}, expected 403`)
        else if (refused.body.error !== DENIED) problems.push(`${kind.table}: the refusal says ${JSON.stringify(refused.body.error)}`)
        if (await count('bulk_delete_jobs') !== jobsBefore) problems.push(`${kind.table}: the refused call still recorded a job`)
        if (await alive(kind.ids) !== kind.ids.length) problems.push(`${kind.table}: the refused call deleted rows`)

        // A pending job (started by another role): the role without Delete may not cancel it either.
        const jobId = 'rm-pending-' + kind.table
        await h.db.prepare("INSERT INTO bulk_delete_jobs(id, entity_type, status, reason, ids_json, total_count) VALUES(?, ?, 'pending', 'role matrix', ?, ?)")
          .bind(jobId, kind.table, JSON.stringify(kind.ids), kind.ids.length).run()
        const flag = async () => (await h.db.prepare('SELECT cancel_requested AS n FROM bulk_delete_jobs WHERE id = ?').bind(jobId).first()).n
        const noCancel = await h.call('POST', kind.path + '/bulk-delete-jobs/' + jobId + '/cancel', {}, kind.table + ' cancel, single Delete off', as(kind.noDelete))
        if (noCancel.status !== 403) problems.push(`${kind.table}: cancel with Delete off answered ${noCancel.status} ${JSON.stringify(noCancel.body)}, expected 403`)
        if (await flag() !== 0) problems.push(`${kind.table}: the cancel with Delete off still flagged the job`)

        // Discriminating twin: a role holding Delete and Bulk delete is not stopped by the gate, so the 403s above are the grant.
        const cancelled = await h.call('POST', kind.path + '/bulk-delete-jobs/' + jobId + '/cancel', {}, kind.table + ' cancel, holds both', as(kind.full))
        if (cancelled.status !== 200 || await flag() !== 1) problems.push(`${kind.table}: a role holding both could not cancel (${cancelled.status} ${JSON.stringify(cancelled.body)})`)
        const jobsTwin = await count('bulk_delete_jobs')
        const accepted = await h.call('POST', kind.path + '/bulk-delete-jobs', { ids: [kind.twin], reason: 'role matrix twin' }, kind.table + ' bulk job, holds both', as(kind.full))
        if (accepted.status !== 202 || await count('bulk_delete_jobs') !== jobsTwin + 1) problems.push(`${kind.table}: a role holding both was refused the job (${accepted.status} ${JSON.stringify(accepted.body)})`)
      }
      assert.deepEqual(problems, [], 'The bulk-delete job runs without the single-delete grant:\n  ' + problems.join('\n  '))
    })
  } finally {
    await h.mf.dispose()
  }
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
  process.exitCode = failed ? 1 : 0
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
