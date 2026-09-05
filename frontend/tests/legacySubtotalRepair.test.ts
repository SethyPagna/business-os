import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { isoToDisplayDate } from '../src/utils/dateEntry.ts'
import {
  LEGACY_SUBTOTAL_REPAIR_APPLY_TIMEOUT_MS,
  LEGACY_SUBTOTAL_REPAIR_CONFIRMATION,
  applyLegacySubtotalRepair,
  previewLegacySubtotalRepair,
  validateLegacySubtotalRepairPreview,
  type LegacySubtotalRepairPreview,
} from '../src/api/legacySubtotalRepairTransport.ts'
import {
  __resetApiHealthForTests,
  __resetApiWriteDedupeForTests,
  cacheGet,
  cacheSet,
  setSyncServerUrl,
  setSyncToken,
} from '../src/api/http.ts'

type TestCallback = () => void | Promise<void>
type FetchCall = Parameters<typeof fetch>

let failed = 0
const require = createRequire(import.meta.url)

async function runTest(name: string, fn: TestCallback) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

function resetHttp() {
  __resetApiWriteDedupeForTests()
  __resetApiHealthForTests()
  setSyncServerUrl('')
  setSyncToken('')
}

function buildPreview(): LegacySubtotalRepairPreview {
  const sales = Array.from({ length: 22 }, (_, index) => {
    const id = 16842 + index
    const sep3 = id <= 16858
    const target = sep3 ? (id === 16858 ? '190.0000' : '80.0000') : (id === 16863 ? '392.0000' : '400.0000')
    const itemDiscount = sep3 ? (id === 16858 ? '13.0000' : '3.0000') : '1.0000'
    return {
      id,
      business_date: sep3 ? '2026-09-03' : '2026-09-02',
      expected_subtotal_usd: '0.0000',
      target_subtotal_usd: target,
      item_discount_usd: itemDiscount,
    }
  })
  return {
    success: true,
    state: 'ready',
    request: {
      step: 'repair_sep23_subtotals',
      apply: true,
      confirmation: LEGACY_SUBTOTAL_REPAIR_CONFIRMATION,
      manifest_sha256: 'a'.repeat(64),
      manifest: { plan_id: 'sep23-subtotal-test-manifest', sales },
    },
    summary: { sale_count: 22, subtotal_usd: '3462.0000', item_discount_usd: '66.0000' },
  }
}

