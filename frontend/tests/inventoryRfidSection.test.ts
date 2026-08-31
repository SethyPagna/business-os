import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/components/inventory/Inventory.tsx', import.meta.url), 'utf8')
const movementsSurface = fs.readFileSync(new URL('../src/components/inventory/InventoryMovementsSurface.tsx', import.meta.url), 'utf8')

assert.match(source, /RFID_INVENTORY_WORKFLOWS/)
assert.match(source, /rfidGatewayStatus/)
assert.match(source, /RFID inventory/)
assert.match(source, /reader gateway/i)
assert.match(source, /unknownTags/)
assert.match(source, /Stock Count/)
assert.match(source, /EPC \/ TID/)
assert.match(source, /barcode fallback/i)
assert.match(source, /openMovementProductDetail/)
assert.match(source, /getInventoryApi\(\)\.getProductsByIds/)
assert.match(movementsSurface, /onClick=\{\(\) => openMovementProductDetail\(movement\)\}/)
// parseInventoryTimestamp left with the products slice (Part 562) -- the
// movement day-grouping runs through buildTimeActionSections/getTimeParts now.

console.log('PASS inventory RFID section is present and operationally framed')
