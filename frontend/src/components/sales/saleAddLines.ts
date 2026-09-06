// Staging a line for "add items to this sale", from the SHARED POS sheet.
//
// The add-items flow used to be two surfaces: the shared option sheet
// (components/shared/ProductOptionSheet.tsx -> the POS's own
// components/pos/ProductDetailSheet.tsx) answered which row and which
// branch, and then a SECOND, private modal -- SaleDetailProductPicker.tsx,
// a Modal-based layout the POS has never rendered -- asked the received
// date, the quantity and the price again with its own list, its own pills
// and its own stock rules. That second modal is what the owner was looking
// at when they said the add-items design must be the POS's, "don't create
// new". It is deleted; the sheet is now the whole pick, and this module is
// the rule that turns the sheet's answer into a staged line.
//
// Two things the private modal got wrong come out in the wash:
//
//  1. The stock cap. It staged `stock_quantity`, the CROSS-BRANCH total, so
//     a product with 2 at the shop and 30 at the warehouse staged a shop
//     line capped at 32: the local "not enough stock" guard stayed silent
//     and the Worker refused the write after the operator had confirmed it.
//     The cap is now the shelf the sheet was read at (branchStockQuantity),
//     narrowed further to the picked lot when there is one -- the same
//     ledger split productSheetState.ts already applies on screen.
//  2. The received date. The sheet was never handed trackedBatchProductIds,
//     so its own lot step could not appear and every pick came back with no
//     batch -- which is exactly why a second modal had to ask. It is handed
//     the tracked ids now, and the lot travels on the pick.
//
// Quantity and price are POS behaviour: a pick adds ONE unit at the row's
// selling price, and both are edited afterwards on the staged row -- the
// same place a POS cart line is edited.
import { branchStockQuantity, type BranchStockRow } from '../pos/productSheetState.ts'

export type SaleAddCandidate = Record<string, unknown> & {
  id?: number | string | null
  name?: string | null
  barcode?: string | null
  selling_price_usd?: number | string | null
  stock_quantity?: number | string | null
  branch_stock?: BranchStockRow[]
  branch_id?: number | string | null
  parent_id?: number | string | null
  __groupKey?: string
  __displayName?: string
  __variantLabel?: string
  __groupChoices?: SaleAddCandidate[]
}

export type StagedAddLine = {
  productId: number
  name: string
  quantity: number
  unitPriceUsd: number
  // The typed text is kept beside the number so a half-typed price ("1.")
  // survives a keystroke; unitPriceUsd stays the single numeric authority.
  priceText: string
  // What the sheet last saw on hand for THIS shelf (and this lot), so the
  // form can block an already-invalid local choice. Never a substitute for
  // the server's check: this number is seconds old and another till may
  // already have taken the units.
  stockQuantity: number
  barcode: string
  // The branch the option sheet resolved this line at -- the shelf the units
  // come off. Carrying it is what puts the added line under the same
  // selling-branch guard as a checkout line; without it the Worker inherits
  // `sale.branch_id` (routes/sales.ts) and draws the lot from a shelf nobody
  // chose, or from none at all on a branchless sale.
  branchId: number | null
  batchId: number | null
  batchLabel: string
  batchReceivedAt: string
  batchExpiryDate: string
  batchQuantity: number | null
}

// What ProductDetailSheet hands back through onPick -- structurally the
// sheet's own BatchSelection, restated here so this module does not depend
// on the transport layer for a shape it only reads.
export type SaleAddSheetSelection = {
  branchId: string | null
  batch?: {
    batchId: number
    batchLabel?: string | null
    batchExpiryDate?: string | null
    batchReceivedAt?: string | null
    quantity?: number | string | null
  }
}

function toNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * What makes two staged lines the SAME line.
 *
 * Product alone was never enough (the same product on two received dates is
 * two movements) and the branch joins the key too -- two picks at different
 * branches take units off two different shelves.
 */
export function stagedAddLineKey(line: Pick<StagedAddLine, 'productId' | 'branchId' | 'batchId'>): string {
  return `${line.productId}:${line.branchId ?? 'any'}:${line.batchId ?? 'stock'}`
}

/**
 * One staged line from one pick on the shared sheet, or `null` when the
 * picked row carries no usable product id (nothing can be added for it, and
 * a NaN product id would post a line the Worker rejects).
 */
export function stagedLineFromSheetPick(
  picked: SaleAddCandidate,
  selection: SaleAddSheetSelection,
): StagedAddLine | null {
  const productId = Number(picked?.id)
  if (!Number.isFinite(productId) || productId <= 0) return null

  const branchNumber = Number(selection?.branchId)
  const branchId = Number.isFinite(branchNumber) && branchNumber > 0 ? branchNumber : null

  const batch = selection?.batch ?? null
  const batchQuantity = batch ? toNumber(batch.quantity) : null
  // On-hand comes from branch_stock; the lot ledger only NARROWS it once a
  // specific received date is picked. Same order productSheetState.ts uses
  // for the number it prints above the pick button, so the staged row and
  // the sheet it came from can never disagree.
  const stockQuantity = batchQuantity ?? branchStockQuantity(picked, selection?.branchId) ?? toNumber(picked.stock_quantity)
  const price = toNumber(picked.selling_price_usd)

  return {
    productId,
    name: String(picked.__displayName || picked.name || `#${productId}`),
    // POS behaviour: one tap adds one unit. The staged row's Qty box is
    // where more are asked for, exactly as the cart line is in the POS.
    quantity: 1,
    unitPriceUsd: price,
    priceText: price > 0 ? String(price) : '0',
    stockQuantity,
    barcode: String(picked.barcode || ''),
    branchId,
    batchId: batch ? Number(batch.batchId) : null,
    batchLabel: batch ? String(batch.batchLabel || '') : '',
    batchReceivedAt: batch ? String(batch.batchReceivedAt || '') : '',
    batchExpiryDate: batch ? String(batch.batchExpiryDate || '') : '',
    batchQuantity,
  }
}

/**
 * Fold one freshly picked line into what is already staged.
 *
 * A second pick of the same product+branch+lot bumps the quantity rather
 * than adding a duplicate row -- the server would accept two lines, but the
 * person meant "two of these".
 *
 * The existing row's PRICE survives. The sheet does not ask for a price, so
 * a repeat pick carries no newer answer than whatever the operator typed on
 * the staged row; overwriting it with the catalogue default would silently
 * undo an explicit edit. (The private picker did overwrite, because it asked
 * the price question itself -- there the pick genuinely was the newer
 * answer.) Everything the sheet DOES re-answer -- what the lot holds right
 * now, its label/expiry/received date -- is refreshed, so a drained lot
 * cannot leave a stale cap behind.
 */
export function mergeStagedAddLine(
  current: readonly StagedAddLine[],
  next: StagedAddLine,
): StagedAddLine[] {
  const key = stagedAddLineKey(next)
  const index = current.findIndex((line) => stagedAddLineKey(line) === key)
  if (index < 0) return [...current, next]
  const merged = [...current]
  merged[index] = {
    ...next,
    quantity: merged[index].quantity + next.quantity,
    unitPriceUsd: merged[index].unitPriceUsd,
    priceText: merged[index].priceText,
  }
  return merged
}
