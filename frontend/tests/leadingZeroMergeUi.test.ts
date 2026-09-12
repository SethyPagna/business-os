import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import Module from 'node:module'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

function loadTs(file: string, stubs: Record<string, unknown> = {}): Record<string, any> {
  const abs = path.join(root, file)
  const output = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: abs,
  }).outputText
  const original = (Module as any)._load
  ;(Module as any)._load = (request: string, parent: unknown, isMain: boolean) => (
    Object.prototype.hasOwnProperty.call(stubs, request) ? stubs[request] : original(request, parent, isMain)
  )
  const mod = { exports: {} as Record<string, any> }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', output)(mod.exports, require, mod, abs, path.dirname(abs))
  } finally { (Module as any)._load = original }
  return mod.exports
}

const responseModule = loadTs('src/components/products/mergeDuplicatesPreviewResponse.ts')
const validPreview = {
  success: true,
  scope: 'leading_zero',
  groupCount: 2,
  duplicateProductCount: 2,
  mergeableDuplicateProductCount: 1,
  blockedGroupCount: 1,
  costRefusalCount: 0,
  batchLimit: 25,
  groups: [
    {
      caseKeys: ['2:1'], canonicalId: 2, canonicalName: 'Clean', canonicalBarcode: '1234',
      duplicates: [{ id: 1, name: 'Clean', barcode: '01234', quantity: 2, batchCount: 0 }],
      totalQuantityToMove: 2, branchBreakdown: [{ branchId: 1, branchName: 'Shop', quantity: 2 }],
      costBefore: { cost_price_usd: 4 }, costAfter: { cost_price_usd: 5 }, costRefusals: [], mergeable: true, mergeBlockers: [],
    },
    {
      caseKeys: ['4:3'], canonicalId: 4, canonicalName: 'Blocked', canonicalBarcode: '5678',
      duplicates: [{ id: 3, name: 'Blocked', barcode: '05678', quantity: 1, batchCount: 0 }],
      totalQuantityToMove: 1, branchBreakdown: [{ branchId: 1, branchName: 'Shop', quantity: 1 }],
      costBefore: { cost_price_usd: 4 }, costAfter: { cost_price_usd: 4 }, costRefusals: [], mergeable: false,
      mergeBlockers: [{ code: 'cached_stock_mismatch', error: 'Reconcile stock.' }],
    },
  ],
  applyManifest: {
    scope: 'leading_zero', manifest_version: 1, manifest_digest: `sha256-${'a'.repeat(64)}`,
    groups: [{ keeper_id: 2, member_ids: [1, 2] }],
  },
}

const validated = responseModule.validateMergeDuplicatesPreviewResponse(validPreview)
assert.deepEqual(validated.applyManifest, validPreview.applyManifest)
assert.throws(() => responseModule.validateMergeDuplicatesPreviewResponse({
  ...validPreview,
  applyManifest: { ...validPreview.applyManifest, groups: [{ keeper_id: 4, member_ids: [3, 4] }] },
}), /overlapping or invalid|not an exact mergeable preview group/)
assert.throws(() => responseModule.validateMergeDuplicatesPreviewResponse({
  ...validPreview,
  applyManifest: { ...validPreview.applyManifest, groups: [{ keeper_id: 2, member_ids: [1, 9] }] },
}), /overlapping or invalid|not an exact mergeable preview group/)

const calls: Array<{ method: string; url: string; body: unknown; signal?: AbortSignal }> = []
const transport = loadTs('src/api/productWriteTransport.ts', {
  './http.ts': {
    apiFetch: async (method: string, url: string, body: unknown, _timeout: number, options: { signal?: AbortSignal } = {}) => {
      calls.push({ method, url, body, signal: options.signal }); return { success: true }
    },
    cacheInvalidate: () => {},
    route: async (_key: string, run: () => Promise<unknown>) => run(),
  },
  './requestIds.ts': {
    ensureClientRequestId: (body: Record<string, unknown>, prefix: string) => ({ ...body, client_request_id: body.client_request_id || `${prefix}-generated` }),
  },
  './expectedUpdatedAt.ts': {},
  '../utils/deviceInfo.ts': { getClientDeviceInfo: () => ({ device_id: 'browser' }) },
  '../utils/selectedConflictMerge.ts': {},
  '../utils/selectedConflictActionReview.ts': {},
})

const controller = new AbortController()
await transport.previewMergeDuplicateProducts({ scope: 'leading_zero', signal: controller.signal })
await transport.mergeDuplicateProducts({ requestId: 'one-run', signal: controller.signal, manifest: validPreview.applyManifest })
assert.equal(calls[0].url, '/api/products/merge-duplicates/preview?scope=leading_zero')
assert.equal(calls[0].signal, controller.signal)
assert.deepEqual(calls[1], {
  method: 'POST', url: '/api/products/merge-duplicates', signal: controller.signal,
  body: { ...validPreview.applyManifest, client_request_id: 'one-run' },
})

const productsSource = fs.readFileSync(path.join(root, 'src/components/products/Products.tsx'), 'utf8')
assert.match(productsSource, /initialAllowed\.get\(group\.keeper_id\)/)
assert.match(productsSource, /leadingZeroWriteInFlightRef\.current/)
assert.match(productsSource, /previewMergeDuplicates\(\{ signal: controller\.signal, scope: 'leading_zero' \}\)/)
assert.match(productsSource, /result\?\.interrupted \|\| Number\(result\?\.undoPendingCount/)
assert.match(productsSource, /result\?\.refusals\?\.length/)
assert.match(productsSource, /setMergeDuplicatesScope\(null\)/)

console.log('leadingZeroMergeUi: all checks passed')
