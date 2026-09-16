// The ONE product option sheet, for every surface that is not the POS grid.
//
// Add/remove/set stock, fast stock-in, transfer, add-items-to-a-sale, a
// sale line's replacement and a return's replacement each used to render
// their own product picker: four of them a flat list that committed on the
// first tap, two of them a private nested Modal with a different layout,
// none of them showing per-branch quantities. That is why the same product
// looked different -- and offered different choices -- depending on which
// button you came in through.
//
// This is a thin adapter, not a second implementation: it mounts the POS's
// own ProductDetailSheet (components/pos/ProductDetailSheet.tsx) with the
// POS-only wiring defaulted out and `onPick` in place of the price buttons,
// so the branch/option/received-date steps, the pill styling, the stock
// derivation (components/pos/productSheetState.ts) and the warehouse rule
// are literally the same code on every surface.
import { useCallback } from 'react'
import ProductDetailSheet from '../pos/ProductDetailSheet.tsx'
import { useApp } from '../../AppContext.tsx'
import type { BatchSelection } from '../../api/batchesTransport.ts'
import type { SheetIntent } from '../pos/productSheetState.ts'

export type ProductOptionRow = Record<string, unknown> & {
  id: string | number
  name: string
  __groupChoices?: ProductOptionRow[]
}

export interface ProductOptionSelection {
  branchId: string | null
  batch?: BatchSelection
}

interface ProductOptionSheetProps {
  // The row the title row stands for. A group's rows travel on `choices`
  // (or on the row's own __groupChoices, which buildProductGroups already
  // produces); a standalone product opens the same sheet with none.
  product: ProductOptionRow
  choices?: readonly ProductOptionRow[]
  t: (key: string) => string | undefined
  fmtUSD: (value: number) => string
  fmtKHR?: (value: number) => string
  // 'stock' for add/remove/set/transfer/fast-stock-in (every branch the
  // operation permits stays selectable); 'sell' for the sale-side pickers,
  // where the warehouse shows its quantity but refuses the pick.
  intent?: SheetIntent
  activeBranchId?: string | number | null
  trackedBatchProductIds?: Set<number>
  // For a host whose write cannot carry a received date -- see
  // ProductDetailSheet's hideReceivedDates.
  hideReceivedDates?: boolean
  pickLabel?: string
  onPick: (product: ProductOptionRow, selection: ProductOptionSelection) => void
  onClose: () => void
}

const asNumber = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export default function ProductOptionSheet({
  product,
  choices,
  t,
  fmtUSD,
  fmtKHR,
  intent = 'stock',
  activeBranchId = null,
  trackedBatchProductIds,
  hideReceivedDates = false,
  pickLabel,
  onPick,
  onClose,
}: ProductOptionSheetProps) {
  // The sheet still owns a handful of bilingual literals (the pager's
  // Back/Next, the option-step title, the damaged-lot labels). Handing it
  // `(english) => english` -- as this adapter first did -- silently shipped
  // English into a Khmer session on every surface EXCEPT the POS, which is
  // the one place the pair was ever resolved. The language comes from the
  // same setting POS.tsx reads, so both halves answer identically.
  const { language } = useApp() as { language?: string }
  const posCopy = useCallback(
    (english: string, khmer = english) => ((language || 'en') === 'km' ? khmer : english),
    [language],
  )
  const rows = (choices && choices.length ? choices : product.__groupChoices) || []
  const variantChoices = rows.length > 1 ? [...rows] : []
  return (
    <ProductDetailSheet
      product={product as never}
      exchangeRate={0}
      t={t}
      fmtUSD={fmtUSD}
      fmtKHR={fmtKHR || ((value: number) => String(value))}
      asNumber={asNumber}
      posCopy={posCopy}
      activeBranchId={activeBranchId}
      trackedBatchProductIds={trackedBatchProductIds}
      hideReceivedDates={hideReceivedDates}
      // No POS cart here, so there is no cross-branch cart-line number to
      // prefer: the branch_stock row IS the answer.
      getDisplayStock={(row) => asNumber((row as { stock_quantity?: unknown } | undefined)?.stock_quantity)}
      getPrimaryProductImage={(row) => String((row as { image_path?: unknown }).image_path || '')}
      getVariantChoices={() => variantChoices as never}
      hasVariantChoices={() => variantChoices.length > 0}
      onAddToCart={() => {}}
      onClose={onClose}
      onOpenImageLightbox={() => {}}
      intent={intent}
      pickLabel={pickLabel}
      portal
      onPick={(picked, selection) => onPick(picked as ProductOptionRow, selection as ProductOptionSelection)}
    />
  )
}
