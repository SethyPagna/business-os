import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'

const root = path.resolve(import.meta.dirname, '..')
const browserCandidates = process.platform === 'win32'
  ? [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    ]
  : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
const browserPath = browserCandidates.find((candidate) => fs.existsSync(candidate))
assert.ok(browserPath, 'A local Chromium or Edge executable is required for the native pagination regression')

const fixture = String.raw`
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import MergeDuplicatesReviewModal from './src/components/products/MergeDuplicatesReviewModal.tsx'

  let groupCount = 2000
  window.__confirmCalls = 0
  window.__previewLoads = 0
  window.__setGroupCount = (count) => { groupCount = count }

  const makePreview = () => ({
    groupCount,
    duplicateProductCount: groupCount,
    mergeableDuplicateProductCount: groupCount,
    blockedGroupCount: 0,
    costRefusalCount: 0,
    groups: Array.from({ length: groupCount }, (_, index) => {
      const id = index + 1
      return {
        canonicalId: id,
        canonicalName: 'Group ' + id,
        canonicalBarcode: String(id),
        duplicates: [{ id: 10000 + id, name: 'Duplicate ' + id, barcode: '0' + id, quantity: 1, batchCount: 0 }],
        totalQuantityToMove: 1,
        branchBreakdown: [],
        mergeable: true,
        mergeBlockers: [],
      }
    }),
  })

  createRoot(document.getElementById('root')).render(
    <MergeDuplicatesReviewModal
      t={(key) => key}
      onClose={() => {}}
      onConfirm={() => { window.__confirmCalls += 1 }}
      onLoadPreview={async () => { window.__previewLoads += 1; return makePreview() }}
      working={false}
      scope="leading_zero"
    />,
  )
`

const built = await build({
  stdin: { contents: fixture, loader: 'tsx', resolveDir: root, sourcefile: 'merge-preview-pagination-fixture.tsx' },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  write: false,
  plugins: [{
    name: 'modal-stub',
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /\.\.\/shared\/Modal$/ }, () => ({ path: 'modal-stub', namespace: 'fixture' }))
      pluginBuild.onLoad({ filter: /^modal-stub$/, namespace: 'fixture' }, () => ({
        loader: 'tsx',
        resolveDir: root,
        contents: `import React from 'react'; export default function Modal({ title, children }) { return <section role="dialog" aria-label={title}>{children}</section> }`,
      }))
    },
  }],
})
const bundle = built.outputFiles[0].text

const server = http.createServer((request, response) => {
  if (request.url === '/fixture.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
    response.end(bundle)
    return
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  response.end('<!doctype html><html><body><div id="root"></div><script src="/fixture.js"></script></body></html>')
})

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      assert.ok(address && typeof address !== 'string')
      probe.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

const appPort = await freePort()
await new Promise<void>((resolve, reject) => {
  server.once('error', reject)
  server.listen(appPort, '127.0.0.1', resolve)
})

const debugPort = await freePort()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-merge-preview-pagination-'))
const browser = spawn(browserPath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`,
  `http://127.0.0.1:${appPort}/`,
], { stdio: 'ignore' })
const browserExit = new Promise<void>((resolve) => browser.once('exit', resolve))

type CdpReply = { id?: number; result?: unknown; error?: { message?: string } }
let socket: WebSocket | null = null
let nextId = 0
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()

async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== null) return value
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  throw new Error('Timed out waiting for browser state')
}

async function send(method: string, params: Record<string, unknown> = {}): Promise<any> {
  assert.ok(socket && socket.readyState === WebSocket.OPEN)
  const id = ++nextId
  const reply = new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
  socket.send(JSON.stringify({ id, method, params }))
  return reply
}

async function evaluate<T>(expression: string): Promise<T> {
  const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.text || 'Browser evaluation failed')
  return reply.result.value as T
}

type PageState = { ids: number[]; status: string; acknowledged: boolean; confirmCalls: number; previewLoads: number }
async function pageState(): Promise<PageState> {
  return evaluate<PageState>(`(() => ({
    ids: Array.from(document.querySelectorAll('[data-merge-preview-group]'), (node) => Number(node.getAttribute('data-merge-preview-group'))),
    status: document.querySelector('[role=status]')?.textContent || '',
    acknowledged: Boolean(document.querySelector('input[type=checkbox]')?.checked),
    confirmCalls: window.__confirmCalls,
    previewLoads: window.__previewLoads,
  }))()`)
}

