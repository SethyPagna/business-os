import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js'
import Check from 'lucide-react/dist/esm/icons/check.js'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import HandCoins from 'lucide-react/dist/esm/icons/hand-coins.js'
import Inbox from 'lucide-react/dist/esm/icons/inbox.js'
import PackageCheck from 'lucide-react/dist/esm/icons/package-check.js'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import StickyNote from 'lucide-react/dist/esm/icons/sticky-note.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import { useApp as useAppHook } from '../../AppContext.tsx'
import ConfirmDialog from '../shared/ConfirmDialog.tsx'
import { Button, ChipRail, EmptyState, RailChip, Skeleton } from '../shared/kit/index.ts'
import { fmtDateTime24 } from '../../utils/formatters.ts'
import { getKhmerTextProps } from '../../utils/scriptTypography.ts'
import {
  applyOnlineOrderRequest, cancelOnlineOrder, decideOnlineOrderRequest, getOnlineOrder, listOnlineOrders, noteOnlineOrder, noteOnlineOrderRefund, recheckOnlineOrder, resolveOnlineOrder,
} from './onlineOrdersApi.ts'
import {
  DEFAULT_ORDER_FILTER, FIRST_PAGE, FULFIL_HANDOFF_KEY, ORDER_FILTERS, applyBody, availableActions, cancelBody, currentCursor, decideBody, fulfilHandoff, itemLine, SEARCH_MAX, searchState,
  nextTrail, noteBody, orderAccess, pageNumber, parseItems, previousTrail, refundBody, refundProblem, requestChanges, requestCanBeApplied, requestIsPending, resolveBody, rowChips,
  stateChip, staffMessage, type OrderAccess, type OrderChip, type OrderFilter, type PageTrail, type RequestChange, type StaffOrderDetail, type StaffOrderPage, type StaffOrderRow, type StaffRequest,
} from './onlineOrdersLogic.ts'

// The staff Orders screen (KHQR G6): the orders customers paid for on the website, what each needs, and every action the Worker offers. It is a section of the Sales hub,
// loaded only when opened. Phone: the list, then the order replaces it with a Back button; desktop: the two side by side. Every action is a short confirmation that shows the
// value before and after, and every refusal reads as a sentence in the staff language (staffErrorKey), never as a code.

type OrdersAppContext = {
  t: (key: string, fallback?: string) => string
  can: (key: string, action: string) => boolean
  navigateTo: (pageId: string, anchor?: string) => void
}
const useApp = useAppHook as unknown as () => OrdersAppContext
type Tx = (key: string, fallback: string) => string

const usd = (value: unknown): string => `$${(Math.round(Number(value || 0) * 100) / 100).toFixed(2)}`
const CHIP_CLASS: Record<OrderChip['tone'], string> = {
  todo: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-100',
  wait: 'bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-100',
  warn: 'bg-rose-100 text-rose-900 dark:bg-rose-400/15 dark:text-rose-100',
  done: 'bg-sky-100 text-sky-900 dark:bg-sky-400/15 dark:text-sky-100',
  muted: 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-neutral-200',
}
const cardClass = 'rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-neutral-900'

