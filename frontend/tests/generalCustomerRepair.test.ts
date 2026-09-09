import assert from 'node:assert/strict'
import fs from 'node:fs'
import { applyGeneralCustomerRepair, GENERAL_CUSTOMER_REPAIR_CONFIRMATION, GENERAL_CUSTOMER_REPAIR_APPLY_TIMEOUT_MS, GENERAL_CUSTOMER_REPAIR_STEP, previewGeneralCustomerRepair, validateGeneralCustomerRepairApplyResponse, validateGeneralCustomerRepairPreview } from '../src/api/generalCustomerRepairTransport.ts'
import { cacheGet, cacheSet, setSyncServerUrl, setSyncToken } from '../src/api/http.ts'

let failed = 0
async function run(name: string, work: () => void | Promise<void>) {
  try { await work(); console.log(`PASS ${name}`) } catch (error) { failed++; console.error(`FAIL ${name}`, error) }
}

function previewBody() {
  return {
    success: true,
    outcome: 'ready',
    request: { step: GENERAL_CUSTOMER_REPAIR_STEP, confirmation: GENERAL_CUSTOMER_REPAIR_CONFIRMATION, manifest_sha256: 'a'.repeat(64), expected_updated_at: '2026-09-04 04:54:57' },
    target: { id: 24969, name: 'general', phone_state: 'known_empty', address_state: 'known_empty', is_anonymous: 0, portal_account_count: 0, sale_count: 5, return_count: 1 },
    protected_customer: { id: 22305, is_anonymous: 0 },
  }
}

function applyBody() {
  return { success: true, outcome: 'already_applied', affected: { customers: 0 }, verification_pending: false, cache_invalidated: true, refresh_pending: false, broadcast_requested: true, message: 'Already applied.' }
}

await run('preview accepts only the fixed four-field request and deep-freezes it', () => {
  const preview = validateGeneralCustomerRepairPreview(previewBody())
  assert.equal(Object.isFrozen(preview.request), true)
  assert.equal(preview.request.confirmation, 'MARK CUSTOMER 24969 AS SHARED GENERAL')
  assert.throws(() => { (preview.request as { step: string }).step = 'other' })
  const malformed = previewBody() as Record<string, unknown>
  ;(malformed.request as Record<string, unknown>).id = 22305
  assert.throws(() => validateGeneralCustomerRepairPreview(malformed), /fields do not match/)
})

await run('direct online transport previews and replays the held request while clearing dependent caches', async () => {
  setSyncServerUrl('https://sync.example.test'); setSyncToken('operator-token')
  const originalFetch = globalThis.fetch
  const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = []
  globalThis.fetch = ((...args: [RequestInfo | URL, RequestInit | undefined]) => {
    calls.push(args)
    const body = calls.length === 1 ? previewBody() : applyBody()
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  }) as typeof fetch
  try {
    const preview = await previewGeneralCustomerRepair()
    cacheSet('customers:list', { stale: true }); cacheSet('sales:list', { stale: true }); cacheSet('returns:list', { stale: true }); cacheSet('actionHistory:get', { stale: true })
    const result = await applyGeneralCustomerRepair(preview.request)
    assert.equal(result.outcome, 'already_applied')
    assert.equal(GENERAL_CUSTOMER_REPAIR_APPLY_TIMEOUT_MS, 600000)
    assert.equal(String(calls[0][0]), 'https://sync.example.test/api/system/shared-general-customer-repair/preview')
    assert.equal(calls[0][1]?.method, 'GET')
    assert.equal(String(calls[1][0]), 'https://sync.example.test/api/system/finalize-migration')
    assert.equal(calls[1][1]?.method, 'POST')
    assert.deepEqual(JSON.parse(String(calls[1][1]?.body)), preview.request)
    assert.equal(cacheGet('customers:list'), null); assert.equal(cacheGet('sales:list'), null); assert.equal(cacheGet('returns:list'), null); assert.equal(cacheGet('actionHistory:get'), null)
  } finally { globalThis.fetch = originalFetch; setSyncServerUrl(''); setSyncToken('') }
})

