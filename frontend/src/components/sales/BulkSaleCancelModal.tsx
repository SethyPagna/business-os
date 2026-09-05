import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import { useCloseGuard } from '../../utils/useCloseGuard.ts'
import UnsavedChangesPrompt from '../shared/UnsavedChangesPrompt.tsx'

export type BulkSaleCancelDraft = { id: number; receipt: string; cancel_reason: '' | 'mistake' | 'buyer_refused' | 'other'; cancel_note: string; cancel_fee_usd: string; cancel_fee_khr: string; cancel_fee_note: string }
type Translate = (key: string, english: string, khmer?: string) => string

export default function BulkSaleCancelModal({ sales, saving = false, translate, onClose, onConfirm }: { sales: Array<{ id: number; receipt: string }>; saving?: boolean; translate: Translate; onClose: () => void; onConfirm: (drafts: BulkSaleCancelDraft[]) => void }) {
  const [drafts, setDrafts] = useState<BulkSaleCancelDraft[]>(() => sales.map((sale) => ({ ...sale, cancel_reason: '', cancel_note: '', cancel_fee_usd: '', cancel_fee_khr: '', cancel_fee_note: '' })))
  const [openId, setOpenId] = useState<number | null>(sales[0]?.id || null)
  const valid = useMemo(() => drafts.every((draft) => draft.cancel_reason && (draft.cancel_reason !== 'other' || draft.cancel_note.trim())), [drafts])
  const dirty = drafts.some((draft) => draft.cancel_reason || draft.cancel_note.trim() || draft.cancel_fee_usd || draft.cancel_fee_khr || draft.cancel_fee_note.trim())
  const update = (id: number, patch: Partial<BulkSaleCancelDraft>) => setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, ...patch } : draft))
  const closeGuard = useCloseGuard({ dirty }, onClose)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const closeGuardRef = useRef(closeGuard)
  const savingRef = useRef(saving)
  closeGuardRef.current = closeGuard
  savingRef.current = saving
  const requestClose = () => {
    if (saving) return
    closeGuard.requestClose()
  }

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    closeButtonRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingRef.current) {
        event.preventDefault()
        if (closeGuardRef.current.promptOpen) closeGuardRef.current.dismissPrompt()
        else closeGuardRef.current.requestClose()
        return
      }
      if (event.key !== 'Tab' || closeGuardRef.current.promptOpen) return
      const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') || [])
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); previousFocus?.focus() }
  }, [])

  useEffect(() => {
    if (!closeGuard.promptOpen) return
    window.requestAnimationFrame(() => {
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')
      dialogs[dialogs.length - 1]?.querySelector<HTMLElement>('button:not([disabled])')?.focus()
    })
  }, [closeGuard.promptOpen])

  return createPortal(
    <div className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1050] flex items-end justify-center overflow-y-auto bg-black/50 sm:items-center sm:p-4" onClick={requestClose}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="modal-panel-safe flex w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-2xl sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b p-4 dark:border-gray-700">
          <div><h2 id={titleId} className="font-bold">{translate('cancel_sale_title', 'Cancel sales', 'បោះបង់ការលក់')}</h2><p className="text-xs text-gray-400">{translate('bulk_cancel_review_hint', 'Review every sale before cancelling.', 'ពិនិត្យការលក់នីមួយៗមុនពេលបោះបង់។')}</p></div>
          <button ref={closeButtonRef} type="button" className="flex h-11 w-11 items-center justify-center rounded-lg" onClick={requestClose} disabled={saving} aria-label={translate('close', 'Close', 'បិទ')}><X className="h-4 w-4" /></button>
        </div>
        <div className="modal-scroll max-h-[65vh] space-y-2 overflow-y-auto p-4">
          {drafts.map((draft, index) => {
            const open = openId === draft.id
            const complete = !!draft.cancel_reason && (draft.cancel_reason !== 'other' || !!draft.cancel_note.trim())
            return (
              <section key={draft.id} className="rounded-xl border border-gray-200 dark:border-gray-700">
                <button type="button" className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left" aria-expanded={open} disabled={saving} onClick={() => setOpenId(open ? null : draft.id)}>
                  <span className="font-semibold">{index + 1}. {draft.receipt}</span>
                  <span className={`ml-auto text-xs ${complete ? 'text-emerald-600' : 'text-amber-600'}`}>{complete ? translate('ready', 'Ready', 'រួចរាល់') : translate('required', 'Required', 'ទាមទារ')}</span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>
                {open ? (
                  <div className="space-y-3 border-t p-3 dark:border-gray-700">
                    <div>
                      <span className="mb-1 block text-xs font-medium">{translate('cancel_reason_label', 'Why is it cancelled?', 'ហេតុអ្វីបានជាបោះបង់?')}</span>
                      <div className="grid grid-cols-3 gap-1">
                        {(['mistake', 'buyer_refused', 'other'] as const).map((reason) => (
                          <button key={reason} type="button" disabled={saving} className={`min-h-11 rounded-lg border px-2 text-xs disabled:opacity-60 ${draft.cancel_reason === reason ? 'border-red-600 bg-red-600 text-white' : 'border-gray-300'}`} onClick={() => update(draft.id, { cancel_reason: reason })}>
                            {translate(`cancel_reason_${reason}`, reason === 'buyer_refused' ? "Buyer didn't buy" : reason[0].toUpperCase() + reason.slice(1), reason === 'mistake' ? 'កំហុស' : reason === 'buyer_refused' ? 'អ្នកទិញបដិសេធ' : 'ផ្សេងទៀត')}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label className="block text-xs font-medium">{draft.cancel_reason === 'other' ? translate('cancel_note_required', 'What happened? (required)', 'តើមានអ្វីកើតឡើង? (ទាមទារ)') : translate('notes', 'Notes', 'កំណត់ចំណាំ')}<textarea className="input mt-1 min-h-[64px] w-full text-sm" disabled={saving} value={draft.cancel_note} onChange={(event) => update(draft.id, { cancel_note: event.target.value })} placeholder={translate('cancel_note_placeholder', 'Optional details', 'ព័ត៌មានបន្ថែម (ជាជម្រើស)')} /></label>
                    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-700/50 dark:bg-amber-900/20">
                      <div className="text-xs font-medium">{translate('cancel_lost_fee', 'Money lost on this sale (optional)', 'ប្រាក់ដែលបាត់បង់លើការលក់នេះ (ជាជម្រើស)')}</div>
                      <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/80">{translate('cancel_lost_fee_hint', 'e.g. a delivery fee already paid that the buyer refused to cover. Recorded as an expense on the Expenses page.', 'ឧ. ថ្លៃដឹកជញ្ជូនដែលបានបង់រួច ប៉ុន្តែអ្នកទិញបដិសេធ។ វានឹងត្រូវកត់ត្រាជាចំណាយនៅទំព័រចំណាយ។')}</p>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <label className="text-xs">USD<input className="input mt-1 w-full text-sm" aria-label="USD" disabled={saving} type="number" min="0" step="any" inputMode="decimal" value={draft.cancel_fee_usd} onChange={(event) => update(draft.id, { cancel_fee_usd: event.target.value })} /></label>
                        <label className="text-xs">KHR<input className="input mt-1 w-full text-sm" aria-label="KHR" disabled={saving} type="number" min="0" step="100" inputMode="numeric" value={draft.cancel_fee_khr} onChange={(event) => update(draft.id, { cancel_fee_khr: event.target.value })} /></label>
                      </div>
                      <label className="mt-2 block text-xs">{translate('fee_note', 'Fee note', 'កំណត់ចំណាំថ្លៃ')}<input className="input mt-1 w-full text-sm" disabled={saving} value={draft.cancel_fee_note} onChange={(event) => update(draft.id, { cancel_fee_note: event.target.value })} placeholder={translate('cancel_fee_note_placeholder', 'What this fee was', 'ថ្លៃនេះសម្រាប់អ្វី')} /></label>
                    </div>
                    <div className="text-xs text-gray-400">{translate('cancel_stock_hint', 'Anything not already returned goes back into stock.', 'ទំនិញដែលមិនទាន់ត្រឡប់នឹងបញ្ចូលទៅក្នុងស្តុកវិញ។')}</div>
                  </div>
                ) : null}
              </section>
            )
          })}
        </div>
        <div className="flex justify-end gap-2 border-t p-4 dark:border-gray-700">
          <button type="button" className="btn-secondary text-sm" onClick={requestClose} disabled={saving}>{translate('keep_sale', 'Keep sales', 'រក្សាការលក់')}</button>
          <button type="button" className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={!valid || saving} onClick={() => onConfirm(drafts)}>{saving ? translate('saving', 'Saving...', 'កំពុងរក្សាទុក...') : translate('confirm_cancel_sales', 'Cancel these sales', 'បោះបង់ការលក់ទាំងនេះ')}</button>
        </div>
      </div>
      <UnsavedChangesPrompt guard={closeGuard} />
    </div>, document.body,
  )
}
