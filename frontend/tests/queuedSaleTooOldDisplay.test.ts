// The Server page Queue tab for a sale the Worker refused as too old (409 sale_created_at_too_old), mounted with the
// REAL ServerPage. The row was kept and marked failed with its error_code (tests/queuedSaleTooOld.test.ts); what the
// owner reads must be in the language of the screen: the reason in the pack, the status badge in the pack, and never
// the Worker's English sentence or the raw word 'failed'. The preview (api/syncPreview.ts) must carry the code.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>

let failed = 0
const mounted: MountedSurface[] = []
async function check(name: string, run: () => Promise<void>): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) } finally {
    for (const page of mounted.splice(0)) await page.unmount()
  }
}

const SERVER_TEXT = 'This sale was saved on this device at an earlier time and is kept there. Nothing was recorded.'
const account = { id: 7, organization_id: 1, name: 'Cashier' }
const harness = await createHarness({ localStorage: { businessos_user: JSON.stringify(account) } })
const { captureOfflineSaleOwner } = await import('../src/api/offlineQueueOwnership.ts')
const { serializePendingSyncPreview } = await import('../src/api/syncPreview.ts')
const owner = captureOfflineSaleOwner()

const keptRow = {
  _seq: 1, channel: 'sales:create', operation: null, entity_table: 'sales', entity_id: -1, entity_name: 'R-1', status: 'failed',
  created_at: '2026-09-15T03:00:00.000Z', updated_at: '2026-10-13T03:00:00.000Z', retry_count: 1, retry_at: null,
  error: SERVER_TEXT, error_code: 'sale_created_at_too_old',
}
const otherRow = { ...keptRow, _seq: 2, entity_name: 'R-2', error: 'Prices changed', error_code: 'sale_pricing_quote_conflict' }
const pendingState = (items: Array<Record<string, unknown>>) => ({
  total: items.length, pending: 0, syncing: 0, failed: items.length, conflict: 0, quarantined: 0,
  owner, review_token: 'review-token', oldest_created_at: null, writes_require_server: true, items: serializePendingSyncPreview(items),
})

async function openQueue(pack: Record<string, string>, language: string, items: Array<Record<string, unknown>>): Promise<MountedSurface> {
  ;(globalThis.window as unknown as { api: Record<string, unknown> }).api = {
    getPendingSyncState: async () => pendingState(items),
    getSystemBootstrap: async () => ({ config: {}, debugLog: { entries: [] } }),
    getSystemDebugLog: async () => ({ entries: [] }),
    getCallLog: () => [],
  }
  const page = await harness.mount({
    component: 'components/server/ServerPage.tsx',
    app: {
      page: 'server', language, settings: { language }, t: (key: string) => pack[key] ?? key, notify: () => {},
      user: account, syncConnected: true, syncUrl: 'https://fixture.test', updateSyncUrl: () => {},
    },
    doubles: {},
  })
  mounted.push(page)
  await page.click(page.find((node) => node.tagName === 'BUTTON' && /border-b-2/.test(node.className) && /\(\d+\)$/.test(node.textContent) && !/Sync Center/.test(node.textContent) && node.textContent.startsWith(pack.queue ?? 'Queue'), 'the Queue tab'))
  await page.waitFor(() => page.text().includes('R-1'), 'the retained sale')
  return page
}
const row = (page: MountedSurface, name: string): MemoryNode => {
  const label = page.find((node) => node.textContent.includes(name) && node.tagName === 'SPAN' && node.className.includes('truncate') === true, `the row of ${name}`)
  let current: MemoryNode | null = label
  while (current && !(typeof current.className === 'string' && current.className.includes('border-b'))) current = current.parentNode
  assert.ok(current, `${name} sits in a list row`)
  return current
}

try {
  await check('the preview carries the error code the row was marked with', () => {
    const [item] = serializePendingSyncPreview([keptRow])
    assert.equal((item as { error_code: unknown }).error_code, 'sale_created_at_too_old')
    assert.equal((serializePendingSyncPreview([{ ...keptRow, error_code: undefined }])[0] as { error_code: unknown }).error_code, null)
    return Promise.resolve()
  })

  await check('English: the kept sale shows the pack reason and the translated badge, not the Worker sentence or the raw word', async () => {
    const page = await openQueue(en, 'en', [keptRow])
    const text = row(page, 'R-1').textContent
    assert.ok(text.includes(en.server_sale_kept_on_device), 'the pack reason')
    assert.ok(!text.includes(SERVER_TEXT), 'not the Worker English')
    assert.ok(text.includes(en.failed), 'the badge is the pack word')
    assert.ok(!/\bfailed\b/.test(text), 'not the raw lowercase status')
    assert.match(en.server_sale_kept_on_device, /too old/i)
  })

  await check('Khmer: the reason and the badge are Khmer, the long sentence wraps with a relaxed line height instead of an ellipsis', async () => {
    const page = await openQueue(km, 'km', [keptRow])
    const kept = row(page, 'R-1')
    const text = kept.textContent
    assert.ok(text.includes(km.server_sale_kept_on_device), 'the Khmer reason')
    assert.ok(text.includes(km.failed), 'the Khmer badge')
    assert.ok(!text.includes(SERVER_TEXT) && !/\bfailed\b/.test(text))
    assert.ok(/[ក-៿]/.test(km.server_sale_kept_on_device) && km.server_sale_kept_on_device !== en.server_sale_kept_on_device)
    const reason = page.find((node) => node.textContent === km.server_sale_kept_on_device && node.tagName === 'P', 'the reason line')
    assert.match(reason.className, /leading-relaxed/)
    assert.match(reason.className, /break-words/)
    assert.doesNotMatch(reason.className, /truncate/)
  })

  await check('control: another refusal keeps showing the Worker text, and the kept sale is still listed beside it', async () => {
    const page = await openQueue(en, 'en', [keptRow, otherRow])
    assert.ok(row(page, 'R-2').textContent.includes('Prices changed'))
    assert.ok(row(page, 'R-1').textContent.includes(en.server_sale_kept_on_device))
  })
} finally {
  await harness.close()
}

if (failed) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nqueuedSaleTooOldDisplay: all checks passed')
