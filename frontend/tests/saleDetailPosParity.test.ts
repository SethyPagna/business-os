import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sanitizeSaleDetailText } from '../src/components/sales/saleDetailText.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => fs.readFileSync(path.resolve(here, relative), 'utf8')
const detail = read('../src/components/sales/SaleDetailModal.tsx')
const picker = read('../src/components/sales/SaleDetailProductPicker.tsx')
const workflow = read('../src/components/sales/SaleStatusWorkflow.tsx')
const backend = read('../../cloudflare/src/routes/sales.ts')

assert.equal(sanitizeSaleDetailText('  Sok\u0007 Dara  '), 'Sok Dara')
assert.equal(sanitizeSaleDetailText('Sok Ã©'), 'Sok é')
assert.equal(sanitizeSaleDetailText('អ្នកដឹកជញ្ជូន\u0000 ល្អ'), 'អ្នកដឹកជញ្ជូន ល្អ')

assert.match(detail, /placeholder=\{translateOr\('add_items_search_placeholder', 'Search by name or barcode'/)
assert.match(detail, /<SaleDetailProductPicker/)
assert.match(picker, /__groupChoices/)
assert.match(picker, /candidates\.filter/)
assert.match(picker, /Options \/ variants/)
assert.match(picker, /getProductBatches\(productId, branchId, true\)/)
assert.match(picker, /received_at/)
assert.match(picker, /expiry_date/)
assert.match(picker, /batches\.length > 0 && !batch/)
assert.doesNotMatch(picker, /Pick a lot/i)

assert.match(detail, /batch_id: line\.batchId/)
assert.match(detail, /batch_label: line\.batchLabel/)
assert.match(detail, /batch_expiry_date: line\.batchExpiryDate/)
assert.match(backend, /batchId: Number\(item\.batch_id\) \|\| null/)
assert.match(backend, /allocateNewSaleLines\(/)

assert.match(detail, /<SaleStatusWorkflow/)
assert.match(workflow, /'closed' \| 'destination' \| 'review'/)
assert.match(workflow, /Choose destination status/)
assert.match(workflow, /getStatusLabel\(currentStatus, t\)/)
assert.match(workflow, /getStatusLabel\(selectedStatus, t\)/)
assert.match(workflow, /onClick=\{onConfirm\}/)

console.log('sale-detail POS parity and personalized status workflow tests passed')
