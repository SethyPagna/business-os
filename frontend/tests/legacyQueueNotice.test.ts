// R2 (6.0.895): sales a device queued before offline selling ended (26 Sep 2026) surface in ONE notice, mounted with the
// REAL LegacyQueueNotice. It renders its real content from first paint, keeps the existing reviewed recovery as the
// one-time drain, adds an export the person keeps, and only clears rows that were exported in the same review. Every
// mutating action asks through the shared confirm dialog with the before and after count. A reply for another account
// never shows. The kept reason and the status read in the pack of the screen (EN and KM).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness, propsOf, type MountedSurface } from './mountedComponentHarness.ts'

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>

let failed = 0
const mounted: MountedSurface[] = []
async function check(name: string, run: () => Promise<void>): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) } finally {
    for (const page of mounted.splice(0)) await page.unmount()
  }
}

const account = { id: 7, organization_id: 1, name: 'Cashier' }
const harness = await createHarness({ localStorage: { businessos_user: JSON.stringify(account) }, observe: ['utils/csv.ts'] })
const { captureOfflineSaleOwner } = await import('../src/api/offlineQueueOwnership.ts')
const owner = captureOfflineSaleOwner()
const SERVER_TEXT = 'This sale was saved on this device at an earlier time and is kept there. Nothing was recorded.'
const items = [
  { _seq: 1, channel: 'sales:create', entity_name: 'R-1', status: 'failed', created_at: '2026-09-15T03:00:00.000Z', error: SERVER_TEXT, error_code: 'sale_created_at_too_old' },
  { _seq: 2, channel: 'sales:create', entity_name: 'R-2', status: 'pending', created_at: '2026-09-16T03:00:00.000Z', error: null, error_code: null },
]

type Calls = { exported: string[]; uploaded: string[]; cleared: string[]; downloads: Array<{ name: string; text: string }>; notes: string[]; changed: number; closed: number }

async function open(pack: Record<string, string>, options: { stateOwner?: unknown; canWriteToServer?: boolean } = {}): Promise<{ page: MountedSurface; calls: Calls }> {
  const calls: Calls = { exported: [], uploaded: [], cleared: [], downloads: [], notes: [], changed: 0, closed: 0 }
  ;(globalThis.window as unknown as { api: Record<string, unknown> }).api = {
    getPendingSyncState: async () => ({ total: items.length, items, owner: options.stateOwner ?? owner, review_token: 'review-1' }),
    exportPendingSyncReview: async (token: string) => { calls.exported.push(token); return { owner, rows: items.map((item) => ({ ...item, payload: { client_request_id: `sale-${item._seq}` } })) } },
    retryPendingSyncNow: async (token: string) => { calls.uploaded.push(token); return { attempted: 2, synced: 1 } },
    discardPendingSyncQueue: async (_reason: string, token: string) => { calls.cleared.push(token); return { discarded: 2 } },
  }
  const page = await harness.mount({
    component: 'components/server/LegacyQueueNotice.tsx',
    props: { recordCount: 5, storagePersisted: false, onClose: () => { calls.closed += 1 }, onChanged: () => { calls.changed += 1 } },
    app: {
      t: (key: string) => pack[key] ?? key, notify: (message: string) => { calls.notes.push(message) },
      canWriteToServer: options.canWriteToServer ?? true, formatDateTime: (value: string) => `fmt(${value})`, settings: {}, user: account,
    },
    doubles: {
      'utils/csv.ts': { downloadBlob: (async (name: string, blob: Blob) => { calls.downloads.push({ name, text: await blob.text() }) }) as never },
    },
  })
  mounted.push(page)
  return { page, calls }
}

