import { useMemo, useState, type FormEvent } from 'react'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import Send from 'lucide-react/dist/esm/icons/send.js'
import Store from 'lucide-react/dist/esm/icons/store.js'
import Truck from 'lucide-react/dist/esm/icons/truck.js'
import Undo2 from 'lucide-react/dist/esm/icons/undo-2.js'
import ConfirmDialog from '../../shared/ConfirmDialog.tsx'
import { fmtDateTime24 } from '../../../utils/formatters.ts'
import { getKhmerTextProps } from '../../../utils/scriptTypography.ts'
import type { OrderApi } from './orderClient.ts'
import { orderErrorMessage } from './orderErrors.ts'
import {
  COMMENT_MAX, MAX_ORDER_LINE_QTY, buildRequestBody, draftForRequest, hasPendingRequest, requestKindsOffered, requestProblem, type RequestDraft, type RequestProblem,
} from './orderLogic.ts'
import { ORDER_CONTACT_FIELDS, type OrderContactField, type OrderRequest, type OrderView, type RequestKind, type RequestStatus } from './orderTypes.ts'
import { Field, Notice, ProductName, QuantityStepper, cardClass, inputClass, primaryButtonClass, secondaryButtonClass, type CopyFn } from './orderUi.tsx'

// Changes and returns after paying (KHQR S7). The shopper asks; the shop accepts or rejects with a reply; the reply shows here. Nothing is
// applied by this page. A request needs the phone number given when ordering (so a copied link alone cannot change an order), only one can
// wait at a time, and it can be withdrawn while it waits. Photos are not taken here: no public upload exists, so the page says staff will
// ask for them. The number of days comes from the order payload (the owner's setting), never from this file.

type Props = {
  copy: CopyFn
  api: OrderApi
  token: string
  order: OrderView
  /** The order as the Worker now has it after a request or a withdrawal. */
  onChanged: (order: OrderView) => void
}