await run('partial, string, numeric, or older apply success bodies are uncertain and never clear caches', async () => {
  const partial = applyBody() as Record<string, unknown>
  delete partial.refresh_pending
  const stringFlag = { ...applyBody(), verification_pending: 'false' }
  const numericFlag = { ...applyBody(), cache_invalidated: 0 }
  const mismatchedOutcome = { ...applyBody(), outcome: 'applied', affected: { customers: 0 } }
  const mismatchedRefresh = { ...applyBody(), cache_invalidated: false }
  for (const malformed of [partial, stringFlag, numericFlag, mismatchedOutcome, mismatchedRefresh]) assert.throws(() => validateGeneralCustomerRepairApplyResponse(malformed), /Invalid shared General customer repair response/)

  setSyncServerUrl('https://sync.example.test'); setSyncToken('operator-token')
  const originalFetch = globalThis.fetch
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify(partial), { status: 200, headers: { 'Content-Type': 'application/json' } }))) as typeof fetch
  try {
    cacheSet('customers:list', { retained: true }); cacheSet('sales:list', { retained: true }); cacheSet('actionHistory:get', { retained: true })
    await assert.rejects(() => applyGeneralCustomerRepair(validateGeneralCustomerRepairPreview(previewBody()).request), (error: { status?: unknown; message?: string }) => error.status === undefined && /complete success result|fields do not match/.test(error.message || ''))
    assert.deepEqual(cacheGet('customers:list'), { retained: true }); assert.deepEqual(cacheGet('sales:list'), { retained: true }); assert.deepEqual(cacheGet('actionHistory:get'), { retained: true })
  } finally { globalThis.fetch = originalFetch; setSyncServerUrl(''); setSyncToken('') }
})

await run('panel mounts first in Page Reset and preserves the replay/error contract', () => {
  const panel = fs.readFileSync(new URL('../src/components/utils-settings/GeneralCustomerRepair.tsx', import.meta.url), 'utf8')
  const reset = fs.readFileSync(new URL('../src/components/utils-settings/ResetData.tsx', import.meta.url), 'utf8')
  const transport = fs.readFileSync(new URL('../src/api/generalCustomerRepairTransport.ts', import.meta.url), 'utf8')
  assert.match(reset, /import GeneralCustomerRepair from '\.\/GeneralCustomerRepair\.tsx'/)
  const pageReset = reset.slice(reset.indexOf('function SectionReset('), reset.indexOf('function FactoryReset('))
  assert.ok(pageReset.indexOf('<GeneralCustomerRepair />') < pageReset.indexOf('grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5'))
  assert.match(panel, /if \(!permitted\) return null/)
  assert.match(panel, /<ConfirmDialog/)
  assert.match(panel, /errorStatus\(error\) === 409/)
  assert.match(panel, /setNeedsNewPreview\(true\)/)
  assert.match(panel, /verification_pending \|\| result\.refresh_pending/)
  assert.match(panel, /verification_pending === false && result\.refresh_pending === false && result\.cache_invalidated === true/)
  assert.match(panel, /refreshAppData\(\['customers', 'audit_log'\]/)
  assert.doesNotMatch(panel, /pushAction|window\.confirm|target\.name|phone_state|address_state/)
  assert.match(transport, /cacheInvalidateWithDerived\('customers'\)/)
  assert.match(transport, /cacheInvalidate\('actionHistory'\)/)
  assert.match(transport, /validateGeneralCustomerRepairApplyResponse\(await apiFetch/)
  assert.doesNotMatch(transport, /\broute\s*\(/)
})

await run('English and Khmer include all panel copy', () => {
  const en = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
  const km = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
  const panel = fs.readFileSync(new URL('../src/components/utils-settings/GeneralCustomerRepair.tsx', import.meta.url), 'utf8')
  const keys = [...panel.matchAll(/T\('(general_customer_repair_[a-z0-9_]+)'/g)].map((match) => match[1])
  assert.ok(keys.length >= 15)
  for (const key of new Set(keys)) { assert.ok(en[key], `missing English ${key}`); assert.ok(km[key], `missing Khmer ${key}`); assert.notEqual(en[key], km[key]) }
})

if (failed) process.exitCode = 1
