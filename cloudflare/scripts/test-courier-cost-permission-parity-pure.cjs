'use strict'
// The courier's actual cost sits behind one switch, `sales:view_courier_cost`, and three places must agree on it:
//   - the Worker's gate, canViewCourierCost (src/lib/courierCostAccess.ts), which every response goes through;
//   - the role editor's row and the runtime `can('sales', 'view_courier_cost')` (frontend utils/permissionActions.ts
//     and utils/permissions.ts), which decide what an administrator sees when they click the row;
//   - the role presets and the Worker's seeded roles, which decide who has it before anyone edits a role.
// This file runs the real modules on both sides over a grid of stored permission maps and fails on any
// disagreement. It also pins that no migration is needed: an absent key means "on", the same one-way
// override every other `section:action` row uses, so a role saved before the row existed keeps what it had.
//
// Run: node scripts/test-courier-cost-permission-parity-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { transformSync } = require('esbuild')

const cloudflareRoot = path.join(__dirname, '..')
const repoRoot = path.join(cloudflareRoot, '..')
const cache = new Map()
function load(file) {
  if (cache.has(file)) return cache.get(file).exports
  const mod = { exports: {} }
  cache.set(file, mod)
  const code = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  const next = (id) => {
    if (!id.startsWith('.')) return require(id)
    const resolved = path.resolve(path.dirname(file), id)
    return load(/\.ts$/.test(resolved) ? resolved : `${resolved}.ts`)
  }
  new Function('require', 'module', 'exports', code)(next, mod, mod.exports)
  return mod.exports
}
const worker = load(path.join(cloudflareRoot, 'src/lib/courierCostAccess.ts'))
const editorActions = load(path.join(repoRoot, 'frontend/src/utils/permissionActions.ts'))
const editorPermissions = load(path.join(repoRoot, 'frontend/src/utils/permissions.ts'))
const presets = load(path.join(repoRoot, 'frontend/src/components/users/rolePresetDefaults.ts'))

let passed = 0
const check = (name, fn) => { fn(); passed += 1; console.log(`PASS ${name}`) }
const KEY = 'sales:view_courier_cost'
const user = (rolePermissions, ownPermissions = null, roleCode = 'employee') => ({
  id: 7, username: 'staff', role_code: roleCode,
  role_permissions: JSON.stringify(rolePermissions), permissions: ownPermissions === null ? null : JSON.stringify(ownPermissions),
})
const workerSees = (u) => worker.canViewCourierCost(u)
const editorSees = (u) => editorPermissions.effectivePermissions(u).can('sales', 'view_courier_cost')

check('the editor has one row for it under Sales, readable in the View tier, named in English and Khmer', () => {
  const rows = editorActions.actionsForKey('sales').filter((row) => row.key === 'view_courier_cost')
  assert.equal(rows.length, 1)
  assert.equal(`sales:${rows[0].key}`, KEY, 'the stored override key is the one the Worker reads')
  assert.equal(rows[0].review, 'allow', 'the View tier keeps it, as the Worker does')
  assert.match(fs.readFileSync(path.join(cloudflareRoot, 'src/lib/courierCostAccess.ts'), 'utf8'), new RegExp(`getActionTier\\(user, 'sales', '${rows[0].key}'\\) !== 'none'`), 'the Worker reads the same action name the editor stores')
  const en = JSON.parse(fs.readFileSync(path.join(repoRoot, 'frontend/src/lang/en.json'), 'utf8'))
  const km = JSON.parse(fs.readFileSync(path.join(repoRoot, 'frontend/src/lang/km.json'), 'utf8'))
  assert.equal(en[rows[0].tKey], rows[0].label, 'the English pack carries the row label')
  assert.ok(typeof km[rows[0].tKey] === 'string' && km[rows[0].tKey].trim(), 'the Khmer pack carries it')
  assert.notEqual(km[rows[0].tKey], en[rows[0].tKey], 'and it is translated, not copied')
  assert.equal(editorActions.outcomeAt(rows[0], 'none'), 'block')
  assert.equal(editorActions.outcomeAt(rows[0], 'view'), 'allow')
  assert.equal(editorActions.outcomeAt(rows[0], 'full'), 'allow')
})

check('editor = Worker over every stored shape: tier x switch x role/user placement x administrator', () => {
  const tiers = [undefined, false, true, 'view', 'review', 'junk']
  const switches = [undefined, false, true, 'no', 0, null]
  let cells = 0
  let granted = 0
  for (const tier of tiers) {
    for (const roleSwitch of switches) {
      for (const userSwitch of switches) {
        for (const placeTierOn of ['role', 'user']) {
          const tierMap = tier === undefined ? {} : { sales: tier }
          const role = { ...(placeTierOn === 'role' ? tierMap : {}), ...(roleSwitch === undefined ? {} : { [KEY]: roleSwitch }) }
          const own = { ...(placeTierOn === 'user' ? tierMap : {}), ...(userSwitch === undefined ? {} : { [KEY]: userSwitch }) }
          for (const roleCode of ['employee', 'admin']) {
            const u = user(role, own, roleCode)
            const label = JSON.stringify({ role, own, roleCode })
            assert.equal(editorSees(u), workerSees(u), `editor and Worker disagree on ${label}`)
            cells += 1
            if (workerSees(u)) granted += 1
          }
        }
      }
    }
  }
  assert.ok(cells > 800 && granted > 100 && granted < cells - 100, `the grid reaches both verdicts (${granted} of ${cells})`)
})

