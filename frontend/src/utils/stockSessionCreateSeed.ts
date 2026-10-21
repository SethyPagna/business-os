// What "+ Create" prefills from the Stock Session search.
//
// A run of six or more digits, or a code the camera or the scanner gun just
// read, is a barcode and goes to the barcode field; anything else is a name.
// A gun on the Windows Khmer layout types ០-៩ for 0-9, so the digits are
// folded first: the check sees a barcode, and the product is created with the
// barcode as the shop prints it, not in Khmer numerals.
import { foldNativeDigits } from './searchMatch.ts'

export interface CreateSeed {
  name: string
  barcode: string
}

export function createFormSeed(text: string, scannedBarcode: string): CreateSeed {
  const barcode = foldNativeDigits(text)
  const looksLikeBarcode = /^\d{6,}$/.test(barcode) || (scannedBarcode !== '' && scannedBarcode === text)
  return looksLikeBarcode ? { name: '', barcode } : { name: text, barcode: '' }
}
