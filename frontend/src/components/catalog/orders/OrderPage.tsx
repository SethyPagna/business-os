import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2.js'
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle.js'
import Copy from 'lucide-react/dist/esm/icons/copy.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import Info from 'lucide-react/dist/esm/icons/info.js'
import ConfirmDialog from '../../shared/ConfirmDialog.tsx'
import { fmtDateTime24 } from '../../../utils/formatters.ts'
import { startVisibleInterval } from '../../../utils/visibilityPolling.ts'
import { lazyRetry } from '../../../utils/lazyImport.ts'
import { getKhmerTextProps } from '../../../utils/scriptTypography.ts'
import KhqrCard from './KhqrCard.tsx'
import { createOrderApi } from './orderClient.ts'
import { orderErrorMessage } from './orderErrors.ts'
import { readSavedOrders, rememberOrder } from './orderHistory.ts'
import { PAID_STATUSES, formatAmount, formatUsd, orderMoneyNotes, orderScreen, parseServerTime, secondsUntilExpiry } from './orderLogic.ts'
import { browserPollHost, createOrderPoller, giveUpTimeFor } from './orderPoller.ts'
import { ORDER_CONTACT_FIELDS, type OrderStatus, type OrderView } from './orderTypes.ts'
import { Notice, ProductName, cardClass, iconButtonClass, primaryButtonClass, type CopyFn } from './orderUi.tsx'

const OrderRequests = lazyRetry(() => import('./OrderRequests.tsx'), 'public-order-requests')
const OrderEditSheet = lazyRetry(() => import('./OrderEditSheet.tsx'), 'public-order-edit')

// One order, opened from its link (KHQR S7): its status, its items, what it costs, and everything the shopper can still do. While it waits
// for money this is the payment screen (the QR, the countdown, a status read every few seconds that stops when the tab is hidden or the order
// is finished). After payment it is where staff replies, refunds and the shop's answers to change and return requests show.

type Props = { copy: CopyFn; token: string }
type Loaded = { phase: 'loading' } | { phase: 'failed'; code: string } | { phase: 'ready'; order: OrderView }

