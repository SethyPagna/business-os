import { useMemo, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import X from 'lucide-react/dist/esm/icons/x.js'
import { fmtTime, fmtTimezoneLabel } from '../../utils/formatters.ts'
import AppSelect from '../shared/AppSelect.tsx'
import StatusBadge, { ALL_STATUSES, getStatusLabel } from './StatusBadge.tsx'

type TranslateFn = (key: string) => string
type MoneyFormatter = (value: number | string) => string

interface InfoBlockProps {
  label: string
  value?: string | number | null
  mono?: boolean
  badge?: boolean
}

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
}

interface SaleDetail {
  id: string | number
  receipt_number?: string | null
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
  t: TranslateFn
  fmtUSD: MoneyFormatter
  fmtKHR: MoneyFormatter
}

function toNumber(value: number | string | null | undefined): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function InfoBlock({ label, value, mono = false, badge = false }: InfoBlockProps) {
  if (value == null || value === '') return null
  return (
    <div>
      <div className="mb-1 text-xs text-gray-400">{label}</div>
      {badge ? (
        <span className="badge-blue text-xs">{value}</span>
      ) : (
        <div className={`text-sm font-medium text-gray-800 dark:text-gray-200 ${mono ? 'font-mono' : ''}`}>
          {value}
        </div>
      )}
    </div>
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
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const translateOr = (key: string, fallbackEn: string, fallbackKm = fallbackEn): string => {
    const value = t(key)
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallbackEn
  }

  const items = useMemo(() => parseItems(sale?.items), [sale?.items])

  if (!sale) return null

  const currentStatus = sale.sale_status || 'completed'
  const totalUsd = toNumber(sale.total_usd || sale.total)
  const totalKhr = toNumber(sale.total_khr)
  const refundUsd = toNumber(sale.refund_usd)
  const refundKhr = toNumber(sale.refund_khr)
  const membershipDiscountUsd = toNumber(sale.membership_discount_usd)
  const membershipDiscountKhr = toNumber(sale.membership_discount_khr)
  const membershipPointsRedeemed = toNumber(sale.membership_points_redeemed)
  const baseDiscountUsd = toNumber(sale.discount_usd)
  const taxUsd = toNumber(sale.tax_usd)
  const subtotalUsd = toNumber(sale.subtotal_usd)
  const amountPaidUsd = toNumber(sale.amount_paid_usd)
  const amountPaidKhr = toNumber(sale.amount_paid_khr)
  const changeUsd = toNumber(sale.change_usd)
  const changeKhr = toNumber(sale.change_khr)
  const discountKhr = toNumber(sale.discount_khr)
  const taxKhr = toNumber(sale.tax_khr)
  const deliveryFeeUsd = toNumber(sale.delivery_fee_usd)
  const deliveryFeeKhr = toNumber(sale.delivery_fee_khr)
  const deliveryActualCostUsd = toNumber(sale.delivery_actual_cost_usd)
  const deliveryActualCostKhr = toNumber(sale.delivery_actual_cost_khr)
  const isDelivery = !!toNumber(sale.is_delivery) || !!String(sale.delivery_contact_name || '').trim()
  const paymentCurrency = String(sale.payment_currency || '').trim()
  const paymentDetails = parsePaymentDetails(sale.payment_details)
  // Outstanding balance: an on-credit / partially-paid sale (amount_paid below
  // total). Shown so the admin detail no longer hides "still owed".
  const outstandingUsd = Math.max(0, Math.round((totalUsd - amountPaidUsd) * 100) / 100)

  // Y10: an awaiting-payment sale with nothing recorded gets its payment
  // entered HERE, at completion time -- the whole point of the status.
  const needsPaymentEntry = currentStatus === 'awaiting_payment'
    && (newStatus === 'completed' || newStatus === 'awaiting_delivery')
    && amountPaidUsd <= 0 && amountPaidKhr <= 0

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
        <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-gray-200 p-4 dark:border-gray-700">
          {/* Long receipt numbers remain fully available through horizontal
              touch scrolling while the status and actions stay in view. */}
          <div className="min-w-0 flex-1">
            <div className="detail-scroll-text font-mono text-sm font-bold text-gray-900 dark:text-white sm:text-base" title={sale.receipt_number || undefined}>{sale.receipt_number}</div>
            <div className="mt-1 text-xs text-gray-400">{fmtTime(sale.created_at)}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
            <StatusBadge status={currentStatus} t={t} />
            {onPrint ? (
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onPrint(sale)
                }}
                className="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
              >
                {t('print') || 'Print'}
              </button>
            ) : null}
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

        <div className="modal-scroll space-y-4 p-4">
          <div className="grid gap-4 md:grid-cols-3">
            <section className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t('sale') || 'Sale'}
              </div>
              <div className="grid gap-3">
                <InfoBlock label={t('cashier') || 'Cashier'} value={sale.cashier_name} />
                {/* Z8: an awaiting-payment (credit) sale carries no method yet
                    -- the field becomes a Record-payment affordance right here
                    "near the payment method", per the user. */}
                {currentStatus === 'awaiting_payment' ? (
                  <div>
                    <div className="text-xs text-gray-400">{t('payment_method') || 'Payment method'}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
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
                    </div>
                  </div>
                ) : (
                  <InfoBlock label={t('payment_method') || 'Payment method'} value={sale.payment_method} badge />
                )}
                {paymentCurrency && paymentCurrency.toUpperCase() !== 'USD' ? (
                  <InfoBlock label={translateOr('payment_currency', 'Payment currency', 'រូបិយប័ណ្ណទូទាត់')} value={paymentCurrency} />
                ) : null}
                {paymentDetails.length > 1 ? (
                  <div>
                    <div className="mb-1 text-xs text-gray-400">{translateOr('payment_breakdown', 'Payment breakdown', 'ការបំបែកការទូទាត់')}</div>
                    <div className="space-y-0.5 text-sm text-gray-800 dark:text-gray-200">
                      {paymentDetails.map((detail, index) => (
                        <div key={`${detail.method}-${index}`} className="flex justify-between gap-3">
                          <span className="detail-scroll-text min-w-0 flex-1">{detail.method}</span>
                          <span className="shrink-0 tabular-nums">{fmtUSD(detail.amount_usd)}{detail.amount_khr > 0 ? ` · ${fmtKHR(detail.amount_khr)}` : ''}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <InfoBlock label={t('branch') || 'Branch'} value={sale.branch_name} />
                <InfoBlock label={t('status') || 'Status'} value={getStatusLabel(currentStatus, t)} />
                <InfoBlock label={t('timezone') || 'Timezone'} value={fmtTimezoneLabel(sale.device_tz)} mono />
                <InfoBlock label={t('device') || 'Device'} value={sale.device_name} />
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t('customer') || 'Customer'}
              </div>
              <div className="grid gap-3">
                <InfoBlock label={t('customer_name') || 'Customer'} value={sale.customer_name} />
                <InfoBlock label={t('phone') || 'Phone'} value={sale.customer_phone} />
                <InfoBlock label={t('address') || 'Address'} value={sale.customer_address} />
                <InfoBlock label={t('membership') || 'Membership'} value={sale.customer_membership_number} mono />
                <div>
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
              </div>
            </section>

            {isDelivery ? (
              <section className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {translateOr('delivery', 'Delivery', 'ការដឹកជញ្ជូន')}
                </div>
                <div className="grid gap-3">
                  <InfoBlock label={translateOr('driver', 'Driver', 'អ្នកបើកបរ')} value={sale.delivery_contact_name} />
                  <InfoBlock label={t('phone') || 'Phone'} value={sale.delivery_contact_phone} />
                  <InfoBlock label={t('address') || 'Address'} value={sale.delivery_contact_address} />
                </div>
              </section>
            ) : null}

            <section className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t('totals') || 'Totals'}
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span>{t('subtotal') || 'Subtotal'}</span><span>{fmtUSD(subtotalUsd)}</span></div>
                {baseDiscountUsd > 0 ? (
                  <div className="flex justify-between text-red-600 dark:text-red-400"><span>{t('discount') || 'Store discount'}</span><span>-{fmtUSD(baseDiscountUsd)}</span></div>
                ) : null}
                {discountKhr > 0 ? <div className="text-right text-xs text-gray-400">-{fmtKHR(discountKhr)}</div> : null}
                {membershipDiscountUsd > 0 ? (
                  <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                    <span>{t('membership_discount') || 'Membership discount'}</span>
                    <span>-{fmtUSD(membershipDiscountUsd)}</span>
                  </div>
                ) : null}
                {membershipDiscountKhr > 0 ? (
                  <div className="text-right text-xs text-gray-400">{fmtKHR(membershipDiscountKhr)}</div>
                ) : null}
                {membershipPointsRedeemed > 0 ? (
                  <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>{t('points_redeemed') || 'Points redeemed'}</span>
                    <span>{membershipPointsRedeemed}</span>
                  </div>
                ) : null}
                {taxUsd > 0 ? (
                  <div className="flex justify-between"><span>{t('tax') || 'Tax'}</span><span>{fmtUSD(taxUsd)}</span></div>
                ) : null}
                {taxKhr > 0 ? <div className="text-right text-xs text-gray-400">{fmtKHR(taxKhr)}</div> : null}
                {deliveryFeeUsd > 0 || deliveryFeeKhr > 0 ? (
                  <div className="flex justify-between"><span>{translateOr('delivery_fee', 'Delivery fee', 'ថ្លៃដឹកជញ្ជូន')}</span><span>{fmtUSD(deliveryFeeUsd)}</span></div>
                ) : null}
                {deliveryFeeKhr > 0 ? <div className="text-right text-xs text-gray-400">{fmtKHR(deliveryFeeKhr)}</div> : null}
                {refundUsd > 0 ? (
                  <div className="flex justify-between text-orange-600 dark:text-orange-400">
                    <span>{t('returns_refunded') || 'Refunded by returns'}</span>
                    <span>-{fmtUSD(refundUsd)}</span>
                  </div>
                ) : null}
                {refundKhr > 0 ? <div className="text-right text-xs text-gray-400">{fmtKHR(refundKhr)}</div> : null}
                <div className="mt-2 flex justify-between border-t border-gray-200 pt-2 text-base font-bold dark:border-gray-700">
                  <span>{t('total') || 'Total'}</span>
                  <span>{fmtUSD(totalUsd)}</span>
                </div>
                {totalKhr > 0 ? <div className="text-right text-xs text-gray-400">{fmtKHR(totalKhr)}</div> : null}
                {amountPaidUsd > 0 ? (
                  <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>{t('amount_paid') || 'Amount paid'}</span>
                    <span>{fmtUSD(amountPaidUsd)}</span>
                  </div>
                ) : null}
                {amountPaidKhr > 0 ? <div className="text-right text-xs text-gray-400">{fmtKHR(amountPaidKhr)}</div> : null}
                {outstandingUsd > 0 && currentStatus !== 'cancelled' ? (
                  <div className="flex justify-between text-xs font-semibold text-amber-600 dark:text-amber-400">
                    <span>{translateOr('outstanding_balance', 'Outstanding (on credit)', 'នៅជំពាក់')}{sale.credit_due_date ? ` · ${translateOr('due', 'due', 'កំណត់')} ${String(sale.credit_due_date).slice(0, 10)}` : ''}</span>
                    <span>{fmtUSD(outstandingUsd)}</span>
                  </div>
                ) : null}
                {changeUsd > 0 ? (
                  <div className="flex justify-between text-xs text-blue-600 dark:text-blue-400">
                    <span>{t('change') || 'Change'}</span>
                    <span>{fmtUSD(changeUsd)}</span>
                  </div>
                ) : null}
                {changeKhr > 0 ? <div className="text-right text-xs text-gray-400">{fmtKHR(changeKhr)}</div> : null}
                {deliveryActualCostUsd > 0 || deliveryActualCostKhr > 0 ? (
                  <div className="mt-1 flex justify-between border-t border-dashed border-gray-200 pt-1 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
                    <span>{translateOr('delivery_actual_cost', 'Actual delivery cost', 'ថ្លៃដឹកជញ្ជូនពិត')}</span>
                    <span>{fmtUSD(deliveryActualCostUsd)}{deliveryActualCostKhr > 0 ? ` · ${fmtKHR(deliveryActualCostKhr)}` : ''}</span>
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          {sale.notes ? (
            <div className="rounded-xl bg-gray-50 p-3 text-sm text-gray-600 dark:bg-gray-700/50 dark:text-gray-300">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{t('notes') || 'Notes'}</div>
              {sale.notes}
            </div>
          ) : null}

          <section className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {t('items') || 'Items'} ({items.length})
            </div>
            {items.length === 0 ? (
              <p className="text-sm text-gray-400">{t('no_item_details') || 'No item details available.'}</p>
            ) : (
              <>
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full min-w-[34rem] text-sm">
                    <thead className="border-y border-gray-200 bg-gray-50 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:bg-gray-900/35 dark:text-gray-400">
                      <tr>
                        <th className="px-2 py-1.5">{t('product') || 'Product'}</th>
                        <th className="px-2 py-1.5 text-right">{t('quantity') || 'Qty'}</th>
                        <th className="px-2 py-1.5 text-right">{t('price') || 'Unit price'}</th>
                        <th className="px-2 py-1.5 text-right">{t('total') || 'Total'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {items.map((item, index) => {
                        const qty = toNumber(item.quantity || item.qty || 1) || 1
                        const unitUsd = toNumber(item.applied_price_usd ?? item.price_usd ?? item.price)
                        const unitKhr = toNumber(item.applied_price_khr ?? item.price_khr)
                        const lineUsd = unitUsd * qty
                        const lineKhr = unitKhr * qty
                        return (
                          <tr key={`${item.product_id || item.id || index}-${index}`}>
                            <td className="max-w-0 px-2 py-1.5"><div className="detail-scroll-text font-medium text-gray-900 dark:text-white">{item.product_name || item.name}</div>{item.branch_name ? <div className="detail-scroll-text text-[11px] text-gray-400">{item.branch_name}</div> : null}</td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-gray-700 dark:text-gray-200">{qty}</td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-gray-700 dark:text-gray-200">{fmtUSD(unitUsd)}{unitKhr > 0 ? <div className="text-[11px] text-gray-400">{fmtKHR(unitKhr)}</div> : null}</td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums text-gray-900 dark:text-white">{fmtUSD(lineUsd)}{lineKhr > 0 ? <div className="text-[11px] font-normal text-gray-400">{fmtKHR(lineKhr)}</div> : null}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="space-y-2 sm:hidden">
                  {items.map((item, index) => {
                    const qty = toNumber(item.quantity || item.qty || 1) || 1
                    const unitUsd = toNumber(item.applied_price_usd ?? item.price_usd ?? item.price)
                    const lineUsd = unitUsd * qty
                    const lineKhr = toNumber(item.applied_price_khr ?? item.price_khr) * qty
                    return (
                      <div key={`${item.product_id || item.id || index}-${index}`} className="flex items-start justify-between gap-3 rounded-lg bg-gray-50 px-2.5 py-2 dark:bg-gray-900/35">
                        <div className="min-w-0 flex-1"><div className="detail-scroll-text text-sm font-medium text-gray-900 dark:text-white">{item.product_name || item.name}</div><div className="text-xs text-gray-500 dark:text-gray-400">{qty} × {fmtUSD(unitUsd)}</div>{item.branch_name ? <div className="detail-scroll-text mt-0.5 text-[11px] text-gray-400">{item.branch_name}</div> : null}</div>
                        <div className="shrink-0 text-right text-sm font-semibold tabular-nums text-gray-900 dark:text-white">{fmtUSD(lineUsd)}{lineKhr > 0 ? <div className="text-[11px] font-normal text-gray-400">{fmtKHR(lineKhr)}</div> : null}</div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </section>

          {currentStatus === 'cancelled' ? (
            <section className="rounded-xl border border-red-200 bg-red-50/50 p-3 dark:border-red-800/60 dark:bg-red-900/15">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-600 dark:text-red-300">
                {t('cancelled_sale') || 'Cancelled sale'}
              </div>
              <div className="space-y-1 text-sm text-gray-700 dark:text-gray-200">
                {sale.cancel_reason ? (
                  <div>
                    <span className="text-gray-400">{t('cancel_reason_label') || 'Reason'}: </span>
                    {sale.cancel_reason === 'mistake'
                      ? (t('cancel_reason_mistake') || 'Mistake')
                      : sale.cancel_reason === 'buyer_refused'
                        ? (t('cancel_reason_buyer_refused') || "Buyer didn't buy")
                        : (t('cancel_reason_other') || 'Other')}
                    {sale.cancel_note ? ` -- ${sale.cancel_note}` : ''}
                  </div>
                ) : null}
                {sale.cancelled_by_name || sale.cancelled_at ? (
                  <div className="text-xs text-gray-400">
                    {[sale.cancelled_by_name, sale.cancelled_at ? fmtTime(sale.cancelled_at) : ''].filter(Boolean).join(' · ')}
                  </div>
                ) : null}
                {toNumber(sale.cancel_fee_id) > 0 ? (
                  <div className="text-xs text-amber-700 dark:text-amber-300">
                    {t('cancel_lost_fee_recorded') || 'A lost fee was recorded on the Expenses page for this cancellation.'}
                  </div>
                ) : null}
              </div>
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
        </div>
      </div>
    </div>,
    document.body,
  )
}
