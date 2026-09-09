import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  SALE_INCIDENT_RECOVERY_APPLY_TIMEOUT_MS,
  SALE_INCIDENT_RECOVERY_CONFIRMATION,
  SALE_INCIDENT_RECOVERY_TARGET,
  SALE_INCIDENT_RECOVERY_V2_CONFIRMATION,
  SALE_INCIDENT_RECOVERY_V2_TARGET,
  applySaleIncidentRecovery,
  previewSaleIncidentRecovery,
  validateSaleIncidentRecoveryApplyResponse,
  validateSaleIncidentRecoveryPreview,
} from '../src/utils/saleIncidentRecovery.ts'
import { cacheGet, cacheSet, setSyncServerUrl, setSyncToken } from '../src/api/http.ts'

let failed = 0
async function run(name: string, work: () => void | Promise<void>) {
  try { await work(); console.log(`PASS ${name}`) } catch (error) { failed++; console.error(`FAIL ${name}`, error) }
}

function previewBody() {
  return {
    success: true,
    target: SALE_INCIDENT_RECOVERY_TARGET,
    outcome: 'apply',
    request: { target: SALE_INCIDENT_RECOVERY_TARGET, confirmation: SALE_INCIDENT_RECOVERY_CONFIRMATION, manifest_sha256: 'a'.repeat(64) },
    sales: [
      { id: 16951, receipt_number: '20260909-101913', status: 'completed', expected_revision: 1, line_count: 1, stock_effect: 'deduct_now', subtotal_before_usd: 342, subtotal_after_usd: 342, total_before_usd: 342, total_after_usd: 342 },
      { id: 16952, receipt_number: '20260909-104116', status: 'awaiting_payment', expected_revision: 6, line_count: 1, stock_effect: 'released_allocation_only', subtotal_before_usd: 0, subtotal_after_usd: 299, total_before_usd: 0, total_after_usd: 299 },
      { id: 16953, receipt_number: '20260909-111455', status: 'awaiting_payment', expected_revision: 1, line_count: 2, stock_effect: 'released_allocation_only', subtotal_before_usd: 0, subtotal_after_usd: 40, total_before_usd: 0, total_after_usd: 40 },
    ],
    blocked_sales: [{ id: 16954, receipt_number: '20260909-130228', reason: 'sale_time_cost_not_proven' }],
    unknown_line_fields: ['price_mode', 'base_price_usd', 'base_price_khr'],
    allocation_basis: 'recovery_time_unique_positive_lot_not_historical_proof',
  }
}

function applyBody() {
  return {
    success: true,
    outcome: 'applied',
    operation_id: 'operation-1',
    manifest_sha256: 'a'.repeat(64),
    affected: { sales: 3, items: 4, allocations: 4, movements: 1, histories: 3, audits: 3 },
    verification_pending: false,
    cache_invalidated: true,
    refresh_pending: false,
    broadcast_requested: true,
    message: 'Recovery completed.',
  }
}

function v2PreviewBody() {
  const preview = previewBody()
  return {
    ...preview,
    target: SALE_INCIDENT_RECOVERY_V2_TARGET,
    request: { target: SALE_INCIDENT_RECOVERY_V2_TARGET, confirmation: SALE_INCIDENT_RECOVERY_V2_CONFIRMATION, manifest_sha256: 'b'.repeat(64) },
    sales: [{ id: 16954, receipt_number: '20260909-130228', status: 'awaiting_payment', expected_revision: 1, line_count: 1, stock_effect: 'released_allocation_only', subtotal_before_usd: 0, subtotal_after_usd: 170, total_before_usd: 0, total_after_usd: 170 }],
    blocked_sales: [],
  }
}

function v2ApplyBody() {
  return {
    ...applyBody(),
    manifest_sha256: 'b'.repeat(64),
    affected: { sales: 1, items: 1, allocations: 1, movements: 0, histories: 1, audits: 1 },
  }
}

await run('preview accepts the server-issued three-sale request and explicitly excluded receipt', () => {
  const preview = validateSaleIncidentRecoveryPreview(previewBody())
  assert.equal(preview.sales.length, 3)
  assert.deepEqual(preview.blocked_sales, [{ id: 16954, receipt_number: '20260909-130228', reason: 'sale_time_cost_not_proven' }])
  assert.equal(Object.isFrozen(preview.request), true)
  assert.throws(() => { (preview.request as { target: string }).target = 'different' })
  const invalid = previewBody() as Record<string, unknown>
  ;(invalid.sales as Array<Record<string, unknown>>).push({ id: 16954, receipt_number: '20260909-130228', status: 'completed', expected_revision: 1, line_count: 1, stock_effect: 'deduct_now', subtotal_before_usd: 0, subtotal_after_usd: 1, total_before_usd: 0, total_after_usd: 1 })
  assert.throws(() => validateSaleIncidentRecoveryPreview(invalid), /fixed recovery/)
})

