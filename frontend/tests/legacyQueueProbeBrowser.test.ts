// R2 (6.0.895): the offline sales queue is gone, but a device may still hold sales it queued before 26 Sep 2026.
// api/legacyQueueProbe.ts counts them with plain IndexedDB in a real browser, so this test runs it in Chromium:
//   - a device that never had the legacy database: 0, no database created, and Dexie never downloaded;
//   - a device whose legacy database (written by the real localDb.ts Dexie schema) has empty queues: 0;
//   - queued rows in sync_queue and sync_outbox, any owner: all counted, and the rows are left untouched;
//   - a browser without indexedDB.databases(): the same answers, still creating nothing.
import assert from 'node:assert/strict'
import { existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({
  root, configFile: false, logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] },
  server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(join(root, 'node_modules'))] } },
  plugins: [{
    name: 'legacy-queue-probe-page',
    configureServer(app) {
      app.middlewares.use('/legacy-queue-probe', (_request, response) => {
        response.setHeader('content-type', 'text/html')
        response.end('<!doctype html><html><body></body></html>')
      })
    },
  }],
})
const executablePath = [process.env.BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((candidate) => candidate && existsSync(candidate))

type ProbeResult = { count: number; names: string[] }

let failed = 0
async function check(name: string, run: () => Promise<void>): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

await server.listen()
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
try {
  const origin = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`
  // A fresh context per case: its own IndexedDB, nothing carried between cases.
  async function freshPage() {
    const context = await browser.newContext()
    const page = await context.newPage()
    const requested: string[] = []
    page.on('request', (request) => requested.push(new URL(request.url()).pathname))
    await page.goto(`${origin}/legacy-queue-probe`)
    return { context, page, requested }
  }
  const probe = (withoutDatabasesList = false) => `(async () => {
    const { countLegacyQueuedRecords } = await import('/src/api/legacyQueueProbe.ts')
    const factory = ${withoutDatabasesList} ? { open: (name) => indexedDB.open(name) } : indexedDB
    const count = await countLegacyQueuedRecords(factory)
    const names = (await indexedDB.databases()).map((entry) => entry.name)
    return { count, names }
  })()`
  const seed = (queue: number, outbox: number) => `(async () => {
    const { dexieDb } = await import('/src/api/localDb.ts')
    await dexieDb.open()
    const owner = { version: 1, actor_id: 7, organization_id: 1, authority: location.origin, runtime: 'cloudflare-workers' }
    for (let index = 0; index < ${queue}; index += 1) await dexieDb.table('sync_queue').add({ id: 'sale-' + index, channel: 'sales:create', status: 'pending', created_at: '2026-09-20', payload: { client_request_id: 'sale-' + index, offline_owner: index ? owner : null } })
    for (let index = 0; index < ${outbox}; index += 1) await dexieDb.table('sync_outbox').add({ id: 'outbox-' + index, status: 'pending', created_at: '2026-09-20' })
    dexieDb.close()
  })()`
  const rows = `(async () => {
    const { dexieDb } = await import('/src/api/localDb.ts')
    await dexieDb.open()
    const result = { queue: await dexieDb.table('sync_queue').count(), outbox: await dexieDb.table('sync_outbox').count() }
    dexieDb.close()
    return result
  })()`

  for (const withoutDatabasesList of [false, true]) {
    const label = withoutDatabasesList ? ' (no indexedDB.databases)' : ''
    await check(`a device without the legacy database counts 0, creates nothing and never loads Dexie${label}`, async () => {
      const { context, page, requested } = await freshPage()
      try {
        const result = await page.evaluate(probe(withoutDatabasesList)) as ProbeResult
        assert.equal(result.count, 0)
        assert.deepEqual(result.names, [], 'probing created no database')
        assert.ok(requested.some((path) => path.endsWith('/src/api/legacyQueueProbe.ts')), 'the probe module itself was loaded')
        assert.deepEqual(requested.filter((path) => /dexie|localDb/i.test(path)), [], 'Dexie and localDb.ts were never requested')
      } finally { await context.close() }
    })

    await check(`an upgraded device with empty legacy queues counts 0${label}`, async () => {
      const { context, page } = await freshPage()
      try {
        await page.evaluate(seed(0, 0))
        const result = await page.evaluate(probe(withoutDatabasesList)) as ProbeResult
        assert.equal(result.count, 0)
        assert.deepEqual(result.names, ['BusinessOS'])
      } finally { await context.close() }
    })

    await check(`queued sales in both legacy stores, any owner, are counted and left in place${label}`, async () => {
      const { context, page } = await freshPage()
      try {
        await page.evaluate(seed(3, 2))
        const result = await page.evaluate(probe(withoutDatabasesList)) as ProbeResult
        assert.equal(result.count, 5)
        assert.deepEqual(await page.evaluate(rows), { queue: 3, outbox: 2 }, 'the probe is read-only')
      } finally { await context.close() }
    })
  }

  await check('the probe reads while the app holds its own Dexie connection open', async () => {
    const { context, page } = await freshPage()
    try {
      await page.evaluate(seed(1, 0))
      const count = await page.evaluate(`(async () => {
        const { dexieDb } = await import('/src/api/localDb.ts')
        await dexieDb.open()
        const { countLegacyQueuedRecords } = await import('/src/api/legacyQueueProbe.ts')
        const count = await countLegacyQueuedRecords()
        await dexieDb.table('settings').put({ key: 'still-open', value: '1' })
        dexieDb.close()
        return count
      })()`)
      assert.equal(count, 1)
    } finally { await context.close() }
  })
} finally {
  await browser.close()
  await server.close()
}

if (failed) process.exitCode = 1
