import assert from 'node:assert/strict'
import { workerState } from './inventoryApprovalStates.ts'
import { withAppliedRowStock } from '../src/components/inventory/inventoryCheckAppliedRows.ts'
import type { InventoryCheckProduct } from '../src/types/inventoryChecks.ts'

// The rows outside the approval panel after lines were applied: what the Worker's own answer says each line wrote, with no read.
const pending = workerState('pending')

{
  const rows = [{ id: 1, name: 'Serum', quantity: 9 }, { id: 2, name: 'Toner', quantity: 5 }] as InventoryCheckProduct[]
  const next = withAppliedRowStock(rows, { '1': 7 }, pending.items)
  assert.deepEqual(next.map(row => row.quantity), [7, 5], 'the applied line takes the figure the answer wrote; another line is untouched')
  assert.equal(next[1], rows[1], 'an untouched row is the same object')
  assert.equal(withAppliedRowStock([{ id: 1, name: 'S', quantity: 9, damaged_quantity: 2 }] as InventoryCheckProduct[], { '1': 7 }, [])[0].quantity, 9, 'units held aside stay in the sum the list shows (7 + 2)')
  const held = pending.items.map(item => ({ ...item, current_stock: { ...item.current_stock, recorded_damaged_quantity: 3 } }))
  assert.equal(withAppliedRowStock([{ id: 1, name: 'S', quantity: 12 }] as InventoryCheckProduct[], { '1': 7 }, held as typeof pending.items)[0].quantity, 10, 'a row that does not say its damaged units takes them from the session item')
}

console.log('PASS Inventory check applied rows: the session list takes the stock an accepted line wrote')
