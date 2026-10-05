import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js'
import { useApp } from '../../AppContext'
import { STOCK_CHANGES_ANCHOR, queueStockRecordFocus, type StockRefusalInfo } from '../../utils/stockRefusal.ts'

// RET-D (owner, 5 Oct 2026): a refused stock Revert / Undo / line edit says
// concisely WHY and WHERE, with an in-built link (utils/stockRefusal.ts).
// One line: the triangle-! icon, the reason, and a link to the blocking stock
// record. `onOpen` opens it in place (Stock Changes already shows records);
// without it the link moves to Stock Changes, which opens the record there.
export default function StockRefusalLine({ info, onOpen, className = '' }: {
  info: StockRefusalInfo
  onOpen?: (movementId: number) => void
  className?: string
}) {
  const { navigateTo } = useApp() as { navigateTo?: (page: string, anchor?: string) => void }
  const open = () => {
    if (onOpen) { onOpen(info.movementId); return }
    queueStockRecordFocus(info.movementId)
    navigateTo?.('products', STOCK_CHANGES_ANCHOR)
  }
  return (
    <p role="alert" data-testid="stock-refusal-line" className={`flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200 ${className}`}>
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">{info.why}.</span>
      <button type="button" onClick={open} className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-blue-700 underline-offset-2 hover:underline dark:text-blue-300">
        {info.linkLabel}<ArrowRight className="h-3 w-3" aria-hidden="true" />
      </button>
    </p>
  )
}
