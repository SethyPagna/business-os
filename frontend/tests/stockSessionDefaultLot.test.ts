// The lot a Stock Session Remove or Set line starts on (defaultLotChoice).
//
// Lot lists are shown newest received first, stocked lots before empty ones. The
// starting lot must not follow that display order: Remove starts on the oldest
// lot (what FIFO would draw), Set on the newest, and a lot holding stock always
// beats an empty one. Found in the release-2 review (finding 3): with undated
// lots only, Set started on the EMPTY lot because the old "last in the list"
// fallback now means "the empty one". Every row of LOT_SCENARIOS is run in every
// arrival order, so a result that quietly depends on list position fails here.
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
      assert.equal(defaultLotChoice({ mode, choices }), expected, `${label}: starting lot`)
      // The float re-derives the default from a list that may be in any order.
      assert.equal(defaultLotChoice({ mode, choices: [...choices].reverse() }), expected, `${label}: starting lot from the reversed list`)
      // The rule the table encodes, stated once more on its own: never an empty lot while a stocked one exists.
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

// An explicit pick is not a default: the option sheet's lot and the session's shared received date win even on an empty lot.
const emptyNewest = LOT_SCENARIOS.find((scenario) => scenario.name === 'multi-day, newest lot empty')!
const setChoices = sessionLotChoices('set', emptyNewest.lots, supplier)
assert.equal(defaultLotChoice({ mode: 'set', choices: setChoices, sheetBatchId: 3 }), 3, 'a lot named by the option sheet wins, even when empty')
assert.equal(defaultLotChoice({ mode: 'set', choices: setChoices, sharedDate: '2026-10-09' }), 3, 'the lot with the shared received date wins, even when empty')
assert.equal(defaultLotChoice({ mode: 'set', choices: setChoices, sheetBatchId: 99 }), 2, 'a sheet lot that is not offered falls back to the default')
assert.equal(defaultLotChoice({ mode: 'set', choices: [] }), 'none', 'no lot at all means the branch total')

console.log('PASS explicit picks win, Add starts new, no lots means the branch total')
