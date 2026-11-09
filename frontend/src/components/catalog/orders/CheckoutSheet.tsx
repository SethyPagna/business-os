import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import QrCode from 'lucide-react/dist/esm/icons/qr-code.js'
import Store from 'lucide-react/dist/esm/icons/store.js'
import Truck from 'lucide-react/dist/esm/icons/truck.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import ConfirmDialog from '../../shared/ConfirmDialog.tsx'
import { lockDocumentScroll } from '../../shared/documentScrollLock.ts'
import { LegalInlineLink } from '../legal/LegalPages.tsx'
import { LEGAL_PAGE_TITLE_KEY, legalText } from '../legal/legalContent.ts'
import { createOrderApi } from './orderClient.ts'
import { orderErrorMessage } from './orderErrors.ts'
import { rememberOrder } from './orderHistory.ts'
import {
  MAX_ORDER_LINE_QTY, buildCheckoutBody, checkoutProblems, emptyCheckoutForm, newClientRequestId, orderableLines, type CheckoutForm, type CheckoutLine,
} from './orderLogic.ts'
import { orderPathFor } from './orderPath.ts'
import { ORDER_CONTACT_FIELDS, type OrderContactField } from './orderTypes.ts'
import { Field, Notice, ProductName, iconButtonClass, inputClass, primaryButtonClass, type CopyFn } from './orderUi.tsx'

// The checkout sheet (KHQR S7): what the shopper must give, and nothing more. Name and phone are the only required fields, plus an address
// when the goods are to be delivered; every way to reach them is shown and optional; there is no account and no stock is held. The sheet is
// the whole form from its first paint (the address field and the delivery notice are always there, not unfolded by a choice).
//
// Tapping "Get QR" places the order on the Worker, remembers its link in this browser and opens the order page, which is where the QR, the
// countdown and the waiting for payment live. One screen for the QR, whether the buyer arrives from here, from a saved link or after a reload.

export type CheckoutItem = CheckoutLine & { name: string; priceText?: string }

type Props = {
  copy: CopyFn
  items: readonly CheckoutItem[]
  onClose: () => void
  /** The order exists: the page empties the list, then this sheet opens the order. */
  onPlaced: () => void
}

type Failure = { code: string; stock: Array<{ name: string; available: number }> }