function chipLabel(tt: Tx, chip: OrderChip): string {
  const base = ({
    to_fulfil: tt('oo_chip_to_fulfil', 'To fulfil'),
    needs_review: tt('oo_chip_needs_review', 'Needs review'),
    not_paid: tt('oo_chip_not_paid', 'Not paid yet'),
    qr_failed: tt('oo_chip_qr_failed', 'QR failed'),
    expired: tt('oo_chip_expired', 'Expired'),
    cancelled: tt('oo_chip_cancelled', 'Cancelled'),
    fulfilled: tt('oo_chip_fulfilled', 'Fulfilled'),
    requests: tt('oo_chip_requests', 'Request'),
    refund_due: tt('oo_chip_refund_due', 'Refund due'),
  } as Record<string, string>)[chip.id] ?? chip.id
  return chip.count && chip.count > 1 ? `${base} ${chip.count}` : base
}
function Chip({ tt, chip }: { tt: Tx; chip: OrderChip }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold leading-6 ${CHIP_CLASS[chip.tone]}`}>{chipLabel(tt, chip)}</span>
}

function filterLabel(tt: Tx, filter: OrderFilter): string {
  switch (filter) {
    case 'attention': return tt('oo_filter_attention', 'To do')
    case 'paid': return tt('oo_filter_paid', 'To fulfil')
    case 'review': return tt('oo_filter_review', 'Needs review')
    case 'requests': return tt('oo_filter_requests', 'Requests')
    case 'refund_due': return tt('oo_filter_refund_due', 'Refund due')
    case 'awaiting_payment': return tt('oo_filter_not_paid', 'Not paid yet')
    case 'fulfilled': return tt('oo_filter_fulfilled', 'Fulfilled')
    case 'expired': return tt('oo_filter_expired', 'Expired')
    case 'qr_failed': return tt('oo_filter_qr_failed', 'QR failed')
    case 'cancelled': return tt('oo_filter_cancelled', 'Cancelled')
    default: return tt('oo_filter_all', 'All')
  }
}

const fulfilmentLabel = (tt: Tx, value: unknown): string => (value === 'delivery' ? tt('oo_delivery', 'Delivery') : tt('oo_pickup', 'Pickup'))

// ---- the page ------------------------------------------------------------------------------------------------------------------

export default function OnlineOrdersPage({ embedded = false }: { embedded?: boolean }) {
  const { t, can } = useApp()
  const tt: Tx = useCallback((key: string, fallback: string) => { const value = t(key); return value && value !== key ? value : fallback }, [t])
  const access = orderAccess(can)
  const [filter, setFilter] = useState<OrderFilter>(DEFAULT_ORDER_FILTER)
  const [trail, setTrail] = useState<PageTrail>(FIRST_PAGE)
  const [page, setPage] = useState<StaffOrderPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const search = searchState(query)
  const searching = search.kind === 'ok'
  const searchKey = search.kind === 'ok' ? search.q : ''

  useEffect(() => {
    if (!access.canView) return undefined
    const controller = new AbortController()
    setLoading(true)
    setFailed(null)
    listOnlineOrders(filter, searching ? search.q : null, currentCursor(trail), controller.signal)
      .then((answer) => { if (!controller.signal.aborted) { setPage(answer); setLoading(false) } })
      .catch((error: { code?: unknown; name?: string }) => {
        if (controller.signal.aborted || error?.name === 'AbortError') return
        setFailed(String(error?.code || 'unknown'))
        setLoading(false)
      })
    return () => controller.abort()
  }, [access.canView, filter, trail, reloadTick, searchKey])

  // The box asks the Worker once typing pauses; a new search starts again at page 1.
  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery((current) => { if (current !== typed) setTrail(FIRST_PAGE); return typed }) }, 350)
    return () => window.clearTimeout(timer)
  }, [typed])
  const changeFilter = (next: OrderFilter) => { setFilter(next); setTrail(FIRST_PAGE); setTyped(''); setQuery('') }
  const refresh = () => setReloadTick((n) => n + 1)
  const rows = useMemo(() => page?.rows ?? [], [page])

  if (!access.canView) {
    return <div className="p-6"><EmptyState icon={<Inbox />} title={staffMessage(tt, 'forbidden')} /></div>
  }

  return (
    <div data-online-orders-page className={`${embedded ? '' : 'page-scroll '}flex flex-col gap-3 p-3 sm:p-6`}>
      <div className={selected !== null ? 'hidden md:block' : ''}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <ChipRail label={tt('oo_filters_label', 'Show orders')}>
              {ORDER_FILTERS.map((id) => <RailChip key={id} selected={!searching && filter === id} onClick={() => changeFilter(id)}>{filterLabel(tt, id)}</RailChip>)}
            </ChipRail>
          </div>
          <Button variant="ghost" size="sm" onClick={refresh} aria-label={tt('oo_refresh', 'Refresh')} title={tt('oo_refresh', 'Refresh')} icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />} />
        </div>
        <div className="mt-2">
          <label className="block text-xs font-semibold leading-6 text-slate-600 dark:text-neutral-300" htmlFor="oo-search">{tt('oo_search_label', 'Find by order number or phone')}</label>
          <input
            id="oo-search"
            type="search"
            inputMode="search"
            autoComplete="off"
            value={typed}
            maxLength={SEARCH_MAX}
            onChange={(event) => setTyped(event.target.value)}
            className="mt-1 min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm leading-6 text-slate-900 dark:border-white/20 dark:bg-neutral-900 dark:text-neutral-100"
          />
          {searchState(typed).kind === 'short' ? <p className="mt-1 text-xs leading-6 text-slate-500 dark:text-neutral-400">{tt('oo_search_short', 'Type at least 3 letters or digits to search.')}</p> : null}
        </div>
      </div>

      <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <div className={`min-w-0 ${selected !== null ? 'hidden md:block' : ''}`}>
          {loading && !page ? <Skeleton rows={6} /> : null}
          {failed ? (
            <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm leading-6 text-rose-900 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-100">
              <p>{failed === 'unknown' ? tt('oo_load_failed', 'The orders could not be loaded.') : staffMessage(tt, failed)}</p>
              <Button className="mt-2" variant="secondary" size="sm" onClick={refresh}>{tt('oo_retry', 'Try again')}</Button>
            </div>
          ) : null}
          {page && !failed ? (
            rows.length === 0 ? (
              <EmptyState
                icon={<Inbox />}
                title={searching ? tt('oo_no_match', 'No order matches.') : tt('oo_empty_title', 'No orders here')}
                text={searching ? undefined : tt('oo_empty_text', 'Orders that customers pay for on the website appear here.')}
              />
            ) : (
              <ul className="space-y-2" aria-busy={loading || undefined}>
                {rows.map((row) => <OrderRowItem key={row.id} tt={tt} row={row} active={selected === row.id} onOpen={() => setSelected(row.id)} />)}
              </ul>
            )
          ) : null}
          {page ? (
            <div className="mt-3 flex items-center justify-between gap-2">
              <Button variant="secondary" size="sm" className="whitespace-nowrap" disabled={pageNumber(trail) <= 1 || loading} onClick={() => setTrail(previousTrail(trail))} icon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />}>{tt('oo_prev', 'Previous')}</Button>
              <span className="text-xs font-semibold leading-6 text-slate-600 dark:text-neutral-300">{tt('oo_page', 'Page {page}').replace('{page}', String(pageNumber(trail)))}</span>
              <Button variant="secondary" size="sm" className="whitespace-nowrap" disabled={!page.next_cursor || loading} onClick={() => setTrail(nextTrail(trail, page.next_cursor))}>
                {tt('oo_next', 'Next')}
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ) : null}
        </div>

        <div className="min-w-0">
          {selected !== null ? (
            <OrderDetail key={selected} id={selected} tt={tt} access={access} onBack={() => setSelected(null)} onChanged={refresh} />
          ) : (
            <div className="hidden md:block"><EmptyState icon={<Inbox />} title={tt('oo_pick_title', 'Pick an order')} text={tt('oo_pick_text', 'Its details and what you can do with it show here.')} /></div>
          )}
        </div>
      </div>
    </div>
  )
}

function OrderRowItem({ tt, row, active, onOpen }: { tt: Tx; row: StaffOrderRow; active: boolean; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        data-online-order-row={row.id}
        onClick={onOpen}
        aria-current={active ? 'true' : undefined}
        className={`block w-full rounded-2xl border p-3 text-left shadow-sm transition ${active ? 'border-emerald-500 bg-emerald-50 dark:border-emerald-400 dark:bg-emerald-400/10' : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-white/10 dark:bg-neutral-900 dark:hover:bg-white/5'}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-bold leading-6 text-slate-900 dark:text-neutral-100" translate="no">{row.order_no}</span>
          <span className="flex flex-wrap gap-1">{rowChips(row).map((chip) => <Chip key={chip.id} tt={tt} chip={chip} />)}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 text-sm leading-6 text-slate-700 dark:text-neutral-200">
          <span {...getKhmerTextProps(row.customer_name, 'min-w-0 [overflow-wrap:anywhere]')}>{row.customer_name}</span>
          <span translate="no">{usd(row.goods_total_usd)}</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs leading-6 text-slate-500 dark:text-neutral-400">
          <span translate="no">{row.customer_phone}</span>
          <span>{fulfilmentLabel(tt, row.fulfilment)} · <span translate="no">{fmtDateTime24(row.created_at)}</span></span>
        </div>
      </button>
    </li>
  )
}

