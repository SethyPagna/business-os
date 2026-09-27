// U-records: a Movements-tab row opens THAT movement's own record float --
// the stock before -> the movement -> the stock after, and the record's own
// facts -- instead of the product's detail card, which answered a different
// question ("what is this product now") and never showed what the movement
// did. It shares the balance block with the stock-in session line float
// (shared/StockLineChange.tsx); the product card stays one tap away.
//
// First paint is the real record: every fact the row already carries renders
// at once, and only the two balance tiles wait for the one-statement read
// (GET /api/inventory/movements/:id/balance), saying so while they do.
import { useEffect, useState } from 'react'
import Modal from '../shared/Modal.tsx'
import { StockLineChange } from '../shared/StockLineChange.tsx'
import { signedMovementQuantity, translateMovementType } from './movementGroups.ts'
import { buildHistoryRowModel, formatHistoryReference } from '../../utils/historyRowModel.ts'

export type MovementDetailRecord = {
  id: string | number
  product_id?: unknown
  product_name?: string
  movement_type?: string
  quantity?: unknown
  unit?: string | null
  created_at?: string | null
  branch_name?: unknown
  user_name?: unknown
  reason?: unknown
  reference_id?: unknown
  reference_kind?: unknown
  reference_label?: unknown
}

// before_qty/after_qty are the TOTAL across branches; the branch pair is the
// movement's own branch (owner, 26 Sep: both, branch first).
export type MovementBalanceValue = {
  before_qty: number | null
  after_qty: number | null
  branch_before_qty?: number | null
  branch_after_qty?: number | null
  active_branch_count?: number | null
}
type Translator = (key: string) => string | undefined

/**
 * The balance block of ANY stock record float that shows one movement: the
 * Movements tab's record float (below) and the Stock Changes ledger's row
 * float (products/StockChangeSection.tsx). One component and one walk
 * (loadMovementStockBalances), so the same movement reads the same branch
 * line and total line on both screens. Each screen passes the read behind
 * ITS OWN gate as `loadBalance`: the Movements tab
 * /api/inventory/movements/:id/balance (Inventory view), the ledger
 * /api/products/stock-ledger/:id/balance (Products OR Inventory view).
 * Pending while it is read; "—" when it cannot be -- unless the caller
 * already holds the row's own TOTAL pair (`fallback`: the ledger row, from
 * the same walk), which then fills the total line instead of "—".
 */
export function MovementBalance({ movement, tr, loadBalance, fallback, showQuantity = true }: {
  movement: MovementDetailRecord
  tr: (key: string, fallback: string) => string
  loadBalance: (id: string | number) => Promise<MovementBalanceValue | null>
  fallback?: { before_qty?: unknown; after_qty?: unknown } | null
  showQuantity?: boolean
}) {
  const [balance, setBalance] = useState<{ id: string | number; value: MovementBalanceValue | null; failed: boolean } | null>(null)
  useEffect(() => {
    let live = true
    loadBalance(movement.id)
      .then((value) => { if (live) setBalance({ id: movement.id, value: value || null, failed: false }) })
      .catch(() => { if (live) setBalance({ id: movement.id, value: null, failed: true }) })
    return () => { live = false }
  }, [movement.id, loadBalance])
  // A balance read for a previous record never labels this one.
  const current = balance && balance.id === movement.id ? balance : null
  const known = (value: unknown): number | null => (value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value))
  const readTotal = [known(current?.value?.before_qty), known(current?.value?.after_qty)]
  const fallbackTotal = [known(fallback?.before_qty), known(fallback?.after_qty)]
  // The read wins; a failed or empty read falls back to the row's own total.
  const total = readTotal.every((value) => value != null) ? readTotal : fallbackTotal
  const usedFallback = !!current && total === fallbackTotal && fallbackTotal.every((value) => value != null)
  return <>
    <StockLineChange
      row={{
        before_qty: total[0],
        after_qty: total[1],
        branch_before_qty: current?.value?.branch_before_qty ?? null,
        branch_after_qty: current?.value?.branch_after_qty ?? null,
        quantity: movement.quantity,
        unit: movement.unit,
      }}
      branchName={typeof movement.branch_name === 'string' ? movement.branch_name : null}
      activeBranchCount={current?.value?.active_branch_count ?? null}
      signedQuantity={signedMovementQuantity(movement.movement_type, movement.quantity)}
      canViewCosts={false}
      tr={tr}
      pending={!current}
      showQuantity={showQuantity}
    />
    {current?.failed && !usedFallback ? <p className="leading-relaxed text-amber-700 dark:text-amber-300">{tr('stock_balance_unavailable', 'The stock before and after could not be read.')}</p> : null}
  </>
}

export default function MovementDetailFloat({ movement, t, fmtTime, loadBalance, onOpenProduct, onClose }: {
  movement: MovementDetailRecord
  t: Translator
  fmtTime: (value: unknown) => string
  loadBalance: (id: string | number) => Promise<MovementBalanceValue | null>
  onOpenProduct?: () => void
  onClose: () => void
}) {
  const tr = (key: string, fallback: string) => { const value = t(key); return value && value !== key ? value : fallback }
  const model = buildHistoryRowModel(movement)
  const receipt = formatHistoryReference(model.reference, { sale: tr('sale', 'Sale'), return: tr('return', 'Return') })
  const facts: Array<[string, string]> = [
    [tr('type', 'Type'), translateMovementType(movement.movement_type, t)],
    [tr('recorded_at', 'Recorded at'), fmtTime(movement.created_at)],
    [tr('branch', 'Branch'), model.branch],
    [tr('user', 'User'), model.actor],
    receipt ? [tr('receipt', 'Receipt'), receipt] : [tr('reference', 'Reference'), movement.reference_id == null || movement.reference_id === '' ? '—' : String(movement.reference_id)],
    [tr('reason', 'Reason'), model.reason],
  ]
  return <Modal title={movement.product_name || tr('movement', 'Movement')} onClose={onClose} size="md" unsavedChanges="read-only">
    <div className="space-y-3 text-xs">
      <MovementBalance movement={movement} tr={tr} loadBalance={loadBalance} />
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-800/60">
        {facts.map(([label, value]) => <div key={label} className="min-w-0">
          <dt className="leading-relaxed text-gray-400">{label}</dt>
          <dd className="break-words font-medium leading-relaxed text-gray-700 dark:text-gray-200">{value || '—'}</dd>
        </div>)}
      </dl>
      {onOpenProduct ? <div className="flex justify-end">
        <button type="button" className="btn-secondary px-3 text-sm" onClick={onOpenProduct}>{tr('open_product', 'Open product')}</button>
      </div> : null}
    </div>
  </Modal>
}