const CONTACT_LABELS = { telegram: 'Telegram', instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', whatsapp: 'WhatsApp' } as const
/** A top-up QR is not covered by the order's own status read, so a page showing one re-reads the order now and then (only while visible). */
const TOP_UP_REFRESH_MS = 30_000

function statusLabel(copy: CopyFn, status: OrderStatus): string {
  switch (status) {
    case 'awaiting_payment': return copy('order_status_waiting', 'Waiting for payment', 'កំពុងរង់ចាំអ្នកបង់ប្រាក់')
    case 'qr_failed': return copy('order_status_qr_failed', 'QR not ready', 'QR មិនទាន់រួចរាល់')
    case 'expired': return copy('order_status_expired', 'Time ran out', 'អស់ពេល')
    case 'paid': return copy('order_status_paid', 'Paid', 'បានបង់ប្រាក់')
    case 'review': return copy('order_status_review', 'Payment being checked', 'កំពុងពិនិត្យការទូទាត់')
    case 'cancelled':
    case 'sale_cancelled': return copy('order_status_cancelled', 'Cancelled', 'បានបោះបង់')
    case 'completed': return copy('order_status_completed', 'Completed', 'បានបញ្ចប់')
    case 'balance_due': return copy('order_status_balance', 'Balance to pay', 'នៅសល់ត្រូវបង់')
    case 'delivery_pending': return copy('order_status_delivery', 'Waiting for delivery', 'រង់ចាំការដឹកជញ្ជូន')
    default: return String(status)
  }
}

export default function OrderPage({ copy, token }: Props) {
  const api = useMemo(() => createOrderApi(), [])
  const [loaded, setLoaded] = useState<Loaded>({ phase: 'loading' })
  const [skewMs, setSkewMs] = useState(0)
  const [busy, setBusy] = useState<'retry' | 'cancel' | 'topup' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [cancelAsk, setCancelAsk] = useState(false)
  const [editing, setEditing] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [topUpReceived, setTopUpReceived] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const orderRef = useRef<OrderView | null>(null)
  const order = loaded.phase === 'ready' ? loaded.order : null
  orderRef.current = order

  const accept = useCallback((next: OrderView, skew?: number | null) => {
    if (typeof skew === 'number') setSkewMs(skew)
    setLoaded({ phase: 'ready', order: next })
  }, [])

  const reload = useCallback(async (): Promise<OrderView | null> => {
    const result = await api.get(token)
    if (!result.ok) {
      // A refused reload on a page that already shows an order keeps what it shows; only a first load can fail the whole page.
      if (!orderRef.current) setLoaded({ phase: 'failed', code: result.code })
      else setActionError(result.code)
      return null
    }
    accept(result.data, result.skewMs)
    return result.data
  }, [accept, api, token])

  useEffect(() => { void reload() }, [reload])

  // The link is remembered in this browser ("My orders"), without moving an order already listed.
  useEffect(() => {
    if (!order || readSavedOrders().some((saved) => saved.token === token)) return
    rememberOrder({ token, orderNo: order.order_no, savedAt: new Date().toISOString(), totalUsd: order.total_usd })
  }, [order, token])

  // The status read: only while a QR is on screen and the order waits, and it stops on its own when the order is finished or the QR is long over.
  const waiting = order?.status === 'awaiting_payment' && !!order.payment
  const expiresAt = order?.payment?.expires_at ?? null
  useEffect(() => {
    if (!waiting) return undefined
    const poller = createOrderPoller({
      host: browserPollHost(),
      read: () => api.status(token),
      onStatus: (status) => {
        if (typeof status.state === 'string' && status.state !== 'awaiting_payment') void reload()
      },
      giveUpAt: () => giveUpTimeFor(parseServerTime(expiresAt)),
    })
    poller.start()
    return () => poller.stop()
  }, [waiting, expiresAt, api, token, reload])

  // An extra payment staff asked for (a top-up) has its own QR: re-read the order now and then until it is paid, while the tab is visible.
  const hasTopUp = (order?.top_ups.length ?? 0) > 0
  useEffect(() => {
    if (!hasTopUp) return undefined
    return startVisibleInterval(() => { void reload() }, TOP_UP_REFRESH_MS)
  }, [hasTopUp, reload])
  const topUpCount = order?.top_ups.length ?? 0
  const previousTopUps = useRef(topUpCount)
  useEffect(() => {
    if (previousTopUps.current > 0 && topUpCount === 0) setTopUpReceived(true)
    previousTopUps.current = topUpCount
  }, [topUpCount])

  // The shop's clock decides whether the QR is still good; this local tick only redraws the screen choice when the time runs out.
  const ticking = (waiting && !!expiresAt) || hasTopUp
  useEffect(() => {
    if (!ticking) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [ticking])

  if (loaded.phase === 'loading') {
    return (
      <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-slate-600 dark:text-neutral-300">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {copy('order_loading', 'Loading your order…', 'កំពុងផ្ទុកការបញ្ជាទិញរបស់អ្នក…')}
      </div>
    )
  }
  if (loaded.phase === 'failed') {
    const gone = loaded.code === 'order_not_found'
    return (
      <div className="space-y-3 py-8">
        <Notice tone="error">{orderErrorMessage(copy, loaded.code)}</Notice>
        {!gone ? (
          <button type="button" className={primaryButtonClass} onClick={() => { setLoaded({ phase: 'loading' }); void reload() }}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {copy('order_try_again', 'Try again', 'ព្យាយាមម្តងទៀត')}
          </button>
        ) : null}
      </div>
    )
  }

  const view = loaded.order
  const secondsLeft = secondsUntilExpiry(view.payment?.expires_at, now, skewMs)
  const screen = orderScreen(view, secondsLeft)
  const notes = orderMoneyNotes(view)
  const delivery = view.fulfilment === 'delivery'
  const savedContacts = ORDER_CONTACT_FIELDS.filter((field) => view.contacts[field])

  const run = async (kind: 'retry' | 'cancel' | 'topup', work: () => ReturnType<typeof api.retry>) => {
    if (busy) return
    setBusy(kind)
    setActionError(null)
    const result = await work()
    setBusy(null)
    if (result.ok) { accept(result.data, result.skewMs); return }
    setActionError(result.code)
    // These mean the page was behind (paid, changed, or its QR is still good): show the Worker's truth.
    if (['already_paid', 'order_changed', 'qr_still_valid', 'order_not_retryable', 'order_not_cancellable', 'topup_paid'].includes(result.code) || result.status === 502) void reload()
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setLinkCopied(true)
      window.setTimeout(() => setLinkCopied(false), 2500)
    } catch {
      setLinkCopied(false)
    }
  }

  const cancelOrder = async () => {
    setCancelAsk(false)
    await run('cancel', () => api.cancel(token))
    // A cancelled order has nothing left to watch; it stays listed so its number and refund note remain reachable.
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-8 text-slate-900 dark:text-white">
            {copy('order_number_label', 'Order', 'ការបញ្ជាទិញ')} <span translate="no">{view.order_no}</span>
          </h1>
          <div className="text-xs leading-6 text-slate-500 dark:text-neutral-400" translate="no">{fmtDateTime24(view.created_at)}</div>
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold leading-6 text-slate-800 dark:bg-white/10 dark:text-neutral-100">{statusLabel(copy, view.status)}</span>
      </div>

      {actionError ? <Notice tone="error">{orderErrorMessage(copy, actionError)}</Notice> : null}

      {screen === 'pay' && view.payment ? (
        <div className={`${cardClass} space-y-4`}>
          <KhqrCard
            copy={copy}
            qrString={view.payment.qr_string}
            deeplink={view.payment.deeplink}
            amount={view.payment.amount}
            currency={view.payment.currency}
            expiresAt={view.payment.expires_at}
            skewMs={skewMs}
            orderNo={view.order_no}
          />
          <ol className="list-decimal space-y-1 ps-5 text-sm leading-relaxed text-slate-700 dark:text-neutral-200">
            <li>{copy('order_step_1', 'Open your bank app (ABA or any bank app that scans KHQR).', 'បើកកម្មវិធីធនាគារ (ABA ឬកម្មវិធីធនាគារណាមួយដែលស្កេន KHQR បាន)។')}</li>
            <li>{copy('order_step_2', 'Scan this QR and pay the exact amount.', 'ស្កេន QR នេះ ហើយបង់ចំនួនទឹកប្រាក់ឱ្យត្រូវ។')}</li>
            <li>{copy('order_step_3', 'This page updates by itself when we receive your payment.', 'ទំព័រនេះនឹងធ្វើបច្ចុប្បន្នភាពដោយខ្លួនឯង នៅពេលយើងទទួលបានការទូទាត់។')}</li>
          </ol>
          <p className="flex items-center justify-center gap-2 text-sm text-slate-600 dark:text-neutral-300"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{copy('order_waiting', 'Waiting for your payment…', 'កំពុងរង់ចាំអ្នកបង់ប្រាក់…')}</p>
        </div>
      ) : null}

      {screen === 'pay_expired' || screen === 'new_qr' ? (
        <div className={`${cardClass} space-y-3`}>
          <Notice tone="warn" icon={<AlertCircle className="h-4 w-4" />}>
            {view.status === 'qr_failed' || !view.payment
              ? copy('order_qr_missing', 'We could not get a QR for this order yet. Nothing was charged.', 'យើងមិនទាន់អាចទទួលបាន QR សម្រាប់ការបញ្ជាទិញនេះទេ។ មិនទាន់មានការកាត់ប្រាក់ទេ។')
              : copy('order_time_up', 'Time ran out. Nothing was charged.', 'អស់ពេលហើយ។ មិនទាន់មានការកាត់ប្រាក់ទេ។')}
          </Notice>
          <button type="button" className={primaryButtonClass} disabled={busy !== null} onClick={() => { void run('retry', () => api.retry(token)) }}>
            {busy === 'retry' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
            {copy('order_new_qr', 'Get a new QR', 'ទទួលយក QR ថ្មី')}
          </button>
        </div>
      ) : null}

      {screen === 'paid' ? (
        <Notice tone="success" icon={<CheckCircle2 className="h-5 w-5" />}>
          <div className="font-semibold">{copy('order_paid_title', 'Payment received. Thank you!', 'បានទទួលការទូទាត់។ សូមអរគុណ!')}</div>
          <div className="mt-1">{delivery
            ? copy('order_paid_delivery', 'Our staff will contact you about the delivery price and time.', 'បុគ្គលិករបស់យើងនឹងទាក់ទងអ្នកអំពីតម្លៃ និងពេលវេលាដឹកជញ្ជូន។')
            : copy('order_paid_pickup', 'Come to the shop to collect your order and show your order number.', 'សូមមកយកទំនិញនៅហាង ហើយបង្ហាញលេខការបញ្ជាទិញរបស់អ្នក។')}</div>
        </Notice>
      ) : null}
      {screen === 'review' ? (
        <Notice tone="warn" icon={<AlertCircle className="h-5 w-5" />}>{copy('order_review_text', 'We received your payment, but our staff need to check it. We will contact you. You do not need to pay again.', 'យើងបានទទួលការទូទាត់របស់អ្នកហើយ ប៉ុន្តែបុគ្គលិករបស់យើងត្រូវពិនិត្យវា។ យើងនឹងទាក់ទងអ្នក។ អ្នកមិនចាំបាច់បង់ម្តងទៀតទេ។')}</Notice>
      ) : null}
      {screen === 'cancelled' ? (
        <Notice tone="info" icon={<Info className="h-5 w-5" />}>{copy('order_cancelled_text', 'This order is cancelled.', 'ការបញ្ជាទិញនេះត្រូវបានបោះបង់។')}</Notice>
      ) : null}
      {screen === 'after_sale' ? (
        <Notice tone={view.status === 'sale_cancelled' ? 'info' : 'success'} icon={view.status === 'sale_cancelled' ? <Info className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}>
          {view.status === 'completed' ? copy('order_done_text', 'Your order is complete. Thank you for shopping with us!', 'ការបញ្ជាទិញរបស់អ្នកបានបញ្ចប់។ សូមអរគុណដែលបានទិញជាមួយយើង!')
            : view.status === 'balance_due' ? copy('order_balance_text', 'Your order is ready. {amount} is still to pay.', 'ការបញ្ជាទិញរបស់អ្នករួចរាល់ហើយ។ នៅសល់ {amount} ត្រូវបង់។').replace('{amount}', formatUsd(view.money.balance_due_usd))
              : view.status === 'delivery_pending' ? copy('order_delivery_text', 'Your order is with us and waiting for delivery. Our staff will contact you about the time.', 'ការបញ្ជាទិញរបស់អ្នកស្ថិតនៅជាមួយយើង ហើយកំពុងរង់ចាំការដឹកជញ្ជូន។ បុគ្គលិករបស់យើងនឹងទាក់ទងអ្នកអំពីពេលវេលា។')
                : copy('order_cancelled_text', 'This order is cancelled.', 'ការបញ្ជាទិញនេះត្រូវបានបោះបង់។')}
        </Notice>
      ) : null}

      {notes.map((note) => (
        <Notice key={note.kind} tone={note.kind === 'refunded' ? 'success' : 'info'}>
          {note.kind === 'refund_due' ? copy('order_money_refund_due', 'A refund of {amount} is due to you. The shop sends it through ABA.', 'ប្រាក់សងវិញចំនួន {amount} ត្រូវសងអ្នក។ ហាងនឹងផ្ញើវាតាម ABA។').replace('{amount}', formatUsd(note.amountUsd))
            : note.kind === 'refunded' ? copy('order_money_refunded', 'Refunded to you through ABA: {amount}.', 'បានសងអ្នកវិញតាម ABA៖ {amount}។').replace('{amount}', formatUsd(note.amountUsd))
              : copy('order_money_balance', 'Still to pay: {amount}.', 'នៅសល់ត្រូវបង់៖ {amount}។').replace('{amount}', formatUsd(note.amountUsd))}
        </Notice>
      ))}

      {view.top_ups.map((topUp) => (
        <div key={`${topUp.request_id}-${topUp.expires_at}`} className={`${cardClass} space-y-3`}>
          <h2 className="text-base font-semibold leading-7 text-slate-900 dark:text-neutral-100">{copy('order_topup_title', 'Pay {amount} more', 'បង់បន្ថែម {amount}').replace('{amount}', formatAmount(topUp.amount, topUp.currency))}</h2>
          <p className="text-sm leading-relaxed text-slate-600 dark:text-neutral-300">{copy('order_topup_text', 'The shop asked for an extra payment for the change you requested.', 'ហាងបានសុំការបង់ប្រាក់បន្ថែមសម្រាប់ការកែប្រែដែលអ្នកបានស្នើ។')}</p>
          <KhqrCard
            copy={copy}
            qrString={topUp.qr_string}
            deeplink={topUp.deeplink}
            amount={topUp.amount}
            currency={topUp.currency}
            expiresAt={topUp.expires_at}
            skewMs={skewMs}
            orderNo={view.order_no}
          />
          {secondsUntilExpiry(topUp.expires_at, now, skewMs) === 0 && topUp.request_id !== null ? (
            <button type="button" className={primaryButtonClass} disabled={busy !== null} onClick={() => { void run('topup', () => api.topUp(token, Number(topUp.request_id))) }}>
              {busy === 'topup' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
              {copy('order_new_qr', 'Get a new QR', 'ទទួលយក QR ថ្មី')}
            </button>
          ) : null}
        </div>
      ))}
      {topUpReceived && !hasTopUp ? <Notice tone="success" icon={<CheckCircle2 className="h-5 w-5" />}>{copy('order_topup_done', 'We received your extra payment. Thank you.', 'យើងបានទទួលការបង់ប្រាក់បន្ថែមរបស់អ្នក។ សូមអរគុណ។')}</Notice> : null}

      <section className={`${cardClass} space-y-3`} aria-labelledby="order-items-title">
        <h2 id="order-items-title" className="text-base font-semibold leading-7 text-slate-900 dark:text-neutral-100">{copy('order_items_label', 'Your items', 'ទំនិញរបស់អ្នក')}</h2>
        <ul className="space-y-2">
          {view.items.map((item) => (
            <li key={item.product_id} className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1"><ProductName name={item.name} /></div>
              <div className="shrink-0 text-right text-sm leading-6 text-slate-700 dark:text-neutral-200" translate="no">{item.quantity} × {formatUsd(item.unit_price_usd)}</div>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-sm font-semibold dark:border-white/10">
          <span>{copy('order_total_goods', 'Total for the goods', 'តម្លៃសរុបនៃទំនិញ')}</span>
          <span translate="no">{formatUsd(view.total_usd)}</span>
        </div>
        {delivery ? <p className="text-xs leading-6 text-slate-500 dark:text-neutral-400">{copy('order_delivery_notice', 'For delivery, our staff will contact you about the delivery price and time. The QR covers the goods only.', 'សម្រាប់ការដឹកជញ្ជូន បុគ្គលិករបស់យើងនឹងទាក់ទងអ្នកអំពីតម្លៃ និងពេលវេលាដឹកជញ្ជូន។ QR គិតតែថ្លៃទំនិញប៉ុណ្ណោះ។')}</p> : null}
      </section>

      <section className={`${cardClass} space-y-2`} aria-labelledby="order-details-title">
        <div className="flex items-center justify-between gap-2">
          <h2 id="order-details-title" className="text-base font-semibold leading-7 text-slate-900 dark:text-neutral-100">{copy('order_details_title', 'Your details', 'ព័ត៌មានរបស់អ្នក')}</h2>
          {view.can_edit ? (
            <div className="flex items-center gap-1">
              <button type="button" className={iconButtonClass} onClick={() => setEditing(true)} aria-label={copy('order_edit_title', 'Change your order', 'កែប្រែការបញ្ជាទិញរបស់អ្នក')} title={copy('order_edit_title', 'Change your order', 'កែប្រែការបញ្ជាទិញរបស់អ្នក')}>
                <Pencil className="h-5 w-5" aria-hidden="true" />
              </button>
              {view.can_cancel ? (
                <button type="button" className={`${iconButtonClass} !text-rose-600 dark:!text-rose-300`} onClick={() => setCancelAsk(true)} disabled={busy !== null} aria-label={copy('order_cancel', 'Cancel order', 'បោះបង់ការបញ្ជាទិញ')} title={copy('order_cancel', 'Cancel order', 'បោះបង់ការបញ្ជាទិញ')}>
                  <Trash2 className="h-5 w-5" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <dl className="space-y-1 text-sm leading-relaxed">
          <Detail label={copy('order_name', 'Your name', 'ឈ្មោះរបស់អ្នក')}><span {...getKhmerTextProps(view.name, '[overflow-wrap:anywhere]')}>{view.name}</span></Detail>
          <Detail label={copy('order_phone', 'Phone number', 'លេខទូរស័ព្ទ')}><span translate="no">{view.phone_hint}</span></Detail>
          <Detail label={copy('order_how_short', 'Pickup or delivery', 'មកយក ឬដឹកជញ្ជូន')}>{delivery ? copy('order_delivery', 'Delivery', 'ដឹកជញ្ជូន') : copy('order_pickup', 'Pickup at the shop', 'មកយកនៅហាង')}</Detail>
          {view.address ? <Detail label={copy('order_address', 'Delivery address', 'អាសយដ្ឋានដឹកជញ្ជូន')}><span {...getKhmerTextProps(view.address, '[overflow-wrap:anywhere]')}>{view.address}</span></Detail> : null}
          {savedContacts.map((field) => (
            <Detail key={field} label={field === 'other' ? copy('order_contact_other', 'Other', 'ផ្សេងៗ') : CONTACT_LABELS[field]}><span translate="no" className="[overflow-wrap:anywhere]">{view.contacts[field]}</span></Detail>
          ))}
          {view.note ? <Detail label={copy('order_note_short', 'Note', 'កំណត់ចំណាំ')}><span {...getKhmerTextProps(view.note, '[overflow-wrap:anywhere]')}>{view.note}</span></Detail> : null}
        </dl>
      </section>

      {PAID_STATUSES.has(view.status) ? (
        <Suspense fallback={null}>
          <OrderRequests copy={copy} api={api} token={token} order={view} onChanged={(next) => accept(next)} />
        </Suspense>
      ) : null}

      <div className="flex items-center justify-between gap-3 pb-2 text-xs leading-6 text-slate-500 dark:text-neutral-400">
        <span>{copy('order_keep_link', 'Keep this page address to come back to your order.', 'សូមរក្សាទុកអាសយដ្ឋានទំព័រនេះ ដើម្បីត្រឡប់មកមើលការបញ្ជាទិញរបស់អ្នក។')}</span>
        <button type="button" className={iconButtonClass} onClick={() => { void copyLink() }} aria-label={copy('order_copy_link', 'Copy link', 'ចម្លងតំណ')} title={linkCopied ? copy('bucketCopied', 'Copied!', 'បានចម្លង!') : copy('order_copy_link', 'Copy link', 'ចម្លងតំណ')}>
          {linkCopied ? <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> : <Copy className="h-5 w-5" aria-hidden="true" />}
        </button>
      </div>

      {editing ? (
        <Suspense fallback={null}>
          <OrderEditSheet
            copy={copy}
            api={api}
            token={token}
            order={view}
            onClose={() => setEditing(false)}
            onSaved={(next) => { setEditing(false); if (next) accept(next); else void reload() }}
          />
        </Suspense>
      ) : null}

      {cancelAsk ? (
        <ConfirmDialog
          title={copy('order_cancel_title', 'Cancel this order?', 'បោះបង់ការបញ្ជាទិញនេះ?')}
          items={[
            { label: copy('order_req_order_status', 'Order', 'ការបញ្ជាទិញ'), value: `${statusLabel(copy, view.status)} → ${copy('order_status_cancelled', 'Cancelled', 'បានបោះបង់')}` },
            { label: copy('order_total_goods', 'Total for the goods', 'តម្លៃសរុបនៃទំនិញ'), value: formatUsd(view.total_usd) },
          ]}
          note={copy('order_cancel_note', 'Nothing was charged. The QR stops working.', 'មិនទាន់មានការកាត់ប្រាក់ទេ។ QR នឹងឈប់ដំណើរការ។')}
          confirmLabel={copy('order_cancel', 'Cancel order', 'បោះបង់ការបញ្ជាទិញ')}
          cancelLabel={copy('back', 'Back', 'ត្រឡប់')}
          danger
          onConfirm={() => { void cancelOrder() }}
          onClose={() => setCancelAsk(false)}
        />
      ) : null}
    </div>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-slate-500 dark:text-neutral-400">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">{children}</dd>
    </div>
  )
}

