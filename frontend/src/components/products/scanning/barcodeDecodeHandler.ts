// What the decode worker does with one frame: grayscale, then the whole fast
// ladder (every step, not the time-boxed slice the main thread could afford),
// or the TRY_HARDER ladder for a photo. Pure and synchronous so it can be
// driven without a Worker; barcodeDecode.worker.ts only wires it to messages.
// The arrays it works in are kept between frames (see Scratch), so a worker
// that lives for one scan session allocates its tables once.

import type { DecodeReply, DecodeRequest, PixelFrame } from './barcodeFrameDecoder.ts'
import { createScratch, rgbaToLuma, runDecodeLadder, viewSlot, type FrameRegions, type LumaDecoder } from './barcodeLadder.ts'

export function createDecodeHandler(decoder: LumaDecoder) {
  const scratch = createScratch()
  return {
    handle(request: DecodeRequest): DecodeReply {
      const luma = (region: 'centre' | 'full', pixels: PixelFrame) => () => (
        rgbaToLuma(pixels.data, pixels.width, pixels.height, scratch, viewSlot(region, 'gray', false))
      )
      try {
        const regions: FrameRegions = {
          centre: luma('centre', request.centre),
          full: request.full ? luma('full', request.full) : undefined,
        }
        const { read } = runDecodeLadder(regions, decoder, { tryHarder: request.tryHarder, scratch })
        return { type: 'read', id: request.id, read }
      } catch (error) {
        return { type: 'failed', id: request.id, message: error instanceof Error && error.message ? error.message : 'The barcode decoder failed.' }
      }
    },
  }
}
