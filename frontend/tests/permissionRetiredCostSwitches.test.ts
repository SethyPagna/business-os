// The two product-cost grants are retired (owner, 15 Nov 2026: cost is admin only). The role editor must not draw them, with the
// Products row open, whether or not the grants are stored; the stored values stay untouched.
//
// Run: node tests/permissionRetiredCostSwitches.test.ts
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { MODULE_ROWS } from '../src/components/users/permissionSummary.ts'
import { createHarness, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const RETIRED = ['product_cost_view', 'product_cost_edit']
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
const costSwitches = (surface: MountedSurface) => surface.findAll((node) => RETIRED.includes(node.getAttribute('data-perm-grant') ?? ''))
const labelled = (surface: MountedSurface, label: string) => surface.findAll((node) => node.getAttribute('aria-label') === label || node.getAttribute('title')?.startsWith(label) === true)

await test('the Products row open: no "View product costs" or "Edit product costs" switch, stored or not', async () => {
  for (const permissions of [{ products: true }, { products: true, product_cost_view: true, product_cost_edit: true }, { product_cost_view: true, product_cost_edit: true }]) {
    const surface = await render(permissions)
    assert.equal(costSwitches(surface).length, 0, `no cost switch for ${JSON.stringify(permissions)}`)
    assert.equal(labelled(surface, en.perm_product_cost_view).length, 0)
    assert.equal(labelled(surface, en.perm_product_cost_edit).length, 0)
    await surface.unmount(); live.splice(0)
  }
})

await test('a control still draws: the destructive-imports switch sits in the same row', async () => {
  const surface = await render({ products: true })
  assert.equal(surface.findAll((node) => node.getAttribute('data-perm-grant') === 'destructive_delete').length, 1)
})

await test('the model: no row lists a retired grant as an extra or group member', () => {
  for (const row of MODULE_ROWS) for (const def of [...row.extras, ...row.group]) assert.ok(!RETIRED.includes(def.key), `${row.id} lists ${def.key}`)
})

await test('MUTANT: without the retired filter the model lists both grants', async () => {
  const dir = new URL('../src/components/users/', import.meta.url)
  const source = readFileSync(new URL('permissionSummary.ts', dir), 'utf8')
  assert.ok(source.includes('!def.retired && def !== main'))
  const mutantUrl = new URL('permissionSummary.mutant.ts', dir)
  writeFileSync(mutantUrl, source.replace('!def.retired && def !== main', 'def !== main'))
  try {
    const mutant = await import(mutantUrl.href) as { MODULE_ROWS: typeof MODULE_ROWS }
    const listed = mutant.MODULE_ROWS.flatMap((row) => row.extras.map((def) => def.key))
    assert.ok(RETIRED.every((key) => listed.includes(key)), 'the unfiltered model offers the switches, so the test above can fail')
  } finally { rmSync(mutantUrl) }
})

await harness.close()
console.log(failed ? `\n${failed} test(s) FAILED` : '\nall tests passed')
if (failed) process.exitCode = 1