const CONTACT_LABELS: Record<Exclude<OrderContactField, 'other'>, string> = { telegram: 'Telegram', instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', whatsapp: 'WhatsApp' }

export default function CheckoutSheet({ copy, items, onClose, onPlaced }: Props) {
  const api = useMemo(() => createOrderApi(), [])
  const [form, setForm] = useState<CheckoutForm>(emptyCheckoutForm)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [discardAsk, setDiscardAsk] = useState(false)
  // Held for the life of the sheet: a double tap or a re-sent request is one order, not two (the Worker refuses the repeat).
  const requestId = useRef(newClientRequestId())
  const submitting = useRef(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const honeypot = useRef<HTMLInputElement | null>(null)

  useEffect(() => lockDocumentScroll(), [])
  useEffect(() => { panelRef.current?.focus() }, [])

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(emptyCheckoutForm()), [form])
  const set = <K extends keyof CheckoutForm>(key: K, value: CheckoutForm[K]) => setForm((current) => ({ ...current, [key]: value }))
  const setContact = (field: OrderContactField, value: string) => setForm((current) => ({ ...current, contacts: { ...current.contacts, [field]: value } }))

  const requestClose = () => {
    if (busy) return
    if (dirty) setDiscardAsk(true)
    else onClose()
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !discardAsk) requestClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const lines = orderableLines(items)
  const tooMany = lines.some((line) => Number(line.qty) > MAX_ORDER_LINE_QTY)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting.current) return
    const problem = checkoutProblems(form)[0]
    if (problem) {
      setFailure({ code: problem, stock: [] })
      document.getElementById(problem === 'name_required' ? 'order-name' : problem === 'phone_invalid' ? 'order-phone' : 'order-address')?.focus()
      return
    }
    if (!lines.length) { setFailure({ code: 'lines_required', stock: [] }); return }
    if (tooMany) { setFailure({ code: 'invalid_line', stock: [] }); return }
    submitting.current = true
    setBusy(true)
    setFailure(null)
    const body = buildCheckoutBody(form, lines, requestId.current)
    // A visitor never sees the honeypot; anything in it is a script, and the Worker refuses it as an unreadable request.
    if (honeypot.current?.value) body.website = honeypot.current.value
    const result = await api.create(body)
    if (result.ok) {
      rememberOrder({ token: result.data.token, orderNo: result.data.order.order_no, savedAt: new Date().toISOString(), totalUsd: result.data.order.total_usd })
      onPlaced()
      window.location.assign(orderPathFor(result.data.token))
      return
    }
    if (result.token) {
      // The order exists but ABA gave no QR: the order page offers "Try again" for it, so go there rather than make the shopper start over.
      rememberOrder({ token: result.token, orderNo: result.orderNo || '', savedAt: new Date().toISOString(), totalUsd: 0 })
      onPlaced()
      window.location.assign(orderPathFor(result.token))
      return
    }
    // The Worker refuses a repeated request id, so a shopper who is told "already placed" and chooses to start again needs a fresh one.
    if (result.code === 'duplicate_request') requestId.current = newClientRequestId()
    const stock = Array.isArray(result.extra.items)
      ? (result.extra.items as Array<{ name?: unknown; available?: unknown }>).map((entry) => ({ name: String(entry.name ?? ''), available: Number(entry.available ?? 0) }))
      : []
    setFailure({ code: result.code, stock })
    submitting.current = false
    setBusy(false)
  }

  const privacyKey = LEGAL_PAGE_TITLE_KEY.privacy
  const termsKey = LEGAL_PAGE_TITLE_KEY.terms
  // One sentence, so Khmer word order is its own: the two links are dropped into the {terms} and {privacy} slots.
  const consentText = copy('order_consent', 'By tapping Get QR you agree to our {terms} and {privacy}. We never see or keep your bank details.', 'ដោយចុច «ទទួលយក QR» អ្នកយល់ព្រមតាម {terms} និង {privacy}។ យើងមិនឃើញ ឬរក្សាទុកព័ត៌មានធនាគាររបស់អ្នកទេ។')
  const consentLine = consentText.split(/({terms}|{privacy})/).map((part, index) => {
    if (part === '{terms}') return <LegalInlineLink key={index} page="terms" label={copy(termsKey, legalText('en', termsKey), legalText('km', termsKey))} />
    if (part === '{privacy}') return <LegalInlineLink key={index} page="privacy" label={copy(privacyKey, legalText('en', privacyKey), legalText('km', privacyKey))} />
    return part
  })
  const fulfilmentOptions = [
    { value: 'pickup' as const, label: copy('order_pickup', 'Pickup at the shop', 'មកយកនៅហាង'), Icon: Store },
    { value: 'delivery' as const, label: copy('order_delivery', 'Delivery', 'ដឹកជញ្ជូន'), Icon: Truck },
  ]

  return (
    <>
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/50 backdrop-blur-sm sm:items-center" onClick={() => { if (!dirty) requestClose() }}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={copy('order_checkout_title', 'Your order', 'ការបញ្ជាទិញរបស់អ្នក')}
        className="flex max-h-modal-85 w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl outline-none dark:bg-neutral-900 sm:rounded-3xl sm:pb-0"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-neutral-800">
          <div className="text-sm font-semibold leading-6 text-slate-900 dark:text-neutral-100">{copy('order_checkout_title', 'Your order', 'ការបញ្ជាទិញរបស់អ្នក')}</div>
          <button type="button" className={iconButtonClass} onClick={requestClose} aria-label={copy('close', 'Close', 'បិទ')} title={copy('close', 'Close', 'បិទ')} disabled={busy}>
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <ul className="space-y-2" aria-label={copy('order_items_label', 'Your items', 'ទំនិញរបស់អ្នក')}>
              {items.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1"><ProductName name={item.name} /></div>
                  <div className="shrink-0 text-right text-xs leading-6 text-slate-600 dark:text-neutral-300" translate="no">
                    {item.qty} × {item.priceText || ''}
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-xs leading-6 text-slate-500 dark:text-neutral-400">{copy('order_total_note', 'You will see the exact total before you pay.', 'អ្នកនឹងឃើញតម្លៃសរុបពិតប្រាកដ មុនពេលបង់ប្រាក់។')}</p>

            {failure ? (
              <Notice tone="error">
                <div>{orderErrorMessage(copy, failure.code)}</div>
                {failure.stock.length ? (
                  <ul className="mt-1 list-disc ps-5">
                    {failure.stock.map((entry, index) => (
                      <li key={`${entry.name}-${index}`}>
                        {entry.available > 0
                          ? copy('order_stock_left', '{name}: {available} left', '{name}៖ នៅសល់ {available}').replace('{name}', entry.name).replace('{available}', String(entry.available))
                          : copy('order_stock_none', '{name}: none left', '{name}៖ អស់ស្តុក').replace('{name}', entry.name)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Notice>
            ) : null}
            {tooMany ? <Notice tone="warn">{orderErrorMessage(copy, 'invalid_line')}</Notice> : null}

            <p className="text-xs leading-6 text-slate-500 dark:text-neutral-400">{copy('order_only_two_needed', 'We only need your name and phone number. No account, and nothing is held for you.', 'យើងត្រូវការតែឈ្មោះ និងលេខទូរស័ព្ទរបស់អ្នកប៉ុណ្ណោះ។ មិនចាំបាច់មានគណនីទេ ហើយយើងមិនទុកទំនិញឱ្យអ្នកទេ។')}</p>

            <Field id="order-name" label={copy('order_name', 'Your name', 'ឈ្មោះរបស់អ្នក')}>
              {(id, describedBy) => (
                <input id={id} aria-describedby={describedBy} aria-required="true" name="name" autoComplete="name" value={form.name} maxLength={60} onChange={(e) => set('name', e.target.value)} className={inputClass} />
              )}
            </Field>
            <Field id="order-phone" label={copy('order_phone', 'Phone number', 'លេខទូរស័ព្ទ')} hint={copy('order_phone_hint', 'For example 012 345 678. We call this number if there is a problem.', 'ឧទាហរណ៍ 012 345 678។ យើងនឹងហៅលេខនេះ បើមានបញ្ហា។')}>
              {(id, describedBy) => (
                <input id={id} aria-describedby={describedBy} aria-required="true" name="tel" type="tel" inputMode="tel" autoComplete="tel" value={form.phone} maxLength={24} onChange={(e) => set('phone', e.target.value)} className={inputClass} />
              )}
            </Field>

            <div role="radiogroup" aria-label={copy('order_how_label', 'How do you want your order?', 'តើអ្នកចង់បានការបញ្ជាទិញរបស់អ្នកដោយរបៀបណា?')} className="grid grid-cols-2 gap-2">
              {fulfilmentOptions.map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={form.fulfilment === value}
                  onClick={() => set('fulfilment', value)}
                  className={`flex min-h-11 items-center justify-center gap-2 rounded-2xl border px-3 py-2.5 text-sm font-semibold leading-6 transition ${form.fulfilment === value
                    ? 'border-emerald-700 bg-emerald-50 text-emerald-900 dark:border-emerald-400 dark:bg-emerald-400/10 dark:text-emerald-100'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/15 dark:bg-white/5 dark:text-neutral-100'}`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <Field id="order-address" label={copy('order_address', 'Delivery address', 'អាសយដ្ឋានដឹកជញ្ជូន')} hint={copy('order_address_hint', 'Needed for delivery. Leave empty for pickup.', 'ត្រូវការសម្រាប់ការដឹកជញ្ជូន។ ទុកទទេសម្រាប់ការមកយកផ្ទាល់។')}>
              {(id, describedBy) => (
                <textarea id={id} aria-describedby={describedBy} aria-required={form.fulfilment === 'delivery'} name="address" autoComplete="street-address" rows={2} maxLength={300} value={form.address} onChange={(e) => set('address', e.target.value)} className={inputClass} />
              )}
            </Field>
            <Notice tone="info">
              {copy('order_delivery_notice', 'For delivery, our staff will contact you about the delivery price and time. The QR covers the goods only.', 'សម្រាប់ការដឹកជញ្ជូន បុគ្គលិករបស់យើងនឹងទាក់ទងអ្នកអំពីតម្លៃ និងពេលវេលាដឹកជញ្ជូន។ QR គិតតែថ្លៃទំនិញប៉ុណ្ណោះ។')}
            </Notice>

            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-semibold leading-6 text-slate-600 dark:text-neutral-300">{copy('order_contacts_title', 'Other ways to reach you (all optional)', 'វិធីផ្សេងទៀតដែលយើងអាចទាក់ទងអ្នក (ជម្រើសទាំងអស់)')}</legend>
              <div className="grid grid-cols-2 gap-2">
                {ORDER_CONTACT_FIELDS.map((field) => (
                  <Field key={field} label={field === 'other' ? copy('order_contact_other', 'Other', 'ផ្សេងៗ') : CONTACT_LABELS[field]}>
                    {(id, describedBy) => (
                      <input id={id} aria-describedby={describedBy} name={`contact-${field}`} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={100} value={form.contacts[field]} onChange={(e) => setContact(field, e.target.value)} className={inputClass} />
                    )}
                  </Field>
                ))}
              </div>
            </fieldset>

            <Field label={copy('order_note_optional', 'Note for the shop (optional)', 'កំណត់ចំណាំសម្រាប់ហាង (ជម្រើស)')}>
              {(id, describedBy) => (
                <textarea id={id} aria-describedby={describedBy} name="note" rows={2} maxLength={300} value={form.note} onChange={(e) => set('note', e.target.value)} className={inputClass} />
              )}
            </Field>

            {/* A person never sees or reaches this field; a script that fills every input will fill it, and the Worker refuses the order. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <input ref={honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
            </div>
          </div>

          <div className="shrink-0 space-y-2 border-t border-slate-100 px-5 py-3 dark:border-neutral-800">
            <button type="submit" disabled={busy} className={primaryButtonClass}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <QrCode className="h-4 w-4" aria-hidden="true" />}
              {busy ? copy('order_working', 'Please wait…', 'សូមរង់ចាំ…') : copy('order_get_qr', 'Get QR', 'ទទួលយក QR')}
            </button>
            <p className="text-center text-xs leading-6 text-slate-500 dark:text-neutral-400">{consentLine}</p>
          </div>
        </form>
      </div>
    </div>
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

