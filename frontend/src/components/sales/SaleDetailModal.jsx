import { useMemo, useState } from 'react'
import { fmtTime } from '../../utils/formatters'
import StatusBadge, { ALL_STATUSES, getStatusLabel } from './StatusBadge'

function InfoBlock({ label, value, mono = false, badge = false }) {
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

function parseItems(raw) {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string') return []
  try {
    return JSON.parse(raw)
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
}) {
  const [newStatus, setNewStatus] = useState(sale?.sale_status || 'completed')
  const [statusNotes, setStatusNotes] = useState('')
  const [statusSaving, setStatusSaving] = useState(false)
  const [membershipNumber, setMembershipNumber] = useState(sale?.customer_membership_number || '')
  const [membershipSaving, setMembershipSaving] = useState(false)
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const translateOr = (key, fallbackEn, fallbackKm = fallbackEn) => {
    const value = t(key)
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallbackEn
  }

  const items = useMemo(() => parseItems(sale?.items), [sale?.items])

  if (!sale) return null

  const currentStatus = sale.sale_status || 'completed'
  const totalUsd = sale.total_usd || sale.total || 0
  const totalKhr = sale.total_khr || 0
  const refundUsd = sale.refund_usd || 0
  const refundKhr = sale.refund_khr || 0
  const membershipDiscountUsd = sale.membership_discount_usd || 0
  const membershipDiscountKhr = sale.membership_discount_khr || 0
  const membershipPointsRedeemed = sale.membership_points_redeemed || 0
  const baseDiscountUsd = sale.discount_usd || 0
  const taxUsd = sale.tax_usd || 0
  const subtotalUsd = sale.subtotal_usd || 0

  const handleStatusUpdate = async () => {
    if (!onStatusChange || newStatus === currentStatus) return
    setStatusSaving(true)
    try {
      await onStatusChange(sale.id, newStatus, statusNotes)
      onClose()
    } finally {
      setStatusSaving(false)
    }
  }

  const handleMembershipAttach = async () => {
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

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:max-w-3xl sm:rounded-2xl dark:bg-gray-800"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <div>
            <div className="font-mono text-base font-bold text-gray-900 dark:text-white">{sale.receipt_number}</div>
            <div className="mt-1 text-xs text-gray-400">{fmtTime(sale.created_at)}</div>
          </div>
          <div className="flex items-center gap-2">
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
              className="flex h-8 w-8 items-center justify-center text-2xl leading-none text-gray-400 hover:text-gray-600"
              aria-label={t('close') || 'Close'}
            >
              ×
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
                <InfoBlock label={t('payment_method') || 'Payment method'} value={sale.payment_method} badge />
                <InfoBlock label={t('branch') || 'Branch'} value={sale.branch_name} />
                <InfoBlock label={t('status') || 'Status'} value={getStatusLabel(currentStatus, t)} />
                <InfoBlock label={t('timezone') || 'Timezone'} value={sale.device_tz} mono />
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
                      className="btn-primary whitespace-nowrap text-sm"
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

            <section className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t('totals') || 'Totals'}
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span>{t('subtotal') || 'Subtotal'}</span><span>{fmtUSD(subtotalUsd)}</span></div>
                {baseDiscountUsd > 0 ? (
                  <div className="flex justify-between text-red-600 dark:text-red-400"><span>{t('discount') || 'Store discount'}</span><span>-{fmtUSD(baseDiscountUsd)}</span></div>
                ) : null}
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
                {(sale.amount_paid_usd || 0) > 0 ? (
                  <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>{t('amount_paid') || 'Amount paid'}</span>
                    <span>{fmtUSD(sale.amount_paid_usd || 0)}</span>
                  </div>
                ) : null}
                {(sale.change_usd || 0) > 0 ? (
                  <div className="flex justify-between text-xs text-blue-600 dark:text-blue-400">
                    <span>{t('change') || 'Change'}</span>
                    <span>{fmtUSD(sale.change_usd || 0)}</span>
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
              <div className="space-y-2">
                {items.map((item, index) => {
                  const qty = item.quantity || item.qty || 1
                  const unitUsd = item.applied_price_usd ?? item.price_usd ?? item.price ?? 0
                  const unitKhr = item.applied_price_khr ?? item.price_khr ?? 0
                  const lineUsd = unitUsd * qty
                  const lineKhr = unitKhr * qty
                  return (
                    <div key={`${item.product_id || item.id || index}-${index}`} className="flex items-start justify-between gap-3 border-b border-gray-100 pb-2 last:border-b-0 last:pb-0 dark:border-gray-700">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-gray-900 dark:text-white">{item.product_name || item.name}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {qty} × {fmtUSD(unitUsd)}
                        </div>
                        {item.branch_name ? (
                          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            {t('branch') || 'Branch'}: {item.branch_name}
                          </div>
                        ) : null}
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-gray-900 dark:text-white">{fmtUSD(lineUsd)}</div>
                        {lineKhr > 0 ? <div className="text-xs text-gray-400">{fmtKHR(lineKhr)}</div> : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {!['returned', 'cancelled'].includes(currentStatus) ? (
            <section className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t('update_status') || 'Update status'}
              </div>
              <div className="grid gap-3 md:grid-cols-[220px,1fr]">
                <div>
                  <label htmlFor="sale-status-select" className="mb-1 block text-xs text-gray-400">
                    {t('status') || 'Status'}
                  </label>
                  <select
                    id="sale-status-select"
                    className="input text-sm"
                    value={newStatus}
                    onChange={(event) => setNewStatus(event.target.value)}
                  >
                    {ALL_STATUSES.filter((status) => !['partial_return', 'returned'].includes(status)).map((status) => (
                      <option key={status} value={status}>{getStatusLabel(status, t)}</option>
                    ))}
                  </select>
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
              <button
                type="button"
                className="btn-primary mt-3 w-full text-sm"
                disabled={statusSaving || newStatus === currentStatus}
                onClick={handleStatusUpdate}
              >
                {statusSaving
                  ? (t('loading') || 'Saving')
                  : `${t('update_to_status') || 'Update to'} ${getStatusLabel(newStatus, t)}`}
              </button>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  )
}
