import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import X from 'lucide-react/dist/esm/icons/x.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import { searchProducts } from '../../api/methods.ts'
import ConfirmDialog, { type ConfirmReviewItem } from '../shared/ConfirmDialog.tsx'
import { fmtTime } from '../../utils/formatters.ts'
import { getSaleReturnBlockReason } from '../../utils/saleReturnGuard.ts'
import AppSelect from '../shared/AppSelect.tsx'
import CopyableId from '../shared/CopyableId.tsx'
import { DetailRow, DetailRowGroup, MoneyRow } from '../shared/DetailRows.tsx'
import InfoHint from '../shared/InfoHint.tsx'
import StatusBadge, { ALL_STATUSES, getStatusLabel } from './StatusBadge.tsx'

type TranslateFn = (key: string) => string
type MoneyFormatter = (value: number | string) => string

interface SaleLineItem {
  id?: string | number | null
  product_id?: string | number | null
  product_name?: string | null
  name?: string | null
  quantity?: number | string | null
  qty?: number | string | null
  applied_price_usd?: number | string | null
  applied_price_khr?: number | string | null
  price_usd?: number | string | null
  price_khr?: number | string | null
  price?: number | string | null
  branch_name?: string | null
  returned_quantity?: number | string | null
}

interface SaleDetail {
  id: string | number
  receipt_number?: string | null
  source_return_id?: number | string | null
  created_at?: string | Date | null
  sale_status?: string | null
  customer_membership_number?: string | null
  items?: SaleLineItem[] | string | null
  total_usd?: number | string | null
  total?: number | string | null
  total_khr?: number | string | null
  refund_usd?: number | string | null
  refund_khr?: number | string | null
  membership_discount_usd?: number | string | null
  membership_discount_khr?: number | string | null
  membership_points_redeemed?: number | string | null
  discount_usd?: number | string | null
  tax_usd?: number | string | null
  subtotal_usd?: number | string | null
  amount_paid_usd?: number | string | null
  amount_paid_khr?: number | string | null
  change_usd?: number | string | null
  cashier_name?: string | null
  payment_method?: string | null
  branch_name?: string | null
  device_tz?: string | null
  device_name?: string | null
  customer_name?: string | null
  customer_phone?: string | null
  customer_address?: string | null
  notes?: string | null
  // Cancellation record (migration 0066) -- present only on cancelled
  // sales cancelled through the Part 383 flow; legacy/imported cancelled
  // rows keep these null and render as plain "cancelled".
  cancel_reason?: string | null
  cancel_note?: string | null
  cancelled_at?: string | null
  cancelled_by_name?: string | null
  status_before_cancel?: string | null
  cancel_fee_id?: number | string | null
  // Payment + delivery + KHR fields the admin detail view now surfaces. All
  // are already returned by GET /api/sales (SELECT s.*); the audit flagged
  // them as captured-but-shown-only-on-the-printable-receipt.
  subtotal_khr?: number | string | null
  discount_khr?: number | string | null
  tax_khr?: number | string | null
  change_khr?: number | string | null
  exchange_rate?: number | string | null
  payment_currency?: string | null
  payment_details?: string | Array<{ method?: string | null; amount_usd?: number | string | null; amount_khr?: number | string | null }> | null
  is_delivery?: number | null
  delivery_fee_usd?: number | string | null
  delivery_fee_khr?: number | string | null
  delivery_actual_cost_usd?: number | string | null
  delivery_actual_cost_khr?: number | string | null
  delivery_contact_name?: string | null
  delivery_contact_phone?: string | null
  delivery_contact_address?: string | null
  credit_due_date?: string | null
}

type ParsedPayment = { method: string; amount_usd: number; amount_khr: number }

// S4-24b -- the product picker's rows, and a line staged for adding.
interface AddProductCandidate {
  id?: number | string | null
  name?: string | null
  barcode?: string | null
  selling_price_usd?: number | string | null
  stock_quantity?: number | string | null
}

type StagedAddLine = {
  productId: number
  name: string
  quantity: number
  unitPriceUsd: number
  // The typed text is kept beside the number so a half-typed price ("1.")
  // survives a keystroke; unitPriceUsd stays the single numeric authority.
  priceText: string
  // What the picker last saw on hand, so the form can WARN before the server
  // refuses. Never a substitute for the server's check: this number is
  // seconds old and another till may already have taken the units.
  stockQuantity: number
}

// Which sale states accept a new line. Hand-synced twin of the Worker's
// SALE_STATUSES_ACCEPTING_NEW_LINES (lib/saleLineAddition.ts) -- the server
// is the authority and refuses anything else with a 400; this list only
// decides whether the surface is offered, so a cashier is never invited into
// a form whose submit is guaranteed to fail.
const STATUSES_ACCEPTING_ADDED_ITEMS = ['completed', 'awaiting_delivery', 'awaiting_payment']

function parsePaymentDetails(raw: SaleDetail['payment_details']): ParsedPayment[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'string' && raw.trim()
      ? (() => { try { const v = JSON.parse(raw); return Array.isArray(v) ? v : [] } catch { return [] } })()
      : []
  return list
    .map((entry) => ({
      method: String((entry as { method?: unknown })?.method ?? '').trim(),
      amount_usd: Number((entry as { amount_usd?: unknown })?.amount_usd) || 0,
      amount_khr: Number((entry as { amount_khr?: unknown })?.amount_khr) || 0,
    }))
    .filter((entry) => entry.method && (entry.amount_usd > 0 || entry.amount_khr > 0))
}

interface SaleDetailModalProps {
  sale?: SaleDetail | null
  settings?: unknown
  onClose: () => void
  // recordHistory/extra mirror Sales.tsx's handleStatusChange -- `extra`
  // carries the Y10 payment payload when completing an awaiting-payment sale.
  onStatusChange?: (saleId: string | number, status: string, notes: string, recordHistory?: boolean, extra?: Record<string, unknown> | null) => Promise<unknown> | unknown
  onAttachMembership?: (saleId: string | number, membershipNumber: string) => Promise<boolean | unknown> | boolean | unknown
  onPrint?: (sale: SaleDetail) => void
  // Opens the SAME new-return flow the Returns section uses
  // (returns/NewReturnModal), pre-filled with this sale. Omitted entirely
  // when the signed-in user lacks `returns:add` -- the identical
  // hide-by-omission pattern as onStatusChange / onAttachMembership above.
  onReturn?: (sale: SaleDetail) => void
  // S4-24b: add product lines to this already-recorded sale. Omitted entirely
  // when the signed-in user lacks `sales:add_items` -- the same
  // hide-by-omission gate as the write callbacks above, and the Worker
  // enforces the identical action server-side.
  onAddItems?: (saleId: string | number, items: Array<{ product_id: number; quantity: number; applied_price_usd?: number }>) => Promise<boolean | unknown> | boolean | unknown
  t: TranslateFn
  fmtUSD: MoneyFormatter
  fmtKHR: MoneyFormatter
}

