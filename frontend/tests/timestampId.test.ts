import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUSINESS_RECEIPT_NUMBER_RE, businessDateTimeId, isBusinessReceiptNumber } from '../src/utils/timestampId.ts'
import { fmtDateTime24 } from '../src/utils/formatters.ts'

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

await runTest('client and server generators stay hand-synced and wired in', () => {
  // Server twin exists with the same exported names (fixed +7 arithmetic).
  const serverLib = readRepo('cloudflare/src/lib/receiptNumber.ts')
  assert.match(serverLib, /export function businessDateTimeId/)
  assert.match(serverLib, /export async function uniqueBusinessDateTimeNumber/)
  assert.match(serverLib, /7 \* 60 \* 60 \* 1000/)
  // Offline sales mint the BARE <datetime> id (user, Aug 31 2026: "Receipt
  // no need RCP"; no more dateless OFFLINE- ids either)...
  const saleWrite = readFrontend('src/api/saleWriteTransport.ts')
  assert.match(saleWrite, /return businessDateTimeId\(\)/)
  assert.doesNotMatch(saleWrite, /`RCP-\$\{/)
  assert.doesNotMatch(saleWrite, /`OFFLINE-\$\{/)
  // ...and returns mint RET-/SRET-<datetime> instead of Date.now() ids.
  const returnsTransport = readFrontend('src/api/returnsTransport.ts')
  assert.match(returnsTransport, /\$\{prefix\}-\$\{businessDateTimeId\(\)\}/)
  assert.doesNotMatch(returnsTransport, /\$\{prefix\}-\$\{Date\.now\(\)\}/)
})

await runTest('the compact id form stays OUT of displayed dates (receipt shows mm/dd/yyyy 24h)', () => {
  // User, Aug 30 2026: yyyymmdd+time is ONLY for the receipt id; shown
  // dates keep the app-wide mm/dd/yyyy + 24-hour convention.
  assert.equal(fmtDateTime24('2026-08-30T07:35:12Z'), '08/30/2026 14:35')
  const receipt = readFrontend('src/components/receipt/Receipt.tsx')
  assert.match(receipt, /fmtDateTime24\(createdAt \|\| new Date\(\)\)/)
  // The old locale-default form printed 12-hour AM/PM (and day-first on
  // non-US devices) -- it must not come back.
  assert.doesNotMatch(receipt, /toLocaleString\(undefined/)
})


await runTest('the client refuses a foreign receipt shape, so the @ label cannot be queued offline', () => {
  // 2026-09-02: a reconciliation pack wrote the old system's
  // `NNNNNN@YYYY-MM-DD` invoice label onto 15,004 sales (repaired by
  // migration 0107). The offline queue mints and PRINTS a receipt id at
  // queue time, so the client has to be able to tell a real business id
  // from a foreign one before that number reaches a customer.
  for (const bad of ['004434@2026-09-02', '4351@2026-08-28', '004434', '20260902', '20260902-1642', '', null, 42]) {
    assert.equal(isBusinessReceiptNumber(bad), false, `should reject ${String(bad)}`)
  }
  for (const good of ['20260902-164228', '20260902-164228-2', '20260902-164228-A3F9', 'RCP-20260101-090000', 'RET-20260902-164228', 'SRET-20260902-164228-2']) {
    assert.equal(isBusinessReceiptNumber(good), true, `should accept ${good}`)
  }
  assert.equal(isBusinessReceiptNumber(`  ${businessDateTimeId()}  `), true, 'a trimmed freshly minted id is accepted')

  // The queue must USE the guard, not merely export it...
  const saleWrite = readFrontend('src/api/saleWriteTransport.ts')
  assert.match(saleWrite, /isBusinessReceiptNumber\(salePayload\.receipt_number\)/)
  assert.doesNotMatch(saleWrite, /salePayload\.receipt_number = salePayload\.receipt_number \|\|/)
  // ...and the server-side twin must stay hand-synced with this regex.
  const serverLib = readRepo('cloudflare/src/lib/receiptNumber.ts')
  const serverRe = serverLib.match(/export const BUSINESS_RECEIPT_NUMBER_RE = (.+)$/m)?.[1]
  assert.equal(serverRe, String(BUSINESS_RECEIPT_NUMBER_RE), 'client and server receipt regexes drifted apart')
})
if (failed > 0) {
  process.exitCode = 1
}
