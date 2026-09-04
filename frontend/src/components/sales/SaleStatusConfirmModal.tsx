import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import X from 'lucide-react/dist/esm/icons/x.js'
import Lock from 'lucide-react/dist/esm/icons/lock.js'
import LockOpen from 'lucide-react/dist/esm/icons/unlock.js'
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js'

type TranslateFn = (key: string) => string | undefined

type SaleStatusConfirmModalProps = {
  // What is being changed -- a receipt number for one sale, or an "N sales"
  // label for a bulk change.
  label: string
  // Current status, as the shopper-facing label. Bulk selections can hold
  // several at once, so this may be a joined list (see `mixed`).
  fromLabel: string
  toLabel: string
  mixed?: boolean
  // Does this transition move stock at all (the kernel's held() rule:
  // completed / awaiting_delivery hold units, awaiting_payment / cancelled
  // do not)? Purely for the sentence shown -- the server decides.
  movesStock: boolean
  // S4-2: the "Don't touch stock" option is rendered ONLY for an
  // administrator, and only behind an explicit unlock. The server enforces
  // the same rule (isAdminControlUser in routes/sales.ts) -- this is the
  // convenience half, never the security half.
  canSkipStock: boolean
  // This sale was already marked stock-skipped by an earlier transition, so
  // no stock will move whatever the toggle says. Stated plainly instead of
  // letting the dialog promise a deduction that will not happen.
  alreadySkipped?: boolean
  saving?: boolean
  onClose: () => void
  onConfirm: (skipStock: boolean) => void
  t: TranslateFn
}