function toNumber(value: number | string | null | undefined): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

// Every card in this modal wears the same shell, so "Sale", "Customer",
// "Delivery" and the items/money block are visibly one family instead of the
// four different treatments they used to be.
function SectionCard({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-gray-200 p-3 dark:border-gray-700 ${className}`}>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</div>
      {children}
    </section>
  )
}

function parseItems(raw: SaleDetail['items']): SaleLineItem[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is SaleLineItem => !!item && typeof item === 'object') : []
  } catch {
    return []
  }
}

export default function SaleDetailModal({
  sale,
  onClose,
  onStatusChange,
  onAttachMembership,
  onPrint,
  onReturn,
  onAddItems,
  t,
  fmtUSD,
  fmtKHR,
}: SaleDetailModalProps) {
  const [newStatus, setNewStatus] = useState(sale?.sale_status || 'completed')
  const [statusNotes, setStatusNotes] = useState('')
  const [statusSaving, setStatusSaving] = useState(false)
  // Y10: payment entered when completing an awaiting-payment sale. USD
  // prefills with the sale total (the common exact-payment case is one tap).
  const [payMethod, setPayMethod] = useState('Cash')
  const [payUsd, setPayUsd] = useState(() => {
    const total = toNumber(sale?.total_usd || sale?.total)
    return total > 0 ? total.toFixed(2) : ''
  })
  const [payKhr, setPayKhr] = useState('')
  const [payError, setPayError] = useState('')
  // Z8 (user, Aug 29): "credit is the same as awaiting payment, just that you
  // can click near the payment method to edit later." The Record-payment
  // affordance lives on the Payment-method field for an awaiting-payment
  // sale; clicking it selects the completing status (revealing the payment
  // inputs) and scrolls this section into view.
  const statusSectionRef = useRef<HTMLDivElement | null>(null)
  const startRecordPayment = () => {
    if (newStatus === 'awaiting_payment' || newStatus === (sale?.sale_status || 'completed')) setNewStatus('completed')
    setTimeout(() => statusSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
  }
  const [membershipNumber, setMembershipNumber] = useState(sale?.customer_membership_number || '')
  const [membershipSaving, setMembershipSaving] = useState(false)
  // S4-24b: "add items to this sale". Staged locally, written in one request,
  // and reviewed in a ConfirmDialog first -- this write deducts real stock, so
  // it gets the same review-before-commit treatment every other stock write on
  // this app has.
  const [addQuery, setAddQuery] = useState('')
  const [addCandidates, setAddCandidates] = useState<AddProductCandidate[]>([])
  const [addSearching, setAddSearching] = useState(false)
  const [addLines, setAddLines] = useState<StagedAddLine[]>([])
  const [addSaving, setAddSaving] = useState(false)
  const [addConfirmOpen, setAddConfirmOpen] = useState(false)
  const addSearchSeqRef = useRef(0)

  useEffect(() => {
    const text = addQuery.trim()
    if (!onAddItems || text.length < 2) { setAddCandidates([]); setAddSearching(false); return }
    const seq = ++addSearchSeqRef.current
    setAddSearching(true)
    const timer = window.setTimeout(async () => {
      try {
        const payload = await searchProducts({ query: text, pageSize: 8 }) as { items?: AddProductCandidate[] }
        if (seq !== addSearchSeqRef.current) return
        setAddCandidates(Array.isArray(payload?.items) ? payload.items : [])
      } catch {
        // Suggestions only -- typing again retries. Never a blocking error:
        // the write itself is what has to be reliable, not the picker.
        if (seq === addSearchSeqRef.current) setAddCandidates([])
      } finally {
        if (seq === addSearchSeqRef.current) setAddSearching(false)
      }
    }, 300)
    return () => window.clearTimeout(timer)
  }, [addQuery, onAddItems])

  const stageAddLine = (candidate: AddProductCandidate): void => {
    const productId = Number(candidate?.id)
    if (!Number.isFinite(productId) || productId <= 0) return
    setAddQuery('')
    setAddCandidates([])
    setAddLines((current) => {
      // A second pick of the same product bumps the quantity rather than
      // adding a duplicate row -- the server would accept two lines, but the
      // person meant "two of these".
      const existing = current.findIndex((line) => line.productId === productId)
      if (existing >= 0) {
        const next = [...current]
        next[existing] = { ...next[existing], quantity: next[existing].quantity + 1 }
        return next
      }
      const price = toNumber(candidate?.selling_price_usd)
      return [...current, {
        productId,
        name: String(candidate?.name || `#${productId}`),
        quantity: 1,
        unitPriceUsd: price,
        priceText: price > 0 ? String(price) : '',
        stockQuantity: toNumber(candidate?.stock_quantity),
      }]
    })
  }
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const translateOr = (key: string, fallbackEn: string, fallbackKm = fallbackEn): string => {
    const value = t(key)
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallbackEn
  }

  const items = useMemo(() => parseItems(sale?.items), [sale?.items])

  if (!sale) return null

  const currentStatus = sale.sale_status || 'completed'
  // The Return action reuses the Returns section's own guards rather than
  // inventing new ones -- see utils/saleReturnGuard.ts, shared with the
  // receipt view so the two surfaces never disagree. The reason is stated up
  // front (disabled button + InfoHint) instead of letting someone walk into a
  // dead-end form.
  const returnBlockReason = getSaleReturnBlockReason({ sale_status: currentStatus, items })
  const returnBlockedReason = returnBlockReason === 'cancelled'
    ? translateOr('return_blocked_cancelled_sale', 'This sale was cancelled, so there is nothing to return.', 'ការលក់នេះត្រូវបានបោះបង់ ដូច្នេះគ្មានអ្វីត្រូវប្រគល់មកវិញទេ។')
    : returnBlockReason === 'fully_returned'
      ? translateOr('return_blocked_fully_returned', 'Every item on this sale has already been returned.', 'ទំនិញទាំងអស់ក្នុងការលក់នេះ ត្រូវបានប្រគល់មកវិញរួចហើយ។')
      : ''
  const totalUsd = toNumber(sale.total_usd || sale.total)
  const totalKhr = toNumber(sale.total_khr)
  const refundUsd = toNumber(sale.refund_usd)
  const refundKhr = toNumber(sale.refund_khr)
  const membershipDiscountUsd = toNumber(sale.membership_discount_usd)
  const membershipDiscountKhr = toNumber(sale.membership_discount_khr)
  const baseDiscountUsd = toNumber(sale.discount_usd)
  const taxUsd = toNumber(sale.tax_usd)
  const subtotalUsd = toNumber(sale.subtotal_usd)
  // subtotal_khr was already returned by GET /api/sales and already stored by
  // the POS, but the old Totals block printed a KHR line for the discounts and
  // the total while leaving the subtotal USD-only -- so the riel column had a
  // hole in it right at the top. It is shown now for the same reason the rest
  // are: the KHR column has to read straight down.
  const subtotalKhr = toNumber(sale.subtotal_khr)
  const amountPaidUsd = toNumber(sale.amount_paid_usd)
  const amountPaidKhr = toNumber(sale.amount_paid_khr)
  const changeUsd = toNumber(sale.change_usd)
  const changeKhr = toNumber(sale.change_khr)
  const discountKhr = toNumber(sale.discount_khr)
  const taxKhr = toNumber(sale.tax_khr)
  const deliveryFeeUsd = toNumber(sale.delivery_fee_usd)
  const deliveryFeeKhr = toNumber(sale.delivery_fee_khr)
  const isDelivery = !!toNumber(sale.is_delivery) || !!String(sale.delivery_contact_name || '').trim()
  // S4-25: what the standalone Delivery card used to hold, rendered under the
  // delivery-fee row's label instead. `note` sits inside a <span>, so every
  // line here is a span too -- a <div> in there is invalid nesting and React
  // will not warn about it in a production build.
  const deliveryContactLines: Array<[label: string, value: string]> = isDelivery
    ? ([
        [translateOr('driver', 'Delivery', 'ដឹកជញ្ជូន'), String(sale.delivery_contact_name || '').trim()],
        [t('phone') || 'Phone', String(sale.delivery_contact_phone || '').trim()],
        [t('address') || 'Address', String(sale.delivery_contact_address || '').trim()],
      ] as Array<[string, string]>).filter(([, value]) => value !== '')
    : []
  const deliveryContactNote = deliveryContactLines.length > 0 ? (
    <span className="mt-0.5 block text-left font-normal">
      {deliveryContactLines.map(([label, value]) => (
        <span key={label} className="block break-words">
          <span className="text-gray-400">{label}</span> {value}
        </span>
      ))}
    </span>
  ) : null
  const paymentDetails = parsePaymentDetails(sale.payment_details)
  // Outstanding balance: an on-credit / partially-paid sale (amount_paid below
  // total). Shown so the admin detail no longer hides "still owed".
  const outstandingUsd = Math.max(0, Math.round((totalUsd - amountPaidUsd) * 100) / 100)

  // Y10: an awaiting-payment sale with nothing recorded gets its payment
  // entered HERE, at completion time -- the whole point of the status.
  const needsPaymentEntry = currentStatus === 'awaiting_payment'
    && (newStatus === 'completed' || newStatus === 'awaiting_delivery')
    && amountPaidUsd <= 0 && amountPaidKhr <= 0

  // S4-24b. The surface is offered only where the Worker would actually
  // accept the write: a status that takes new lines, and no recorded returns
  // (a returned sale's contents belong to the Returns flow -- adding to it
  // would change what "already came back" means for records already written).
  const hasRecordedReturns = refundUsd > 0 || items.some((item) => toNumber(item.returned_quantity) > 0)
  const canOfferAddItems = !!onAddItems
    && STATUSES_ACCEPTING_ADDED_ITEMS.includes(currentStatus)
    && !hasRecordedReturns
  const addedSubtotalUsd = Math.round(addLines.reduce((sum, line) => sum + line.unitPriceUsd * line.quantity, 0) * 100) / 100
  // Every other money field is frozen by the server (see
  // lib/saleLineAddition.ts's decision 3), so the new total is exactly the
  // old total plus what is being added -- which is what makes this preview
  // safe to show before the write.
  const projectedTotalUsd = Math.round((totalUsd + addedSubtotalUsd) * 100) / 100
  // Same shape as outstandingUsd above -- one definition of "still owed"
  // on this screen, so the projection cannot disagree with the figure it is
  // projecting from.
  const projectedOutstandingUsd = Math.max(0, Math.round((projectedTotalUsd - amountPaidUsd) * 100) / 100)
  const addStockMoves = currentStatus !== 'awaiting_payment'

  const submitAddItems = async (): Promise<void> => {
    if (!onAddItems || !addLines.length) return
    setAddSaving(true)
    try {
      const ok = await onAddItems(sale.id, addLines.map((line) => ({
        product_id: line.productId,
        quantity: line.quantity,
        applied_price_usd: line.unitPriceUsd,
      })))
      // The caller raises its own success/failure notice (it is the one that
      // knows whether stock actually moved), so this only clears the form and
      // steps out of the way on success.
      if (ok !== false) {
        setAddLines([])
        setAddConfirmOpen(false)
        onClose()
      } else {
        setAddConfirmOpen(false)
      }
    } finally {
      setAddSaving(false)
    }
  }

  const handleStatusUpdate = async (): Promise<void> => {
    if (!onStatusChange || newStatus === currentStatus) return
    let extra: Record<string, unknown> | null = null
    if (needsPaymentEntry) {
      const method = payMethod.trim()
      const paidUsdNum = parseFloat(payUsd) || 0
      const paidKhrNum = parseFloat(payKhr) || 0
      if (!method) {
        setPayError(translateOr('payment_method_required', 'Enter the payment method.', 'បញ្ចូលវិធីទូទាត់។'))
        return
      }
      if (paidUsdNum <= 0 && paidKhrNum <= 0) {
        setPayError(translateOr('payment_amount_required', 'Enter the amount received.', 'បញ្ចូលចំនួនទឹកប្រាក់ដែលបានទទួល។'))
        return
      }
      setPayError('')
      extra = {
        payment_method: method,
        amount_paid_usd: paidUsdNum,
        amount_paid_khr: paidKhrNum,
      }
    }
    setStatusSaving(true)
    try {
      await onStatusChange(sale.id, newStatus, statusNotes, true, extra)
      onClose()
    } finally {
      setStatusSaving(false)
    }
  }

  const handleMembershipAttach = async (): Promise<void> => {
    const value = String(membershipNumber || '').trim()
    if (!value || !onAttachMembership) return
    setMembershipSaving(true)
    try {
      const ok = await onAttachMembership(sale.id, value)
      if (ok) onClose()
    } finally {
      setMembershipSaving(false)
    }
  }

  return createPortal(
    <div className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1050] flex items-end justify-center overflow-y-auto bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="modal-panel-safe flex w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:max-w-3xl sm:rounded-2xl dark:bg-gray-800"
        onClick={(event: MouseEvent<HTMLDivElement>) => event.stopPropagation()}
      >
        {/* The receipt id owns a full-width row of its own below sm (user,
            Sep 3 2026: "for smaller screens the receipt id must be shown
            clearly fully, no scroll; can push to second row and copy
            easily"), so it wraps instead of scrolling sideways and the
            status/actions cluster drops underneath it. From sm the two share
            one compact row again, with the same copy button. */}
        <div className="flex flex-shrink-0 flex-col gap-2 border-b border-gray-200 p-4 dark:border-gray-700 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <CopyableId
              value={sale.receipt_number || ''}
              copyLabel={translateOr('copy_receipt_number', 'Copy receipt number', 'ចម្លងលេខវិក្កយបត្រ')}
              copiedLabel={t('copied') || 'Copied'}
              valueClassName="font-mono text-sm font-bold text-gray-900 dark:text-white sm:text-base"
            />
            <div className="mt-1 text-xs text-gray-400">{fmtTime(sale.created_at)}</div>
          </div>
          {/* S4-24 (user, Sep 4 2026): "print buttons end of page...not on top
              near the x close button". Print and Return moved to the footer at
              the end of the record. Only the status badge and the close control
              stay up here -- a badge is a fact about the record, and X is how
              you leave, not something you do to the sale. */}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <StatusBadge status={currentStatus} t={t} />
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600"
              aria-label={t('close') || 'Close'}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* One rhythm for the whole record (user, Sep 3 2026: "a row view is
            better instead of current broken view"). Every field is a
            label/value ROW -- Sale, Customer and Delivery no longer stack the
            label above the value while Totals used rows, which is what made
            the same modal read in two shapes at once. The money summary is
            not a separate box any more either: it lives in the SAME table as
            the line items, so subtotal / discounts / total land in the same
            right-aligned column as the line totals and can be scanned
            straight down. Every KHR figure now sits inside its own row's
            amount cell instead of floating underneath as an unlabelled
            right-aligned line. */}
        <div className="modal-scroll space-y-4 p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <SectionCard title={t('sale') || 'Sale'}>
              <DetailRowGroup>
                <DetailRow label={t('cashier') || 'Cashier'} value={sale.cashier_name} />
                {/* Z8: an awaiting-payment (credit) sale carries no method yet
                    -- the field becomes a Record-payment affordance right here
                    "near the payment method", per the user. */}
                {currentStatus === 'awaiting_payment' ? (
                  <DetailRow label={t('payment_method') || 'Payment method'}>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300">
                        {translateOr('credit_awaiting_payment', 'Credit — awaiting payment', 'ឥណទាន — រង់ចាំការទូទាត់')}
                      </span>
                      <button
                        type="button"
                        onClick={startRecordPayment}
                        className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
                      >
                        {translateOr('record_payment', 'Record payment', 'កត់ត្រាការទូទាត់')}
                      </button>
                    </span>
                  </DetailRow>
                ) : (
                  /* S4-24: the split payment is no longer a row called
                     "Payment breakdown" -- it is the payment row's own detail,
                     which is exactly how the receipt prints it (Receipt.tsx
                     order_info passes the same list as the payment Row's
                     subValue). One fact, one row. */
                  <DetailRow label={t('payment_method') || 'Payment method'}>
                    <span className="block">
                      <span className="badge-blue text-xs">{sale.payment_method}</span>
                      {paymentDetails.length > 1 ? (
                        <span className="mt-1 block space-y-0.5">
                          {paymentDetails.map((detail, index) => (
                            <span key={`${detail.method}-${index}`} className="flex justify-between gap-3 text-xs font-normal text-gray-500 dark:text-gray-400">
                              <span className="min-w-0 flex-1 break-words">{detail.method}</span>
                              <span className="shrink-0 tabular-nums">{fmtUSD(detail.amount_usd)}{detail.amount_khr > 0 ? ` · ${fmtKHR(detail.amount_khr)}` : ''}</span>
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </span>
                  </DetailRow>
                )}
                <DetailRow label={t('branch') || 'Branch'} value={sale.branch_name} />
                <DetailRow label={t('status') || 'Status'} value={getStatusLabel(currentStatus, t)} />
                {sale.source_return_id ? (
                  <DetailRow label={translateOr('replacement_for_return', 'Replacement for return', 'ការលក់ជំនួសសម្រាប់ការបង្វិលត្រឡប់')} value={`#${sale.source_return_id}`} mono />
                ) : null}
                {/* S4-24: Timezone, Device and Payment currency are gone from
                    this card. They are device telemetry -- no receipt prints
                    them, and the user asked for the detail to read like one.
                    The data is not lost: it is still on the sale row, still
                    exported, and still on the Sales list's own columns. If a
                    till ever needs to be identified from a receipt, put it
                    back deliberately rather than by re-adding a row nobody
                    asked for. */}
              </DetailRowGroup>
            </SectionCard>

            <SectionCard title={t('customer') || 'Customer'}>
              <DetailRowGroup>
                <DetailRow label={t('customer_name') || 'Customer'} value={sale.customer_name} />
                <DetailRow label={t('phone') || 'Phone'} value={sale.customer_phone} />
                <DetailRow label={t('address') || 'Address'} value={sale.customer_address} />
                <DetailRow label={t('membership') || 'Membership'} value={sale.customer_membership_number} mono />
              </DetailRowGroup>
              {/* An ACTION, not a field -- kept in the Customer card but held
                  below the row list so it cannot break the row rhythm. */}
              <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-700/60">
                <label htmlFor="sale-membership-attach" className="mb-1 block text-xs text-gray-400">
                  {translateOr('attach_membership', 'Attach membership to this sale', 'ភ្ជាប់សមាជិកទៅការលក់នេះ')}
                </label>
                <div className="flex gap-2">
                  <input
                    id="sale-membership-attach"
                    className="input text-sm"
                    value={membershipNumber}
                    onChange={(event) => setMembershipNumber(event.target.value)}
                    placeholder={t('membership_number') || 'Membership number'}
                  />
                  <button
                    type="button"
                    className="btn-primary whitespace-nowrap text-xs"
                    disabled={membershipSaving || !String(membershipNumber || '').trim()}
                    onClick={handleMembershipAttach}
                  >
                    {membershipSaving ? (t('loading') || 'Saving') : (t('save') || 'Save')}
                  </button>
                </div>
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  {translateOr('sale_membership_attach_hint', 'Use this when a sale was created anonymously and staff need to link it to a member later.', 'ប្រើពេលការលក់ត្រូវបានបង្កើតដោយមិនមានសមាជិក ហើយបុគ្គលិកត្រូវភ្ជាប់ទៅសមាជិកនៅពេលក្រោយ។')}
                </p>
              </div>
            </SectionCard>

            {/* S4-25: delivery is no longer a card of its own. The driver,
                their phone and the drop address now ride the delivery-fee row
                inside the items table, which is where the receipt puts the
                fee -- next to the total. A card sitting beside Customer made
                the reader hold two addresses apart before reaching a single
                number they both explain. */}

            {sale.notes ? (
              <SectionCard title={t('notes') || 'Notes'}>
                <p className="break-words text-sm text-gray-700 dark:text-gray-200">{sale.notes}</p>
              </SectionCard>
            ) : null}
          </div>

          {/* Items AND the money summary in ONE table: the tfoot amounts sit in
              the same column as the line totals above them, which is the whole
              point of a row view -- the numbers can be read straight down. The
              product name wraps instead of living in a 151px horizontal scroll
              box (measured on the old shape at 1280), and the table keeps the
              same shape at every width, so the phone no longer loses the Qty
              and Unit price columns to a separate card list. */}
          <SectionCard title={`${t('items') || 'Items'} (${items.length})`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y border-gray-200 bg-gray-50 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:bg-gray-900/35 dark:text-gray-400">
                  <tr>
                    <th className="px-1.5 py-1.5 text-left sm:px-2">{t('product') || 'Product'}</th>
                    <th className="px-1.5 py-1.5 text-right sm:px-2">{t('qty_short') || 'Qty'}</th>
                    <th className="px-1.5 py-1.5 text-right sm:px-2">{t('unit_price') || 'Unit price'}</th>
                    <th className="px-1.5 py-1.5 text-right sm:px-2">{t('line_total') || 'Line total'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-2 py-3 text-sm text-gray-400">{t('no_item_details') || 'No item details available.'}</td>
                    </tr>
                  ) : items.map((item, index) => {
                    const qty = toNumber(item.quantity || item.qty || 1) || 1
                    const unitUsd = toNumber(item.applied_price_usd ?? item.price_usd ?? item.price)
                    const unitKhr = toNumber(item.applied_price_khr ?? item.price_khr)
                    const lineUsd = unitUsd * qty
                    const lineKhr = unitKhr * qty
                    return (
                      <tr key={`${item.product_id || item.id || index}-${index}`}>
                        <td className="px-1.5 py-1.5 align-top sm:px-2">
                          <div className="break-words font-medium text-gray-900 dark:text-white">{item.product_name || item.name}</div>
                          {toNumber(item.returned_quantity) > 0 ? (
                            <div className="mt-0.5 inline-flex rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">↩ {toNumber(item.returned_quantity)} {t('returned_quantity_tag') || 'returned'}</div>
                          ) : null}
                          {item.branch_name ? <div className="break-words text-[11px] text-gray-400">{item.branch_name}</div> : null}
                        </td>
                        <td className="whitespace-nowrap px-1.5 py-1.5 text-right align-top sm:px-2 tabular-nums text-gray-700 dark:text-gray-200">{qty}</td>
                        <td className="whitespace-nowrap px-1.5 py-1.5 text-right align-top sm:px-2 tabular-nums text-gray-700 dark:text-gray-200">
                          {fmtUSD(unitUsd)}
                          {unitKhr > 0 ? <div className="text-[11px] text-gray-400">{fmtKHR(unitKhr)}</div> : null}
                        </td>
                        <td className="whitespace-nowrap px-1.5 py-1.5 text-right align-top sm:px-2 font-semibold tabular-nums text-gray-900 dark:text-white">
                          {fmtUSD(lineUsd)}
                          {lineKhr > 0 ? <div className="text-[11px] font-normal text-gray-400">{fmtKHR(lineKhr)}</div> : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="border-t border-gray-200 dark:border-gray-700">
                  <MoneyRow
                    label={t('subtotal') || 'Subtotal'}
                    amount={fmtUSD(subtotalUsd)}
                    sub={subtotalKhr > 0 ? fmtKHR(subtotalKhr) : null}
                  />
                  {baseDiscountUsd > 0 ? (
                    <MoneyRow
                      label={t('discount') || 'Store discount'}
                      tone="discount"
                      amount={`-${fmtUSD(baseDiscountUsd)}`}
                      sub={discountKhr > 0 ? `-${fmtKHR(discountKhr)}` : null}
                    />
                  ) : null}
                  {membershipDiscountUsd > 0 ? (
                    <MoneyRow
                      label={t('membership_discount') || 'Membership discount'}
                      tone="credit"
                      amount={`-${fmtUSD(membershipDiscountUsd)}`}
                      sub={membershipDiscountKhr > 0 ? `-${fmtKHR(membershipDiscountKhr)}` : null}
                    />
                  ) : null}
                  {/* S4-24: "Points redeemed" is gone. It is not money -- it
                      sat in a money column stating the mechanism behind the
                      membership discount printed directly above it, which is
                      the kind of second explanation of one number the user
                      meant by "no need so much break downs". */}
                  {taxUsd > 0 ? (
                    <MoneyRow label={t('tax') || 'Tax'} amount={fmtUSD(taxUsd)} sub={taxKhr > 0 ? fmtKHR(taxKhr) : null} />
                  ) : null}
                  {/* S4-25: the row renders when the sale IS a delivery even
                      if the fee is zero -- a free delivery still has a driver,
                      and dropping the row on a zero fee would have hidden the
                      contact the old card used to show. */}
                  {isDelivery || deliveryFeeUsd > 0 || deliveryFeeKhr > 0 ? (
                    <MoneyRow
                      label={translateOr('delivery_fee', 'Delivery fee', 'ថ្លៃដឹកជញ្ជូន')}
                      note={deliveryContactNote}
                      amount={fmtUSD(deliveryFeeUsd)}
                      sub={deliveryFeeKhr > 0 ? fmtKHR(deliveryFeeKhr) : null}
                    />
                  ) : null}
                  {refundUsd > 0 ? (
                    <MoneyRow
                      label={t('returns_refunded') || 'Refunded by returns'}
                      tone="refund"
                      amount={`-${fmtUSD(refundUsd)}`}
                      sub={refundKhr > 0 ? `-${fmtKHR(refundKhr)}` : null}
                    />
                  ) : null}
                  <MoneyRow
                    label={t('total') || 'Total'}
                    strong
                    amount={fmtUSD(totalUsd)}
                    sub={totalKhr > 0 ? fmtKHR(totalKhr) : null}
                  />
                  {amountPaidUsd > 0 ? (
                    <MoneyRow
                      label={t('amount_paid') || 'Amount paid'}
                      tone="muted"
                      amount={fmtUSD(amountPaidUsd)}
                      sub={amountPaidKhr > 0 ? fmtKHR(amountPaidKhr) : null}
                    />
                  ) : null}
                  {outstandingUsd > 0 && currentStatus !== 'cancelled' ? (
                    <MoneyRow
                      label={translateOr('outstanding_balance', 'Outstanding (on credit)', 'នៅជំពាក់')}
                      note={sale.credit_due_date ? `· ${translateOr('due', 'due', 'កំណត់')} ${String(sale.credit_due_date).slice(0, 10)}` : null}
                      tone="due"
                      amount={fmtUSD(outstandingUsd)}
                    />
                  ) : null}
                  {changeUsd > 0 ? (
                    <MoneyRow
                      label={t('change') || 'Change'}
                      tone="change"
                      amount={fmtUSD(changeUsd)}
                      sub={changeKhr > 0 ? fmtKHR(changeKhr) : null}
                    />
                  ) : null}
                  {/* S4-24: "Actual delivery cost" is gone from this summary.
                      It is what the shop PAID the driver, not part of what the
                      customer owes, and printing it under Change invited the
                      reader to subtract it from a total it was never in --
                      literally the "difference" the user asked to remove. It
                      stays on the sale row and in the delivery reports, which
                      is where a margin question belongs. */}
                </tfoot>
              </table>
            </div>
          </SectionCard>

          {/* S4-24b: add more products to a sale that already exists. It sits
              directly under the item list it extends, so the record still
              reads top-to-bottom and still ends in its footer actions.
              The write moves real stock, so it follows the house rule for a
              material stock mutation: one review (the ConfirmDialog below)
              before the request, and a visible outcome after it. */}
          {canOfferAddItems ? (
            <section className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {translateOr('add_items_to_sale', 'Add items to this sale', 'បន្ថែមទំនិញទៅការលក់នេះ')}
              </div>
              <label htmlFor="sale-add-item-search" className="mb-1 block text-xs text-gray-400">
                {t('product') || 'Product'}
              </label>
              <input
                id="sale-add-item-search"
                className="input h-10 text-sm"
                value={addQuery}
                onChange={(event) => setAddQuery(event.target.value)}
                placeholder={translateOr('add_items_search_placeholder', 'Search by name or barcode', 'ស្វែងរកតាមឈ្មោះ ឬបាកូដ')}
                autoComplete="off"
              />
              {addSearching ? (
                <p className="mt-2 text-xs text-gray-400">{t('loading') || 'Loading'}</p>
              ) : addQuery.trim().length >= 2 && addCandidates.length === 0 ? (
                <p className="mt-2 text-xs text-gray-400">
                  {translateOr('add_items_no_matches', 'No products matched.', 'រកមិនឃើញផលិតផលទេ។')}
                </p>
              ) : null}
              {addCandidates.length > 0 ? (
                <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
                  {addCandidates.map((candidate) => (
                    <li key={String(candidate.id)}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 px-2 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                        onClick={() => stageAddLine(candidate)}
                      >
                        <span className="min-w-0">
                          <span className="block break-words font-medium text-gray-900 dark:text-white">{candidate.name}</span>
                          <span className="block text-[11px] text-gray-400">
                            {candidate.barcode ? <span className="font-mono">{candidate.barcode}</span> : null}
                            {candidate.barcode ? ' · ' : ''}
                            {`${t('current_stock') || 'Stock'}: ${toNumber(candidate.stock_quantity)}`}
                          </span>
                        </span>
                        <span className="whitespace-nowrap tabular-nums text-gray-700 dark:text-gray-200">
                          {fmtUSD(toNumber(candidate.selling_price_usd))}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              {addLines.length === 0 ? (
                <p className="mt-3 text-xs text-gray-400">
                  {translateOr('add_items_none_staged', 'Pick a product above to add it to this sale.', 'ជ្រើសរើសផលិតផលខាងលើ ដើម្បីបន្ថែមទៅការលក់នេះ។')}
                </p>
              ) : (
                <>
                  <ul className="mt-3 space-y-2">
                    {addLines.map((line) => (
                      <li key={line.productId} className="rounded-lg border border-gray-200 p-2 dark:border-gray-700">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 flex-1 break-words text-sm font-medium text-gray-900 dark:text-white">{line.name}</span>
                          <span className="flex items-center gap-1">
                            <label htmlFor={`sale-add-qty-${line.productId}`} className="text-[11px] text-gray-400">{t('qty_short') || 'Qty'}</label>
                            <input
                              id={`sale-add-qty-${line.productId}`}
                              className="input h-9 w-16 text-right text-sm"
                              inputMode="numeric"
                              value={String(line.quantity)}
                              onChange={(event) => {
                                // Whole units only, never below one: a zero or
                                // negative line would ask the server to move
                                // stock the wrong way through an add.
                                const next = Math.max(1, Math.floor(Number(event.target.value) || 1))
                                setAddLines((current) => current.map((row) => (
                                  row.productId === line.productId ? { ...row, quantity: next } : row
                                )))
                              }}
                            />
                          </span>
                          <span className="flex items-center gap-1">
                            <label htmlFor={`sale-add-price-${line.productId}`} className="text-[11px] text-gray-400">{t('unit_price') || 'Unit price'}</label>
                            <input
                              id={`sale-add-price-${line.productId}`}
                              className="input h-9 w-24 text-right text-sm"
                              inputMode="decimal"
                              value={line.priceText}
                              onChange={(event) => {
                                const text = event.target.value
                                setAddLines((current) => current.map((row) => (
                                  row.productId === line.productId
                                    ? { ...row, priceText: text, unitPriceUsd: toNumber(text) }
                                    : row
                                )))
                              }}
                            />
                          </span>
                          <span className="w-20 text-right text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                            {fmtUSD(line.unitPriceUsd * line.quantity)}
                          </span>
                          <button
                            type="button"
                            aria-label={t('remove') || 'Remove'}
                            className="rounded p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                            onClick={() => setAddLines((current) => current.filter((row) => row.productId !== line.productId))}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        {addStockMoves && line.quantity > line.stockQuantity ? (
                          <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                            {translateOr('add_items_over_stock', 'More than the stock this product had a moment ago — the server will refuse if the units are not there.', 'លើសពីស្តុកដែលផលិតផលនេះមានមុននេះបន្តិច — ម៉ាស៊ីនមេនឹងបដិសេធ បើគ្មានចំនួននោះ។')}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3">
                    <DetailRowGroup>
                      <DetailRow
                        label={translateOr('add_items_added_subtotal', 'Added subtotal', 'សរុបរងបន្ថែម')}
                        value={fmtUSD(addedSubtotalUsd)}
                      />
                      <DetailRow
                        label={translateOr('add_items_new_total', 'New total', 'សរុបថ្មី')}
                        value={fmtUSD(projectedTotalUsd)}
                      />
                      {outstandingUsd > 0 || projectedOutstandingUsd > 0 ? (
                        <DetailRow
                          label={translateOr('add_items_new_due', 'New amount due', 'ចំនួនត្រូវបង់ថ្មី')}
                          value={fmtUSD(projectedOutstandingUsd)}
                        />
                      ) : null}
                    </DetailRowGroup>
                  </div>
                  {/* Says out loud whether this write touches stock. The
                      answer is the sale's status (see decision 2 in the
                      Worker's lib/saleLineAddition.ts), and a cashier should
                      not have to know the rule to predict the effect. */}
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    {addStockMoves
                      ? translateOr('add_items_moves_stock', 'These units leave stock now, exactly as they would at checkout.', 'ចំនួននេះនឹងចេញពីស្តុកភ្លាមៗ ដូចពេលទូទាត់ដែរ។')
                      : translateOr('add_items_holds_stock', 'This sale has not taken stock yet, so nothing leaves stock until it is completed.', 'ការលក់នេះមិនទាន់យកស្តុកទេ ដូច្នេះគ្មានអ្វីចេញពីស្តុក រហូតដល់វាបញ្ចប់។')}
                  </p>
                  <button
                    type="button"
                    className="btn-primary mt-3 w-full text-xs"
                    disabled={addSaving || addLines.length === 0}
                    onClick={() => setAddConfirmOpen(true)}
                  >
                    {addSaving ? (t('loading') || 'Saving') : (translateOr('add_items_submit', 'Add to sale', 'បន្ថែមទៅការលក់'))}
                  </button>
                </>
              )}
            </section>
          ) : null}

          {currentStatus === 'cancelled' ? (
            <section className="rounded-xl border border-red-200 bg-red-50/50 p-3 dark:border-red-800/60 dark:bg-red-900/15">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-600 dark:text-red-300">
                {t('cancelled_sale') || 'Cancelled sale'}
              </div>
              {/* Same label/value rows as every other block -- the reason used
                  to be inline prose ("Reason: Mistake -- note"), the only
                  field in the modal whose label sat on the same line as its
                  value with a colon. */}
              <DetailRowGroup>
                <DetailRow
                  label={t('cancel_reason_label') || 'Reason'}
                  value={sale.cancel_reason
                    ? `${sale.cancel_reason === 'mistake'
                      ? (t('cancel_reason_mistake') || 'Mistake')
                      : sale.cancel_reason === 'buyer_refused'
                        ? (t('cancel_reason_buyer_refused') || "Buyer didn't buy")
                        : (t('cancel_reason_other') || 'Other')}${sale.cancel_note ? ` — ${sale.cancel_note}` : ''}`
                    : null}
                />
                <DetailRow
                  label={t('cancelled_by') || 'Cancelled by'}
                  value={[sale.cancelled_by_name, sale.cancelled_at ? fmtTime(sale.cancelled_at) : ''].filter(Boolean).join(' · ') || null}
                />
              </DetailRowGroup>
              {toNumber(sale.cancel_fee_id) > 0 ? (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                  {t('cancel_lost_fee_recorded') || 'A lost fee was recorded on the Expenses page for this cancellation.'}
                </p>
              ) : null}
              {onStatusChange ? (
                <button
                  type="button"
                  className="btn-secondary mt-3 w-full text-xs"
                  disabled={statusSaving}
                  onClick={async () => {
                    // Un-cancel: the backend only accepts the status the
                    // sale was in when cancelled (it re-deducts the
                    // un-returned stock and removes the linked fee row).
                    const target = String(sale.status_before_cancel || 'completed')
                    setStatusSaving(true)
                    try {
                      await onStatusChange(sale.id, target, statusNotes)
                      onClose()
                    } finally {
                      setStatusSaving(false)
                    }
                  }}
                >
                  {statusSaving
                    ? (t('loading') || 'Saving')
                    : `${t('uncancel_sale') || 'Un-cancel'} (${getStatusLabel(String(sale.status_before_cancel || 'completed'), t)})`}
                </button>
              ) : null}
            </section>
          ) : null}

          {!['returned', 'cancelled'].includes(currentStatus) ? (
            <section ref={statusSectionRef} className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t('update_status') || 'Update status'}
              </div>
              <div className="grid gap-3 md:grid-cols-[220px,1fr]">
                <div>
                  <label htmlFor="sale-status-select" className="mb-1 block text-xs text-gray-400">
                    {t('status') || 'Status'}
                  </label>
                  <AppSelect
                    id="sale-status-select"
                    value={newStatus}
                    onChange={(nextValue) => setNewStatus(nextValue)}
                    ariaLabel={t('status') || 'Status'}
                    className="w-full"
                    buttonClassName="h-10 w-full text-sm"
                    menuClassName="min-w-[13rem]"
                    optionClassName="text-sm"
                    options={ALL_STATUSES
                      .filter((status) => !['partial_return', 'returned'].includes(status))
                      // Once returns exist, only cancellation is still a
                      // manual transition (the returns flow owns the rest)
                      .filter((status) => currentStatus !== 'partial_return' || status === 'cancelled' || status === currentStatus)
                      .map((status) => ({ value: status, label: getStatusLabel(status, t) }))}
                  />
                </div>
                <div>
                  <label htmlFor="sale-status-notes" className="mb-1 block text-xs text-gray-400">
                    {t('notes') || 'Notes'}
                  </label>
                  <textarea
                    id="sale-status-notes"
                    className="input min-h-[92px] resize-none text-sm"
                    value={statusNotes}
                    onChange={(event) => setStatusNotes(event.target.value)}
                    placeholder={t('status_notes_placeholder') || 'Optional notes about this status change'}
                  />
                </div>
              </div>
              {needsPaymentEntry ? (
                <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-800/70 dark:bg-emerald-950/20">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                    {translateOr('record_payment', 'Record payment', 'កត់ត្រាការទូទាត់')}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div>
                      <label htmlFor="sale-pay-method" className="mb-1 block text-xs text-gray-400">
                        {t('payment_method') || 'Payment method'}
                      </label>
                      <input
                        id="sale-pay-method"
                        className="input h-10 text-sm"
                        value={payMethod}
                        onChange={(event) => setPayMethod(event.target.value)}
                        placeholder="Cash / ABA / Wing"
                      />
                    </div>
                    <div>
                      <label htmlFor="sale-pay-usd" className="mb-1 block text-xs text-gray-400">USD</label>
                      <input
                        id="sale-pay-usd"
                        className="input h-10 text-sm"
                        inputMode="decimal"
                        value={payUsd}
                        onChange={(event) => setPayUsd(event.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label htmlFor="sale-pay-khr" className="mb-1 block text-xs text-gray-400">KHR</label>
                      <input
                        id="sale-pay-khr"
                        className="input h-10 text-sm"
                        inputMode="numeric"
                        value={payKhr}
                        onChange={(event) => setPayKhr(event.target.value)}
                        placeholder="0"
                      />
                    </div>
                  </div>
                  {payError ? <p className="mt-2 text-xs text-red-600 dark:text-red-400">{payError}</p> : null}
                </div>
              ) : null}
              <button
                type="button"
                className="btn-primary mt-3 w-full text-xs"
                disabled={statusSaving || newStatus === currentStatus}
                onClick={handleStatusUpdate}
              >
                {statusSaving
                  ? (t('loading') || 'Saving')
                  // The translation is a template ("Update to {status}") --
                  // substitute the placeholder instead of appending after it,
                  // which rendered a literal "{status}" in the button.
                  : (() => {
                      const template = t('update_to_status') || 'Update to {status}'
                      const statusLabel = getStatusLabel(newStatus, t)
                      return template.includes('{status}') ? template.replace('{status}', statusLabel) : `${template} ${statusLabel}`
                    })()}
              </button>
            </section>
          ) : null}

          {/* S4-24: the record's actions, at the end of the record. They read
              in the order you reach them -- you have just finished reading the
              sale, so Print and Return are the next things you might do.
              Full-width and stacked below sm so a thumb cannot miss them; a
              row from sm. */}
          {onPrint || onReturn ? (
            <div className="flex flex-col gap-2 border-t border-gray-200 pt-4 sm:flex-row sm:justify-end dark:border-gray-700">
              {onReturn ? (
                <span className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onReturn(sale)}
                    disabled={returnBlockedReason !== ''}
                    className="w-full rounded-lg bg-orange-50 px-4 py-2 text-sm font-medium text-orange-700 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto dark:bg-orange-900/30 dark:text-orange-300 dark:hover:bg-orange-900/50"
                  >
                    {t('return') || 'Return'}
                  </button>
                  {/* Why the action is unavailable stays behind the hint, not
                      as inline prose next to the button. */}
                  {returnBlockedReason ? (
                    <InfoHint text={returnBlockedReason} label={t('return') || 'Return'} />
                  ) : null}
                </span>
              ) : null}
              {onPrint ? (
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    onPrint(sale)
                  }}
                  className="w-full rounded-lg bg-blue-50 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-100 sm:w-auto dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
                >
                  {t('print') || 'Print'}
                </button>
              ) : null}
            </div>
          ) : null}

          {/* The review step. A stock write never leaves this app on a single
              click: the person sees each line, the money it adds, and whether
              stock moves, and confirms that summary. */}
          {addConfirmOpen ? (
            <ConfirmDialog
              t={t}
              title={translateOr('add_items_to_sale', 'Add items to this sale', 'បន្ថែមទំនិញទៅការលក់នេះ')}
              message={sale.receipt_number ? `#${sale.receipt_number}` : undefined}
              items={[
                ...addLines.map((line): ConfirmReviewItem => ({
                  label: line.name,
                  value: `${line.quantity} × ${fmtUSD(line.unitPriceUsd)} = ${fmtUSD(line.unitPriceUsd * line.quantity)}`,
                })),
                {
                  label: translateOr('add_items_added_subtotal', 'Added subtotal', 'សរុបរងបន្ថែម'),
                  value: fmtUSD(addedSubtotalUsd),
                },
                {
                  label: translateOr('add_items_new_total', 'New total', 'សរុបថ្មី'),
                  value: fmtUSD(projectedTotalUsd),
                },
                {
                  label: t('stock') || 'Stock',
                  value: addStockMoves
                    ? translateOr('add_items_confirm_deducts', 'Deducted now', 'កាត់ភ្លាមៗ')
                    : translateOr('add_items_confirm_no_deduct', 'Not deducted yet', 'មិនទាន់កាត់'),
                },
              ]}
              note={translateOr('add_items_undo_note', 'You can undo this from the history bar right after.', 'អ្នកអាចត្រឡប់វិញភ្លាមៗបន្ទាប់ពីនេះ ពីរបារប្រវត្តិ។')}
              confirmLabel={translateOr('add_items_submit', 'Add to sale', 'បន្ថែមទៅការលក់')}
              working={addSaving}
              onConfirm={submitAddItems}
              onClose={() => { if (!addSaving) setAddConfirmOpen(false) }}
            />
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}
