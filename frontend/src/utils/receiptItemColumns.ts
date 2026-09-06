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
// THREE root causes, none of them padding:
//
// 1. The money tracks were sized in `rem`, which is the ROOT font size (16px)
//    and has nothing to do with the receipt's own `font_size`. A shop printing
//    at 9px still paid 16px-rooted columns and gutters. Every track here is
//    `em`, so it scales with the receipt.
// 2. The money tracks were CONTENT-SIZED (`auto`, then `fit-content()`), and
//    every item row is its OWN grid element -- `<div class="grid">` per line,
//    not one grid over the whole table. A content-sized track therefore
//    resolves row by row: with `fit-content(4.4em)` the discounted line's
//    price column came out 52.8px while the plain line's came out 32.4px on
//    the same receipt, so the Price figures did not line up down the page and
//    the name column was a different width on every row. The tracks are now
//    `minmax(<floor>em, max-content)`, with floors chosen to cover the figures
//    a receipt actually prints, so every row -- and the header -- resolves the
//    SAME track from the paper width alone.
// 3. The per-unit discount was an INLINE span beside the price
//    (`<span class="ml-1">(-$3.00)</span>`), so that cell's max-content was
//    "$21.00 (-$3.00)" on one line -- ~95px of an 80mm receipt's ~270px
//    content box -- and it blew straight past any floor. Receipt.tsx renders
//    it as its own block under the price, so a money cell's max-content is
//    the widest SINGLE figure and the floor is what decides the track.
//
// Residual, stated rather than hidden: a floor only makes a column
// content-independent for figures that fit under it. A per-unit cut wider than
// the price floor -- "(-$120.00)" at 5.4em against the 4.4em floor -- still
// grows that one row's track. Widening the floor to cover it would take the
// width back off the product name, which is the thing the owner asked for, so
// the trade is deliberate.

