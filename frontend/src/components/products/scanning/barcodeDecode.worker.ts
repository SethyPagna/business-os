import { createDecodeHandler } from './barcodeDecodeHandler.ts'
import type { DecodeReply, DecodeRequest } from './barcodeFrameDecoder.ts'
import { createLumaDecoder } from './barcodeZxing.ts'

type DecodeWorkerScope = {
  postMessage(message: DecodeReply): void
  addEventListener(type: 'message', listener: (event: MessageEvent<DecodeRequest>) => void): void
}

const workerSelf = self as unknown as DecodeWorkerScope

try {
  const handler = createDecodeHandler(createLumaDecoder())
  workerSelf.addEventListener('message', (event) => workerSelf.postMessage(handler.handle(event.data)))
  workerSelf.postMessage({ type: 'ready' })
} catch (error) {
  workerSelf.postMessage({ type: 'failed', message: error instanceof Error && error.message ? error.message : 'The barcode decoder could not start.' })
}