const iconButton = (page: MountedSurface, label: string) => page.find((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === label, `the ${label} button`)

await check('first paint shows the real retained sales, their pack reasons, the other records and the eviction warning', async () => {
  const { page } = await open(en)
  await page.waitFor(() => page.text().includes('R-1'), 'the retained sale')
  const text = page.text()
  for (const key of ['legacy_queue_title', 'legacy_queue_intro', 'storage_eviction_title']) assert.ok(text.includes(en[key]), key)
  assert.ok(text.includes(`${en.legacy_queue_own_count}: 2`))
  assert.ok(text.includes(en.legacy_queue_other_records.replace('{count}', '3')), 'probe 5 - own 2 = 3 kept for others')
  assert.ok(text.includes(en.server_sale_kept_on_device) && !text.includes(SERVER_TEXT), 'the pack reason, not the Worker English')
  assert.ok(text.includes(en.failed) && text.includes('fmt(2026-09-15T03:00:00.000Z)'))
  assert.equal(propsOf(iconButton(page, en.server_clear_reviewed_sales)).disabled, true, 'nothing can be cleared before it is exported')
})

await check('Export downloads the reviewed rows as JSON and only then allows Clear, which confirms 2 -> 0', async () => {
  const { page, calls } = await open(en)
  await page.waitFor(() => page.text().includes('R-1'), 'the retained sale')
  await page.click(iconButton(page, en.legacy_queue_export))
  await page.waitFor(() => calls.downloads.length === 1, 'the download')
  assert.deepEqual(calls.exported, ['review-1'])
  assert.match(calls.downloads[0].name, /^business-os-retained-sales-.+\.json$/)
  assert.deepEqual(JSON.parse(calls.downloads[0].text).rows.map((row: { payload: { client_request_id: string } }) => row.payload.client_request_id), ['sale-1', 'sale-2'])
  assert.ok(calls.notes.includes(en.legacy_queue_exported.replace('{count}', '2')))
  const clear = iconButton(page, en.server_clear_reviewed_sales)
  assert.equal(propsOf(clear).disabled, false)
  await page.click(clear)
  assert.ok(page.text().includes(en.server_clear_reviewed_title) && page.text().includes('2 → 0'), 'before and after in the confirm')
  await page.click(page.button(en.server_clear_reviewed_sales, page.find((node) => node.getAttribute('role') === 'dialog' && node.textContent.includes('2 → 0'), 'the confirm dialog')))
  await page.waitFor(() => calls.cleared.length === 1, 'the clear')
  assert.deepEqual(calls.cleared, ['review-1'])
  assert.equal(calls.changed, 1, 'the shell probes again')
})

await check('Upload is the reviewed one-time drain, confirmed 2 -> 0, and reports what the server took', async () => {
  const { page, calls } = await open(en)
  await page.waitFor(() => page.text().includes('R-1'), 'the retained sale')
  await page.click(page.button(en.legacy_queue_upload))
  assert.ok(page.text().includes(en.legacy_queue_upload_title) && page.text().includes(en.legacy_queue_on_device))
  const dialog = page.find((node) => node.getAttribute('role') === 'dialog' && node.textContent.includes(en.legacy_queue_upload_title), 'the confirm dialog')
  await page.click(page.button(en.legacy_queue_upload, dialog))
  await page.waitFor(() => calls.uploaded.length === 1, 'the upload')
  assert.deepEqual(calls.uploaded, ['review-1'])
  assert.ok(calls.notes.includes(en.legacy_queue_uploaded.replace('{synced}', '1').replace('{attempted}', '2')))
  assert.equal(calls.changed, 1)
})

await check('without a connection Upload waits; a reply for another account shows nothing', async () => {
  const offline = await open(en, { canWriteToServer: false })
  await offline.page.waitFor(() => offline.page.text().includes('R-1'), 'the retained sale')
  assert.equal(propsOf(offline.page.button(en.legacy_queue_upload)).disabled, true)
  await offline.page.unmount()
  const foreign = await open(en, { stateOwner: { ...owner, actor_id: 8 } })
  await foreign.page.settle()
  assert.ok(!foreign.page.text().includes('R-1'), 'rows of another account are not shown')
  assert.ok(foreign.page.text().includes(`${en.legacy_queue_own_count}: 0`))
})

await check('the Khmer pack reads Khmer throughout', async () => {
  const { page } = await open(km)
  await page.waitFor(() => page.text().includes('R-1'), 'the retained sale')
  const text = page.text()
  for (const key of ['legacy_queue_title', 'legacy_queue_intro', 'server_sale_kept_on_device']) {
    assert.ok(text.includes(km[key]) && /[ក-៿]/.test(km[key]) && km[key] !== en[key], key)
  }
})

await harness.close()
if (failed) process.exitCode = 1
