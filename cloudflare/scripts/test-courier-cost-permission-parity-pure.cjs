'use strict'
// The courier's actual cost is ADMIN ONLY (owner, 15 Nov 2026: cost, profit and margin are administrator money everywhere, and what the
// shop paid the driver is cost). Until then it sat behind `sales:view_courier_cost`, on for every Sales role. This file pins that the
// switch is now inert and retired, over the real modules on both sides:
//   - the Worker's gate, canViewCourierCost (src/lib/courierCostAccess.ts), answers true for an administrator and nobody else, over a
//     grid of stored permission maps (tier x switch x role/user placement x administrator);
//   - the role editor offers NO row for it (a switch that does nothing is a fake control) and no preset or seed stores the key;
//   - the old rule survives, unused, as holdsCourierCostGrant: the way back if the owner reverses the ruling;
//   - every Worker response gate still asks the one function, not the administrator flag or the amend right.
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
const presets = load(path.join(repoRoot, 'frontend/src/components/users/rolePresetDefaults.ts'))

let passed = 0
const check = (name, fn) => { fn(); passed += 1; console.log(`PASS ${name}`) }
const KEY = 'sales:view_courier_cost'
const user = (rolePermissions, ownPermissions = null, roleCode = 'employee') => ({
  id: 7, username: 'staff', role_code: roleCode,
  role_permissions: JSON.stringify(rolePermissions), permissions: ownPermissions === null ? null : JSON.stringify(ownPermissions),
})

check('the Worker gate is true for an administrator and false for everyone else, over every stored shape', () => {
  const tiers = [undefined, false, true, 'view', 'review', 'junk']
  const switches = [undefined, false, true, 'no', 0, null]
  let cells = 0
  let adminCells = 0
  for (const tier of tiers) {
    for (const roleSwitch of switches) {
      for (const userSwitch of switches) {
        for (const placeTierOn of ['role', 'user']) {
          const tierMap = tier === undefined ? {} : { sales: tier }
          const role = { ...(placeTierOn === 'role' ? tierMap : {}), ...(roleSwitch === undefined ? {} : { [KEY]: roleSwitch }), product_cost_view: true, product_cost_edit: true }
          const own = { ...(placeTierOn === 'user' ? tierMap : {}), ...(userSwitch === undefined ? {} : { [KEY]: userSwitch }) }
          for (const roleCode of ['employee', 'admin']) {
            const u = user(role, own, roleCode)
            assert.equal(worker.canViewCourierCost(u), roleCode === 'admin', JSON.stringify({ role, own, roleCode }))
            cells += 1
            if (roleCode === 'admin') adminCells += 1
          }
        }
      }
    }
  }
  assert.ok(cells > 800 && adminCells === cells / 2, `the grid reaches both verdicts (${adminCells} admin of ${cells})`)
})

check('an all-grant is an administrator; a stored switch, a missing Sales tier and a customer principal open nothing', () => {
  assert.equal(worker.canViewCourierCost(user({ all: true, [KEY]: false })), true, 'an all-grant is an administrator and is never narrowed')
  assert.equal(worker.canViewCourierCost(user({ [KEY]: true })), false)
  assert.equal(worker.canViewCourierCost(user({ sales: true, [KEY]: true })), false, 'the old switch, even on, opens nothing')
  assert.equal(worker.canViewCourierCost({ role_code: 'customer', role_permissions: '{}', permissions: null }), false)
  assert.equal(worker.canViewCourierCost(null), false)
})

check('the role editor offers no row for it, and the Sales actions still name every other row', () => {
  const rows = editorActions.actionsForKey('sales')
  assert.equal(rows.some((row) => row.key === 'view_courier_cost'), false, 'a retired switch is not offered')
  assert.ok(rows.length >= 7, 'the other Sales actions are untouched')
})

check('the switch-back keeps the old per-role rule (on for a Sales role until an explicit false), unused by the gate', () => {
  for (const [map, own, expected] of [[{ sales: true }, null, true], [{ sales: 'view' }, null, true], [{ sales: true, [KEY]: false }, null, false],
    [{ sales: true, [KEY]: false }, { [KEY]: true }, true], [{ [KEY]: true }, null, false], [{ sales: true, [KEY]: 'no' }, null, true]]) {
    assert.equal(worker.holdsCourierCostGrant(user(map, own)), expected, JSON.stringify({ map, own }))
    assert.equal(worker.canViewCourierCost(user(map, own)), false)
  }
  assert.equal(worker.holdsCourierCostGrant(user({}, null, 'admin')), true)
})

check('no preset, no seeded role and no migration stores the key', () => {
  for (const preset of presets.ROLE_PRESETS) assert.equal(Object.hasOwn(preset.permissions, KEY), false, preset.key)
  const source = fs.readFileSync(path.join(cloudflareRoot, 'src/lib/roleDefaults.ts'), 'utf8').split('\r\n').join('\n')
  const start = source.indexOf('const DEFAULT_ROLE_PERMISSIONS')
  const body = source.slice(source.indexOf('{', source.indexOf('=', start)), source.indexOf('\n}\n', start) + 2)
  const seeded = new Function(`return (${body})`)()
  assert.deepEqual(Object.keys(seeded).sort(), ['admin', 'employee', 'manager'])
  for (const role of ['employee', 'manager']) {
    assert.equal(Object.hasOwn(seeded[role], KEY), false)
    assert.equal(worker.canViewCourierCost(user(seeded[role])), false, `a seeded ${role} no longer reads the courier cost`)
  }
  assert.equal(worker.canViewCourierCost(user(seeded.admin, null, 'admin')), true)
  const migrations = fs.readdirSync(path.join(cloudflareRoot, 'migrations')).filter((name) => name.endsWith('.sql'))
  const touching = migrations.filter((name) => fs.readFileSync(path.join(cloudflareRoot, 'migrations', name), 'utf8').includes('view_courier_cost'))
  assert.deepEqual(touching, [], 'no migration writes the key')
})

check('every Worker response gate asks canViewCourierCost, not the administrator role or the amend right', () => {
  const read = (relative) => fs.readFileSync(path.join(cloudflareRoot, relative), 'utf8')
  const gate = read('src/lib/courierCostAccess.ts').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))
  assert.equal(/canViewSaleCourierCost/.test(gate + read('src/routes/sales.ts')), false, 'the interim amend-based gate is gone')
  assert.equal(/getActionTier\(user, 'sales', 'amend'\)/.test(gate), false)
  assert.match(gate, /export function canViewCourierCost\(user: PermissionUser\): boolean \{\n {2}return isAdminControlUser\(user\)\n\}/)
  for (const [file, atLeast] of [['src/routes/reports.ts', 6], ['src/routes/sales.ts', 4], ['src/routes/compat.ts', 1]]) {
    assert.ok((read(file).match(/canViewCourierCost\(/g) || []).length >= atLeast, `${file} gates through canViewCourierCost`)
  }
  const reports = read('src/routes/reports.ts')
  assert.equal(/gateCourierRow\([^)]*isAdmin\)/.test(reports), false, 'the courier rows are not gated by the administrator flag')
})

console.log(`GREEN courier-cost permission: ${passed} checks hold`)
