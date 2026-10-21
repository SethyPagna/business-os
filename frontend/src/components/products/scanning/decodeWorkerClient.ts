// The main thread's end of the decode worker: one frame in flight, the pixel
// buffers handed over rather than copied, and a worker that dies reported
// instead of waited on. The camera loop and the photo path both decode through
// this; neither imports the ladder or ZXing.

import type { BarcodeRead, DecodeReply, DecodeRequest, PixelFrame } from './barcodeFrameDecoder.ts'

/** The part of a Worker this client uses; a test passes a stand-in. */
export interface DecodeWorkerPort {
  postMessage(message: DecodeRequest, transfer: Transferable[]): void
  terminate(): void
  onmessage: ((event: MessageEvent<DecodeReply>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent) => void) | null
}

export interface DecodeFrames {
  centre: PixelFrame
  full?: PixelFrame
}

export interface DecodeClient {
  /** Settles when the worker has built its decoder; rejects if it cannot. */
  readonly ready: Promise<void>
  readonly isReady: boolean
  /** A frame is being decoded; the next one waits for it. */
  readonly busy: boolean
  /** Why the worker can no longer decode, or null while it can. */
  readonly broken: Error | null
  /** Hands the pixel buffers to the worker (they are unusable here afterwards).
   * Resolves null when the frame holds no acceptable read, or when the client
   * is stopped while it waits. */
  decode(frames: DecodeFrames, tryHarder: boolean): Promise<BarcodeRead | null>
  terminate(): void
}

interface Pending {
  id: number
  resolve: (read: BarcodeRead | null) => void
  reject: (error: Error) => void
}

export function createDecodeClient(worker: DecodeWorkerPort): DecodeClient {
  let isReady = false
  let broken: Error | null = null
  let stopped = false
  let lastId = 0
  let pending: Pending | null = null
  let resolveReady: () => void = () => {}
  let rejectReady: (error: Error) => void = () => {}
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  // Whoever awaits `ready` sees the rejection; an unawaited one is not an unhandled error.
  ready.catch(() => {})

  const fail = (error: Error): void => {
    if (broken || stopped) return
    broken = error
    rejectReady(error)
    const waiting = pending
    pending = null
    waiting?.reject(error)
  }

  worker.onmessage = (event) => {
    const reply = event.data
    if (reply?.type === 'ready') {
      isReady = true
      resolveReady()
    } else if (reply?.type === 'read' && pending?.id === reply.id) {
      const waiting = pending
      pending = null
      waiting.resolve(reply.read)
    } else if (reply?.type === 'failed') {
      const error = new Error(reply.message)
      if (reply.id === undefined) fail(error)
      else if (pending?.id === reply.id) {
        const waiting = pending
        pending = null
        waiting.reject(error)
      }
    }
  }
  worker.onerror = (event) => fail(new Error(event.message || 'The barcode decoder stopped unexpectedly.'))
  worker.onmessageerror = () => fail(new Error('The barcode decoder sent a reply this page could not read.'))

  return {
    ready,
    get isReady() { return isReady },
    get busy() { return pending !== null },
    get broken() { return broken },
    decode(frames, tryHarder) {
      if (broken) return Promise.reject(broken)
      if (stopped) return Promise.resolve(null)
      if (pending) return Promise.reject(new Error('A frame is already being decoded.'))
      const id = ++lastId
      return new Promise<BarcodeRead | null>((resolve, reject) => {
        pending = { id, resolve, reject }
        const transfer: Transferable[] = [frames.centre.data.buffer]
        if (frames.full) transfer.push(frames.full.data.buffer)
        try {
          worker.postMessage({ id, centre: frames.centre, full: frames.full, tryHarder }, transfer)
        } catch (error) {
          // A frame the worker never received must not leave the client waiting on it.
          pending = null
          reject(error instanceof Error ? error : new Error('The frame could not be sent to the barcode decoder.'))
        }
      })
    },
    terminate() {
      if (stopped) return
      stopped = true
      worker.terminate()
      const waiting = pending
      pending = null
      waiting?.resolve(null)
    },
  }
}

function spawnDecodeWorker(): DecodeWorkerPort {
  if (typeof Worker === 'undefined') throw new Error('This browser cannot run the barcode decoder.')
  return new Worker(new URL('./barcodeDecode.worker.ts', import.meta.url), { type: 'module' })
}

// A press that never opens the scanner must not keep a worker alive.
const WARM_CLIENT_TTL_MS = 30_000
let warm: { client: DecodeClient; expire: ReturnType<typeof setTimeout> } | null = null

/** Starts the decode worker ahead of the scanner opening, so its script and
 * ZXing load while the camera permission and the modal chunk are still in
 * flight. Idempotent, and never throws: the scan that follows reports a worker
 * that really cannot start. */
export function warmDecodeClient(): void {
  if (warm) return
  try {
    const client = createDecodeClient(spawnDecodeWorker())
    warm = {
      client,
      expire: setTimeout(() => {
        if (warm?.client === client) warm = null
        client.terminate()
      }, WARM_CLIENT_TTL_MS),
    }
  } catch (error) {
    console.error('[scanner] The barcode decoder could not be warmed up.', error)
  }
}

/** The warmed worker if there is one, otherwise a fresh one. The caller owns
 * it and must terminate it. Throws when this browser has no workers. */
export function acquireDecodeClient(): DecodeClient {
  if (warm) {
    clearTimeout(warm.expire)
    const { client } = warm
    warm = null
    // A worker that already failed to start is not worth handing out.
    if (!client.broken) return client
    client.terminate()
  }
  return createDecodeClient(spawnDecodeWorker())
}
