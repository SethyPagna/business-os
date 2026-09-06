// The receipt's grid geometry -- ONE definition, shared by the component that
// renders the rows (components/receipt/Receipt.tsx) and the exporter that
// re-lays them out on paper (utils/printReceipt.ts).
//
// Why it lives here. printReceipt.ts clones the on-screen receipt and, because
// the clone carries pixel tracks captured from the preview, rewrites
// `gridTemplateColumns` on every row against the real printable box. It had
// its OWN track list, and that copy had already drifted from the component's:
// 2.2rem / 3.6rem / 3.2rem on paper against 2.2rem / 3.9rem / 3.4rem on
// screen, and 4.25rem against 4.6rem on the label/value rows. A change made in
// the component therefore never reached print, image or PDF -- the three
// outputs the shop actually looks at.
//
// N33 (owner, Sep 6 2026, reading a printed 80mm receipt): "for the items,
// qty, price, total make them compact... especially name, it is being pushed
// two rows."
//
// Two root causes, neither of them padding:
//
// 1. The money tracks were `minmax(x, auto)`, and an `auto` grid track takes
//    its MAX-CONTENT width. The price cell was `whitespace-nowrap` and holds
//    "$21.00 (-$3.00)" on one line, so that one column claimed ~95px of an
//    80mm receipt's ~270px content box -- and the name column, the only
//    flexible one, was left with whatever remained. A 34-character product
//    name then wrapped onto four lines.
// 2. The tracks were sized in `rem`, which is the ROOT font size (16px) and
//    has nothing to do with the receipt's own `font_size`. A shop printing at
//    9px still paid 16px-rooted columns and gutters.
//
// The fix is `fit-content(<limit>)` in `em`: the track sits at its content
// width when that is small (a qty of "1" costs one character, not 1.8em),
// grows only up to the limit, and the cell wraps BETWEEN its figures beyond
// it. No figure is ever broken across lines -- fit-content never drops below
// min-content, so a five-figure price still gets the width it needs.

export const RECEIPT_ITEM_COLUMN_LIMIT_EM = {
  // A two-digit quantity, and no more: a three-digit one still gets its width
  // because fit-content never drops below min-content, and a one-digit one
  // costs a single character rather than the whole limit.
  qty: 1.4,
  // Wide enough for the parenthesised per-unit cut -- "(-$3.00)", the widest
  // thing this column prints on its own line -- so the discount wraps under
  // the price instead of breaking mid-figure. receiptNumericWidthEm() below
  // is how the test states that, rather than trusting the number here.
  unitPrice: 4.4,
  lineTotal: 3.4,
} as const

// Column gap, in em of the receipt's own font size, so a shop that prints at
// 9px does not pay 16px-rooted gutters.
export const RECEIPT_ITEM_COLUMN_GAP_EM = 0.2

// The money cells print a touch smaller than the product name: the name is
// what a customer reads, the figures only have to be legible. This is the
// "make them compact" half of the owner's note, and it is what buys the name
// column the width it needs.
export const RECEIPT_ITEM_NUMERIC_FONT_EM = 0.9

// The label/value rows (Row() in Receipt.tsx). The value column is a MINIMUM,
// not a cap: a long total still grows it.
export const RECEIPT_ROW_VALUE_MIN_EM = 4.6
export const RECEIPT_ROW_GRID_TEMPLATE = `minmax(0,1fr) minmax(${RECEIPT_ROW_VALUE_MIN_EM}em,auto)`

// shellStyleFor() in Receipt.tsx: `padding: '18px 16px 20px'`.
export const RECEIPT_SHELL_HORIZONTAL_PADDING_PX = 32

const PX_PER_MM = 96 / 25.4

// "Courier New" -- the receipt's default family and the widest of the three
// offered -- advances 0.6em per character. Sans and serif are narrower, so a
// budget computed with this constant is the worst case.
export const RECEIPT_MONOSPACE_ADVANCE_EM = 0.6

// The width a money figure of this many characters needs inside a numeric
// cell, in em of the RECEIPT font (the cell itself prints at
// RECEIPT_ITEM_NUMERIC_FONT_EM). Used to prove a fit-content limit is wide
// enough that the figure never has to break mid-number.
export function receiptNumericWidthEm(characters: number): number {
  return characters * RECEIPT_MONOSPACE_ADVANCE_EM * RECEIPT_ITEM_NUMERIC_FONT_EM
}

export function receiptItemGridTemplate(showUnitPriceCol: boolean): string {
  const { qty, unitPrice, lineTotal } = RECEIPT_ITEM_COLUMN_LIMIT_EM
  // The name column is the flexible one and may shrink before any money
  // column gives up a pixel -- minmax(0,1fr), never `auto`.
  return showUnitPriceCol
    ? `minmax(0,1fr) fit-content(${qty}em) fit-content(${unitPrice}em) fit-content(${lineTotal}em)`
    : `minmax(0,1fr) fit-content(${qty}em) fit-content(${unitPrice + lineTotal}em)`
}

export interface ReceiptNameColumnInput {
  paperWidthMm: number
  fontSizePx: number
  showUnitPriceCol?: boolean
}

// The width the product name is GUARANTEED, in px, on a receipt of this paper
// width and font size. Conservative: it charges every money column its full
// fit-content LIMIT, while a real row usually pays less (a one-digit qty costs
// one character). The real name column is therefore never narrower than this.
export function receiptNameColumnWidthPx({
  paperWidthMm,
  fontSizePx,
  showUnitPriceCol = true,
}: ReceiptNameColumnInput): number {
  const contentPx = paperWidthMm * PX_PER_MM - RECEIPT_SHELL_HORIZONTAL_PADDING_PX
  const { qty, unitPrice, lineTotal } = RECEIPT_ITEM_COLUMN_LIMIT_EM
  // Turning the price column off merges its budget into the total column
  // rather than returning it, so the money side costs the same either way and
  // only the gutter count changes.
  const columnEm = qty + unitPrice + lineTotal
  const gapEm = (showUnitPriceCol ? 3 : 2) * RECEIPT_ITEM_COLUMN_GAP_EM
  return contentPx - (columnEm + gapEm) * fontSizePx
}

export function receiptNameCharsPerLine(input: ReceiptNameColumnInput): number {
  const perChar = input.fontSizePx * RECEIPT_MONOSPACE_ADVANCE_EM
  return Math.max(0, Math.floor(receiptNameColumnWidthPx(input) / perChar))
}

// How many printed lines a product name of this length occupies. Infinity
// when the name column has collapsed to nothing, which is the failure the
// owner photographed.
export function receiptNameLineCount(nameLength: number, input: ReceiptNameColumnInput): number {
  const perLine = receiptNameCharsPerLine(input)
  if (perLine <= 0) return Number.POSITIVE_INFINITY
  return Math.max(1, Math.ceil(nameLength / perLine))
}