// Content-INDEPENDENT floors, in em of the receipt's own font size. Each one
// covers the widest figure its column prints; tests/receiptCompactRows.test.ts
// states that against receiptNumericWidthEm() rather than trusting these
// numbers.
export const RECEIPT_ITEM_COLUMN_FLOOR_EM = {
  // "99" -- 1.08em under the Courier model -- with headroom, so a three-digit
  // quantity grows the track rather than breaking the figure.
  qty: 1.5,
  // The parenthesised per-unit cut, "(-$3.00)" (4.32em), is the widest thing
  // this column prints on a line of its own, and "$120.00" (3.78em) is the
  // widest plain price this shop rings up.
  unitPrice: 4.4,
  // "$120.00" -- 3.78em.
  lineTotal: 3.8,
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
// The LABEL track is `minmax(min-content,1fr)`, not `minmax(0,1fr)`. With a
// zero floor the label track can be squeezed below its longest word, and the
// label span is `break-words`, so the browser then breaks the WORD -- a 58mm
// receipt printed "Cashi/er:". The value cell is the one that is allowed to
// wrap (it is `break-words`/`break-all` and its parts are nowrap), so on
// narrow paper the rate drops WHOLE under the cashier's name and the label
// stays a word.
export const RECEIPT_ROW_GRID_TEMPLATE = `minmax(min-content,1fr) minmax(${RECEIPT_ROW_VALUE_MIN_EM}em,auto)`
// Row(): `gap-x-3` on the grid and `pr-1` on the label span, in px.
export const RECEIPT_ROW_COLUMN_GAP_PX = 12
export const RECEIPT_ROW_LABEL_PADDING_PX = 4

// shellStyleFor() in Receipt.tsx: `padding: '18px 16px 20px'`.
export const RECEIPT_SHELL_HORIZONTAL_PADDING_PX = 32

const PX_PER_MM = 96 / 25.4

// "Courier New" -- the receipt's default family and the widest of the three
// offered -- advances 0.6em per character. Sans and serif are narrower, so a
// budget computed with this constant is the worst case.
export const RECEIPT_MONOSPACE_ADVANCE_EM = 0.6

// The width a money figure of this many characters needs inside a numeric
// cell, in em of the RECEIPT font (the cell itself prints at
// RECEIPT_ITEM_NUMERIC_FONT_EM). Used to prove a floor is wide enough that the
// figure never has to break mid-number.
export function receiptNumericWidthEm(characters: number): number {
  return characters * RECEIPT_MONOSPACE_ADVANCE_EM * RECEIPT_ITEM_NUMERIC_FONT_EM
}

// A run of text under the same Courier model, in px. Array.from, not .length:
// a Khmer label is counted in code points, not UTF-16 units.
export function receiptTextWidthPx(text: string, fontSizePx: number): number {
  return Array.from(text).length * RECEIPT_MONOSPACE_ADVANCE_EM * fontSizePx
}

// The printable box inside the receipt shell, in px.
export function receiptContentWidthPx(paperWidthMm: number): number {
  return paperWidthMm * PX_PER_MM - RECEIPT_SHELL_HORIZONTAL_PADDING_PX
}

export function receiptItemGridTemplate(showUnitPriceCol: boolean): string {
  const { qty, unitPrice, lineTotal } = RECEIPT_ITEM_COLUMN_FLOOR_EM
  // The name column is the flexible one and may shrink before any money
  // column gives up a pixel -- minmax(0,1fr), never `auto`. The money columns
  // are FLOORED, never capped: `fit-content()` and bare `auto` both resolve
  // per row, and each item line is its own grid element.
  return showUnitPriceCol
    ? `minmax(0,1fr) minmax(${qty}em,max-content) minmax(${unitPrice}em,max-content) minmax(${lineTotal}em,max-content)`
    // Turning the price column off RETURNS its budget to the name rather than
    // merging it into the total column: the cell that is gone prints nothing,
    // so charging for it would take width off the name for no reason.
    : `minmax(0,1fr) minmax(${qty}em,max-content) minmax(${lineTotal}em,max-content)`
}

export interface ReceiptItemTrackInput {
  paperWidthMm: number
  /** The receipt's own font_size -- the em base an item ROW inherits. */
  fontSizePx: number
  showUnitPriceCol?: boolean
  /**
   * The font-size of the GRID ELEMENT being resolved. `em` tracks and the `em`
   * column gap resolve against the element's own font-size, so a header that
   * carried `text-[10px]` on the grid CONTAINER resolved 4.4em to 44px while
   * the item rows resolved it to 52.8px -- the header sat on different tracks
   * than the rows under it. Defaults to `fontSizePx`, which is what every grid
   * on the receipt inherits once that class is on the CELLS instead.
   */
  gridFontSizePx?: number
  /** The font-size the FIGURES print at. Defaults to the numeric cell size. */
  figureFontSizePx?: number
  /** Every figure the cell prints, ONE PER BLOCK LINE. */
  qtyFigures?: string[]
  unitPriceFigures?: string[]
  lineTotalFigures?: string[]
}

export interface ReceiptItemTracksPx {
  gapPx: number
  namePx: number
  qtyPx: number
  unitPricePx: number
  lineTotalPx: number
  /** Where the centred Qty cell's midline lands, measured from the content box. */
  qtyCentrePx: number
  /** Where the right-aligned figures land. NaN when the price column is off. */
  unitPriceRightEdgePx: number
  lineTotalRightEdgePx: number
}

function maxContentPx(figures: string[] | undefined, figureFontSizePx: number): number {
  if (!figures || figures.length === 0) return 0
  // Each figure is its own block line and each is nowrap, so the cell's
  // max-content is the widest ONE of them -- not their sum.
  return Math.max(...figures.map((figure) => receiptTextWidthPx(figure, figureFontSizePx)))
}

// Resolve `minmax(<floor>em, max-content)` for the money columns and the
// remaining 1fr for the name, under the module's Courier model. This is how a
// test states that two item rows and their header land on the SAME tracks
// without a browser -- the property the owner's photo was missing.
export function receiptResolveItemTracksPx(input: ReceiptItemTrackInput): ReceiptItemTracksPx {
  const showUnitPriceCol = input.showUnitPriceCol !== false
  const gridFontSizePx = input.gridFontSizePx ?? input.fontSizePx
  const figureFontSizePx = input.figureFontSizePx ?? input.fontSizePx * RECEIPT_ITEM_NUMERIC_FONT_EM
  const gapPx = RECEIPT_ITEM_COLUMN_GAP_EM * gridFontSizePx
  const track = (floorEm: number, figures?: string[]): number =>
    Math.max(floorEm * gridFontSizePx, maxContentPx(figures, figureFontSizePx))
  const qtyPx = track(RECEIPT_ITEM_COLUMN_FLOOR_EM.qty, input.qtyFigures)
  const unitPricePx = showUnitPriceCol ? track(RECEIPT_ITEM_COLUMN_FLOOR_EM.unitPrice, input.unitPriceFigures) : 0
  const lineTotalPx = track(RECEIPT_ITEM_COLUMN_FLOOR_EM.lineTotal, input.lineTotalFigures)
  const gapCount = showUnitPriceCol ? 3 : 2
  const namePx = receiptContentWidthPx(input.paperWidthMm) - qtyPx - unitPricePx - lineTotalPx - gapCount * gapPx
  const qtyStartPx = namePx + gapPx
  const unitPriceStartPx = qtyStartPx + qtyPx + gapPx
  const lineTotalStartPx = showUnitPriceCol ? unitPriceStartPx + unitPricePx + gapPx : unitPriceStartPx
  return {
    gapPx,
    namePx,
    qtyPx,
    unitPricePx,
    lineTotalPx,
    qtyCentrePx: qtyStartPx + qtyPx / 2,
    unitPriceRightEdgePx: showUnitPriceCol ? unitPriceStartPx + unitPricePx : Number.NaN,
    lineTotalRightEdgePx: lineTotalStartPx + lineTotalPx,
  }
}

export interface ReceiptNameColumnInput {
  paperWidthMm: number
  fontSizePx: number
  showUnitPriceCol?: boolean
}

// The width the product name gets, in px, on a receipt of this paper width and
// font size. With floored (rather than content-sized) money tracks this is the
// width on EVERY row, not a conservative lower bound: only a figure wider than
// its column's floor moves it, and the floors cover what a receipt prints.
export function receiptNameColumnWidthPx(input: ReceiptNameColumnInput): number {
  return receiptResolveItemTracksPx(input).namePx
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