// ---- one order -------------------------------------------------------------------------------------------------------------------

type Dialog =
  | { kind: 'cancel' }
  | { kind: 'resolve' }
  | { kind: 'refund' }
  | { kind: 'note' }
  | { kind: 'decide'; request: StaffRequest; decision: 'accept' | 'reject' }
  | { kind: 'apply'; request: StaffRequest }
  | { kind: 'fulfil' }

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-sm font-semibold leading-6 text-slate-800 dark:text-neutral-100">{label}<span className="mt-1 block font-normal">{children}</span></label>
}
const inputClass = 'min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900 dark:border-white/20 dark:bg-neutral-900 dark:text-neutral-100'

function OrderDetail({ id, tt, access, onBack, onChanged }: { id: number; tt: Tx; access: OrderAccess; onBack: () => void; onChanged: () => void }) {
  const { navigateTo, can } = useApp()
  const [detail, setDetail] = useState<StaffOrderDetail | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  // dialog fields
  const [textA, setTextA] = useState('')
  const [textB, setTextB] = useState('')
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const load = useCallback(async () => {
    try {
      const answer = await getOnlineOrder(id)
      if (alive.current) { setDetail(answer); setFailed(null) }
    } catch (error) {
      if (alive.current) setFailed(String((error as { code?: unknown })?.code || 'unknown'))
    }
  }, [id])
  useEffect(() => { void load() }, [load])

  const close = () => { setDialog(null); setTextA(''); setTextB(''); setAmount(''); setReference(''); setProblem(null) }
  const open = (next: Dialog, preset?: { amount?: string }) => { close(); setDone(null); if (preset?.amount) setAmount(preset.amount); setDialog(next) }
  const run = async (work: () => Promise<unknown>, success: string | ((result: any) => string)) => {
    setBusy(true)
    setProblem(null)
    try {
      const result = await work()
      if (!alive.current) return
      close()
      setDone(typeof success === 'function' ? success(result) : success)
      await load()
      onChanged()
    } catch (error) {
      if (alive.current) setProblem(staffMessage(tt, (error as { code?: unknown })?.code))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  if (failed) {
    return (
      <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm leading-6 text-rose-900 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-100">
        <p>{failed === 'unknown' ? tt('oo_load_failed', 'The orders could not be loaded.') : staffMessage(tt, failed)}</p>
        <div className="mt-2 flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => void load()}>{tt('oo_retry', 'Try again')}</Button>
          <Button variant="ghost" size="sm" onClick={onBack}>{tt('oo_back_list', 'Back to the list')}</Button>
        </div>
      </div>
    )
  }
  if (!detail) return <Skeleton rows={6} />

  const { order, money, payments, requests, events } = detail
  // Fulfil is a sale, so it needs the till as well as the order (the Worker refuses online_order_id without the sales grant).
  const actions = availableActions(detail, access).filter((action) => action !== 'fulfil' || can('pos', 'view'))
  const items = parseItems(order.items_json)
  const refundDue = Number(money.refund_due_usd ?? 0)
  const heldPayments = payments.filter((p) => p.state === 'review')
  const heldUsd = heldPayments.reduce((sum, p) => sum + Number(p.paid_amount ?? 0), 0)
  const pending = requests.filter(requestIsPending)
  const chips: OrderChip[] = [stateChip(order.state)]
  if (pending.length) chips.push({ id: 'requests', tone: 'todo', count: pending.length })
  if (refundDue > 0) chips.push({ id: 'refund_due', tone: 'warn' })
  const revision = Number(order.revision)
  const text = (value: unknown) => (value === null || value === undefined ? '' : String(value))

  const statusWord = (state: string) => chipLabel(tt, stateChip(state))
  const refundIssue = dialog?.kind === 'refund' ? refundProblem(amount, refundDue) : null

  return (
    <div className="space-y-3" data-online-order-detail={id}>
      <div className="flex flex-wrap items-center gap-2">
        <Button className="md:hidden" variant="ghost" size="sm" onClick={onBack} icon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}>{tt('oo_back_list', 'Back to the list')}</Button>
        <h2 className="text-lg font-bold leading-8 text-slate-900 dark:text-neutral-100" translate="no">{text(order.order_no)}</h2>
        <span className="flex flex-wrap gap-1">{chips.map((chip) => <Chip key={chip.id} tt={tt} chip={chip} />)}</span>
        <span className="ml-auto text-xs leading-6 text-slate-500 dark:text-neutral-400" translate="no">{fmtDateTime24(text(order.created_at))}</span>
      </div>

      {done ? <div role="status" className="rounded-xl bg-emerald-50 p-2.5 text-sm leading-6 text-emerald-900 dark:bg-emerald-400/10 dark:text-emerald-100">{done}</div> : null}

      {heldPayments.length ? (
        <div className="rounded-xl bg-rose-50 p-2.5 text-sm leading-6 text-rose-900 dark:bg-rose-400/10 dark:text-rose-100">{(order.state === 'review'
          ? tt('oo_review_banner', 'A payment came in that does not match this order: {amount} is held. Check it in ABA, then accept it or cancel the order.')
          : tt('oo_review_banner_late', 'A payment came in on this order that needs a look: {amount} is held. Check it in ABA, then accept it or send it back.')).replace('{amount}', usd(heldUsd))}</div>
      ) : null}
      {refundDue > 0 ? (
        <div className="rounded-xl bg-amber-50 p-2.5 text-sm leading-6 text-amber-900 dark:bg-amber-400/10 dark:text-amber-100">{tt('oo_refund_banner', 'A refund of {amount} is due to the customer. Send it from the ABA app, then record it here.').replace('{amount}', usd(refundDue))}</div>
      ) : null}
      {order.sale_id != null ? <div className="rounded-xl bg-sky-50 p-2.5 text-sm leading-6 text-sky-900 dark:bg-sky-400/10 dark:text-sky-100">{tt('oo_has_sale', 'This order was handed over. Changes now go through its sale.')}</div> : null}

      {actions.length ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label={tt('oo_actions', 'What you can do')}>
          {actions.includes('fulfil') ? (
            <Button variant="primary" icon={<PackageCheck className="h-4 w-4" aria-hidden="true" />} onClick={() => open({ kind: 'fulfil' })}>{tt('oo_act_fulfil', 'Fulfil')}</Button>
          ) : null}
          {actions.includes('resolve') ? <Button variant="primary" icon={<Check className="h-4 w-4" aria-hidden="true" />} onClick={() => open({ kind: 'resolve' })}>{tt('oo_act_accept', 'Accept')}</Button> : null}
          {actions.includes('refund') ? <Button variant="secondary" icon={<HandCoins className="h-4 w-4" aria-hidden="true" />} onClick={() => open({ kind: 'refund' }, { amount: refundDue.toFixed(2) })}>{tt('oo_act_refund', 'Refund')}</Button> : null}
          {actions.includes('recheck') ? (
            <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />} loading={busy && !dialog} onClick={() => void run(() => recheckOnlineOrder(id), (result: { checked: number }) => tt('oo_checked', 'Checked with ABA: {n} payment(s).').replace('{n}', String(result.checked)))}>{tt('oo_act_check', 'Check')}</Button>
          ) : null}
          {actions.includes('note') ? <Button variant="secondary" icon={<StickyNote className="h-4 w-4" aria-hidden="true" />} onClick={() => open({ kind: 'note' })}>{tt('oo_act_note', 'Note')}</Button> : null}
          {actions.includes('cancel') ? <Button variant="secondary" icon={<X className="h-4 w-4" aria-hidden="true" />} onClick={() => open({ kind: 'cancel' })}>{tt('oo_act_cancel', 'Cancel')}</Button> : null}
        </div>
      ) : null}
      {problem && !dialog ? <div role="alert" className="rounded-xl bg-rose-50 p-2.5 text-sm leading-6 text-rose-900 dark:bg-rose-400/10 dark:text-rose-100">{problem}</div> : null}

      <section className={cardClass} aria-label={tt('oo_customer', 'Customer')}>
        <h3 className="text-sm font-semibold leading-6 text-slate-900 dark:text-neutral-100">{tt('oo_customer', 'Customer')}</h3>
        <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm leading-6">
          <dt className="text-slate-500 dark:text-neutral-400">{tt('oo_name', 'Name')}</dt><dd {...getKhmerTextProps(text(order.customer_name), '[overflow-wrap:anywhere]')}>{text(order.customer_name)}</dd>
          <dt className="text-slate-500 dark:text-neutral-400">{tt('oo_phone', 'Phone')}</dt><dd translate="no">{text(order.customer_phone)}</dd>
          <dt className="text-slate-500 dark:text-neutral-400">{tt('oo_how', 'Pickup or delivery')}</dt><dd>{fulfilmentLabel(tt, order.fulfilment)}</dd>
          {order.customer_address ? <><dt className="text-slate-500 dark:text-neutral-400">{tt('oo_address', 'Address')}</dt><dd {...getKhmerTextProps(text(order.customer_address), '[overflow-wrap:anywhere]')}>{text(order.customer_address)}</dd></> : null}
          {(['telegram', 'instagram', 'facebook', 'tiktok', 'whatsapp', 'other'] as const).filter((f) => order[`contact_${f}`]).map((f) => (
            <><dt key={`${f}-k`} className="text-slate-500 dark:text-neutral-400">{f === 'other' ? tt('oo_contact_other', 'Other contact') : f.charAt(0).toUpperCase() + f.slice(1)}</dt><dd key={`${f}-v`} translate="no" className="[overflow-wrap:anywhere]">{text(order[`contact_${f}`])}</dd></>
          ))}
          {order.note ? <><dt className="text-slate-500 dark:text-neutral-400">{tt('oo_customer_note', 'Customer note')}</dt><dd {...getKhmerTextProps(text(order.note), '[overflow-wrap:anywhere]')}>{text(order.note)}</dd></> : null}
        </dl>
      </section>

      <section className={cardClass} aria-label={tt('oo_items', 'Items')}>
        <h3 className="text-sm font-semibold leading-6 text-slate-900 dark:text-neutral-100">{tt('oo_items', 'Items')}</h3>
        <ul className="mt-1 space-y-0.5 text-sm leading-6">
          {items.map((item, index) => (
            <li key={`${item.product_id}-${index}`} className="flex items-start justify-between gap-3">
              <span {...getKhmerTextProps(itemLine(item), 'min-w-0 [overflow-wrap:anywhere]')}>{itemLine(item)}</span>
              <span translate="no" className="shrink-0">{usd(item.line_total_usd ?? Number(item.unit_price_usd ?? 0) * Number(item.quantity ?? 0))}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-sm font-semibold dark:border-white/10"><span>{tt('oo_total', 'Total for the goods')}</span><span translate="no">{usd(order.goods_total_usd)}</span></div>
        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 text-sm leading-6 text-slate-700 dark:text-neutral-200">
          <dt>{tt('oo_paid', 'Paid')}</dt><dd translate="no">{usd(money.paid_usd)}</dd>
          {Number(money.refunded_usd ?? 0) > 0 ? <><dt>{tt('oo_refunded', 'Refunded')}</dt><dd translate="no">{usd(money.refunded_usd)}</dd></> : null}
          {refundDue > 0 ? <><dt>{tt('oo_refund_due', 'Refund due')}</dt><dd translate="no">{usd(refundDue)}</dd></> : null}
          {Number(money.balance_due_usd ?? 0) > 0 ? <><dt>{tt('oo_balance_due', 'Still to pay')}</dt><dd translate="no">{usd(money.balance_due_usd)}</dd></> : null}
        </dl>
      </section>

      {requests.length ? (
        <section className={cardClass} aria-label={tt('oo_requests', 'Customer requests')}>
          <h3 className="text-sm font-semibold leading-6 text-slate-900 dark:text-neutral-100">{tt('oo_requests', 'Customer requests')}</h3>
          <ul className="mt-2 space-y-3">
            {requests.map((request) => (
              <RequestItem
                key={request.id}
                tt={tt}
                request={request}
                canDecide={access.canDecide}
                canApply={access.canDecide && requestCanBeApplied(request, order)}
                onDecide={(decision) => open({ kind: 'decide', request, decision })}
                onApply={() => open({ kind: 'apply', request })}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <section className={cardClass} aria-label={tt('oo_payments', 'Payments')}>
        <h3 className="text-sm font-semibold leading-6 text-slate-900 dark:text-neutral-100">{tt('oo_payments', 'Payments')}</h3>
        {payments.length === 0 ? <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">{tt('oo_no_payments', 'No payment was started.')}</p> : (
          <ul className="mt-1 space-y-1 text-sm leading-6">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-3">
                <span>{p.purpose === 'top_up' ? tt('oo_pay_topup', 'Extra payment') : tt('oo_pay_order', 'Order payment')} <span translate="no">{usd(p.amount)}</span></span>
                <span className="text-slate-600 dark:text-neutral-300">{paymentStateLabel(tt, p.state)}{p.state === 'review' && p.paid_amount ? <> · <span translate="no">{usd(p.paid_amount)}</span></> : null}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={cardClass} aria-label={tt('oo_history', 'History')}>
        <h3 className="text-sm font-semibold leading-6 text-slate-900 dark:text-neutral-100">{tt('oo_history', 'History')}</h3>
        <ol className="mt-1 space-y-1.5 text-sm leading-6">
          {[...events].reverse().map((event) => (
            <li key={event.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-medium">{eventLabel(tt, event.event)}{event.actor_name ? <span className="font-normal text-slate-500 dark:text-neutral-400"> · {event.actor_name}</span> : null}</span>
                <span className="text-xs text-slate-500 dark:text-neutral-400" translate="no">{fmtDateTime24(event.created_at)}</span>
              </div>
              {event.public_comment ? <p className="text-slate-600 dark:text-neutral-300" {...getKhmerTextProps(event.public_comment, '[overflow-wrap:anywhere]')}>{event.public_comment}</p> : null}
              {event.internal_note ? <p className="text-slate-500 italic dark:text-neutral-400" {...getKhmerTextProps(event.internal_note, '[overflow-wrap:anywhere]')}>{event.internal_note}</p> : null}
            </li>
          ))}
        </ol>
      </section>

      {dialog ? (
        <ActionDialog
          tt={tt}
          dialog={dialog}
          detail={detail}
          busy={busy}
          problem={problem}
          textA={textA}
          textB={textB}
          amount={amount}
          reference={reference}
          refundIssue={refundIssue}
          setTextA={setTextA}
          setTextB={setTextB}
          setAmount={setAmount}
          setReference={setReference}
          statusWord={statusWord}
          heldUsd={heldUsd}
          onClose={() => { if (!busy) close() }}
          onConfirm={() => {
            if (dialog.kind === 'cancel') void run(() => cancelOnlineOrder(id, cancelBody(textA, revision) as { reason?: string; revision: number }), tt('oo_done_cancel', 'The order is cancelled.'))
            else if (dialog.kind === 'resolve') void run(() => resolveOnlineOrder(id, resolveBody(textA, revision) as { note?: string; revision: number }), tt('oo_done_resolve', 'The payment is accepted. The order is ready to fulfil.'))
            else if (dialog.kind === 'note') void run(() => noteOnlineOrder(id, noteBody(textA)), tt('oo_done_note', 'Note saved.'))
            else if (dialog.kind === 'refund') void run(() => noteOnlineOrderRefund(id, refundBody(amount, reference, textA) as { amount_usd: number; reference?: string; note?: string }), tt('oo_done_refund', 'Refund recorded.'))
            else if (dialog.kind === 'decide') void run(() => decideOnlineOrderRequest(id, dialog.request.id, decideBody(dialog.decision, textA, textB) as { decision: 'accept' | 'reject' }), dialog.decision === 'accept' ? tt('oo_done_accept', 'Request accepted. Apply it to the order next.') : tt('oo_done_reject', 'Request rejected.'))
            else if (dialog.kind === 'apply') void run(() => applyOnlineOrderRequest(id, dialog.request.id, applyBody(revision)), (result: { top_up_usd: number }) => (Number(result.top_up_usd) > 0 ? tt('oo_done_apply_topup', 'Applied. The customer pays {amount} more.').replace('{amount}', usd(result.top_up_usd)) : tt('oo_done_apply', 'Applied to the order.')))
            else if (dialog.kind === 'fulfil') {
              try { window.sessionStorage.setItem(FULFIL_HANDOFF_KEY, JSON.stringify(fulfilHandoff(detail))) } catch { /* the till then opens empty */ }
              close()
              navigateTo('pos')
            }
          }}
        />
      ) : null}
    </div>
  )
}

// ---- pieces ----------------------------------------------------------------------------------------------------------------------

function paymentStateLabel(tt: Tx, state: string): string {
  return ({
    awaiting: tt('oo_pstate_awaiting', 'Waiting for the customer'),
    paid: tt('oo_pstate_paid', 'Paid'),
    expired: tt('oo_pstate_expired', 'Time ran out'),
    cancelled: tt('oo_pstate_cancelled', 'Cancelled'),
    review: tt('oo_pstate_review', 'Held for review'),
    failed: tt('oo_pstate_failed', 'Declined'),
  } as Record<string, string>)[state] ?? state
}

function eventLabel(tt: Tx, event: string): string {
  const labels: Record<string, string> = {
    created: tt('oo_ev_created', 'Order placed'),
    edited: tt('oo_ev_edited', 'Customer changed the order'),
    order_edited: tt('oo_ev_edited', 'Customer changed the order'),
    qr_issued: tt('oo_ev_qr_issued', 'QR made'),
    qr_failed: tt('oo_ev_qr_failed', 'QR could not be made'),
    callback: tt('oo_ev_callback', 'ABA told us about a payment'),
    verified_paid: tt('oo_ev_paid', 'Payment confirmed'),
    late_paid: tt('oo_ev_late_paid', 'Payment came in late'),
    mismatch: tt('oo_ev_mismatch', 'Payment does not match'),
    expired: tt('oo_ev_expired', 'Time ran out'),
    cancelled: tt('oo_ev_cancelled', 'Order cancelled'),
    resolved: tt('oo_ev_resolved', 'Held payment accepted'),
    fulfilled: tt('oo_ev_fulfilled', 'Order handed over'),
    payment_recorded_on_sale: tt('oo_ev_on_sale', 'Payment recorded on the sale'),
    refund_noted: tt('oo_ev_refund', 'Refund recorded'),
    request_submitted: tt('oo_ev_request', 'Customer sent a request'),
    request_withdrawn: tt('oo_ev_withdrawn', 'Customer took the request back'),
    request_accepted: tt('oo_ev_accepted', 'Request accepted'),
    request_rejected: tt('oo_ev_rejected', 'Request rejected'),
    request_applied: tt('oo_ev_applied', 'Change applied to the order'),
    note: tt('oo_ev_note', 'Staff note'),
    scrubbed: tt('oo_ev_scrubbed', 'Customer details removed'),
  }
  return labels[event] ?? event
}

const kindLabel = (tt: Tx, kind: string): string => ({
  items: tt('oo_kind_items', 'Change items'),
  fulfilment: tt('oo_kind_fulfilment', 'Change pickup or delivery'),
  address: tt('oo_kind_address', 'Change address'),
  contact: tt('oo_kind_contact', 'Change contact details'),
  note: tt('oo_kind_note', 'Change note'),
  cancel: tt('oo_kind_cancel', 'Cancel order'),
  return: tt('oo_kind_return', 'Return items'),
} as Record<string, string>)[kind] ?? kind

const fieldLabel = (tt: Tx, field: RequestChange['field']): string => ({
  items: tt('oo_f_items', 'Items'), fulfilment: tt('oo_f_how', 'Pickup or delivery'), address: tt('oo_f_address', 'Address'), name: tt('oo_f_name', 'Name'),
  contacts: tt('oo_f_contacts', 'Contacts'), note: tt('oo_f_note', 'Note'), reason: tt('oo_f_reason', 'Reason'), cancel: tt('oo_f_state', 'Order'),
} as Record<string, string>)[field] ?? field

function requestStateLabel(tt: Tx, state: string): string {
  return ({
    pending: tt('oo_rstate_pending', 'Waiting for you'),
    accepted: tt('oo_rstate_accepted', 'Accepted'),
    rejected: tt('oo_rstate_rejected', 'Rejected'),
    withdrawn: tt('oo_rstate_withdrawn', 'Taken back'),
    applied: tt('oo_rstate_applied', 'Applied'),
    reversed: tt('oo_rstate_reversed', 'Reversed'),
  } as Record<string, string>)[state] ?? state
}

function ChangeRows({ tt, changes }: { tt: Tx; changes: RequestChange[] }) {
  return (
    <ul className="space-y-1.5 text-sm leading-6">
      {changes.map((change) => (
        <li key={change.field}>
          <div className="text-xs font-semibold text-slate-500 dark:text-neutral-400">{fieldLabel(tt, change.field)}</div>
          <div className="grid gap-x-3 sm:grid-cols-2">
            <div className="whitespace-pre-line rounded-lg bg-slate-50 px-2 py-1 dark:bg-white/5" {...getKhmerTextProps(change.before, '[overflow-wrap:anywhere]')}>{change.before || tt('oo_empty_value', '(empty)')}</div>
            <div className="whitespace-pre-line rounded-lg bg-emerald-50 px-2 py-1 dark:bg-emerald-400/10" {...getKhmerTextProps(change.after, '[overflow-wrap:anywhere]')}>{change.after || tt('oo_empty_value', '(empty)')}</div>
          </div>
        </li>
      ))}
    </ul>
  )
}

function RequestItem({ tt, request, canDecide, canApply, onDecide, onApply }: {
  tt: Tx; request: StaffRequest; canDecide: boolean; canApply: boolean; onDecide: (decision: 'accept' | 'reject') => void; onApply: () => void
}) {
  const changes = requestChanges(request)
  return (
    <li className="space-y-1.5 border-t border-slate-100 pt-2 first:border-t-0 first:pt-0 dark:border-white/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold leading-6">{kindLabel(tt, request.kind)}{request.stage === 'after_sale' ? <span className="font-normal text-slate-500 dark:text-neutral-400"> · {tt('oo_after_sale', 'after the sale')}</span> : null}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold leading-6 ${request.state === 'pending' ? CHIP_CLASS.todo : request.state === 'rejected' || request.state === 'withdrawn' ? CHIP_CLASS.muted : CHIP_CLASS.done}`}>{requestStateLabel(tt, request.state)}</span>
      </div>
      {request.customer_comment ? <p className="text-sm leading-6 text-slate-700 dark:text-neutral-200" {...getKhmerTextProps(request.customer_comment, '[overflow-wrap:anywhere]')}>“{request.customer_comment}”</p> : null}
      {changes.length ? <ChangeRows tt={tt} changes={changes} /> : null}
      {(canDecide && requestIsPending(request)) || canApply ? (
        <div className="flex flex-wrap gap-2">
          {canDecide && requestIsPending(request) ? (
            <>
              <Button size="sm" variant="primary" icon={<Check className="h-4 w-4" aria-hidden="true" />} onClick={() => onDecide('accept')}>{tt('oo_accept', 'Accept')}</Button>
              <Button size="sm" variant="secondary" icon={<X className="h-4 w-4" aria-hidden="true" />} onClick={() => onDecide('reject')}>{tt('oo_reject', 'Reject')}</Button>
            </>
          ) : null}
          {canApply ? <Button size="sm" variant="primary" icon={<Check className="h-4 w-4" aria-hidden="true" />} onClick={onApply}>{tt('oo_apply', 'Apply')}</Button> : null}
        </div>
      ) : null}
    </li>
  )
}

// ---- the confirmation of each action: the value before and after, and the fields it needs -----------------------------------------

type DialogProps = {
  tt: Tx
  dialog: Dialog
  detail: StaffOrderDetail
  busy: boolean
  problem: string | null
  textA: string
  textB: string
  amount: string
  reference: string
  refundIssue: ReturnType<typeof refundProblem>
  setTextA: (value: string) => void
  setTextB: (value: string) => void
  setAmount: (value: string) => void
  setReference: (value: string) => void
  statusWord: (state: string) => string
  heldUsd: number
  onClose: () => void
  onConfirm: () => void
}

function ActionDialog(props: DialogProps) {
  const { tt, dialog, detail, busy, problem, textA, textB, amount, reference, refundIssue, setTextA, setTextB, setAmount, setReference, statusWord, heldUsd, onClose, onConfirm } = props
  const { order, money } = detail
  const paid = Number(money.paid_usd ?? 0)
  const refundDue = Number(money.refund_due_usd ?? 0)
  const textArea = (label: string, value: string, set: (v: string) => void, max: number) => (
    <Field label={label}><textarea rows={2} maxLength={max} value={value} onChange={(event) => set(event.target.value)} className={inputClass} /></Field>
  )
  const common = {
    cancelLabel: tt('oo_back', 'Back'),
    working: busy,
    workingLabel: tt('oo_working', 'Please wait…'),
    layer: 'default' as const,
    onClose,
    onConfirm,
  }
  const error = problem ? <p role="alert" className="text-sm leading-6 text-rose-700 dark:text-rose-300">{problem}</p> : null

  if (dialog.kind === 'cancel') {
    return (
      <ConfirmDialog
        {...common}
        danger
        title={tt('oo_cancel_title', 'Cancel this order?')}
        message={<span translate="no">{String(order.order_no)}</span>}
        items={[
          { label: tt('oo_status', 'Status'), value: `${statusWord(String(order.state))} → ${statusWord('cancelled')}` },
          { label: tt('oo_paid', 'Paid'), value: usd(paid) },
          { label: tt('oo_refund_due', 'Refund due'), value: `${usd(refundDue)} → ${usd(Math.max(0, paid + heldUsd - Number(money.refunded_usd ?? 0)))}` },
        ]}
        note={tt('oo_cancel_note', 'The money stays where it is until you send the refund from the ABA app and record it here.')}
        confirmLabel={tt('oo_act_cancel_order', 'Cancel order')}
      >
        {textArea(tt('oo_reason', 'Reason (only staff see it)'), textA, setTextA, 500)}
        {error}
      </ConfirmDialog>
    )
  }
  if (dialog.kind === 'resolve') {
    return (
      <ConfirmDialog
        {...common}
        title={tt('oo_resolve_title', 'Accept the held payment?')}
        message={<span translate="no">{String(order.order_no)}</span>}
        items={[
          { label: tt('oo_status', 'Status'), value: order.state === 'review' ? `${statusWord('review')} → ${statusWord('paid')}` : statusWord(String(order.state)) },
          { label: tt('oo_held', 'Money held'), value: usd(heldUsd) },
          { label: tt('oo_total', 'Total for the goods'), value: usd(order.goods_total_usd) },
          { label: tt('oo_paid', 'Paid'), value: `${usd(paid)} → ${usd(paid + heldUsd)}` },
        ]}
        note={order.state !== 'review'
          ? tt('oo_resolve_late', 'The held money joins what the customer paid. If it is not wanted, send it back through ABA and record the refund here.')
          : paid + heldUsd + 0.005 < Number(order.goods_total_usd) ? tt('oo_resolve_short', 'The held money is less than the total. Collect the difference when you hand the order over.') : undefined}
        confirmLabel={tt('oo_act_accept_payment', 'Accept payment')}
      >
        {textArea(tt('oo_note_field', 'Note (only staff see it)'), textA, setTextA, 500)}
        {error}
      </ConfirmDialog>
    )
  }
  if (dialog.kind === 'note') {
    return (
      <ConfirmDialog {...common} title={tt('oo_note_title', 'Add a note')} message={<span translate="no">{String(order.order_no)}</span>} confirmLabel={tt('oo_save', 'Save')} confirmDisabled={!textA.trim()}>
        {textArea(tt('oo_note_field', 'Note (only staff see it)'), textA, setTextA, 500)}
        {error}
      </ConfirmDialog>
    )
  }
  if (dialog.kind === 'refund') {
    const typed = Number(amount)
    const valid = refundIssue === null
    return (
      <ConfirmDialog
        {...common}
        title={tt('oo_refund_title', 'Record a refund')}
        message={<span translate="no">{String(order.order_no)}</span>}
        items={[
          { label: tt('oo_refund_due', 'Refund due'), value: `${usd(refundDue)} → ${usd(valid ? Math.max(0, refundDue - typed) : refundDue)}` },
        ]}
        note={tt('oo_refund_note', 'This only writes it down. Send the money from the ABA app first.')}
        confirmLabel={tt('oo_save', 'Save')}
        confirmDisabled={!valid}
      >
        <Field label={tt('oo_refund_amount', 'Amount sent back (USD)')}><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className={inputClass} translate="no" /></Field>
        {refundIssue ? <p role="alert" className="text-sm leading-6 text-rose-700 dark:text-rose-300">{refundIssue === 'refund_over_due' ? tt('oo_err_refund_over_due', 'The refund cannot be more than what is still due.') : tt('oo_err_amount_invalid', 'Enter the refund amount in dollars.')}</p> : null}
        <Field label={tt('oo_refund_reference', 'ABA reference (optional)')}><input maxLength={60} value={reference} onChange={(event) => setReference(event.target.value)} className={inputClass} translate="no" /></Field>
        {textArea(tt('oo_note_field', 'Note (only staff see it)'), textA, setTextA, 500)}
        {error}
      </ConfirmDialog>
    )
  }
  if (dialog.kind === 'decide') {
    const accept = dialog.decision === 'accept'
    return (
      <ConfirmDialog
        {...common}
        danger={!accept}
        title={accept ? tt('oo_accept_title', 'Accept this request?') : tt('oo_reject_title', 'Reject this request?')}
        message={kindLabel(tt, dialog.request.kind)}
        items={[{ label: tt('oo_status', 'Status'), value: `${requestStateLabel(tt, 'pending')} → ${requestStateLabel(tt, accept ? 'accepted' : 'rejected')}` }]}
        note={accept ? tt('oo_accept_note', 'Accepting does not change the order yet. Apply it next.') : undefined}
        confirmLabel={accept ? tt('oo_accept', 'Accept') : tt('oo_reject', 'Reject')}
      >
        {textArea(tt('oo_public_comment', 'Message to the customer (they will see it)'), textA, setTextA, 300)}
        {textArea(tt('oo_note_field', 'Note (only staff see it)'), textB, setTextB, 500)}
        {error}
      </ConfirmDialog>
    )
  }
  if (dialog.kind === 'apply') {
    const changes = requestChanges(dialog.request)
    return (
      <ConfirmDialog
        {...common}
        title={tt('oo_apply_title', 'Apply this change to the order?')}
        message={kindLabel(tt, dialog.request.kind)}
        note={dialog.request.kind === 'items' ? tt('oo_apply_items_note', 'The new total is worked out when you apply. If it is higher, the customer is asked to pay the difference.') : undefined}
        confirmLabel={tt('oo_apply', 'Apply')}
      >
        <ChangeRows tt={tt} changes={changes} />
        {error}
      </ConfirmDialog>
    )
  }
  // fulfil
  return (
    <ConfirmDialog
      {...common}
      title={tt('oo_fulfil_title', 'Hand this order over')}
      message={<span translate="no">{String(order.order_no)}</span>}
      cancelLabel={tt('oo_close', 'Close')}
      confirmLabel={tt('oo_open_till', 'Open the till')}
      note={tt('oo_fulfil_open_note', "The till opens with this order's items and its online payment filled in. You can change lines there and it shows what changes. Pressing Complete there hands the order over.")}
    />
  )
}