await run('v2 accepts only its separately proven sale and has no inherited v1 blocked receipt', () => {
  const preview = validateSaleIncidentRecoveryPreview(v2PreviewBody(), 'v2')
  assert.equal(preview.target, SALE_INCIDENT_RECOVERY_V2_TARGET)
  assert.deepEqual(preview.sales.map((sale) => sale.id), [16954])
  assert.deepEqual(preview.blocked_sales, [])
  const withV1Block = v2PreviewBody() as Record<string, unknown>
  withV1Block.blocked_sales = [{ id: 16954, receipt_number: '20260909-130228', reason: 'sale_time_cost_not_proven' }]
  assert.throws(() => validateSaleIncidentRecoveryPreview(withV1Block, 'v2'), /not fixed|do not match/)
  const applied = validateSaleIncidentRecoveryApplyResponse(v2ApplyBody(), 'v2')
  if (!applied.success) throw new Error('Expected an applied v2 recovery response')
  assert.equal(applied.affected.movements, 0)
})

await run('apply accepts only a complete fixed-count success and paired refresh flags', () => {
  const applied = validateSaleIncidentRecoveryApplyResponse(applyBody())
  if (!applied.success) throw new Error('Expected an applied recovery response')
  assert.equal(applied.affected.items, 4)
  const mismatch = applyBody() as Record<string, unknown>
  ;(mismatch.affected as Record<string, unknown>).sales = 4
  assert.throws(() => validateSaleIncidentRecoveryApplyResponse(mismatch), /affected counts/)
  const broadcastPending = applyBody() as Record<string, unknown>
  broadcastPending.refresh_pending = true
  assert.equal(validateSaleIncidentRecoveryApplyResponse(broadcastPending).refresh_pending, true)
  const stale = applyBody() as Record<string, unknown>
  stale.cache_invalidated = false
  stale.refresh_pending = false
  assert.throws(() => validateSaleIncidentRecoveryApplyResponse(stale), /must require refresh/)
})

await run('202 uncertain keeps the exact request replayable and does not clear local caches', async () => {
  setSyncServerUrl('https://sync.example.test'); setSyncToken('operator-token')
  const originalFetch = globalThis.fetch
  const uncertain = { success: false, outcome: 'uncertain', operation_id: 'operation-1', manifest_sha256: 'a'.repeat(64), verification_pending: true, cache_invalidated: false, refresh_pending: true, broadcast_requested: false, message: 'Verification could not complete. Replay the same request.' }
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify(uncertain), { status: 202, headers: { 'Content-Type': 'application/json' } }))) as typeof fetch
  try {
    const preview = validateSaleIncidentRecoveryPreview(previewBody())
    cacheSet('sales:list', { retained: true })
    const result = await applySaleIncidentRecovery(preview.request)
    assert.equal(result.success, false)
    assert.equal(result.outcome, 'uncertain')
    assert.equal(cacheGet('sales:list')?.retained, true)
  } finally { globalThis.fetch = originalFetch; setSyncServerUrl(''); setSyncToken('') }
})

