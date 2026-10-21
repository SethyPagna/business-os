// ZXing's retail readers, built for the decode worker. Only the retail readers,
// by deep path: the package root also pulls in the QR, DataMatrix, PDF417, Aztec
// and RSS decoders through MultiFormatReader, about 330 KB of what used to be a
// 448 KB chunk, none of it reachable from a caller. Worker-only, like
// barcodeLadder.ts: the main thread must never import this file.

import type BitArray from '@zxing/library/esm/core/common/BitArray'
import BarcodeFormat from '@zxing/library/esm/core/BarcodeFormat'
import BinaryBitmap from '@zxing/library/esm/core/BinaryBitmap'
import ChecksumException from '@zxing/library/esm/core/ChecksumException'
import DecodeHintType from '@zxing/library/esm/core/DecodeHintType'
import FormatException from '@zxing/library/esm/core/FormatException'
import NotFoundException from '@zxing/library/esm/core/NotFoundException'
import HybridBinarizer from '@zxing/library/esm/core/common/HybridBinarizer'
import Code128Reader from '@zxing/library/esm/core/oned/Code128Reader'
import Code39Reader from '@zxing/library/esm/core/oned/Code39Reader'
import ITFReader from '@zxing/library/esm/core/oned/ITFReader'
import MultiFormatUPCEANReader from '@zxing/library/esm/core/oned/MultiFormatUPCEANReader'
import OneDReader from '@zxing/library/esm/core/oned/OneDReader'
import RGBLuminanceSource from '@zxing/library/esm/core/RGBLuminanceSource'
import type Result from '@zxing/library/esm/core/Result'
import { RETAIL_BARCODE_FORMATS } from './barcodeFrameDecoder.ts'
import type { LumaDecoder } from './barcodeLadder.ts'

/** What ZXing's MultiFormatOneDReader does for the retail formats, minus its
 * imports of Code 93, Codabar and RSS: every row goes to each reader in turn,
 * UPC/EAN first. */
function createRetailReader(hints: Map<DecodeHintType, unknown>) {
  const readers = [new MultiFormatUPCEANReader(hints), new Code39Reader(), new Code128Reader(), new ITFReader()]
  class RetailReader extends OneDReader {
    decodeRow(rowNumber: number, row: BitArray, rowHints?: Map<DecodeHintType, unknown>): Result {
      for (const reader of readers) {
        try {
          return reader.decodeRow(rowNumber, row, rowHints)
        } catch (_) {
          // This reader sees no code in this row; the next one may.
        }
      }
      throw new NotFoundException()
    }
  }
  return new RetailReader()
}

const FORMAT_BY_NAME: Record<string, number> = {
  ean_13: BarcodeFormat.EAN_13,
  ean_8: BarcodeFormat.EAN_8,
  upc_a: BarcodeFormat.UPC_A,
  upc_e: BarcodeFormat.UPC_E,
  code_128: BarcodeFormat.CODE_128,
  code_39: BarcodeFormat.CODE_39,
  itf: BarcodeFormat.ITF,
}
const NAME_BY_FORMAT = new Map(Object.entries(FORMAT_BY_NAME).map(([name, format]) => [format, name]))

/** Two readers per worker, both limited to the retail formats: a fast one and
 * a TRY_HARDER one. Only "nothing here" exceptions count as a miss; anything
 * else is a real fault and propagates. */
export function createLumaDecoder(): LumaDecoder {
  const possibleFormats = RETAIL_BARCODE_FORMATS.map((name) => FORMAT_BY_NAME[name])
  const createReader = (tryHarder: boolean) => {
    const hints = new Map<DecodeHintType, unknown>([[DecodeHintType.POSSIBLE_FORMATS, possibleFormats]])
    if (tryHarder) hints.set(DecodeHintType.TRY_HARDER, true)
    return { reader: createRetailReader(hints), hints }
  }
  const fast = createReader(false)
  const hard = createReader(true)
  return (frame, tryHarder) => {
    const { reader, hints } = tryHarder ? hard : fast
    try {
      const source = new RGBLuminanceSource(frame.data, frame.width, frame.height)
      const result = reader.decode(new BinaryBitmap(new HybridBinarizer(source)), hints)
      return { text: String(result.getText() || '').trim(), format: NAME_BY_FORMAT.get(result.getBarcodeFormat()) || '' }
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ChecksumException || error instanceof FormatException) return null
      throw error
    }
  }
}
