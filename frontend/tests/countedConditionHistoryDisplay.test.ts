import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness } from './mountedComponentHarness.ts'
import { signedMovementQuantity, translateMovementRowType } from '../src/components/inventory/movementGroups.ts'

const labels: Record<string, string> = {
  movement_type_condition_tag: 'Condition tag added',
  movement_type_condition_clear: 'Condition tag cleared',
}
for (const [type, key] of [['condition_tag', 'movement_type_condition_tag'], ['condition_clear', 'movement_type_condition_clear']]) {
  assert.equal(translateMovementRowType({ movement_type: type }, key => labels[key]), labels[key], 'new condition types use the shared translated label')
  assert.equal(signedMovementQuantity(type, 0), 0)
}
assert.equal(signedMovementQuantity('damage_out', 3), -3, 'historical held-pool removal remains a physical outflow')
assert.equal(signedMovementQuantity('write_off', 3), -3, 'actual removal remains a physical outflow')

const harness = await createHarness()
try {
  for (const language of ['en', 'km']) {
    const pack = JSON.parse(readFileSync(new URL(`../src/lang/${language}.json`, import.meta.url), 'utf8')) as Record<string, string>
    const t = (key: string) => pack[key] || key
    for (const movementType of ['condition_tag', 'condition_clear', 'damage_out', 'write_off', 'adjustment']) {
      const conditionOnly = movementType.startsWith('condition_')
      const fixture = await harness.mount({
        component: 'components/inventory/MovementDetailFloat.tsx',
        doubles: {},
        app: { t, language, settings: {}, user: { id: 7 }, can: () => true },
        props: {
          movement: { id: 1, product_name: 'Synthetic stock record', branch_name: 'LC Store', movement_type: movementType, quantity: conditionOnly || movementType === 'adjustment' ? 0 : 3 },
          t, fmtTime: () => '09/10/2026', onClose: () => {},
          loadBalance: async () => ({ before_qty: 10, after_qty: conditionOnly || movementType === 'adjustment' ? 10 : 7, branch_before_qty: 10, branch_after_qty: conditionOnly || movementType === 'adjustment' ? 10 : 7, active_branch_count: 1 }),
        },
      })
      await fixture.settle()
      const hint = pack.stock_condition_quantity_unchanged
      assert.ok(hint && hint !== 'stock_condition_quantity_unchanged', `${language} supplies the condition-only explanation`)
      assert.equal(fixture.text().includes(hint), conditionOnly, `${language}/${movementType} shows the quantity-neutral explanation only for a condition change`)
      assert.ok(fixture.text().includes(translateMovementRowType({ movement_type: movementType }, t)), `${language}/${movementType} renders the shared translated label`)
      assert.ok(fixture.text().includes('LC Store'), 'the sole branch remains visible')
      await fixture.unmount()
      console.log(`PASS actual movement detail ${language} ${movementType}`)
    }
  }
} finally { await harness.close() }
