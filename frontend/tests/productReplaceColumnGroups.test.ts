import assert from 'node:assert/strict'
import {
  REPLACE_COLUMN_GROUPS,
  BACKEND_PRODUCT_REPLACE_COLUMNS,
  flattenReplaceColumnGroups,
} from '../src/components/products/import/productReplaceColumnGroups.ts'

let failed = 0

async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// The property that actually matters (per this module's own header
// comment): every column on the backend's PRODUCT_REPLACE_COLUMNS
// allow-list (BACKEND_PRODUCT_REPLACE_COLUMNS is a literal mirror of it,
// see that constant's own comment for why it's a copy rather than a
// cross-package import) appears in exactly one group here -- no column
// missing (an operator would have no way to select it), and no column
// duplicated across groups (ambiguous which group "owns" it, and a
// future edit to one copy silently orphaning the other).

await runTest('every backend replace column appears in exactly one group', () => {
  const backendSet = new Set(BACKEND_PRODUCT_REPLACE_COLUMNS)
  const seen = new Map<string, string[]>()
  for (const group of REPLACE_COLUMN_GROUPS) {
    for (const col of group.columns) {
      const owners = seen.get(col) ?? []
      owners.push(group.key)
      seen.set(col, owners)
    }
  }

  const missing = BACKEND_PRODUCT_REPLACE_COLUMNS.filter((col) => !seen.has(col))
  assert.deepStrictEqual(missing, [], `columns missing from every group: ${missing.join(', ')}`)

  const duplicated = Array.from(seen.entries()).filter(([, owners]) => owners.length > 1)
  assert.deepStrictEqual(
    duplicated,
    [],
    `columns claimed by more than one group: ${duplicated.map(([col, owners]) => `${col} (${owners.join(', ')})`).join('; ')}`,
  )

  const extra = Array.from(seen.keys()).filter((col) => !backendSet.has(col))
  assert.deepStrictEqual(extra, [], `group columns not on the backend allow-list: ${extra.join(', ')}`)
})

await runTest('BACKEND_PRODUCT_REPLACE_COLUMNS has no duplicate entries itself', () => {
  const asSet = new Set(BACKEND_PRODUCT_REPLACE_COLUMNS)
  assert.equal(asSet.size, BACKEND_PRODUCT_REPLACE_COLUMNS.length)
})

await runTest('flattenReplaceColumnGroups expands selected group keys to their columns, ignoring unknown keys', () => {
  const result = flattenReplaceColumnGroups(new Set(['basic', 'unknown_key']))
  assert.deepStrictEqual(result, ['name', 'sku', 'barcode'])
})

await runTest('flattenReplaceColumnGroups accepts a plain array of keys too', () => {
  // Output order follows REPLACE_COLUMN_GROUPS' own array order (expiry
  // comes before status there), not the order keys were passed in.
  const result = flattenReplaceColumnGroups(['status', 'expiry'])
  assert.deepStrictEqual(result, ['expiry_date', 'expiry_alert_days', 'is_active'])
})

await runTest('flattenReplaceColumnGroups returns empty for no selected keys', () => {
  assert.deepStrictEqual(flattenReplaceColumnGroups(new Set()), [])
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
