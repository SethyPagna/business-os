// Scanner S1b (6.0.935): the page's end of the decode worker.
//
// One frame in flight, buffers handed over and not copied, a worker that dies
// reported rather than waited on, and a warmed worker that is handed to the
// scan that follows the press (or let go of if no scan follows).
import assert from 'node:assert/strict'
import {
  acquireDecodeClient,
  createDecodeClient,
  warmDecodeClient,
  type DecodeWorkerPort,
} from '../src/components/products/scanning/decodeWorkerClient.ts'
import type { DecodeReply, DecodeRequest, PixelFrame } from '../src/components/products/scanning/barcodeFrameDecoder.ts'

let failed = 0
async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const unhandled: unknown[] = []
process.on('unhandledRejection', (reason) => { unhandled.push(reason) })

class FakePort implements DecodeWorkerPort {
  onmessage: ((event: MessageEvent<DecodeReply>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null
  sent: Array<{ message: DecodeRequest; transfer: Transferable[] }> = []
  terminated = 0
  throwOnPost: Error | null = null
  postMessage(message: DecodeRequest, transfer: Transferable[]): void {
    if (this.throwOnPost) throw this.throwOnPost
    this.sent.push({ message, transfer })
  }
  terminate(): void { this.terminated += 1 }
  reply(data: DecodeReply): void { this.onmessage?.({ data } as MessageEvent<DecodeReply>) }
  crash(message: string): void { this.onerror?.({ message } as ErrorEvent) }
}

const frame = (width = 4, height = 2): PixelFrame => ({ data: new Uint8ClampedArray(width * height * 4), width, height })
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const EAN = { text: '5901234123457', format: 'ean_13' }

await runTest('ready settles when the worker says so, and isReady follows', async () => {
  const port = new FakePort()
  const client = createDecodeClient(port)
  assert.equal(client.isReady, false)
  port.reply({ type: 'ready' })
  await client.ready
  assert.equal(client.isReady, true)
})

await runTest('decode hands both pixel buffers to the worker, and resolves with the read for its own id', async () => {
  const port = new FakePort()
  const client = createDecodeClient(port)
  const centre = frame()
  const full = frame(8, 4)
  const result = client.decode({ centre, full }, true)
  assert.equal(client.busy, true)
  const [{ message, transfer }] = port.sent
  assert.equal(message.id, 1)
  assert.equal(message.tryHarder, true)
  assert.equal(message.centre, centre)
  assert.deepEqual(transfer, [centre.data.buffer, full.data.buffer], 'the buffers are transferred, so nothing is copied')
  port.reply({ type: 'read', id: 1, read: EAN })
  assert.deepEqual(await result, EAN)
  assert.equal(client.busy, false)
})

await runTest('a frame without the whole picture transfers one buffer, and ids count up', async () => {
  const port = new FakePort()
  const client = createDecodeClient(port)
  const first = client.decode({ centre: frame() }, false)
  assert.equal(port.sent[0].transfer.length, 1)
  assert.equal(port.sent[0].message.full, undefined)
  port.reply({ type: 'read', id: 1, read: null })
  assert.equal(await first, null, 'a frame with nothing acceptable in it resolves null')
  const second = client.decode({ centre: frame() }, false)
  assert.equal(port.sent[1].message.id, 2)
  port.reply({ type: 'read', id: 2, read: EAN })
  assert.deepEqual(await second, EAN)
})

await runTest('only one frame is in flight: a second decode is refused until the first is answered', async () => {
  const port = new FakePort()
  const client = createDecodeClient(port)
  const first = client.decode({ centre: frame() }, false)
  await assert.rejects(() => client.decode({ centre: frame() }, false), /already being decoded/)
  assert.equal(port.sent.length, 1, 'the refused frame was never sent')
  port.reply({ type: 'read', id: 1, read: null })
  await first
  const next = client.decode({ centre: frame() }, false)
  assert.equal(port.sent.length, 2)
  port.reply({ type: 'read', id: 2, read: null })
  await next
})

await runTest('a reply for another frame is ignored; the frame in flight keeps waiting for its own', async () => {
  const port = new FakePort()
  const client = createDecodeClient(port)
  const result = client.decode({ centre: frame() }, false)
  port.reply({ type: 'read', id: 99, read: EAN })
  assert.equal(client.busy, true, 'still waiting')
  port.reply({ type: 'read', id: 1, read: null })
  assert.equal(await result, null)
})

await runTest('a failure for one frame rejects that frame only; the worker is still good', async () => {
  const port = new FakePort()
  const client = createDecodeClient(port)
  const first = client.decode({ centre: frame() }, false)
  port.reply({ type: 'failed', id: 1, message: 'reader exploded' })
  await assert.rejects(() => first, /reader exploded/)
  assert.equal(client.broken, null)
  const second = client.decode({ centre: frame() }, false)
  port.reply({ type: 'read', id: 2, read: EAN })
  assert.deepEqual(await second, EAN)
})

await runTest('a worker that reports it cannot start is broken: ready and the frame in flight reject, later frames reject at once', async () => {
  const port = new FakePort()
  const client = createDecodeClient(port)
  const inFlight = client.decode({ centre: frame() }, false)
  port.reply({ type: 'failed', message: 'zxing missing' })
  await assert.rejects(() => client.ready, /zxing missing/)
  await assert.rejects(() => inFlight, /zxing missing/)
  assert.equal(client.broken?.message, 'zxing missing')
  assert.equal(client.busy, false)
  await assert.rejects(() => client.decode({ centre: frame() }, false), /zxing missing/)
})

await runTest('a worker script that dies, or sends a reply the page cannot read, is broken with a message', async () => {
  const crashed = new FakePort()
  const crashedClient = createDecodeClient(crashed)
  const pending = crashedClient.decode({ centre: frame() }, false)
  crashed.crash('Script error loading the worker')
  await assert.rejects(() => pending, /Script error loading the worker/)
  assert.match(crashedClient.broken?.message || '', /Script error/)

  const silent = new FakePort()
  const silentClient = createDecodeClient(silent)
  silent.crash('')
  assert.match(silentClient.broken?.message || '', /stopped unexpectedly/, 'an event with no message still says something')

  const garbled = new FakePort()
  const garbledClient = createDecodeClient(garbled)
  garbled.onmessageerror?.({} as MessageEvent)
  assert.match(garbledClient.broken?.message || '', /could not read/)
  await assert.rejects(() => garbledClient.ready, /could not read/)
})

await runTest('terminate stops the worker once, settles the frame in flight with no read, and ignores whatever comes later', async () => {
  const port = new FakePort()
  const client = createDecodeClient(port)
  const pending = client.decode({ centre: frame() }, false)
  client.terminate()
  client.terminate()
  assert.equal(port.terminated, 1)
  assert.equal(await pending, null)
  assert.equal(client.busy, false)
  assert.equal(await client.decode({ centre: frame() }, false), null, 'a stopped client decodes nothing')
  assert.equal(port.sent.length, 1)
  port.crash('too late')
  assert.equal(client.broken, null, 'a crash after the scan ended is not news')
})

await runTest('a frame the worker never received (postMessage throws) does not leave the client busy', async () => {
  const port = new FakePort()
  const client = createDecodeClient(port)
  port.throwOnPost = new Error('DataCloneError')
  await assert.rejects(() => client.decode({ centre: frame() }, false), /DataCloneError/)
  assert.equal(client.busy, false)
  port.throwOnPost = null
  const next = client.decode({ centre: frame() }, false)
  port.reply({ type: 'read', id: 2, read: null })
  assert.equal(await next, null)
})

await runTest('a ready promise nobody awaits does not become an unhandled rejection when the worker fails', async () => {
  const port = new FakePort()
  createDecodeClient(port)
  port.reply({ type: 'failed', message: 'nobody is listening' })
  await tick()
  await tick()
  assert.deepEqual(unhandled, [])
})

// --- the warmed worker ---------------------------------------------------------

class CountingWorker extends FakePort {
  static made: CountingWorker[] = []
  url: unknown
  options: unknown
  constructor(url: unknown, options?: unknown) {
    super()
    this.url = url
    this.options = options
    CountingWorker.made.push(this)
  }
}
const globals = globalThis as unknown as { Worker?: unknown }
const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
const expiries: Array<{ callback: () => void; delay: number; cleared: boolean }> = []

function installWarmStage() {
  CountingWorker.made = []
  expiries.length = 0
  globals.Worker = CountingWorker
  // Only the 30 s expiry is held back; everything else keeps its real timer.
  globalThis.setTimeout = ((callback: () => void, delay?: number, ...args: unknown[]) => {
    if (delay !== 30_000) return realSetTimeout(callback, delay, ...args)
    const entry = { callback, delay, cleared: false }
    expiries.push(entry)
    return entry
  }) as unknown as typeof setTimeout
  globalThis.clearTimeout = ((handle: unknown) => {
    const entry = expiries.find((candidate) => candidate === handle)
    if (entry) entry.cleared = true
    else realClearTimeout(handle as never)
  }) as typeof clearTimeout
}

function removeWarmStage() {
  globalThis.setTimeout = realSetTimeout
  globalThis.clearTimeout = realClearTimeout
  delete globals.Worker
}

await runTest('a press warms one worker; the scan that follows takes that same worker and the expiry is cancelled', () => {
  installWarmStage()
  try {
    warmDecodeClient()
    warmDecodeClient()
    assert.equal(CountingWorker.made.length, 1, 'two presses, one worker')
    assert.match(String(CountingWorker.made[0].url), /barcodeDecode\.worker\.ts$/)
    assert.deepEqual(CountingWorker.made[0].options, { type: 'module' })
    assert.equal(expiries.length, 1)
    const client = acquireDecodeClient()
    assert.equal(CountingWorker.made.length, 1, 'the scan took the warmed worker, not a new one')
    assert.equal(expiries[0].cleared, true, 'a worker in use must not expire')
    const second = acquireDecodeClient()
    assert.equal(CountingWorker.made.length, 2, 'the warmed worker is handed out once; the next scan starts its own')
    assert.notEqual(second, client)
    client.terminate()
    second.terminate()
  } finally {
    removeWarmStage()
  }
})

await runTest('a warmed worker nobody takes is stopped after 30 s, and the next scan starts a fresh one', () => {
  installWarmStage()
  try {
    warmDecodeClient()
    assert.equal(expiries[0].delay, 30_000)
    expiries[0].callback()
    assert.equal(CountingWorker.made[0].terminated, 1, 'the idle worker is let go')
    const client = acquireDecodeClient()
    assert.equal(CountingWorker.made.length, 2)
    client.terminate()
    warmDecodeClient()
    assert.equal(CountingWorker.made.length, 3, 'and a later press warms a new one')
    acquireDecodeClient().terminate()
  } finally {
    removeWarmStage()
  }
})

await runTest('a warmed worker that already failed is not handed to a scan', () => {
  installWarmStage()
  try {
    warmDecodeClient()
    CountingWorker.made[0].crash('Script error')
    const client = acquireDecodeClient()
    assert.equal(CountingWorker.made[0].terminated, 1, 'the broken one is stopped')
    assert.equal(CountingWorker.made.length, 2, 'and the scan gets a new one')
    assert.equal(client.broken, null)
    client.terminate()
  } finally {
    removeWarmStage()
  }
})

await runTest('without Worker support the warm-up is a logged no-op and a scan gets a clear error', () => {
  installWarmStage()
  delete globals.Worker
  const logged: unknown[][] = []
  const original = console.error
  console.error = (...args: unknown[]) => { logged.push(args) }
  try {
    assert.doesNotThrow(() => warmDecodeClient())
    assert.equal(logged.length, 1, 'the head start that could not happen is reported')
    assert.throws(() => acquireDecodeClient(), /cannot run the barcode decoder/)
  } finally {
    console.error = original
    removeWarmStage()
  }
})

await tick()
assert.deepEqual(unhandled, [], 'no promise in this file was left rejected without a handler')
if (failed > 0) process.exitCode = 1
