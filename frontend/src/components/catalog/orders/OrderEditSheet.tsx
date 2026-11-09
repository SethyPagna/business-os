import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import Store from 'lucide-react/dist/esm/icons/store.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import Truck from 'lucide-react/dist/esm/icons/truck.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import ConfirmDialog from '../../shared/ConfirmDialog.tsx'
import { lockDocumentScroll } from '../../shared/documentScrollLock.ts'
import type { OrderApi } from './orderClient.ts'
import { orderErrorMessage } from './orderErrors.ts'
import { MAX_ORDER_LINE_QTY, draftFromOrder, editBodyFor, formatUsd, isPlausiblePhone, type EditDraft } from './orderLogic.ts'
import { ORDER_CONTACT_FIELDS, type OrderContactField, type OrderView } from './orderTypes.ts'
import { Field, Notice, ProductName, QuantityStepper, iconButtonClass, inputClass, primaryButtonClass, secondaryButtonClass, type CopyFn } from './orderUi.tsx'

// Change an order that is still waiting for payment (KHQR S7). Nothing was paid, so no approval is needed: saving changes it at once. A new
// list means a new price, and so a new QR for the new amount; the old QR is closed. A change to the details only keeps the QR as it is.
// Saving first shows what changes, before and after, and only then sends it.

type Props = {
  copy: CopyFn
  api: OrderApi
  token: string
  order: OrderView
  onClose: () => void
  /** The order as the Worker now has it (after a save, or after a refusal that means the page is out of date). */
  onSaved: (order: OrderView | null) => void
}

