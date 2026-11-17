// The two product-cost grants are editable switches again (owner, 17 Nov 2026, reversing the 15 Nov retirement): the role editor must draw
// "View product costs" and "Edit product costs" in the Products row, exactly once each, whether or not the grants are stored.
//
// Run: node tests/permissionCostSwitches.test.ts
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { MODULE_ROWS } from '../src/components/users/permissionSummary.ts'
import { createHarness, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const COST_GRANTS = ['product_cost_view', 'product_cost_edit']
let failed = 0
const live: MountedSurface[] = []
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) } finally {
    for (const surface of live.splice(0)) await surface.unmount()
  }
}

const harness = await createHarness()
const ancestors = (node: MemoryNode): MemoryNode[] => {
  const chain: MemoryNode[] = []
  for (let current = node.parentNode; current; current = current.parentNode) chain.push(current)
  return chain
}
const within = (node: MemoryNode, root: MemoryNode) => node === root || ancestors(node).includes(root)

async function render(permissions: Record<string, unknown>): Promise<MountedSurface> {
  const t = (key: string) => en[key]
  const surface = await harness.mount({ component: 'components/users/PermissionEditor.tsx', props: { permissions, onChange: () => {}, t }, app: { t }, doubles: {} })
  live.push(surface)
  for (const id of surface.findAll((node) => node.getAttribute('data-perm-module') !== null).map((node) => node.getAttribute('data-perm-module') as string)) {
    const root = surface.find((node) => node.getAttribute('data-perm-module') === id, `module ${id}`)
    const toggle = surface.find((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-expanded') !== null && within(node, root), `${id} expander`)
    if (toggle.getAttribute('aria-expanded') !== 'true') await surface.click(toggle)
  }
  return surface
}
const costSwitches = (surface: MountedSurface) => surface.findAll((node) => COST_GRANTS.includes(node.getAttribute('data-perm-grant') ?? ''))
const labelled = (surface: MountedSurface, label: string) => surface.findAll((node) => node.getAttribute('aria-label') === label || node.getAttribute('title')?.startsWith(label) === true)

await test('the Products row open: one "View product costs" and one "Edit product costs" switch, stored or not', async () => {
  for (const permissions of [{ products: true }, { products: true, product_cost_view: true, product_cost_edit: true }, { product_cost_view: false, product_cost_edit: false }]) {
    const surface = await render(permissions)
    assert.equal(costSwitches(surface).length, 2, `both cost switches for ${JSON.stringify(permissions)}`)
    for (const key of COST_GRANTS) assert.equal(surface.findAll((node) => node.getAttribute('data-perm-grant') === key).length, 1, `one ${key}`)
    assert.ok(labelled(surface, en.perm_product_cost_view).length >= 1, 'the view switch carries its label')
    assert.ok(labelled(surface, en.perm_product_cost_edit).length >= 1, 'the edit switch carries its label')
    await surface.unmount(); live.splice(0)
  }
})

await test('a control draws beside them: the destructive-imports switch sits in the same row', async () => {
  const surface = await render({ products: true })
  assert.equal(surface.findAll((node) => node.getAttribute('data-perm-grant') === 'destructive_delete').length, 1)
})

await test('the model: the Products row lists both cost grants as extras', () => {
  const products = MODULE_ROWS.find((row) => row.id === 'products')
  assert.ok(products, 'Products row')
  for (const key of COST_GRANTS) assert.ok(products.extras.some((def) => def.key === key), `Products lists ${key}`)
})

await test('MUTANT: with both grants flagged retired the model drops them, so the tests above can fail', async () => {
  const dir = new URL('../src/components/users/', import.meta.url)
  const definitions = readFileSync(new URL('permissionDefinitions.ts', dir), 'utf8')
  const summary = readFileSync(new URL('permissionSummary.ts', dir), 'utf8')
  const keep = "short: 'See costs' }"
  assert.ok(definitions.includes(keep) && definitions.includes("short: 'Enter costs' }"))
  const defsMutant = new URL('permissionDefinitions.mutant.ts', dir)
  const summaryMutant = new URL('permissionSummary.mutant.ts', dir)
  writeFileSync(defsMutant, definitions.replace(keep, "short: 'See costs', retired: true }").replace("short: 'Enter costs' }", "short: 'Enter costs', retired: true }"))
  writeFileSync(summaryMutant, summary.replace("'./permissionDefinitions.ts'", "'./permissionDefinitions.mutant.ts'"))
  try {
    const mutant = await import(summaryMutant.href) as { MODULE_ROWS: typeof MODULE_ROWS }
    const listed = mutant.MODULE_ROWS.flatMap((row) => row.extras.map((def) => def.key))
    assert.ok(COST_GRANTS.every((key) => !listed.includes(key)), 'the mutant model no longer offers the switches')
  } finally { rmSync(defsMutant); rmSync(summaryMutant) }
})

await harness.close()
console.log(failed ? `\n${failed} test(s) FAILED` : '\nall tests passed')
if (failed) process.exitCode = 1