check('editor = Worker for an all-grant and for a stored map with no Sales at all', () => {
  for (const map of [{ all: true }, { all: true, [KEY]: false }, {}, { reports: true, dashboard: true, product_cost_view: true }, { [KEY]: true }]) {
    const u = user(map)
    assert.equal(editorSees(u), workerSees(u), JSON.stringify(map))
  }
  assert.equal(workerSees(user({ all: true, [KEY]: false })), true, 'an all-grant is an administrator and is never narrowed')
  assert.equal(workerSees(user({ [KEY]: true })), false, 'an override never grants past a missing Sales tier')
  assert.equal(workerSees(null), false)
  assert.equal(editorSees(null), false)
})

check('clicking the row in the editor flips what the Worker answers, in both directions', () => {
  for (const tier of [true, 'view']) {
    const start = { sales: tier, pos: true }
    assert.equal(workerSees(user(start)), true)
    const off = editorActions.toggleActionOverrideMap(start, 'sales', 'view_courier_cost')
    assert.deepEqual(off, { ...start, [KEY]: false })
    assert.equal(editorActions.isActionOverriddenOff(off, 'sales', 'view_courier_cost'), true)
    assert.equal(workerSees(user(off)), false, `the Worker follows the switch at tier ${tier}`)
    assert.equal(editorSees(user(off)), false)
    const on = editorActions.toggleActionOverrideMap(off, 'sales', 'view_courier_cost')
    assert.deepEqual(on, start, 'handing it back removes the key, so a role is stored exactly as it was before the row existed')
    assert.equal(workerSees(user(on)), true)
  }
})

check('role presets: every preset that holds Sales has it, the Product Viewer (no Sales) and a non-staff principal do not', () => {
  const verdicts = Object.fromEntries(presets.ROLE_PRESETS.map((preset) => {
    const u = user(preset.permissions, null, preset.key === 'admin' ? 'admin' : 'employee')
    assert.equal(editorSees(u), workerSees(u), `${preset.key}: editor and Worker agree`)
    return [preset.key, workerSees(u)]
  }))
  assert.deepEqual(verdicts, { employee: true, manager: true, product_viewer: false, admin: true })
  assert.equal(Object.hasOwn(presets.ROLE_PRESETS.find((preset) => preset.key === 'employee').permissions, KEY), false,
    'no preset stores the key: "on" is the absence of an override, so there is nothing to migrate')
  assert.equal(workerSees({ role_code: 'customer', role_permissions: '{}', permissions: null }), false, 'a storefront or customer principal')
})

check('seeded roles: the Worker seeds the Employee with Sales and no switch, so it has the cost; nothing is written to existing roles', () => {
  const source = fs.readFileSync(path.join(cloudflareRoot, 'src/lib/roleDefaults.ts'), 'utf8').split('\r\n').join('\n')
  const start = source.indexOf('const DEFAULT_ROLE_PERMISSIONS')
  const body = source.slice(source.indexOf('{', source.indexOf('=', start)), source.indexOf('\n}\n', start) + 2)
  const seeded = new Function(`return (${body})`)()
  assert.deepEqual(Object.keys(seeded).sort(), ['admin', 'employee', 'manager'])
  assert.equal(Object.hasOwn(seeded.employee, KEY), false)
  assert.equal(workerSees(user(seeded.employee)), true, 'a freshly seeded Employee reads the courier cost')
  assert.equal(workerSees(user(seeded.admin, null, 'admin')), true)
  assert.equal(workerSees(user(seeded.manager)), false, 'a seeded Manager is {}: no Sales, so no sale and no cost to see until Sales is granted')
  const migrations = fs.readdirSync(path.join(cloudflareRoot, 'migrations')).filter((name) => name.endsWith('.sql'))
  const touching = migrations.filter((name) => fs.readFileSync(path.join(cloudflareRoot, 'migrations', name), 'utf8').includes('view_courier_cost'))
  assert.deepEqual(touching, [], 'no migration writes the key: roles saved before the row existed keep seeing the cost through the code default')
})

check('every Worker response gate asks the permission, not the administrator role or the amend right', () => {
  const read = (relative) => fs.readFileSync(path.join(cloudflareRoot, relative), 'utf8')
  const gate = read('src/lib/courierCostAccess.ts')
  assert.equal(/canViewSaleCourierCost/.test(gate + read('src/routes/sales.ts')), false, 'the interim amend-based gate is gone')
  assert.equal(/getActionTier\(user, 'sales', 'amend'\)/.test(gate), false)
  for (const [file, atLeast] of [['src/routes/reports.ts', 6], ['src/routes/sales.ts', 4], ['src/routes/compat.ts', 1]]) {
    assert.ok((read(file).match(/canViewCourierCost\(/g) || []).length >= atLeast, `${file} gates through canViewCourierCost`)
  }
  const reports = read('src/routes/reports.ts')
  assert.equal(/gateCourierRow\([^)]*isAdmin\)/.test(reports), false, 'the courier rows are not gated by the administrator flag')
})

console.log(`GREEN courier-cost permission parity: ${passed} checks hold`)