function loadComponentWithApp(app: Record<string, unknown>) {
  const componentUrl = new URL('../src/components/utils-settings/LegacySubtotalRepair.tsx', import.meta.url)
  const source = fs.readFileSync(componentUrl, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText
  const module = { exports: {} as Record<string, unknown> }
  const icon = () => null
  const customRequire = (specifier: string): unknown => {
    if (specifier.startsWith('lucide-react/')) return { __esModule: true, default: icon }
    if (specifier.includes('AppContext')) return { useApp: () => app }
    if (specifier.includes('legacySubtotalRepairTransport')) {
      return {
        LEGACY_SUBTOTAL_REPAIR_CONFIRMATION,
        applyLegacySubtotalRepair: async () => ({ success: true }),
        previewLegacySubtotalRepair: async () => buildPreview(),
      }
    }
    if (specifier.includes('actionGuards')) return { beginSingleAction: () => true, finishSingleAction: () => {} }
    if (specifier.includes('appRefresh')) return { refreshAppData: () => {} }
    if (specifier.includes('dateEntry')) return { isoToDisplayDate }
    if (specifier.includes('dirtyWork')) return { registerDirtyWork: () => () => {} }
    if (specifier.includes('ConfirmDialog')) return { __esModule: true, default: () => null }
    return require(specifier)
  }
  new Function('require', 'module', 'exports', output)(customRequire, module, module.exports)
  return module.exports.default as React.ComponentType
}

await runTest('preview uses the authenticated online HTTP client and freezes the exact request', async () => {
  resetHttp()
  setSyncServerUrl('https://sync.example.test')
  setSyncToken('operator-token')
  const originalFetch = globalThis.fetch
  const calls: FetchCall[] = []
  globalThis.fetch = ((...args: FetchCall) => {
    calls.push(args)
    return Promise.resolve(new Response(JSON.stringify(buildPreview()), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  }) as typeof fetch
  try {
    const preview = await previewLegacySubtotalRepair()
    assert.equal(preview.success, true)
    if (!preview.success) return
    assert.equal(calls.length, 1)
    assert.equal(String(calls[0][0]), 'https://sync.example.test/api/system/legacy-subtotal-repair/preview')
    assert.equal(calls[0][1]?.method, 'GET')
    assert.equal(calls[0][1]?.credentials, 'include')
    assert.equal((calls[0][1]?.headers as Record<string, string>)['x-sync-token'], 'operator-token')
    assert.equal(Object.isFrozen(preview.request), true)
    assert.equal(Object.isFrozen(preview.request.manifest), true)
    assert.equal(Object.isFrozen(preview.request.manifest.sales), true)
  } finally {
    globalThis.fetch = originalFetch
    resetHttp()
  }
})

await runTest('apply posts the held request verbatim with a long timeout contract', async () => {
  resetHttp()
  setSyncServerUrl('https://sync.example.test')
  setSyncToken('operator-token')
  const preview = validateLegacySubtotalRepairPreview(buildPreview())
  assert.equal(preview.success, true)
  if (!preview.success) return
  const heldRequest = preview.request
  const originalFetch = globalThis.fetch
  const calls: FetchCall[] = []
  globalThis.fetch = ((...args: FetchCall) => {
    calls.push(args)
    return Promise.resolve(new Response(JSON.stringify({ success: true, outcome: 'already_applied', affected: { sales: 0 }, message: 'Already applied.' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  }) as typeof fetch
  try {
    cacheSet('sales:rows', { stale: true })
    cacheSet('dashboard:summary', { stale: true })
    cacheSet('analytics:summary', { stale: true })
    cacheSet('products:rows', { keep: true })
    cacheSet('inventory:rows', { keep: true })
    const first = await applyLegacySubtotalRepair(heldRequest)
    const second = await applyLegacySubtotalRepair(heldRequest)
    assert.equal(first.outcome, 'already_applied')
    assert.equal(second.outcome, 'already_applied')
    assert.equal(LEGACY_SUBTOTAL_REPAIR_APPLY_TIMEOUT_MS, 600_000)
    assert.equal(calls.length, 2)
    assert.equal(cacheGet('sales:rows'), null)
    assert.equal(cacheGet('dashboard:summary'), null)
    assert.equal(cacheGet('analytics:summary'), null)
    assert.deepEqual(cacheGet('products:rows'), { keep: true })
    assert.deepEqual(cacheGet('inventory:rows'), { keep: true })
    for (const [url, init] of calls) {
      assert.equal(String(url), 'https://sync.example.test/api/system/finalize-migration')
      assert.equal(init?.method, 'POST')
      assert.deepEqual(JSON.parse(String(init?.body)), heldRequest)
    }
  } finally {
    globalThis.fetch = originalFetch
    resetHttp()
  }
})

await runTest('GET 409 remains a non-ready error and never manufactures a request', async () => {
  resetHttp()
  setSyncServerUrl('https://sync.example.test')
  const originalFetch = globalThis.fetch
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ success: false, error: 'Repair is not ready.' }), {
    status: 409,
    headers: { 'Content-Type': 'application/json' },
  }))) as typeof fetch
  try {
    await assert.rejects(
      () => previewLegacySubtotalRepair(),
      (error: { status?: number; message?: string }) => error.status === 409 && error.message === 'Repair is not ready.',
    )
  } finally {
    globalThis.fetch = originalFetch
    resetHttp()
  }
})

await runTest('malformed or mixed-cohort previews are refused before apply', () => {
  assert.throws(
    () => validateLegacySubtotalRepairPreview({ success: false, error: 'not ready', request: buildPreview().request }),
    /non-ready response must not include a request/,
  )
  const wrong = buildPreview() as unknown as Record<string, any>
  wrong.request.manifest.sales[0].id = 16827
  assert.throws(() => validateLegacySubtotalRepairPreview(wrong), /wrong business date|each sale ID/)
})

await runTest('permission gate controls the mounted panel', () => {
  const denied = loadComponentWithApp({
    t: (_key: string, fallback: string) => fallback,
    notify: () => {},
    hasPermission: () => false,
  })
  assert.equal(renderToStaticMarkup(React.createElement(denied)), '')

  const allowed = loadComponentWithApp({
    t: (_key: string, fallback: string) => fallback,
    notify: () => {},
    hasPermission: (permission: string) => permission === 'backup_restore',
  })
  const html = renderToStaticMarkup(React.createElement(allowed))
  assert.match(html, /Repair September 2–3 legacy subtotals/)
  assert.match(html, /IDs 16842–16858/)
  assert.match(html, /IDs 16859–16863/)
  assert.match(html, /Stock, payments, sale items, totals, statuses, and COGS are unchanged/)
  assert.match(html, /Preview exact repair/)
  assert.doesNotMatch(html, /finalize_step_zero|Zero live stock/)
})

await runTest('business dates use the canonical DD/MM/YYYY display without mutating preview data', () => {
  const preview = buildPreview()
  const storedIso = preview.request.manifest.sales[0].business_date
  assert.equal(isoToDisplayDate(storedIso), '03/09/2026')
  assert.equal(preview.request.manifest.sales[0].business_date, '2026-09-03')
})

await runTest('source wiring preserves retry, refresh, audit, and responsive boundaries', () => {
  const component = fs.readFileSync(new URL('../src/components/utils-settings/LegacySubtotalRepair.tsx', import.meta.url), 'utf8')
  const reset = fs.readFileSync(new URL('../src/components/utils-settings/ResetData.tsx', import.meta.url), 'utf8')
  const transport = fs.readFileSync(new URL('../src/api/legacySubtotalRepairTransport.ts', import.meta.url), 'utf8')
  assert.match(reset, /import LegacySubtotalRepair from '\.\/LegacySubtotalRepair\.tsx'/)
  assert.ok(reset.indexOf('<LegacySubtotalRepair />') < reset.indexOf('grid grid-cols-1 gap-3 sm:grid-cols-2'))
  assert.match(component, /if \(!permitted\) return null/)
  assert.match(component, /applyLegacySubtotalRepair\(request\)/)
  assert.match(component, /errorStatus\(error\) === 409/)
  assert.match(component, /setNeedsNewPreview\(true\)/)
  assert.match(component, /refreshAppData\(\['sales', 'dashboard', 'audit_log'\], \{ reason: 'legacy-subtotal-repair' \}\)/)
  assert.doesNotMatch(component, /refreshAppData\(\[[^\]]*(?:products|inventory|payments)/)
  assert.doesNotMatch(component, /pushAction/)
  assert.match(component, /beginSingleAction\(applyInFlight/)
  assert.match(component, /isoToDisplayDate\(sale\.business_date\)/)
  assert.match(component, /<ConfirmDialog/)
  assert.match(component, /onClick=\{\(\) => setConfirmOpen\(true\)\}/)
  assert.match(component, /onConfirm=\{applyRepair\}/)
  assert.doesNotMatch(component, /onClick=\{applyRepair\}/)
  assert.doesNotMatch(component, /window\.confirm/)
  assert.match(component, /registerDirtyWork\(\{/)
  assert.match(component, /pageId: 'settings'/)
  assert.match(component, /isDirty: \(\) => pendingConfirmationRef\.current/)
  assert.match(component, /max-h-72 overflow-auto/)
  assert.match(component, /min-w-\[720px\]/)
  assert.match(component, /flex flex-col gap-2 sm:flex-row/)
  assert.doesNotMatch(component, /<textarea|type="file"/)
  assert.match(transport, /import \{ apiFetch, cacheInvalidate, cacheInvalidateWithDerived \} from '\.\/http\.ts'/)
  assert.match(transport, /cacheInvalidateWithDerived\('sales'\)/)
  assert.match(transport, /cacheInvalidate\('actionHistory'\)/)
  assert.doesNotMatch(transport, /\broute\s*\(/)
})

await runTest('English and Khmer packs contain every panel key', () => {
  const en = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
  const km = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
  const component = fs.readFileSync(new URL('../src/components/utils-settings/LegacySubtotalRepair.tsx', import.meta.url), 'utf8')
  const keys = [...component.matchAll(/T\('(legacy_subtotal_[a-z0-9_]+)'/g)].map((match) => match[1])
  assert.ok(keys.length >= 30)
  for (const key of new Set(keys)) {
    assert.ok(en[key], `missing English ${key}`)
    assert.ok(km[key], `missing Khmer ${key}`)
    assert.notEqual(km[key], en[key], `Khmer ${key} should be translated`)
  }
})

if (failed > 0) process.exitCode = 1