const CONTACT_LABELS: Record<Exclude<OrderContactField, 'other'>, string> = { telegram: 'Telegram', instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', whatsapp: 'WhatsApp' }

function kindLabel(copy: CopyFn, kind: RequestKind): string {
  switch (kind) {
    case 'items': return copy('order_req_kind_items', 'Change items', 'ផ្លាស់ប្តូរទំនិញ')
    case 'fulfilment': return copy('order_req_kind_fulfilment', 'Pickup or delivery', 'មកយក ឬដឹកជញ្ជូន')
    case 'address': return copy('order_req_kind_address', 'Change address', 'ប្តូរអាសយដ្ឋាន')
    case 'contact': return copy('order_req_kind_contact', 'Change contact details', 'ប្តូរព័ត៌មានទំនាក់ទំនង')
    case 'note': return copy('order_req_kind_note', 'Change note', 'ប្តូរកំណត់ចំណាំ')
    case 'cancel': return copy('order_req_kind_cancel', 'Cancel order', 'បោះបង់ការបញ្ជាទិញ')
    case 'return': return copy('order_req_kind_return', 'Return items', 'ប្រគល់ទំនិញវិញ')
    default: return String(kind)
  }
}

function statusLabel(copy: CopyFn, status: RequestStatus): string {
  switch (status) {
    case 'pending': return copy('order_req_status_pending', 'Waiting for the shop', 'កំពុងរង់ចាំហាង')
    case 'accepted': return copy('order_req_status_accepted', 'Accepted', 'បានទទួលយក')
    case 'rejected': return copy('order_req_status_rejected', 'Not accepted', 'មិនបានទទួលយក')
    case 'withdrawn': return copy('order_req_status_withdrawn', 'Withdrawn', 'បានដកវិញ')
    case 'applied': return copy('order_req_status_applied', 'Done', 'បានធ្វើរួចរាល់')
    case 'reversed': return copy('order_req_status_reversed', 'Undone by the shop', 'ហាងបានលុបចោល')
    default: return String(status)
  }
}

const STATUS_TONE: Record<RequestStatus, string> = {
  pending: 'bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-100',
  accepted: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-100',
  applied: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-100',
  rejected: 'bg-rose-100 text-rose-900 dark:bg-rose-400/15 dark:text-rose-100',
  withdrawn: 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-neutral-200',
  reversed: 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-neutral-200',
}

function problemText(copy: CopyFn, problem: RequestProblem): string {
  switch (problem) {
    case 'need_items': return copy('order_req_need_items', 'Choose at least one item.', 'សូមជ្រើសរើសទំនិញយ៉ាងហោចណាស់មួយ។')
    case 'need_reason': return copy('order_req_need_reason', 'Please write why you are returning these items.', 'សូមសរសេរមូលហេតុដែលអ្នកប្រគល់ទំនិញទាំងនេះវិញ។')
    case 'no_change': return copy('order_req_no_change', 'Nothing has changed yet.', 'មិនទាន់មានអ្វីផ្លាស់ប្តូរនៅឡើយទេ។')
    case 'address_required': return orderErrorMessage(copy, 'address_required')
    case 'name_required': return orderErrorMessage(copy, 'name_required')
    default: return orderErrorMessage(copy, 'phone_invalid')
  }
}

export default function OrderRequests({ copy, api, token, order, onChanged }: Props) {
  const kinds = requestKindsOffered(order)
  const pending = hasPendingRequest(order)
  const canAsk = kinds.length > 0 && !pending
  const [draft, setDraft] = useState<RequestDraft>(() => draftForRequest(order, kinds[0] ?? 'items'))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [withdrawing, setWithdrawing] = useState<OrderRequest | null>(null)
  const [withdrawPhone, setWithdrawPhone] = useState('')

  const set = <K extends keyof RequestDraft>(key: K, value: RequestDraft[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const chooseKind = (kind: RequestKind) => setDraft((current) => ({ ...draftForRequest(order, kind), phone: current.phone, comment: current.comment }))
  const kind = kinds.includes(draft.kind) ? draft.kind : kinds[0]

  const send = async () => {
    if (busy) return
    setBusy(true)
    setMessage(null)
    const result = await api.request(token, buildRequestBody(order, draft))
    setBusy(false)
    setConfirmCancel(false)
    if (!result.ok) { setMessage({ tone: 'error', text: orderErrorMessage(copy, result.code) }); return }
    setDraft(draftForRequest(result.data, kinds[0] ?? 'items'))
    setMessage({ tone: 'success', text: copy('order_req_sent', 'Request sent. Our staff will reply here.', 'បានផ្ញើសំណើ។ បុគ្គលិករបស់យើងនឹងឆ្លើយតបនៅទីនេះ។') })
    onChanged(result.data)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!canAsk || busy) return
    const problem = requestProblem(order, draft)
    if (problem) { setMessage({ tone: 'error', text: problemText(copy, problem) }); return }
    // Asking to cancel a paid order is the one request that is hard to take back in the shopper's mind, so it is reviewed first.
    if (draft.kind === 'cancel') { setMessage(null); setConfirmCancel(true); return }
    void send()
  }

  const withdraw = async () => {
    if (!withdrawing || busy) return
    if (!withdrawPhone.trim()) { setMessage({ tone: 'error', text: orderErrorMessage(copy, 'phone_invalid') }); return }
    setBusy(true)
    const result = await api.withdraw(token, withdrawing.id, withdrawPhone.trim())
    setBusy(false)
    if (!result.ok) { setMessage({ tone: 'error', text: orderErrorMessage(copy, result.code) }); setWithdrawing(null); return }
    setWithdrawing(null)
    setWithdrawPhone('')
    setMessage(null)
    onChanged(result.data)
  }

  const nameOf = useMemo(() => new Map(order.items.map((item) => [item.product_id, item.name])), [order.items])
  const phoneField = (
    <Field id="request-phone" label={copy('order_req_phone', 'The phone number you gave when you ordered', 'លេខទូរស័ព្ទដែលអ្នកបានផ្តល់ពេលបញ្ជាទិញ')} hint={copy('order_req_phone_hint', 'We ask for it so nobody else can change your order with a copied link.', 'យើងសួររកលេខនេះ ដើម្បីកុំឱ្យអ្នកផ្សេងកែការបញ្ជាទិញរបស់អ្នកដោយប្រើតំណដែលបានចម្លង។')}>
      {(id, describedBy) => <input id={id} aria-describedby={describedBy} type="tel" inputMode="tel" autoComplete="tel" maxLength={24} value={draft.phone} onChange={(e) => set('phone', e.target.value)} className={inputClass} />}
    </Field>
  )

  return (
    <section className={`${cardClass} space-y-4`} aria-labelledby="order-requests-title">
      <h2 id="order-requests-title" className="text-base font-semibold leading-7 text-slate-900 dark:text-neutral-100">{copy('order_requests_title', 'Changes and returns', 'ការកែប្រែ និងការប្រគល់ទំនិញវិញ')}</h2>

      {order.requests.length ? (
        <ul className="space-y-3">
          {[...order.requests].reverse().map((request) => (
            <li key={request.id} className="space-y-2 rounded-2xl border border-slate-200 p-3 dark:border-white/10">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold leading-6 text-slate-900 dark:text-neutral-100">{kindLabel(copy, request.kind)}</div>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold leading-6 ${STATUS_TONE[request.status] ?? STATUS_TONE.withdrawn}`}>{statusLabel(copy, request.status)}</span>
              </div>
              <div className="text-xs leading-6 text-slate-500 dark:text-neutral-400" translate="no">{fmtDateTime24(request.created_at)}</div>
              {request.comment ? (
                <div className="text-sm leading-relaxed text-slate-700 dark:text-neutral-200">
                  <span className="font-semibold">{copy('order_req_yours', 'Your note', 'កំណត់ចំណាំរបស់អ្នក')}: </span>
                  <span {...getKhmerTextProps(request.comment, '[overflow-wrap:anywhere]')}>{request.comment}</span>
                </div>
              ) : null}
              {request.staff_reply ? (
                <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-800 dark:bg-white/5 dark:text-neutral-100">
                  <span className="font-semibold">{copy('order_req_reply', 'Shop reply', 'ចម្លើយពីហាង')}: </span>
                  <span {...getKhmerTextProps(request.staff_reply, '[overflow-wrap:anywhere]')}>{request.staff_reply}</span>
                </div>
              ) : null}
              {request.status === 'pending' ? (
                <button type="button" className={secondaryButtonClass} onClick={() => { setWithdrawing(request); setMessage(null) }}>
                  <Undo2 className="h-4 w-4" aria-hidden="true" />
                  {copy('order_req_withdraw', 'Withdraw request', 'ដកសំណើវិញ')}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {pending ? (
        <p className="text-sm leading-relaxed text-slate-600 dark:text-neutral-300">{copy('order_requests_pending_note', 'Your request is waiting for the shop. You can send another one after it is answered.', 'សំណើរបស់អ្នកកំពុងរង់ចាំហាង។ អ្នកអាចផ្ញើសំណើមួយទៀតបន្ទាប់ពីមានចម្លើយ។')}</p>
      ) : null}

      {!kinds.length && !pending && !order.requests.length ? (
        <p className="text-sm leading-relaxed text-slate-600 dark:text-neutral-300">{copy('order_requests_closed', 'The time for changes and returns has ended for this order. Please contact the shop if you need help.', 'រយៈពេលសម្រាប់ការកែប្រែ និងការប្រគល់ទំនិញវិញបានបញ្ចប់សម្រាប់ការបញ្ជាទិញនេះ។ សូមទាក់ទងហាង បើអ្នកត្រូវការជំនួយ។')}</p>
      ) : null}

      {canAsk ? (
        <form onSubmit={submit} className="space-y-3" noValidate>
          <p className="text-sm leading-relaxed text-slate-600 dark:text-neutral-300">{copy('order_requests_intro', 'You can ask for a change or a return within {days} days. Our staff will reply here.', 'អ្នកអាចស្នើសុំការកែប្រែ ឬការប្រគល់ទំនិញវិញក្នុងរយៈពេល {days} ថ្ងៃ។ បុគ្គលិករបស់យើងនឹងឆ្លើយតបនៅទីនេះ។').replace('{days}', String(order.request_window_days))}</p>
          <div role="radiogroup" aria-label={copy('order_req_what', 'What do you need?', 'តើអ្នកត្រូវការអ្វី?')} className="flex flex-wrap gap-2">
            {kinds.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={kind === option}
                onClick={() => chooseKind(option)}
                className={`min-h-11 rounded-full border px-3.5 py-2 text-sm font-semibold leading-6 transition ${kind === option
                  ? 'border-emerald-700 bg-emerald-50 text-emerald-900 dark:border-emerald-400 dark:bg-emerald-400/10 dark:text-emerald-100'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/15 dark:bg-white/5 dark:text-neutral-100'}`}
              >
                {kindLabel(copy, option)}
              </button>
            ))}
          </div>

          {kind === 'items' || kind === 'return' ? (
            <div className="space-y-3">
              <p className="text-xs leading-6 text-slate-500 dark:text-neutral-400">{kind === 'items'
                ? copy('order_req_items_hint', 'Set the quantity you want. To add something new, tell us in the note below.', 'កំណត់ចំនួនដែលអ្នកចង់បាន។ ដើម្បីបន្ថែមអ្វីថ្មី សូមប្រាប់យើងក្នុងកំណត់ចំណាំខាងក្រោម។')
                : copy('order_req_return_hint', 'Choose what you are giving back and how many.', 'ជ្រើសរើសទំនិញដែលអ្នកប្រគល់វិញ និងចំនួន។')}</p>
              <ul className="space-y-3">
                {order.items.map((item) => (
                  <li key={item.product_id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1"><ProductName name={nameOf.get(item.product_id) ?? item.name} /></div>
                    <QuantityStepper copy={copy} itemName={item.name} value={draft.quantities[item.product_id] ?? 0} min={0} max={kind === 'return' ? item.quantity : MAX_ORDER_LINE_QTY} onChange={(qty) => set('quantities', { ...draft.quantities, [item.product_id]: qty })} />
                  </li>
                ))}
              </ul>
              {kind === 'return' ? (
                <>
                  <Field label={copy('order_req_reason', 'Why are you returning these items?', 'ហេតុអ្វីអ្នកប្រគល់ទំនិញទាំងនេះវិញ?')}>
                    {(id, describedBy) => <textarea id={id} aria-describedby={describedBy} rows={2} maxLength={COMMENT_MAX} value={draft.reason} onChange={(e) => set('reason', e.target.value)} className={inputClass} />}
                  </Field>
                  <Notice tone="info">{copy('order_req_photos', 'Our staff will contact you for photos if they need them.', 'បុគ្គលិករបស់យើងនឹងទាក់ទងអ្នកសុំរូបថត បើពួកគេត្រូវការ។')}</Notice>
                </>
              ) : null}
            </div>
          ) : null}

          {kind === 'fulfilment' ? (
            <div className="space-y-3">
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
              <Field label={copy('order_address', 'Delivery address', 'អាសយដ្ឋានដឹកជញ្ជូន')} hint={copy('order_address_hint', 'Needed for delivery. Leave empty for pickup.', 'ត្រូវការសម្រាប់ការដឹកជញ្ជូន។ ទុកទទេសម្រាប់ការមកយកផ្ទាល់។')}>
                {(id, describedBy) => <textarea id={id} aria-describedby={describedBy} rows={2} maxLength={300} value={draft.address} onChange={(e) => set('address', e.target.value)} className={inputClass} />}
              </Field>
              <Notice tone="info">{copy('order_delivery_notice', 'For delivery, our staff will contact you about the delivery price, the time and how to pay for it. The QR covers the goods only.', 'សម្រាប់ការដឹកជញ្ជូន បុគ្គលិករបស់យើងនឹងទាក់ទងអ្នកអំពីតម្លៃ ពេលវេលា និងរបៀបបង់ថ្លៃដឹក។ QR គិតតែថ្លៃទំនិញប៉ុណ្ណោះ។')}</Notice>
            </div>
          ) : null}

          {kind === 'address' ? (
            <Field label={copy('order_new_address', 'New address', 'អាសយដ្ឋានថ្មី')}>
              {(id, describedBy) => <textarea id={id} aria-describedby={describedBy} rows={2} maxLength={300} value={draft.address} onChange={(e) => set('address', e.target.value)} className={inputClass} />}
            </Field>
          ) : null}

          {kind === 'contact' ? (
            <div className="space-y-2">
              <Field label={copy('order_name', 'Your name', 'ឈ្មោះរបស់អ្នក')}>
                {(id, describedBy) => <input id={id} aria-describedby={describedBy} autoComplete="name" maxLength={60} value={draft.name} onChange={(e) => set('name', e.target.value)} className={inputClass} />}
              </Field>
              <div className="grid grid-cols-2 gap-2">
                {ORDER_CONTACT_FIELDS.map((field) => (
                  <Field key={field} label={field === 'other' ? copy('order_contact_other', 'Other', 'ផ្សេងៗ') : CONTACT_LABELS[field]}>
                    {(id, describedBy) => (
                      <input id={id} aria-describedby={describedBy} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={100} value={draft.contacts[field]} onChange={(e) => set('contacts', { ...draft.contacts, [field]: e.target.value })} className={inputClass} />
                    )}
                  </Field>
                ))}
              </div>
            </div>
          ) : null}

          {kind === 'note' ? (
            <Field label={copy('order_note_optional', 'Note for the shop (optional)', 'កំណត់ចំណាំសម្រាប់ហាង (ជម្រើស)')}>
              {(id, describedBy) => <textarea id={id} aria-describedby={describedBy} rows={2} maxLength={300} value={draft.note} onChange={(e) => set('note', e.target.value)} className={inputClass} />}
            </Field>
          ) : null}

          {kind === 'cancel' ? (
            <p className="text-sm leading-relaxed text-slate-600 dark:text-neutral-300">{copy('order_req_cancel_hint', 'Ask the shop to cancel this order. The shop will review it and answer here.', 'សុំឱ្យហាងបោះបង់ការបញ្ជាទិញនេះ។ ហាងនឹងពិនិត្យ ហើយឆ្លើយនៅទីនេះ។')}</p>
          ) : null}

          <Field label={copy('order_req_comment', 'Anything you want to tell us (optional)', 'អ្វីដែលអ្នកចង់ប្រាប់យើង (ជម្រើស)')}>
            {(id, describedBy) => <textarea id={id} aria-describedby={describedBy} rows={2} maxLength={COMMENT_MAX} value={draft.comment} onChange={(e) => set('comment', e.target.value)} className={inputClass} />}
          </Field>
          {phoneField}
          <button type="submit" disabled={busy} className={primaryButtonClass}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            {copy('order_req_send', 'Send request', 'ផ្ញើសំណើ')}
          </button>
        </form>
      ) : null}

      {confirmCancel ? (
        <ConfirmDialog
          title={copy('order_req_cancel_confirm_title', 'Ask the shop to cancel?', 'សុំឱ្យហាងបោះបង់?')}
          items={[
            { label: copy('order_req_order_status', 'Order', 'ការបញ្ជាទិញ'), value: `${copy('order_status_paid', 'Paid', 'បានបង់ប្រាក់')} → ${copy('order_req_cancel_requested', 'Cancellation requested', 'បានស្នើសុំបោះបង់')}` },
          ]}
          confirmLabel={copy('order_req_send', 'Send request', 'ផ្ញើសំណើ')}
          cancelLabel={copy('back', 'Back', 'ត្រឡប់')}
          working={busy}
          workingLabel={copy('order_working', 'Please wait…', 'សូមរង់ចាំ…')}
          onConfirm={() => { void send() }}
          onClose={() => { if (!busy) setConfirmCancel(false) }}
        />
      ) : null}

      {withdrawing ? (
        <ConfirmDialog
          title={copy('order_req_withdraw_title', 'Withdraw this request?', 'ដកសំណើនេះវិញ?')}
          items={[
            { label: kindLabel(copy, withdrawing.kind), value: `${statusLabel(copy, 'pending')} → ${statusLabel(copy, 'withdrawn')}` },
          ]}
          confirmLabel={copy('order_req_withdraw', 'Withdraw request', 'ដកសំណើវិញ')}
          cancelLabel={copy('back', 'Back', 'ត្រឡប់')}
          danger={false}
          working={busy}
          workingLabel={copy('order_working', 'Please wait…', 'សូមរង់ចាំ…')}
          onConfirm={() => { void withdraw() }}
          onClose={() => { if (!busy) { setWithdrawing(null); setWithdrawPhone('') } }}
        >
          <Field label={copy('order_req_phone', 'The phone number you gave when you ordered', 'លេខទូរស័ព្ទដែលអ្នកបានផ្តល់ពេលបញ្ជាទិញ')}>
            {(id, describedBy) => <input id={id} aria-describedby={describedBy} type="tel" inputMode="tel" autoComplete="tel" maxLength={24} value={withdrawPhone} onChange={(e) => setWithdrawPhone(e.target.value)} className={inputClass} />}
          </Field>
        </ConfirmDialog>
      ) : null}
    </section>
  )
}
