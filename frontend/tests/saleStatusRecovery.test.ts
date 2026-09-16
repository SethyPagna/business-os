import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { recoverSaleStatus } from '../src/utils/saleStatusRecovery.ts'

const fresh = { id: 17000, updated_at: '2026-09-11 10:30:00', sale_status: 'completed' }
const receipt = { committed: true, response: { updated_at: fresh.updated_at } }
let rowReads = 0
assert.deepEqual(await recoverSaleStatus({
  isCurrent: () => true, readReceipt: async () => ({ committed: false }),
  readSale: async () => { rowReads++; return fresh },
}), { state: 'pending', committed: false })
assert.equal(rowReads, 0, 'a matching visible status without a receipt cannot prove this operation')
assert.deepEqual(await recoverSaleStatus({
  isCurrent: () => true, readReceipt: async () => receipt, readSale: async () => fresh,
}), { state: 'recovered', sale: fresh })
for (const stale of [null, { ...fresh, updated_at: '2026-09-11 10:29:00' }]) {
  assert.deepEqual(await recoverSaleStatus({
    isCurrent: () => true, readReceipt: async () => receipt, readSale: async () => stale,
  }), { state: 'pending', committed: true })
}
let current = true
assert.deepEqual(await recoverSaleStatus({
  isCurrent: () => current,
  readReceipt: async () => { current = false; return receipt },
  readSale: async () => { throw new Error('must not read another actor or request') },
}), { state: 'superseded' })
current = true
assert.deepEqual(await recoverSaleStatus({
  isCurrent: () => current, readReceipt: async () => receipt,
  readSale: async () => { current = false; return fresh },
}), { state: 'superseded' })
let finishReceipt!: (value: typeof receipt) => void
const bounded = await recoverSaleStatus({
  isCurrent: () => true, timeoutMs: 5,
  readReceipt: () => new Promise((resolve) => { finishReceipt = resolve }),
  readSale: async () => { rowReads++; return fresh },
})
assert.deepEqual(bounded, { state: 'pending', committed: false })
finishReceipt(receipt)
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(rowReads, 0, 'a receipt arriving after the deadline cannot start a late read')
assert.deepEqual(await recoverSaleStatus({
  isCurrent: () => true, timeoutMs: 5, readReceipt: async () => receipt,
  readSale: () => new Promise(() => {}),
}), { state: 'pending', committed: true }, 'a hung display read preserves positive commit proof')

// Execute the production retry callback, so proof must suppress the actual
// mutation call rather than merely returning the right helper result.
const source = readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const start = source.indexOf('const retryPendingDirectStatusRequest = ') + 'const retryPendingDirectStatusRequest = '.length
const end = source.indexOf('\n  const discardPendingDirectStatus', start)
const code = transformSync(`const callback = ${source.slice(start, end)}`, { loader: 'ts', format: 'cjs' }).code
const pending = { actorId: '7', entityId: '17000', history: null, body: { client_request_id: 'original', sale_status: 'completed', payment_details: [{ method: 'ABA Bank', amount_usd: 7 }] } }
let writes = 0
let active = pending
let actor = '7'
let outcome: any = { state: 'recovered', sale: fresh }
let security = 'security:7:0'
let revokeDuringRead = false
const callback = new Function('statusSecurityScope', 'statusSecurityRef', 'authReady', 'currentPendingDirectStatus', 'reconcilePendingStatus', 'statusActorRef', 'handleStatusChange', 'setDetailSale', 'actionHistory', `${code}; return callback`)(
  security, { get current() { return security } }, true,
  () => active,
  async () => { if (revokeDuringRead) security = 'security:7:1'; return outcome },
  { get current() { return actor } },
  async (...args: any[]) => { writes++; assert.strictEqual(args[6], pending.body); return true },
  () => {}, {},
)
await callback()
assert.equal(writes, 0, 'committed and readable recovery never PATCHes')
outcome = { state: 'pending', committed: true }
await callback()
assert.equal(writes, 0, 'committed but stale recovery never PATCHes')
outcome = { state: 'pending', committed: false }
await callback()
assert.equal(writes, 1, 'missing proof retries the original frozen body')
actor = '8'
await callback()
assert.equal(writes, 1, 'actor switch suppresses the old request')
actor = '7'
outcome = { state: 'superseded' }
await callback()
assert.equal(writes, 1, 'superseded operation never submits')
outcome = { state: 'pending', committed: false }
revokeDuringRead = true
await callback()
assert.equal(writes, 1, 'same-ID permission change while reading proof cannot replay an old closure')
await callback()
assert.equal(writes, 1, 'stale retry callback remains invalid even before its first read')
console.log('PASS bounded read-only sale recovery, stale/missing proof, late responses, actor guards and production retry callback')