await run('transport previews and replays the frozen request, refreshing local reads only after complete server confirmation', async () => {
  setSyncServerUrl('https://sync.example.test'); setSyncToken('operator-token')
  const originalFetch = globalThis.fetch
  const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = []
  globalThis.fetch = ((...args: [RequestInfo | URL, RequestInit | undefined]) => {
    calls.push(args)
    return Promise.resolve(new Response(JSON.stringify(calls.length === 1 ? previewBody() : applyBody()), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  }) as typeof fetch
  try {
    const preview = await previewSaleIncidentRecovery()
    cacheSet('sales:list', { stale: true }); cacheSet('products:list', { stale: true }); cacheSet('inventory:list', { stale: true }); cacheSet('actionHistory:get', { stale: true })
    const result = await applySaleIncidentRecovery(preview.request)
    assert.equal(result.outcome, 'applied')
    assert.equal(SALE_INCIDENT_RECOVERY_APPLY_TIMEOUT_MS, 600000)
    assert.equal(String(calls[0][0]), 'https://sync.example.test/api/system/sale-incident-recovery-20260909/preview')
    assert.equal(calls[0][1]?.method, 'GET')
    assert.equal(String(calls[1][0]), 'https://sync.example.test/api/system/sale-incident-recovery-20260909/apply')
    assert.equal(calls[1][1]?.method, 'POST')
    assert.deepEqual(JSON.parse(String(calls[1][1]?.body)), preview.request)
    assert.equal(cacheGet('sales:list'), null); assert.equal(cacheGet('products:list'), null); assert.equal(cacheGet('inventory:list'), null); assert.equal(cacheGet('actionHistory:get'), null)
  } finally { globalThis.fetch = originalFetch; setSyncServerUrl(''); setSyncToken('') }
})

await run('v2 transport uses its own fixed endpoints and request', async () => {
  setSyncServerUrl('https://sync.example.test'); setSyncToken('operator-token')
  const originalFetch = globalThis.fetch
  const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = []
  globalThis.fetch = ((...args: [RequestInfo | URL, RequestInit | undefined]) => {
    calls.push(args)
    return Promise.resolve(new Response(JSON.stringify(calls.length === 1 ? v2PreviewBody() : v2ApplyBody()), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  }) as typeof fetch
  try {
    const preview = await previewSaleIncidentRecovery('v2')
    await applySaleIncidentRecovery(preview.request, 'v2')
    assert.equal(String(calls[0][0]), 'https://sync.example.test/api/system/sale-incident-recovery-20260909-v2/preview')
    assert.equal(String(calls[1][0]), 'https://sync.example.test/api/system/sale-incident-recovery-20260909-v2/apply')
    assert.deepEqual(JSON.parse(String(calls[1][1]?.body)), preview.request)
  } finally { globalThis.fetch = originalFetch; setSyncServerUrl(''); setSyncToken('') }
})

await run('panel gates on the normal maintenance permission and shows amount, stock, exclusion, stale, replay, and responsive controls', () => {
  const panel = fs.readFileSync(new URL('../src/components/utils-settings/SaleIncidentRecovery.tsx', import.meta.url), 'utf8')
  assert.match(panel, /if \(!permitted\) return null/)
  assert.match(panel, /preview\.sales\.length/)
  assert.match(panel, /subtotal_before_usd/)
  assert.match(panel, /total_after_usd/)
  assert.match(panel, /preview\.blocked_sales\.length/)
  const confirmationInputId = (variant: 'v1' | 'v2') => `sale-incident-recovery-${variant}-confirmation`
  assert.notEqual(confirmationInputId('v1'), confirmationInputId('v2'))
  assert.match(panel, /const confirmationInputId = `sale-incident-recovery-\$\{variant\}-confirmation`/)
  assert.match(panel, /htmlFor=\{confirmationInputId\}/)
  assert.match(panel, /<input id=\{confirmationInputId\}/)
  assert.doesNotMatch(panel, /htmlFor="sale-incident-recovery-confirmation"/)
  assert.doesNotMatch(panel, /id="sale-incident-recovery-confirmation"/)
  assert.match(panel, /errorStatus\(error\) === 409/)
  assert.match(panel, /setNeedsNewPreview\(true\)/)
  assert.match(panel, /Replay same request/)
  assert.match(panel, /beginSingleAction\(applyInFlight/)
  assert.match(panel, /sm:flex-row/)
  assert.match(panel, /min-w-\[940px\]/)
  assert.match(panel, /refreshAppData\(\['sales', 'products', 'inventory', 'audit_log'\]/)
  assert.match(panel, /variant = 'v1'/)
  assert.match(panel, /sale_incident_recovery_v2_title/)
  assert.doesNotMatch(panel, /16951|16952|16953|16954/)
})

await run('English and Khmer include all panel copy', () => {
  const en = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
  const km = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
  const panel = fs.readFileSync(new URL('../src/components/utils-settings/SaleIncidentRecovery.tsx', import.meta.url), 'utf8')
  const keys = [...panel.matchAll(/T\('(sale_incident_recovery_[a-z0-9_]+)'/g)].map((match) => match[1])
  assert.ok(keys.length >= 20)
  for (const key of new Set(keys)) { assert.ok(en[key], `missing English ${key}`); assert.ok(km[key], `missing Khmer ${key}`); assert.notEqual(en[key], km[key]) }
  assert.equal(en.sale_incident_recovery_blocked_reason, 'Handled by the separate fourth-receipt recovery.')
  assert.doesNotMatch(panel, /sale-time cost is not proven/)
})

if (failed) process.exitCode = 1
