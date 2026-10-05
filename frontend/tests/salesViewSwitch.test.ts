// Role editor "View" switch for Sales (owner, 5 Oct 2026). `sales:view` could only be set through
// the API: the editor had no row for it. The Worker (lib/permissions.ts getActionTier) and the
// frontend (utils/permissions.ts effectivePermissions) already honour an explicit false; this pins
// that the editor now exposes it, that both sides answer identically for every stored shape, and
// that a role saved before the row existed keeps seeing Sales.
//
// Run: node tests/salesViewSwitch.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { effectivePermissions } from '../src/utils/permissions.ts'
import { actionsForKey, actionAllowed, isActionOverriddenOff, outcomeAt, toggleActionOverrideMap } from '../src/utils/permissionActions.ts'
import { rolePermissionLabel } from '../src/components/users/rolePermissionLabel.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const worker: any = (() => {
  const compiled = ts.transpileModule(read('../../cloudflare/src/lib/permissions.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const module = { exports: {} }
  new Function('exports', compiled)(module.exports)
  return module.exports
})()
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>

// 1. The editor has a View row for Sales, first, readable at the View tier.
const view = actionsForKey('sales').find((action) => action.key === 'view')
assert.ok(view, 'Sales has a View row in the role editor')
assert.equal(actionsForKey('sales')[0].key, 'view', 'View leads the list, as it does for every other section')
assert.equal(outcomeAt(view!, 'view'), 'allow', 'the View tier still reads')
assert.equal(outcomeAt(view!, 'full'), 'allow')
assert.equal(outcomeAt(view!, 'none'), 'block')

// 2. Clicking the row stores a one-way false and clicking again deletes it.
const off = toggleActionOverrideMap({ sales: true }, 'sales', 'view')
assert.deepEqual(off, { sales: true, 'sales:view': false })
assert.deepEqual(toggleActionOverrideMap(off, 'sales', 'view'), { sales: true }, 'handing it back removes the key rather than storing true')

// 3. Frontend and Worker agree for every stored shape; absent key = on (roles saved before this row).
const absent = Symbol('absent')
let cases = 0
for (const tier of [true, 'view', false, 'review'] as const) {
  for (const stored of [absent, false, true, 'false', 0, null] as const) {
    const permissions: Record<string, unknown> = { sales: tier }
    if (stored !== absent) permissions['sales:view'] = stored
    const front = effectivePermissions({ permissions }).can('sales', 'view')
    const back = worker.getActionTier({ permissions: JSON.stringify(permissions) }, 'sales', 'view') !== 'none'
    assert.equal(front, back, `parity for ${JSON.stringify(permissions)}`)
    if (tier === true || tier === 'view') assert.equal(front, stored !== false, `only an explicit false hides Sales: ${JSON.stringify(permissions)}`)
    else assert.equal(front, false, 'no sales grant, no Sales')
    cases += 1
  }
}
for (const tier of [true, 'view'] as const) {
  assert.equal(effectivePermissions({ permissions: { sales: tier } }).can('sales', 'view'), true, 'existing role without the key keeps Sales')
  assert.equal(isActionOverriddenOff({ sales: tier }, 'sales', 'view'), false)
  assert.equal(actionAllowed('sales', 'view', tier === true ? 'full' : 'view'), true)
  assert.equal(actionAllowed('sales', 'view', tier === true ? 'full' : 'view', () => false, (s, a) => isActionOverriddenOff({ sales: tier, 'sales:view': false }, s, a)), false)
}
// An administrator is never narrowed, on either side.
const admin = { role_code: 'admin', permissions: { sales: true, 'sales:view': false } }
assert.equal(effectivePermissions(admin).can('sales', 'view'), true)
assert.equal(worker.getActionTier({ ...admin, permissions: JSON.stringify(admin.permissions) }, 'sales', 'view'), 'full')

// 4. The Worker refuses on the surfaces the key is meant to hide (reports.ts is in the deployed base).
assert.match(read('../../cloudflare/src/routes/reports.ts'), /getActionTier\(user, 'sales', 'view'\) !== 'none'/)
// The editor renders every row of the table except the one it draws as a dropdown.
assert.match(read('../src/components/users/PermissionEditor.tsx'), /action\.key !== 'customer_reassign'/)

// 5. Labels: both packs, a real Khmer string, and the Roles card tag reads as a label not a raw key.
assert.ok(en.perm_act_sales_view && km.perm_act_sales_view, 'perm_act_sales_view in both packs')
assert.notEqual(km.perm_act_sales_view, en.perm_act_sales_view, 'no English placeholder in km')
assert.match(km.perm_act_sales_view, /[\u1780-\u17FF]/)
const tr = (pack: Record<string, string>) => (key: string, fallback: string) => pack[key] || fallback
assert.equal(rolePermissionLabel('sales:view', tr(km)), `${km.perm_sales}: ${km.perm_act_sales_view}`)
assert.equal(rolePermissionLabel('sales:view', tr(en)), `${en.perm_sales}: ${en.perm_act_sales_view}`)

console.log(`PASS Sales View switch: editor row, one-way toggle, ${cases} frontend/Worker parity cases, both packs`)