// The confirmation the user asked for on every sale status change (2026-09-03:
// "for the sales status in particular when save/update or actions will ask
// confirmation and in the confirmation also option to Don't Touch Stock but
// with a lock, needs unlock.... for other users this doesn't appear").
//
// It states what changes BEFORE it happens -- old status → new status, and
// what that does to stock -- because a bulk status flip is exactly how 9
// already-counted units were deducted a second time on Sep 3.
export default function SaleStatusConfirmModal({
  label,
  fromLabel,
  toLabel,
  mixed = false,
  movesStock,
  canSkipStock,
  alreadySkipped = false,
  saving = false,
  onClose,
  onConfirm,
  t,
}: SaleStatusConfirmModalProps) {
  const [unlocked, setUnlocked] = useState(false)
  const [skipStock, setSkipStock] = useState(false)

  // A fresh target = a fresh decision. The skip must never ride along from
  // the previous sale the dialog was opened for.
  useEffect(() => {
    setUnlocked(false)
    setSkipStock(false)
  }, [label, fromLabel, toLabel])

  const isKhmer = /[ក-៿]/.test(t('cancel') || '')
  const tr = (key: string, fallbackEn: string, fallbackKm = fallbackEn): string => {
    const value = t(key)
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallbackEn
  }

  // Already-skipped sales stay outside the stock ledger no matter what, so
  // the dialog says "no stock will move" for them too.
  const stockWillMove = movesStock && !skipStock && !alreadySkipped

  return createPortal(
    <div className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1050] flex items-end justify-center overflow-y-auto bg-black/50 sm:items-center sm:p-4" onClick={saving ? undefined : onClose}>
      <div className="modal-panel-safe flex w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-md sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 p-4 dark:border-gray-700">
          <div className="min-w-0">
            <h2 className="font-bold text-gray-900 dark:text-white">{tr('sale_status_confirm_title', 'Confirm status change', 'បញ្ជាក់ការប្ដូរស្ថានភាព')}</h2>
            <div className="mt-0.5 truncate text-xs text-gray-400">{label}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" className="min-h-9 max-w-28 truncate rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:hidden" onClick={() => onConfirm(skipStock)} disabled={saving}>{saving ? tr('saving', 'Saving...') : tr('confirm', 'Confirm')}</button>
            <button type="button" onClick={onClose} className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-gray-400 hover:text-gray-600" disabled={saving}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="modal-scroll space-y-3 p-4">
          {/* What changes, before and after -- stated, not implied. */}
          <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{tr('sale_status_confirm_from', 'Current status', 'ស្ថានភាពបច្ចុប្បន្ន')}</div>
                <div className="mt-0.5 truncate text-sm font-semibold text-gray-700 dark:text-gray-200">{fromLabel}</div>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-gray-400" />
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{tr('sale_status_confirm_to', 'New status', 'ស្ថានភាពថ្មី')}</div>
                <div className="mt-0.5 truncate text-sm font-semibold text-blue-700 dark:text-blue-300">{toLabel}</div>
              </div>
            </div>
            {mixed ? (
              <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
                {tr('sale_status_confirm_mixed', 'The selected sales are not all in the same status right now.', 'ការលក់ដែលបានជ្រើសរើស មិនស្ថិតក្នុងស្ថានភាពដូចគ្នាទាំងអស់ទេ។')}
              </div>
            ) : null}
          </div>

          {/* What it does to stock. */}
          <div className={`rounded-xl p-3 text-xs ${stockWillMove ? 'bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200' : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200'}`}>
            {stockWillMove
              ? tr('sale_status_confirm_stock_moves', 'Stock will change with this update.', 'ស្តុកនឹងផ្លាស់ប្ដូរតាមការកែប្រែនេះ។')
              : tr('sale_status_confirm_stock_frozen', 'Stock will not change.', 'ស្តុកនឹងមិនផ្លាស់ប្ដូរទេ។')}
          </div>

          {alreadySkipped ? (
            <div className="rounded-xl bg-gray-100 p-3 text-xs text-gray-600 dark:bg-gray-700/40 dark:text-gray-300">
              {tr('sale_status_already_skipped', 'This sale is already marked as not touching stock, so no stock moves for it.', 'ការលក់នេះត្រូវបានសម្គាល់ថាមិនប៉ះស្តុករួចហើយ ដូច្នេះស្តុកមិនផ្លាស់ប្ដូរទេ។')}
            </div>
          ) : null}

          {/* S4-2: admin only, and behind a lock the admin has to open. */}
          {canSkipStock && !alreadySkipped ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-700/50 dark:bg-amber-900/20">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-800 dark:text-amber-200">
                  {unlocked ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                  {tr('dont_touch_stock', "Don't touch stock", 'កុំប៉ះស្តុក')}
                  <span className="text-amber-600/80 dark:text-amber-300/70">({tr('admin_only', 'admin only', 'អ្នកគ្រប់គ្រងតែប៉ុណ្ណោះ')})</span>
                </div>
                {!unlocked ? (
                  <button
                    type="button"
                    className="shrink-0 rounded-lg border border-amber-300 px-2.5 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-600 dark:text-amber-200 dark:hover:bg-amber-800/40"
                    onClick={() => setUnlocked(true)}
                    disabled={saving}
                  >
                    {tr('unlock', 'Unlock', 'ដោះសោ')}
                  </button>
                ) : null}
              </div>
              {unlocked ? (
                <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs text-amber-900 dark:text-amber-100">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={skipStock}
                    onChange={(event) => setSkipStock(event.target.checked)}
                    disabled={saving}
                  />
                  <span>{tr('dont_touch_stock_hint', 'For old-system sales whose stock was already counted. The status changes and no stock moves.', 'សម្រាប់ការលក់ពីប្រព័ន្ធចាស់ ដែលបានរាប់ចូលស្តុករួចហើយ។ ស្ថានភាពប្ដូរ តែស្តុកមិនផ្លាស់ប្ដូរទេ។')}</span>
                </label>
              ) : (
                <div className="mt-1 text-[11px] text-amber-700/80 dark:text-amber-300/70">
                  {tr('dont_touch_stock_locked', 'Unlock to change a status without moving stock.', 'ដោះសោ ដើម្បីប្ដូរស្ថានភាពដោយមិនផ្លាស់ប្ដូរស្តុក។')}
                </div>
              )}
              {skipStock ? (
                <div className="mt-2 rounded-lg bg-amber-100 px-2.5 py-2 text-[11px] font-medium text-amber-900 dark:bg-amber-800/40 dark:text-amber-100">
                  {tr('dont_touch_stock_warning', 'Recorded on the sale: this status change moved no stock, on purpose. Later changes to this sale will not move stock either.', 'កត់ត្រាលើការលក់៖ ការប្ដូរស្ថានភាពនេះមិនផ្លាស់ប្ដូរស្តុកដោយចេតនា។ ការប្ដូរជាបន្តបន្ទាប់លើការលក់នេះ ក៏មិនផ្លាស់ប្ដូរស្តុកដែរ។')}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="hidden items-center justify-end gap-2 border-t border-gray-200 p-4 dark:border-gray-700 sm:flex">
          <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={onClose} disabled={saving}>{tr('cancel', 'Cancel', 'បោះបង់')}</button>
          <button type="button" className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => onConfirm(skipStock)} disabled={saving}>
            {saving ? tr('saving', 'Saving...') : tr('confirm', 'Confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
