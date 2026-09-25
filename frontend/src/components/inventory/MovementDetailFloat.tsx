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

type Balance = { before_qty: number | null; after_qty: number | null }
type Translator = (key: string) => string | undefined

export default function MovementDetailFloat({ movement, t, fmtTime, loadBalance, onOpenProduct, onClose }: {
  movement: MovementDetailRecord
  t: Translator
  fmtTime: (value: unknown) => string
  loadBalance: (id: string | number) => Promise<Balance | null>
  onOpenProduct?: () => void
  onClose: () => void
}) {
  const tr = (key: string, fallback: string) => { const value = t(key); return value && value !== key ? value : fallback }
  const [balance, setBalance] = useState<{ id: string | number; value: Balance | null; failed: boolean } | null>(null)
  useEffect(() => {
    let live = true
    loadBalance(movement.id)
      .then((value) => { if (live) setBalance({ id: movement.id, value: value || null, failed: false }) })
      .catch(() => { if (live) setBalance({ id: movement.id, value: null, failed: true }) })
    return () => { live = false }
  }, [movement.id, loadBalance])
  // A balance read for a previous record never labels this one.
  const current = balance && balance.id === movement.id ? balance : null
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
      <StockLineChange
        row={{ before_qty: current?.value?.before_qty ?? null, after_qty: current?.value?.after_qty ?? null, quantity: movement.quantity, unit: movement.unit }}
        signedQuantity={signedMovementQuantity(movement.movement_type, movement.quantity)}
        canViewCosts={false}
        tr={tr}
        pending={!current}
      />
      {current?.failed ? <p className="leading-relaxed text-amber-700 dark:text-amber-300">{tr('stock_balance_unavailable', 'The stock before and after could not be read.')}</p> : null}
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
