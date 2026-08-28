import { useEffect, useState } from 'react'
import X from 'lucide-react/dist/esm/icons/x.js'
import AppSelect, { type AppSelectOption } from '../shared/AppSelect'
import { receiveBatchStock } from '../../api/batchesTransport.ts'
import { dateToBatchCode } from '../../utils/batchCode.ts'

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

type InventoryId = number | string
type Translator = (key: string) => string | undefined
type TranslationWithFallback = (key: string, fallbackEn?: string, fallbackKm?: string) => string

type InventoryProduct = Record<string, any> & {
  id?: InventoryId
  name?: string
  unit?: string
}

type ReceiveBatchModalProps = {
  product: InventoryProduct | null
  branchSelectOptions: AppSelectOption[]
  defaultBranchId?: string
  notify: (message: string, type?: string) => void
  onClose: () => void
  onReceived: () => void
  t: Translator
  tr: TranslationWithFallback
}

// Receives new stock into a lot/expiry-tracked batch (see
// api/batchesTransport.ts + cloudflare/src/lib/productBatches.ts). Distinct
// from InventoryBatchModal ("batch session" -- a queue of ordinary stock
// adjustments/transfers/moves across several products); this is always for
// one product, and always creates or tops up one product_batches row.
export default function ReceiveBatchModal({
  product,
  branchSelectOptions,
  defaultBranchId,
  notify,
  onClose,
  onReceived,
  t,
  tr,
}: ReceiveBatchModalProps) {
  const [branchId, setBranchId] = useState(defaultBranchId || String(branchSelectOptions[0]?.value ?? ''))
  const [quantity, setQuantity] = useState('1')
  const [receivedDate, setReceivedDate] = useState(todayIsoDate())
  const [expiryDate, setExpiryDate] = useState('')
  const [notes, setNotes] = useState('')
  // Supplier + cost + paid/on-credit (migrations 0062/0065): who this lot
  // came from, what one unit cost, and — when on credit — the due date the
  // admin reminder is built on.
  const [supplierName, setSupplierName] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [paymentStatus, setPaymentStatus] = useState<'' | 'paid' | 'credit'>('')
  const [creditDueDate, setCreditDueDate] = useState('')
  const [saving, setSaving] = useState(false)

  // Reset the form whenever a different product is opened (or the modal is
  // closed and re-opened for the same one) -- otherwise a leftover
  // received date/expiry from the previous receipt would silently carry
  // over.
  useEffect(() => {
    setBranchId(defaultBranchId || String(branchSelectOptions[0]?.value ?? ''))
    setQuantity('1')
    setReceivedDate(todayIsoDate())
    setExpiryDate('')
    setNotes('')
    setSupplierName('')
    setUnitCost('')
    setPaymentStatus('')
    setCreditDueDate('')
  }, [product?.id])

  if (!product) return null

  const closeIfIdle = () => {
    if (!saving) onClose()
  }

  const submit = async () => {
    const productId = Number(product.id)
    const parsedBranchId = Number(branchId)
    const parsedQuantity = Number(quantity)
    if (!parsedBranchId) { notify(tr('choose_branch', 'Choose a branch'), 'error'); return }
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) { notify(tr('quantity_must_be_positive', 'Quantity must be a positive number'), 'error'); return }
    if (paymentStatus === 'credit' && !creditDueDate) {
      notify(tr('credit_needs_due_date', 'A credit purchase needs its due date — the admin reminder is built on it.'), 'error')
      return
    }

    setSaving(true)
    try {
      const res = await receiveBatchStock({
        productId,
        branchId: parsedBranchId,
        quantity: parsedQuantity,
        expiryDate: expiryDate || null,
        receivedDate: receivedDate || null,
        notes: notes.trim() || null,
        supplierName: supplierName.trim() || null,
        unitCostUsd: unitCost.trim() === '' ? null : Number(unitCost),
        paymentStatus: paymentStatus || null,
        creditDueDate: paymentStatus === 'credit' ? creditDueDate : null,
      })
      if (res?.success === false) {
        notify((res as any)?.error || tr('receive_batch_failed', 'Failed to receive batch stock'), 'error')
        return
      }
      notify(tr('batch_received', 'Batch stock received'))
      onReceived()
      onClose()
    } catch (e: unknown) {
      notify(e instanceof Error ? e.message : tr('receive_batch_failed', 'Failed to receive batch stock'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={closeIfIdle}>
      <div className="flex max-h-modal-92 w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-lg sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 p-4 dark:border-gray-700">
          <div className="min-w-0">
            <h2 className="font-bold text-gray-900 dark:text-white">{tr('receive_batch', 'Receive Batch')}</h2>
            <div className="mt-0.5 truncate text-xs text-gray-400">{product.name}</div>
          </div>
          <button type="button" onClick={closeIfIdle} className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-gray-400 hover:text-gray-600" disabled={saving}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="modal-scroll space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{t('branch') || 'Branch'}</span>
              <AppSelect
                value={branchId}
                onChange={setBranchId}
                ariaLabel={t('branch') || 'Branch'}
                className="w-full"
                buttonClassName="h-10 w-full text-sm"
                menuClassName="min-w-[13rem]"
                optionClassName="text-sm"
                options={branchSelectOptions}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">
                {tr('quantity_received', 'Quantity received')} {product.unit ? `(${product.unit})` : ''}
              </span>
              <input
                className="input w-full text-sm"
                type="number"
                min="0"
                step="any"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('received_date', 'Received date')}</span>
              <input
                className="input w-full text-sm"
                type="date"
                value={receivedDate}
                onChange={(event) => setReceivedDate(event.target.value)}
              />
              {/* Preview only -- the backend always recomputes and stores
                  the authoritative code itself from whichever date is
                  actually submitted (see batchCode.ts's dateToBatchCode).
                  A receipt on the same date as an existing batch tops it
                  up automatically; there's no separate lot code to type. */}
              <span className="mt-1 block text-[11px] text-gray-400">
                {tr('batch_code_preview', 'Batch code')}: {dateToBatchCode(receivedDate) || '--'}
              </span>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('expiry_date', 'Expiry date')}</span>
              <input
                className="input w-full text-sm"
                type="date"
                value={expiryDate}
                onChange={(event) => setExpiryDate(event.target.value)}
              />
            </label>
          </div>
          {/* Supplier + cost on one row (this lot's own facts) */}
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{t('supplier') || 'Supplier'}</span>
              <input
                className="input w-full text-sm"
                value={supplierName}
                onChange={(event) => setSupplierName(event.target.value)}
                placeholder={tr('supplier_optional_placeholder', 'Who this lot was bought from')}
                autoComplete="off"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('unit_cost_usd', 'Unit cost (USD)')}</span>
              <input
                className="input w-full text-sm"
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={unitCost}
                onChange={(event) => setUnitCost(event.target.value)}
                placeholder="0.00"
              />
            </label>
          </div>
          {/* Paid vs on-credit; the due date appears only when credit and is
              required — it is what the admin reminder is built on. */}
          <div>
            <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('payment_to_supplier', 'Payment to supplier')}</span>
            <div className="flex items-center gap-2">
              <div className="inline-flex overflow-hidden rounded-lg border border-gray-200 text-xs font-medium dark:border-gray-600">
                {([['', tr('payment_unset', '—')], ['paid', tr('paid', 'Paid')], ['credit', tr('on_credit', 'On credit')]] as const).map(([value, label], index) => (
                  <button
                    key={value || 'unset'}
                    type="button"
                    className={`px-3 py-1.5 ${index > 0 ? 'border-l border-gray-200 dark:border-gray-600' : ''} ${paymentStatus === value ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                    onClick={() => setPaymentStatus(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {paymentStatus === 'credit' ? (
                <label className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="flex-shrink-0 text-[11px] text-gray-500">{tr('due', 'Due')}</span>
                  <input
                    className="input min-w-0 flex-1 text-sm"
                    type="date"
                    value={creditDueDate}
                    onChange={(event) => setCreditDueDate(event.target.value)}
                  />
                </label>
              ) : null}
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{t('notes') || 'Notes'}</span>
            <textarea
              className="input min-h-[70px] w-full text-sm"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={tr('receive_batch_notes_placeholder', 'Optional -- PO number, condition, etc.')}
            />
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 p-4 dark:border-gray-700">
          <button type="button" className="btn-secondary text-sm" onClick={onClose} disabled={saving}>
            {t('cancel') || 'Cancel'}
          </button>
          <button type="button" className="btn-primary text-sm" onClick={submit} disabled={saving}>
            {saving ? (t('saving') || 'Saving...') : tr('receive_stock', 'Receive stock')}
          </button>
        </div>
      </div>
    </div>
  )
}
