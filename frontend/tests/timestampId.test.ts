import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUSINESS_RECEIPT_NUMBER_RE, businessDateTimeId, isBusinessReceiptNumber, stockSessionId } from '../src/utils/timestampId.ts'
import { fmtDateTime24 } from '../src/utils/formatters.ts'
import { normalizeClientReceiptNumber, uniqueBusinessDateTimeNumber } from '../../cloudflare/src/lib/receiptNumber.ts'

const testDir = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(testDir, '..')
const repoRoot = resolve(frontendRoot, '..')

function readFrontend(path: string): string {
  return readFileSync(resolve(frontendRoot, path), 'utf8')
}

function readRepo(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

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

await runTest('receipt-id fragment is Phnom Penh YYYYMMDD-HHMMSS, 24-hour', () => {
  // 07:35:12 UTC = 14:35:12 wall clock in Asia/Phnom_Penh (UTC+07, no DST)
  assert.equal(businessDateTimeId(new Date('2026-08-30T07:35:12Z')), '20260830-143512')
  // UTC evening is the NEXT Phnom Penh calendar day; midnight is 00, not 24
  assert.equal(businessDateTimeId(new Date('2026-08-30T17:00:00Z')), '20260831-000000')
  assert.equal(businessDateTimeId(new Date('2026-12-31T17:00:00Z')), '20270101-000000')
  assert.match(businessDateTimeId(), /^\d{8}-\d{6}$/)
})

await runTest('client and server generators stay hand-synced and wired in', async () => {
  // Server twin exists with the same exported names (fixed +7 arithmetic).
  const serverLib = readRepo('cloudflare/src/lib/receiptNumber.ts')
  assert.match(serverLib, /export function businessDateTimeId/)
  assert.match(serverLib, /export async function uniqueBusinessDateTimeNumber/)
  assert.match(serverLib, /7 \* 60 \* 60 \* 1000/)
  const moment = new Date('2026-08-30T17:00:00Z')
  const expected = businessDateTimeId(moment)
  assert.equal(await uniqueBusinessDateTimeNumber('', async () => false, moment), expected)
  assert.equal(await uniqueBusinessDateTimeNumber('', async candidate => candidate === expected, moment), `${expected}-2`)
  // New sales require server confirmation: only the server may mint their
  // receipt number. Historical recovery preserves its original identity.
  const saleWrite = readFrontend('src/api/saleWriteTransport.ts')
  assert.doesNotMatch(saleWrite, /queueOfflineSale|buildOfflineSaleReceiptNumber|businessDateTimeId/)
  assert.doesNotMatch(saleWrite, /`RCP-\$\{/)
  assert.doesNotMatch(saleWrite, /`OFFLINE-\$\{/)
  const salesRoute = readRepo('cloudflare/src/routes/sales.ts')
  assert.match(salesRoute, /normalizeClientReceiptNumber\(body\.receipt_number\) \|\| await uniqueBusinessDateTimeNumber\(/)
  // ...and returns mint RET-/SRET-<datetime> instead of Date.now() ids.
  const returnsTransport = readFrontend('src/api/returnsTransport.ts')
  assert.match(returnsTransport, /\$\{prefix\}-\$\{businessDateTimeId\(\)\}/)
  assert.doesNotMatch(returnsTransport, /\$\{prefix\}-\$\{Date\.now\(\)\}/)
})

await runTest('the compact id form stays OUT of displayed dates (receipt shows dd/mm/yyyy 24h)', () => {
  // User, Aug 30 2026: yyyymmdd+time is ONLY for the receipt id; shown
  // dates keep the app-wide display convention -- which became DAY-first
  // on Sep 4 2026: "change the whole app to dd-mm-yyy, just receipt id
  // stays yyyy-mm-dd". 30 is past the 12th, so this pins the order
  // rather than merely agreeing with it. The 24-hour half is unchanged.
  assert.equal(fmtDateTime24('2026-08-30T07:35:12Z'), '30/08/2026 14:35')
  const receipt = readFrontend('src/components/receipt/Receipt.tsx')
  assert.match(receipt, /fmtDateTime24\(createdAt \|\| new Date\(\)\)/)
  // The old locale-default form printed 12-hour AM/PM and let the DEVICE
  // pick the field order. A wrong locale swaps day and month without
  // failing, so the order is assembled by hand now -- it must not come back.
  assert.doesNotMatch(receipt, /toLocaleString\(undefined/)
})


await runTest('receipt validation rejects foreign labels and server creation owns normalization', () => {
  // 2026-09-02: a reconciliation pack wrote the old system's
  // `NNNNNN@YYYY-MM-DD` invoice label onto 15,004 sales (repaired by
  // migration 0107). The offline queue mints and PRINTS a receipt id at
  // queue time historically. Validation still distinguishes those ids;
  // new online-only sales use server normalization before receipt creation.
  for (const bad of ['004434@2026-09-02', '4351@2026-08-28', '004434', '20260902', '20260902-1642', '', null, 42]) {
    assert.equal(isBusinessReceiptNumber(bad), false, `should reject ${String(bad)}`)
    assert.equal(normalizeClientReceiptNumber(bad), null, 'server rejects foreign receipt labels before minting')
  }
  for (const good of ['20260902-164228', '20260902-164228-2', '20260902-164228-A3F9', 'RCP-20260101-090000', 'RET-20260902-164228', 'SRET-20260902-164228-2']) {
    assert.equal(isBusinessReceiptNumber(good), true, `should accept ${good}`)
    assert.equal(normalizeClientReceiptNumber(` ${good} `), good, 'server preserves valid original recovery receipt identity')
  }
  assert.equal(isBusinessReceiptNumber(`  ${businessDateTimeId()}  `), true, 'a trimmed freshly minted id is accepted')

  // Execute the server normalizer, not only its regex declaration.
  const serverLib = readRepo('cloudflare/src/lib/receiptNumber.ts')
  const serverRe = serverLib.match(/export const BUSINESS_RECEIPT_NUMBER_RE = (.+)$/m)?.[1]
  assert.equal(serverRe, String(BUSINESS_RECEIPT_NUMBER_RE), 'client and server receipt regexes drifted apart')
})
await runTest('S4-14: a stock-in session id is S-YYYYMMDD-HHMM in Phnom Penh time', () => {
  // Minute resolution, no seconds -- and the SAME +7 shift the receipt id
  // uses, so an evening-UTC session carries the next Phnom Penh day.
  assert.equal(stockSessionId('2026-08-30T07:35:12Z'), 'S-20260830-1435')
  assert.equal(stockSessionId('2026-08-30T17:00:00Z'), 'S-20260831-0000')
  // SQLite CURRENT_TIMESTAMP has no zone marker and must still be read as
  // UTC -- a bare Date.parse would treat it as local and shift the id.
  assert.equal(stockSessionId('2026-08-30 07:35:12'), 'S-20260830-1435')
  // Unreadable input yields '' so the caller can fall back, never 'S-NaN'.
  for (const bad of ['', null, undefined, 'not a date']) {
    assert.equal(stockSessionId(bad), '', `should not mint an id from ${String(bad)}`)
  }
  // The Sessions list must SHOW this id, keep the opaque grouping key only
  // as the cell's title, and no longer head that column 'Receipt'.
  const sessions = readFrontend('src/components/products/StockInSessionsSection.tsx')
  assert.match(sessions, /stockSessionId\(session\.createdAt\) \|\| session\.key/)
  assert.match(sessions, /tr\('session_id', 'Session ID'\)/)
  assert.doesNotMatch(sessions, /tr\('receipt', 'Receipt'\)/)
})

if (failed > 0) {
  process.exitCode = 1
}
