import assert from 'node:assert/strict'
import { buildCategoryGroups, categoryGroupValues } from '../src/utils/categoryGrouping.ts'

let failed = 0

type TestCallback = () => void | Promise<void>

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('buildCategoryGroups clusters "Main - Sub" names under one parent, sorted by sub label', () => {
  const groups = buildCategoryGroups(['Haircare - Shampoo', 'Haircare - Conditioner', 'Haircare - Oil'])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].mainLabel, 'Haircare')
  assert.equal(groups[0].ownValue, null)
  assert.deepEqual(groups[0].children.map((c) => c.label), ['Conditioner', 'Oil', 'Shampoo'])
  assert.deepEqual(groups[0].children.map((c) => c.value), ['Haircare - Conditioner', 'Haircare - Oil', 'Haircare - Shampoo'])
})

await runTest('buildCategoryGroups keeps a category with no " - " as a standalone single-item group', () => {
  const groups = buildCategoryGroups(['Skincare', 'Makeup'])
  assert.equal(groups.length, 2)
  assert.deepEqual(groups.map((g) => g.mainLabel).sort(), ['Makeup', 'Skincare'])
  for (const group of groups) {
    assert.equal(group.children.length, 0)
    assert.equal(group.ownValue, group.mainLabel)
  }
})

await runTest('buildCategoryGroups keeps a bare main category as the group\'s own selectable value alongside its subcategories', () => {
  const groups = buildCategoryGroups(['Haircare', 'Haircare - Shampoo', 'Haircare - Conditioner'])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].ownValue, 'Haircare')
  assert.equal(groups[0].children.length, 2)
})

await runTest('categoryGroupValues includes the own value plus every child value', () => {
  const [group] = buildCategoryGroups(['Haircare', 'Haircare - Shampoo', 'Haircare - Conditioner'])
  assert.deepEqual(categoryGroupValues(group).sort(), ['Haircare', 'Haircare - Conditioner', 'Haircare - Shampoo'])
})

await runTest('categoryGroupValues for a group with no bare value returns only its children', () => {
  const [group] = buildCategoryGroups(['Haircare - Shampoo', 'Haircare - Conditioner'])
  assert.deepEqual(categoryGroupValues(group).sort(), ['Haircare - Conditioner', 'Haircare - Shampoo'])
})

await runTest('buildCategoryGroups does not misread a mid-word hyphen (no spaces) as a "Main - Sub" separator', () => {
  const groups = buildCategoryGroups(['Eco-Friendly', 'Eco-Friendly - Bamboo'])
  // "Eco-Friendly" alone has a hyphen but no space-padded " - ", so it stays
  // whole as its own main label; "Eco-Friendly - Bamboo" DOES have the real
  // separator and correctly nests under it.
  assert.equal(groups.length, 1)
  assert.equal(groups[0].mainLabel, 'Eco-Friendly')
  assert.equal(groups[0].ownValue, 'Eco-Friendly')
  assert.deepEqual(groups[0].children.map((c) => c.label), ['Bamboo'])
})

await runTest('buildCategoryGroups is stable against duplicate/whitespace-noisy input', () => {
  const groups = buildCategoryGroups(['Haircare - Shampoo', ' Haircare -  Shampoo ', '', '  '])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].children.length, 1, 'the whitespace-noisy duplicate should not create a second child')
})

await runTest('buildCategoryGroups sorts groups alphabetically by main label', () => {
  const groups = buildCategoryGroups(['Skincare - Serum', 'Haircare - Shampoo', 'Makeup - Lipstick'])
  assert.deepEqual(groups.map((g) => g.mainLabel), ['Haircare', 'Makeup', 'Skincare'])
})

if (failed > 0) {
  process.exitCode = 1
}
