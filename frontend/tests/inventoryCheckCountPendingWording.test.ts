// INV S6 verify gap 4: a Set held while a count of the product waits for approval answers 409 inventory_check_count_pending. Every surface that can now receive it says so in the
// person's language (key inventoryCheckCountPending, en + km): Products > Manage received dates, the stock sessions (Add/Remove/Set rows), the Fast stock-in rows and Inventory.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stockFailureText } from '../src/utils/stockAdjustOutcome.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const KEY = 'inventoryCheckCountPending'
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>

// The shared failure text (stock sessions, Fast stock-in, tagged rows): the code is translated, the Worker's English is not shown.
const asked: string[] = []
const text = stockFailureText({ code: 'inventory_check_count_pending', message: 'Set is blocked while a count of this product is waiting for approval. Approve or reject that count first.' }, (key, fallback) => { asked.push(key); return `[${key}] ${fallback}` }, 'Error')
assert.deepEqual(asked, [KEY], 'the pack key is asked for')
assert.match(text, /^\[inventoryCheckCountPending\] /)

// Both language packs carry it, and Khmer is Khmer.
assert.ok(en[KEY] && km[KEY], 'both packs have the key')
assert.notEqual(en[KEY], km[KEY]); assert.match(km[KEY], /[\u1780-\u17FF]/, 'the Khmer sentence is in Khmer')

// B5 follow-up 2: it reads as a refusal of the Set, not as a bare count, and says what unblocks it.
assert.match(en[KEY], /^Set is blocked .*waiting for approval.*Approve or reject/, 'en: the Set is blocked until the waiting count is decided')
// B5 follow-up 3: the unused duplicate key is gone from both packs (nothing reads it, including the inventory_check_error_ code family).
assert.ok(!('inventory_check_error_count_pending' in en) && !('inventory_check_error_count_pending' in km), 'the dead duplicate key stays retired')

// Each surface maps the code (a source pin: these components are not mounted in a unit test).
assert.match(read('../src/components/inventory/ManageBatchesModal.tsx'), /code === 'inventory_check_count_pending' \? tr\('inventoryCheckCountPending'/, 'Manage received dates')
assert.match(read('../src/components/products/StockChangeSection.tsx'), /stockFailureText\(\{ code: row\.failure\.code, message: row\.failure\.message \}/, 'the stock sessions show the translated failure of a row')
assert.match(read('../src/components/inventory/InventoryChecksPage.tsx'), /inventory_check_count_pending: \{ key: 'inventoryCheckCountPending'/, 'Inventory')
console.log('PASS inventoryCheckCountPendingWording')