const CONTACT_LABELS: Record<Exclude<OrderContactField, 'other'>, string> = { telegram: 'Telegram', instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', whatsapp: 'WhatsApp' }

const itemsText = (lines: ReadonlyArray<{ name: string; qty: number }>): string => lines.map((line) => `${line.qty} × ${line.name}`).join(', ')

export default function OrderEditSheet({ copy, api, token, order, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<EditDraft>(() => draftFromOrder(order))
  const [review, setReview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [discardAsk, setDiscardAsk] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => lockDocumentScroll(), [])
  useEffect(() => { panelRef.current?.focus() }, [])

  const body = useMemo(() => editBodyFor(order, draft), [order, draft])
  const changed = Object.keys(body).length > 0
  const set = <K extends keyof EditDraft>(key: K, value: EditDraft[K]) => setDraft((current) => ({ ...current, [key]: value }))

  const requestClose = () => {
    if (busy) return
    if (changed) setDiscardAsk(true)
    else onClose()
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !review && !discardAsk) requestClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const preview = (event: FormEvent) => {
    event.preventDefault()
    if (!changed || busy) return
    if (!draft.name.trim()) { setErrorCode('name_required'); document.getElementById('edit-name')?.focus(); return }
    if (draft.fulfilment === 'delivery' && !draft.address.trim()) { setErrorCode('address_required'); document.getElementById('edit-address')?.focus(); return }
    if (draft.newPhone.trim() && !isPlausiblePhone(draft.newPhone)) { setErrorCode('phone_invalid'); document.getElementById('edit-phone')?.focus(); return }
    setErrorCode(null)
    setReview(true)
  }

  const save = async () => {
    if (busy) return
    setBusy(true)
    const result = await api.edit(token, body)
    setBusy(false)
    if (result.ok) { onSaved(result.data); return }
    setReview(false)
    setErrorCode(result.code)
    // These mean the page's copy of the order is out of date (it was paid, changed or closed meanwhile): show the Worker's truth.
    if (['already_paid', 'order_changed', 'order_not_editable'].includes(result.code) || result.status === 502) onSaved(null)
  }

  const linesChanged = 'lines' in body
  const newLines = draft.lines.map(({ item, qty }) => ({ name: item.name, qty }))
  const oldLines = order.items.map((item) => ({ name: item.name, qty: item.quantity }))
  const reviewRows = [
    ...(linesChanged ? [
      { label: copy('order_review_items_before', 'Items before', 'ទំនិញមុន'), value: itemsText(oldLines) },
      { label: copy('order_review_items_after', 'Items after', 'ទំនិញក្រោយ'), value: itemsText(newLines) },
      { label: copy('order_review_total_before', 'Total before', 'តម្លៃសរុបមុន'), value: formatUsd(order.total_usd) },
      { label: copy('order_review_total_after', 'Total after', 'តម្លៃសរុបក្រោយ'), value: copy('order_review_total_new', 'Worked out when you save', 'គណនានៅពេលអ្នករក្សាទុក') },
    ] : []),
    ...('name' in body ? [{ label: copy('order_name', 'Your name', 'ឈ្មោះរបស់អ្នក'), value: `${order.name} → ${String(body.name)}` }] : []),
    ...('phone' in body ? [{ label: copy('order_phone', 'Phone number', 'លេខទូរស័ព្ទ'), value: `${order.phone_hint} → ${String(body.phone)}` }] : []),
    ...('fulfilment' in body ? [{
      label: copy('order_how_short', 'Pickup or delivery', 'មកយក ឬដឹកជញ្ជូន'),
      value: `${order.fulfilment === 'delivery' ? copy('order_delivery', 'Delivery', 'ដឹកជញ្ជូន') : copy('order_pickup', 'Pickup at the shop', 'មកយកនៅហាង')} → ${draft.fulfilment === 'delivery' ? copy('order_delivery', 'Delivery', 'ដឹកជញ្ជូន') : copy('order_pickup', 'Pickup at the shop', 'មកយកនៅហាង')}`,
    }] : []),
    ...('address' in body ? [{ label: copy('order_address', 'Delivery address', 'អាសយដ្ឋានដឹកជញ្ជូន'), value: `${order.address || '–'} → ${String(body.address) || '–'}` }] : []),
    ...('note' in body ? [{ label: copy('order_note_short', 'Note', 'កំណត់ចំណាំ'), value: `${order.note || '–'} → ${String(body.note) || '–'}` }] : []),
    ...('contacts' in body ? [{ label: copy('order_contacts_short', 'Contact details', 'ព័ត៌មានទំនាក់ទំនង'), value: copy('order_review_contacts_changed', 'Changed', 'បានកែប្រែ') }] : []),
  ]

  return (
    <>
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/50 backdrop-blur-sm sm:items-center" onClick={() => { if (!changed) requestClose() }}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={copy('order_edit_title', 'Change your order', 'កែប្រែការបញ្ជាទិញរបស់អ្នក')}
        className="flex max-h-modal-85 w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl outline-none dark:bg-neutral-900 sm:rounded-3xl sm:pb-0"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-neutral-800">
          <div className="text-sm font-semibold leading-6 text-slate-900 dark:text-neutral-100">{copy('order_edit_title', 'Change your order', 'កែប្រែការបញ្ជាទិញរបស់អ្នក')}</div>
          <button type="button" className={iconButtonClass} onClick={requestClose} aria-label={copy('close', 'Close', 'បិទ')} title={copy('close', 'Close', 'បិទ')} disabled={busy}>
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={preview} className="flex min-h-0 flex-1 flex-col" noValidate>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {errorCode ? <Notice tone="error">{orderErrorMessage(copy, errorCode)}</Notice> : null}
            <p className="text-xs leading-6 text-slate-500 dark:text-neutral-400">{copy('order_edit_note', 'Changing your items gives you a new price and a new QR. The old QR stops working.', 'ការផ្លាស់ប្តូរទំនិញនឹងផ្តល់តម្លៃថ្មី និង QR ថ្មី។ QR ចាស់នឹងឈប់ដំណើរការ។')}</p>
            <ul className="space-y-3" aria-label={copy('order_items_label', 'Your items', 'ទំនិញរបស់អ្នក')}>
              {draft.lines.map((line, index) => (
                <li key={line.item.product_id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1"><ProductName name={line.item.name} /></div>
                  <QuantityStepper copy={copy} itemName={line.item.name} value={line.qty} min={1} max={MAX_ORDER_LINE_QTY} onChange={(qty) => set('lines', draft.lines.map((own, i) => (i === index ? { ...own, qty } : own)))} />
                  <button
                    type="button"
                    className={iconButtonClass}
                    disabled={draft.lines.length <= 1}
                    onClick={() => set('lines', draft.lines.filter((_, i) => i !== index))}
                    aria-label={`${copy('removeFromBucket', 'Remove', 'ដកចេញ')}: ${line.item.name}`}
                    title={copy('removeFromBucket', 'Remove', 'ដកចេញ')}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>

            <Field id="edit-name" label={copy('order_name', 'Your name', 'ឈ្មោះរបស់អ្នក')}>
              {(id, describedBy) => <input id={id} aria-describedby={describedBy} autoComplete="name" maxLength={60} value={draft.name} onChange={(e) => set('name', e.target.value)} className={inputClass} />}
            </Field>
            <Field id="edit-phone" label={copy('order_new_phone', 'New phone number (leave empty to keep {hint})', 'លេខទូរស័ព្ទថ្មី (ទុកទទេ ដើម្បីរក្សា {hint})').replace('{hint}', order.phone_hint)}>
              {(id, describedBy) => <input id={id} aria-describedby={describedBy} type="tel" inputMode="tel" autoComplete="tel" maxLength={24} value={draft.newPhone} onChange={(e) => set('newPhone', e.target.value)} className={inputClass} />}
            </Field>
            <div role="radiogroup" aria-label={copy('order_how_label', 'How do you want your order?', 'តើអ្នកចង់បានការបញ្ជាទិញរបស់អ្នកដោយរបៀបណា?')} className="grid grid-cols-2 gap-2">
              {([
                { value: 'pickup' as const, label: copy('order_pickup', 'Pickup at the shop', 'មកយកនៅហាង'), Icon: Store },
                { value: 'delivery' as const, label: copy('order_delivery', 'Delivery', 'ដឹកជញ្ជូន'), Icon: Truck },
              ]).map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={draft.fulfilment === value}
                  onClick={() => set('fulfilment', value)}
                  className={`flex min-h-11 items-center justify-center gap-2 rounded-2xl border px-3 py-2.5 text-sm font-semibold leading-6 transition ${draft.fulfilment === value
                    ? 'border-emerald-700 bg-emerald-50 text-emerald-900 dark:border-emerald-400 dark:bg-emerald-400/10 dark:text-emerald-100'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/15 dark:bg-white/5 dark:text-neutral-100'}`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <Field id="edit-address" label={copy('order_address', 'Delivery address', 'អាសយដ្ឋានដឹកជញ្ជូន')} hint={copy('order_address_hint', 'Needed for delivery. Leave empty for pickup.', 'ត្រូវការសម្រាប់ការដឹកជញ្ជូន។ ទុកទទេសម្រាប់ការមកយកផ្ទាល់។')}>
              {(id, describedBy) => <textarea id={id} aria-describedby={describedBy} rows={2} maxLength={300} value={draft.address} onChange={(e) => set('address', e.target.value)} className={inputClass} />}
            </Field>
            <Notice tone="info">{copy('order_delivery_notice', 'For delivery, our staff will contact you about the delivery price and time. The QR covers the goods only.', 'សម្រាប់ការដឹកជញ្ជូន បុគ្គលិករបស់យើងនឹងទាក់ទងអ្នកអំពីតម្លៃ និងពេលវេលាដឹកជញ្ជូន។ QR គិតតែថ្លៃទំនិញប៉ុណ្ណោះ។')}</Notice>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-semibold leading-6 text-slate-600 dark:text-neutral-300">{copy('order_contacts_title', 'Other ways to reach you (all optional)', 'វិធីផ្សេងទៀតដែលយើងអាចទាក់ទងអ្នក (ជម្រើសទាំងអស់)')}</legend>
              <div className="grid grid-cols-2 gap-2">
                {ORDER_CONTACT_FIELDS.map((field) => (
                  <Field key={field} label={field === 'other' ? copy('order_contact_other', 'Other', 'ផ្សេងៗ') : CONTACT_LABELS[field]}>
                    {(id, describedBy) => (
                      <input id={id} aria-describedby={describedBy} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={100} value={draft.contacts[field]} onChange={(e) => set('contacts', { ...draft.contacts, [field]: e.target.value })} className={inputClass} />
                    )}
                  </Field>
                ))}
              </div>
            </fieldset>
            <Field label={copy('order_note_optional', 'Note for the shop (optional)', 'កំណត់ចំណាំសម្រាប់ហាង (ជម្រើស)')}>
              {(id, describedBy) => <textarea id={id} aria-describedby={describedBy} rows={2} maxLength={300} value={draft.note} onChange={(e) => set('note', e.target.value)} className={inputClass} />}
            </Field>
          </div>
          <div className="flex shrink-0 gap-2 border-t border-slate-100 px-5 py-3 dark:border-neutral-800">
            <button type="submit" disabled={!changed || busy} className={primaryButtonClass}>{copy('order_review_changes', 'Review changes', 'ពិនិត្យការផ្លាស់ប្តូរ')}</button>
            <button type="button" onClick={requestClose} disabled={busy} className={secondaryButtonClass}>{copy('back', 'Back', 'ត្រឡប់')}</button>
          </div>
        </form>
      </div>
    </div>
      {review ? (
        <ConfirmDialog
          title={copy('order_edit_confirm_title', 'Save these changes?', 'រក្សាទុកការផ្លាស់ប្តូរទាំងនេះ?')}
          items={reviewRows}
          note={linesChanged ? copy('order_edit_confirm_note', 'You get a new QR for the new total. The old QR stops working.', 'អ្នកនឹងទទួលបាន QR ថ្មីសម្រាប់តម្លៃសរុបថ្មី។ QR ចាស់នឹងឈប់ដំណើរការ។') : undefined}
          confirmLabel={busy ? undefined : copy('order_save', 'Save', 'រក្សាទុក')}
          cancelLabel={copy('back', 'Back', 'ត្រឡប់')}
          working={busy}
          workingLabel={<span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{copy('order_working', 'Please wait…', 'សូមរង់ចាំ…')}</span>}
          layer="nested"
          onConfirm={() => { void save() }}
          onClose={() => { if (!busy) setReview(false) }}
        />
      ) : null}
      {discardAsk ? (
        <ConfirmDialog
          title={copy('order_discard_title', 'Discard unsaved changes?', 'បោះបង់ការផ្លាស់ប្តូរដែលមិនទាន់រក្សាទុក?')}
          confirmLabel={copy('order_discard', 'Discard', 'បោះបង់')}
          cancelLabel={copy('back', 'Back', 'ត្រឡប់')}
          danger
          layer="nested"
          onConfirm={() => { setDiscardAsk(false); onClose() }}
          onClose={() => setDiscardAsk(false)}
        />
      ) : null}
    </>
  )
}
