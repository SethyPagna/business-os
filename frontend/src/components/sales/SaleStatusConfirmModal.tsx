import { useEffect, useState } from 'react'
import Lock from 'lucide-react/dist/esm/icons/lock.js'
import LockOpen from 'lucide-react/dist/esm/icons/unlock.js'
import ConfirmDialog from '../shared/ConfirmDialog.tsx'
import InfoHint from '../shared/InfoHint.tsx'

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
  // completed / awaiting_payment / awaiting_delivery / return statuses hold
  // units, while cancelled holds none)? Purely for the sentence shown -- the
  // server decides.
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

  return (
    <ConfirmDialog
      title={tr('sale_status_confirm_title', 'Confirm status change', 'បញ្ជាក់ការប្ដូរស្ថានភាព')}
      message={label}
      items={[
        { label: tr('sale_status_confirm_from', 'Current status', 'ស្ថានភាពបច្ចុប្បន្ន'), value: fromLabel },
        { label: tr('sale_status_confirm_to', 'New status', 'ស្ថានភាពថ្មី'), value: toLabel },
        {
          label: tr('stock', 'Stock', 'ស្តុក'),
          value: stockWillMove
            ? tr('sale_status_confirm_stock_moves', 'Stock will change with this update.', 'ស្តុកនឹងផ្លាស់ប្ដូរតាមការកែប្រែនេះ។')
            : tr('sale_status_confirm_stock_frozen', 'Stock will not change.', 'ស្តុកនឹងមិនផ្លាស់ប្ដូរទេ។'),
        },
      ]}
      note={mixed ? tr('sale_status_confirm_mixed', 'The selected sales are not all in the same status right now.', 'ការលក់ដែលបានជ្រើសរើស មិនស្ថិតក្នុងស្ថានភាពដូចគ្នាទាំងអស់ទេ។') : undefined}
      working={saving}
      workingLabel={tr('saving', 'Saving...')}
      confirmLabel={tr('confirm', 'Confirm')}
      cancelLabel={tr('cancel', 'Cancel', 'បោះបង់')}
      onConfirm={() => onConfirm(skipStock)}
      onClose={onClose}
      t={t}
    >
      {alreadySkipped ? (
        <div className="rounded-xl bg-gray-100 p-3 text-xs text-gray-600 dark:bg-gray-700/40 dark:text-gray-300">
          {tr('sale_status_already_skipped', 'This sale is already marked as not touching stock, so no stock moves for it.', 'ការលក់នេះត្រូវបានសម្គាល់ថាមិនប៉ះស្តុករួចហើយ ដូច្នេះស្តុកមិនផ្លាស់ប្ដូរទេ។')}
        </div>
      ) : null}

      {/* S4-2: admin only, and behind a lock the admin has to open. */}
      {canSkipStock && !alreadySkipped ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-700/50 dark:bg-amber-900/20">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium leading-relaxed text-amber-800 dark:text-amber-200">
              {unlocked ? <LockOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
              <span className="min-w-0">{tr('dont_touch_stock', "Don't touch stock", 'កុំប៉ះស្តុក')}</span>
              <InfoHint
                label={tr('dont_touch_stock', "Don't touch stock", 'កុំប៉ះស្តុក')}
                text={`${tr('admin_only', 'admin only', 'អ្នកគ្រប់គ្រងតែប៉ុណ្ណោះ')}

${unlocked
                  ? tr('dont_touch_stock_hint', 'For old-system sales whose stock was already counted. The status changes and no stock moves.', 'សម្រាប់ការលក់ពីប្រព័ន្ធចាស់ ដែលបានរាប់ចូលស្តុករួចហើយ។ ស្ថានភាពប្ដូរ តែស្តុកមិនផ្លាស់ប្ដូរទេ។')
                  : tr('dont_touch_stock_locked', 'Unlock to change a status without moving stock.', 'ដោះសោ ដើម្បីប្ដូរស្ថានភាពដោយមិនផ្លាស់ប្ដូរស្តុក។')}`}
              />
            </div>
            {!unlocked ? (
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-600 dark:text-amber-200 dark:hover:bg-amber-800/40"
                onClick={() => setUnlocked(true)}
                disabled={saving}
                aria-label={tr('unlock', 'Unlock', 'ដោះសោ')}
                title={tr('unlock', 'Unlock', 'ដោះសោ')}
              >
                <LockOpen className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
            {unlocked ? (
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0"
                checked={skipStock}
                onChange={(event) => setSkipStock(event.target.checked)}
                disabled={saving}
                aria-label={tr('dont_touch_stock', "Don't touch stock", 'កុំប៉ះស្តុក')}
              />
            ) : null}
          </div>
          {skipStock ? (
            <div className="mt-2 rounded-lg bg-amber-100 px-2.5 py-2 text-[11px] font-medium leading-relaxed text-amber-900 dark:bg-amber-800/40 dark:text-amber-100">
              {tr('dont_touch_stock_warning', 'Recorded on the sale: this status change moved no stock, on purpose. Later changes to this sale will not move stock either.', 'កត់ត្រាលើការលក់៖ ការប្ដូរស្ថានភាពនេះមិនផ្លាស់ប្ដូរស្តុកដោយចេតនា។ ការប្ដូរជាបន្តបន្ទាប់លើការលក់នេះ ក៏មិនផ្លាស់ប្ដូរស្តុកដែរ។')}
            </div>
          ) : null}
        </div>
      ) : null}
    </ConfirmDialog>
  )
}
