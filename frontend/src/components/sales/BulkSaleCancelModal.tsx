import { useMemo, useState } from 'react'
import Ban from 'lucide-react/dist/esm/icons/ban.js'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import InfoHint from '../shared/InfoHint.tsx'
import Modal from '../shared/Modal.tsx'
import CancelSaleFields, { EMPTY_CANCEL_FIELDS, cancelFieldsComplete, cancelFieldsDirty, type CancelFieldsValue } from './CancelSaleFields.tsx'

export type BulkSaleCancelDraft = { id: number; receipt: string } & CancelFieldsValue
type Translate = (key: string, english: string, khmer?: string) => string

// N9: each row's lost fee is an expense -- offered only with Expenses -> Add
// (feeAllowed, utils/cancelFeeRules.ts).
export default function BulkSaleCancelModal({ sales, feeAllowed, saving = false, translate, onClose, onConfirm }: { sales: Array<{ id: number; receipt: string }>; feeAllowed: boolean; saving?: boolean; translate: Translate; onClose: () => void; onConfirm: (drafts: BulkSaleCancelDraft[]) => void }) {
  const [drafts, setDrafts] = useState<BulkSaleCancelDraft[]>(() => sales.map((sale) => ({ id: sale.id, receipt: sale.receipt, ...EMPTY_CANCEL_FIELDS })))
  const [openId, setOpenId] = useState<number | null>(sales[0]?.id || null)
  const valid = useMemo(() => drafts.every(cancelFieldsComplete), [drafts])
  const dirty = drafts.some(cancelFieldsDirty)
  const update = (id: number, patch: Partial<CancelFieldsValue>) => setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, ...patch } : draft))
  const tr = (key: string, fallback: string) => translate(key, fallback)
  const hint = [
    translate('bulk_cancel_review_hint', 'Review every sale before cancelling.', 'ពិនិត្យការលក់នីមួយៗមុនពេលបោះបង់។'),
    translate('cancel_stock_hint', 'Anything not already returned goes back into stock.', 'ទំនិញដែលមិនទាន់ត្រឡប់នឹងបញ្ចូលទៅក្នុងស្តុកវិញ។'),
    translate('cancel_lost_fee_hint', 'e.g. a delivery fee already paid that the buyer refused to cover. Recorded as an expense on the Expenses page.', 'ឧ. ថ្លៃដឹកដែលបានបង់រួច ប៉ុន្តែអតិថិជនមិនព្រមសង។ កត់ត្រាជាចំណាយនៅទំព័រ «ចំណាយ»។'),
  ].join('\n\n')

  return (
    <Modal
      title={translate('cancel_sale_title', 'Cancel sales', 'បោះបង់ការលក់')}
      onClose={onClose}
      size="lg"
      keyboard
      closeDisabled={saving}
      unsavedChanges={{ dirty }}
      headerExtra={<InfoHint label={translate('cancel_sale_title', 'Cancel sales', 'បោះបង់ការលក់')} text={hint} />}
    >
      <div className="space-y-2">
        <div className="max-h-[calc(65*var(--app-vh))] space-y-2 overflow-y-auto">
          {drafts.map((draft, index) => {
            const open = openId === draft.id
            const complete = cancelFieldsComplete(draft)
            return (
              <section key={draft.id} className="rounded-xl border border-gray-200 dark:border-gray-700">
                <button type="button" className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left" aria-expanded={open} disabled={saving} onClick={() => setOpenId(open ? null : draft.id)}>
                  <span className="min-w-0 break-all font-semibold">{index + 1}. {draft.receipt}</span>
                  <span className={`ml-auto shrink-0 text-xs leading-relaxed ${complete ? 'text-emerald-600' : 'text-amber-600'}`}>{complete ? translate('ready', 'Ready', 'រួចរាល់') : translate('required', 'Required', 'ទាមទារ')}</span>
                  <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
                {open ? (
                  <div className="border-t p-3 dark:border-gray-700">
                    <CancelSaleFields value={draft} onChange={(patch) => update(draft.id, patch)} disabled={saving} withFee={feeAllowed} tr={tr} />
                  </div>
                ) : null}
              </section>
            )
          })}
        </div>
        <div className="flex justify-end border-t border-gray-200 pt-3 dark:border-gray-700">
          <button type="button" className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50" disabled={!valid || saving} onClick={() => onConfirm(drafts)}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Ban className="h-4 w-4" aria-hidden="true" />}
            {translate('confirm', 'Confirm', 'បញ្ជាក់')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
