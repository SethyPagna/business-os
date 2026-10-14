// The lot a Stock Session Remove or Set line starts on (defaultLotChoice): oldest for Remove, newest for Set, never an empty
// lot while a stocked one exists. Every row of LOT_SCENARIOS runs in every arrival order, so list position cannot decide it.
import assert from 'node:assert/strict'
import { defaultLotChoice, sessionLotChoices } from '../src/utils/stockSessionDraft.ts'
import { LOT_SCENARIOS, orderings } from './stockSessionLotScenarios.ts'

const supplier = { supplierId: null, supplierName: '' }
const holdsStock = (lot: { quantity: number }): boolean => lot.quantity > 0

for (const scenario of LOT_SCENARIOS) {
  for (const mode of ['remove', 'set'] as const) {
    const expected = scenario[mode]
    for (const arrival of orderings(scenario.lots)) {
      const label = `${scenario.name} / ${mode} / arriving ${arrival.map((lot) => lot.id).join(',')}`
      const choices = sessionLotChoices(mode, arrival, supplier)
      const { sharedDate } = scenario
      assert.equal(defaultLotChoice({ mode, choices, sharedDate }), expected, `${label}: starting lot`)
      assert.equal(defaultLotChoice({ mode, choices: [...choices].reverse(), sharedDate }), expected, `${label}: starting lot from the reversed list`)
      // The rule once more on its own: never an empty lot while a stocked one exists.
      if (typeof expected === 'number' && scenario.lots.some(holdsStock)) {
        const picked = scenario.lots.find((lot) => lot.id === expected)
        assert.ok(picked && holdsStock(picked), `${label}: lot ${expected} holds no stock but a stocked lot exists`)
      }
    }
  }
  console.log(`PASS ${scenario.name}: Remove starts on ${scenario.remove}, Set on ${scenario.set}`)
}

// Add never starts on an existing lot unless the option sheet named one.
for (const scenario of LOT_SCENARIOS) {
  assert.equal(defaultLotChoice({ mode: 'add', choices: sessionLotChoices('add', scenario.lots, supplier) }), 'new', `${scenario.name}: Add starts on a new received date`)
}

// The option sheet's lot is a choice the person made, so it wins even on an empty lot; the shared date (today unless changed) does not.
const emptyNewest = LOT_SCENARIOS.find((scenario) => scenario.name === 'multi-day, newest lot empty')!
const setChoices = sessionLotChoices('set', emptyNewest.lots, supplier)
assert.equal(defaultLotChoice({ mode: 'set', choices: setChoices, sheetBatchId: 3 }), 3, 'a lot named by the option sheet wins, even when empty')
assert.equal(defaultLotChoice({ mode: 'set', choices: setChoices, sharedDate: '2026-10-09' }), 2, 'the empty lot of the shared date does not beat a stocked one')
assert.equal(defaultLotChoice({ mode: 'set', choices: setChoices, sheetBatchId: 99 }), 2, 'a sheet lot that is not offered falls back to the default')
assert.equal(defaultLotChoice({ mode: 'set', choices: [] }), 'none', 'no lot at all means the branch total')

console.log('PASS explicit picks win, Add starts new, no lots means the branch total')