try {
  const target = await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      const targets = await response.json() as Array<{ type?: string; url?: string; webSocketDebuggerUrl?: string }>
      return targets.find((item) => item.type === 'page' && item.url?.startsWith(`http://127.0.0.1:${appPort}/`))?.webSocketDebuggerUrl || null
    } catch { return null }
  })
  socket = new WebSocket(target)
  await new Promise<void>((resolve, reject) => {
    socket!.addEventListener('open', () => resolve(), { once: true })
    socket!.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true })
  })
  socket.addEventListener('message', (event) => {
    const reply = JSON.parse(String(event.data)) as CdpReply
    if (!reply.id) return
    const waiter = pending.get(reply.id)
    if (!waiter) return
    pending.delete(reply.id)
    if (reply.error) waiter.reject(new Error(reply.error.message || 'CDP command failed'))
    else waiter.resolve(reply.result)
  })
  await send('Runtime.enable')
  await waitFor(async () => (await pageState()).ids.length === 25 ? true : null)

  const reached = new Set<number>()
  await evaluate(`document.querySelector('input[type=checkbox]').click()`)
  for (let page = 1; page <= 80; page += 1) {
    const state = await pageState()
    assert.ok(state.ids.length > 0 && state.ids.length <= 25, `page ${page} renders at most 25 group cards`)
    assert.equal(state.status.includes(`Page ${page} of 80`), true, `page ${page} announces its page range`)
    assert.equal(state.acknowledged, true, 'paging preserves the explicit confirmation acknowledgement')
    assert.equal(state.confirmCalls, 0, 'paging never invokes the merge confirmation callback')
    assert.equal(state.previewLoads, 1, 'paging does not reload or replace the validated preview')
    state.ids.forEach((id) => reached.add(id))
    if (page < 80) await evaluate(`document.querySelector('[data-merge-preview-page=next]').click()`)
  }
  assert.equal(reached.size, 2000, 'all 2,000 preview groups are reachable through the bounded DOM window')
  assert.deepEqual([...reached].sort((a, b) => a - b), Array.from({ length: 2000 }, (_, index) => index + 1))

  await evaluate(`document.querySelector('[data-merge-preview-page=back]').click()`)
  await waitFor(async () => (await pageState()).status.includes('Page 79 of 80') ? true : null)
  await evaluate(`document.querySelector('[data-merge-preview-page=next]').click()`)
  await waitFor(async () => (await pageState()).status.includes('Page 80 of 80') ? true : null)

  await evaluate(`Array.from(document.querySelectorAll('button')).find((button) => button.textContent.includes('Merge reviewed'))?.click()`)
  assert.equal((await pageState()).confirmCalls, 1, 'confirmation still runs exactly once after paging')

  await evaluate(`window.__setGroupCount(13); Array.from(document.querySelectorAll('button')).find((button) => button.textContent.trim() === 'Re-scan')?.click()`)
  await waitFor(async () => {
    const state = await pageState()
    return state.ids.length === 13 && state.status.includes('Page 1 of 1') ? state : null
  })
  const refreshed = await pageState()
  assert.deepEqual(refreshed.ids, Array.from({ length: 13 }, (_, index) => index + 1), 'refresh resets and clamps the detail page to the new result')
  assert.equal(refreshed.acknowledged, false, 'a fresh preview still requires a fresh acknowledgement')
  assert.equal(refreshed.confirmCalls, 1, 'refresh and page clamping do not apply another merge')
  assert.equal(refreshed.previewLoads, 2, 'only the explicit re-scan refreshes the validated preview')

  console.log('PASS native 2,000-group preview renders <=25 cards, reaches every group, preserves confirmation, and clamps refresh')
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: ++nextId, method: 'Browser.close', params: {} }))
  const exitedCleanly = await Promise.race([browserExit.then(() => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000))])
  if (!exitedCleanly) {
    if (process.platform === 'win32' && browser.pid) spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' })
    else browser.kill()
    await Promise.race([browserExit, new Promise<void>((resolve) => setTimeout(resolve, 2_000))])
  }
  for (const waiter of pending.values()) waiter.reject(new Error('Browser closed'))
  pending.clear()
  socket?.close()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await new Promise((resolve) => setTimeout(resolve, 100))
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
