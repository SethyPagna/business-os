// I8 (Sep 26 2026): prepare a print ahead of the tap. A mounted receipt warms
// the print chunk while the browser is idle; the QR tiles share one generation
// per link; and a warm-up that fails must never poison the tap that follows.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { scheduleIdleWarmup } from '../src/utils/idleWarmup.ts'
import { createQrDataUrlCache } from '../src/utils/receiptQrCache.ts'

let failed = 0
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const globals = globalThis as Record<string, unknown>

await check('idle warm-up runs once when the browser is idle, and never before', async () => {
  const idle: Array<() => void> = []
  let timeout: number | undefined
  globals.window = { requestIdleCallback: (fn: () => void, options?: { timeout?: number }) => { idle.push(fn); timeout = options?.timeout; return idle.length }, cancelIdleCallback: () => {} }
  try {
    let runs = 0
    scheduleIdleWarmup(() => { runs += 1 })
    assert.equal(runs, 0, 'nothing runs inside the render that scheduled it')
    assert.equal(timeout, 2000, 'bounded: an always-busy page still warms within 2 s')
    idle[0]()
    idle[0]()
    assert.equal(runs, 1)
  } finally {
    delete globals.window
  }
})

await check('unmounting first cancels the warm-up', async () => {
  const cancelled: number[] = []
  let idle: (() => void) | null = null
  globals.window = { requestIdleCallback: (fn: () => void) => { idle = fn; return 7 }, cancelIdleCallback: (handle: number) => { cancelled.push(handle) } }
  try {
    let runs = 0
    const cancel = scheduleIdleWarmup(() => { runs += 1 })
    cancel()
    ;(idle as unknown as () => void)()
    assert.deepEqual(cancelled, [7])
    assert.equal(runs, 0)
  } finally {
    delete globals.window
  }
})

await check('Safari has no requestIdleCallback: a short timer stands in, and a failing warm-up is swallowed', async () => {
  globals.window = {}
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
  process.on('unhandledRejection', onUnhandled)
  try {
    let runs = 0
    scheduleIdleWarmup(() => { runs += 1; return Promise.reject(new Error('chunk offline')) })
    scheduleIdleWarmup(() => { throw new Error('sync failure') })
    assert.equal(runs, 0)
    await sleep(400)
    assert.equal(runs, 1)
    assert.deepEqual(unhandled, [], 'a warm-up failure is not an unhandled rejection')
  } finally {
    process.off('unhandledRejection', onUnhandled)
    delete globals.window
  }
})

await check('QR tiles for one link share one generation; the result is kept; a failure is not', async () => {
  let generated = 0
  let fail = true
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const cache = createQrDataUrlCache(async (url) => {
    generated += 1
    await gate
    if (fail) throw new Error('qrcode chunk failed')
    return `data:image/png;base64,${url}`
  })
  assert.equal(cache.peek('https://shop'), null)
  const first = cache.get('https://shop')
  const second = cache.get('https://shop')
  assert.equal(second, first, 'a generation in flight is shared, not raced')
  release()
  await assert.rejects(first)
  assert.equal(generated, 1)
  fail = false
  assert.equal(await cache.get('https://shop'), 'data:image/png;base64,https://shop', 'a failure is retried on the next mount')
  assert.equal(generated, 2)
  assert.equal(cache.peek('https://shop'), 'data:image/png;base64,https://shop', 'and the tile paints it on first render')
  await cache.get('https://shop')
  assert.equal(generated, 2, 'a finished QR is never regenerated')
})

// The loader as Receipt.tsx ships it, with only its import() substituted, so
// a rejected warm-up is observed on the real memoization code.
const receiptSource = fs.readFileSync(new URL('../src/components/receipt/Receipt.tsx', import.meta.url), 'utf8')

await check('a failed warm-up does not poison the Print tap that follows', async () => {
  const start = receiptSource.indexOf('let receiptPrintModulePromise')
  const end = receiptSource.indexOf('function toNumber(')
  assert.ok(start > 0 && end > start)
  const body = receiptSource.slice(start, end).replace("import('../../utils/printReceipt')", '__import()')
  assert.notEqual(body, receiptSource.slice(start, end), 'the import() being substituted is still there')
  const js = ts.transpileModule(`type ReceiptPrintModule = unknown\n${body}\nreturn loadReceiptPrintModule`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  let imports = 0
  let online = false
  const load = new Function('__import', js)(() => { imports += 1; return online ? Promise.resolve({ ok: true }) : Promise.reject(new Error('offline')) }) as () => Promise<unknown>
  await assert.rejects(load(), /offline/, 'the idle warm-up fails while offline')
  await sleep(0)
  online = true
  assert.deepEqual(await load(), { ok: true }, 'the tap fetches the chunk again instead of replaying the failure')
  assert.equal(imports, 2)
  await load()
  assert.equal(imports, 2, 'a loaded chunk is memoized')
})

await check('Receipt warms the print chunk on mount, idle-scheduled, without opening any window', () => {
  const effect = receiptSource.match(/useEffect\(\(\) => scheduleIdleWarmup\(\(\) => loadReceiptPrintModule\(\)\), \[\]\)/)
  assert.ok(effect, 'one mount effect, returning the cancel to React')
  assert.doesNotMatch(receiptSource, /scheduleIdleWarmup\([^\n]*openPrintPreviewWindow/, 'the preview window is never opened ahead of the tap')
})

if (failed > 0) process.exitCode = 1
