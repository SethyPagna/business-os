import { useEffect, useMemo, useRef, useState } from 'react'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2.js'
import DatabaseBackup from 'lucide-react/dist/esm/icons/database-backup.js'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check.js'
import { useApp as useAppFromContext } from '../../AppContext.tsx'
import {
  LEGACY_SUBTOTAL_REPAIR_CONFIRMATION,
  applyLegacySubtotalRepair,
  previewLegacySubtotalRepair,
  type LegacySubtotalRepairApplyResponse,
  type LegacySubtotalRepairPreview,
  type LegacySubtotalRepairRequest,
  type LegacySubtotalRepairSale,
} from '../../api/legacySubtotalRepairTransport.ts'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'
import { refreshAppData } from '../../utils/appRefresh.ts'
import { isoToDisplayDate } from '../../utils/dateEntry.ts'
import { registerDirtyWork } from '../../utils/dirtyWork.ts'
import ConfirmDialog from '../shared/ConfirmDialog.tsx'

type Translate = (key: string, fallback?: string) => string | undefined
type AppContextValue = {
  t?: Translate
  notify: (message: string, type?: string) => void
  hasPermission: (permission: string) => boolean
}
type ApplyFailure = { message: string; uncertain: boolean }

const useApp = useAppFromContext as () => AppContextValue

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown error')
}

function errorStatus(error: unknown): number {
  return Number((error as { status?: unknown } | null)?.status || 0)
}

function isUncertainFailure(error: unknown): boolean {
  const status = errorStatus(error)
  return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500
}

function fourDecimalUsd(value: string): string {
  return `$${value}`
}

function LegacySubtotalRepair() {
  const { t, notify, hasPermission } = useApp()
  const T = (key: string, fallback: string) => (typeof t === 'function' ? t(key, fallback) || fallback : fallback)
  const permitted = hasPermission('backup_restore')
  const [preview, setPreview] = useState<LegacySubtotalRepairPreview | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [applyLoading, setApplyLoading] = useState(false)
  const [applyFailure, setApplyFailure] = useState<ApplyFailure | null>(null)
  const [applyResult, setApplyResult] = useState<LegacySubtotalRepairApplyResponse | null>(null)
  const [needsNewPreview, setNeedsNewPreview] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [typedConfirmation, setTypedConfirmation] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const previewInFlight = useRef(false)
  const applyInFlight = useRef(false)
  const pendingConfirmationRef = useRef(false)

  const sales = useMemo<LegacySubtotalRepairSale[]>(() => preview?.request.manifest.sales || [], [preview])
  const request: LegacySubtotalRepairRequest | null = preview?.request || null
  const confirmed = acknowledged && typedConfirmation === LEGACY_SUBTOTAL_REPAIR_CONFIRMATION
  const completed = applyResult?.success === true
  const repairTitle = T('legacy_subtotal_title', 'Repair September 2–3 legacy subtotals')
  pendingConfirmationRef.current = confirmOpen

  useEffect(() => registerDirtyWork({
    key: 'legacy-subtotal-repair-confirmation',
    pageId: 'settings',
    label: repairTitle,
    isDirty: () => pendingConfirmationRef.current,
    discard: () => {
      if (!applyInFlight.current) setConfirmOpen(false)
    },
  }), [repairTitle])

  if (!permitted) return null

  const loadPreview = async () => {
    if (!hasPermission('backup_restore')) return notify(T('access_denied', 'No permission'), 'error')
    if (!beginSingleAction(previewInFlight, { blocked: previewLoading || applyLoading || completed })) return
    setPreviewLoading(true)
    setPreviewError('')
    setApplyFailure(null)
    setNeedsNewPreview(false)
    setPreview(null)
    setAcknowledged(false)
    setTypedConfirmation('')
    try {
      const result = await previewLegacySubtotalRepair()
      if (!result.success) {
        setPreviewError(result.error)
        return
      }
      setPreview(result)
    } catch (error) {
      setPreviewError(errorMessage(error))
    } finally {
      finishSingleAction(previewInFlight)
      setPreviewLoading(false)
    }
  }

  const applyRepair = async () => {
    if (!hasPermission('backup_restore')) return notify(T('access_denied', 'No permission'), 'error')
    if (!request || !confirmed || needsNewPreview || completed) return
    if (!beginSingleAction(applyInFlight, { blocked: applyLoading })) return
    setApplyLoading(true)
    setApplyFailure(null)
    try {
      // `request` is the frozen object returned by the preview. Reuse it
      // verbatim after a timeout/lost response; never regenerate a manifest
      // behind the operator's back.
      const result = await applyLegacySubtotalRepair(request)
      if (!result?.success) {
        setApplyFailure({ message: result?.error || T('legacy_subtotal_apply_failed', 'The repair was not applied.'), uncertain: false })
        return
      }
      setApplyResult(result)
      notify(result.message || T('legacy_subtotal_apply_success', 'Legacy subtotals repaired.'), 'success')
      // The server owns the single durable action-history/audit record. The
      // client only refreshes every app surface and deliberately does not add
      // a second local history item.
      refreshAppData(['sales', 'dashboard', 'audit_log'], { reason: 'legacy-subtotal-repair' })
    } catch (error) {
      if (errorStatus(error) === 409) {
        setNeedsNewPreview(true)
        setApplyFailure({ message: errorMessage(error), uncertain: false })
      } else {
        setApplyFailure({ message: errorMessage(error), uncertain: isUncertainFailure(error) })
      }
    } finally {
      finishSingleAction(applyInFlight)
      setApplyLoading(false)
      setConfirmOpen(false)
    }
  }

  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50/40 p-3 dark:border-amber-800 dark:bg-amber-950/20 sm:p-4" aria-labelledby="legacy-subtotal-repair-title">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-amber-100 p-2 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
          <ShieldCheck className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="legacy-subtotal-repair-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {repairTitle}
          </h2>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            {T('legacy_subtotal_desc', 'A fixed, backup-first correction for 22 imported paid sales. This is separate from destructive migration finalization and accepts no SQL or files.')}
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white/80 p-2 dark:border-gray-700 dark:bg-gray-900/50">
          <div className="font-semibold text-gray-800 dark:text-gray-200">{T('legacy_subtotal_sep3', 'September 3, 2026')}</div>
          <div className="mt-0.5 text-gray-600 dark:text-gray-400">{T('legacy_subtotal_sep3_scope', 'IDs 16842–16858 · 17 sales · $1,470.0000 · item discounts $61.0000')}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white/80 p-2 dark:border-gray-700 dark:bg-gray-900/50">
          <div className="font-semibold text-gray-800 dark:text-gray-200">{T('legacy_subtotal_sep2', 'September 2, 2026')}</div>
          <div className="mt-0.5 text-gray-600 dark:text-gray-400">{T('legacy_subtotal_sep2_scope', 'IDs 16859–16863 · 5 sales · $1,992.0000 · item discounts $5.0000')}</div>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-2 dark:border-emerald-900 dark:bg-emerald-950/30">
          <div className="font-semibold text-emerald-800 dark:text-emerald-300">{T('legacy_subtotal_unchanged_title', 'Everything else stays unchanged')}</div>
          <div className="mt-0.5 text-emerald-700 dark:text-emerald-400">{T('legacy_subtotal_unchanged', 'Stock, payments, sale items, totals, statuses, and COGS are unchanged.')}</div>
        </div>
      </div>

      {!preview && !completed ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={loadPreview}
            disabled={previewLoading || applyLoading}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${previewLoading ? 'animate-spin' : ''}`} />
            {previewLoading
              ? T('legacy_subtotal_preview_loading', 'Checking current records...')
              : needsNewPreview
                ? T('legacy_subtotal_preview_new', 'Load a new preview')
                : T('legacy_subtotal_preview_button', 'Preview exact repair')}
          </button>
        </div>
      ) : null}

      {previewError ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" role="alert">
          <span className="font-semibold">{T('legacy_subtotal_not_ready', 'Repair not ready')}:</span> {previewError}
        </div>
      ) : null}

      {preview ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-gray-200 bg-white/80 p-2 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-300">
            <span><strong>{T('legacy_subtotal_summary_sales', 'Sales')}:</strong> {preview.summary.sale_count}</span>
            <span><strong>{T('legacy_subtotal_summary_subtotal', 'Target subtotal')}:</strong> {fourDecimalUsd(preview.summary.subtotal_usd)}</span>
            <span><strong>{T('legacy_subtotal_summary_discount', 'Item discounts')}:</strong> {fourDecimalUsd(preview.summary.item_discount_usd)}</span>
          </div>

          <div className="max-h-72 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700" tabIndex={0} aria-label={T('legacy_subtotal_table_label', 'Exact sale rows in this repair')}>
            <table className="w-full min-w-[720px] table-fixed text-left text-xs">
              <thead className="sticky top-0 bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                <tr>
                  <th className="w-24 px-2 py-2">{T('legacy_subtotal_col_id', 'Sale ID')}</th>
                  <th className="w-32 px-2 py-2">{T('legacy_subtotal_col_date', 'Business date')}</th>
                  <th className="px-2 py-2">{T('legacy_subtotal_col_before', 'Current subtotal')}</th>
                  <th className="px-2 py-2">{T('legacy_subtotal_col_after', 'Target subtotal')}</th>
                  <th className="px-2 py-2">{T('legacy_subtotal_col_discount', 'Item discount')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white dark:divide-gray-800 dark:bg-gray-900/60">
                {sales.map((sale) => (
                  <tr key={sale.id}>
                    <td className="px-2 py-1.5 font-mono text-gray-800 dark:text-gray-200">{sale.id}</td>
                    <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400">{isoToDisplayDate(sale.business_date)}</td>
                    <td className="px-2 py-1.5 font-mono text-gray-600 dark:text-gray-400">{fourDecimalUsd(sale.expected_subtotal_usd)}</td>
                    <td className="px-2 py-1.5 font-mono font-medium text-gray-800 dark:text-gray-200">{fourDecimalUsd(sale.target_subtotal_usd)}</td>
                    <td className="px-2 py-1.5 font-mono text-gray-600 dark:text-gray-400">{fourDecimalUsd(sale.item_discount_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-1 rounded-lg bg-gray-100 p-2 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300 sm:grid-cols-[auto_1fr]">
            <span className="font-semibold">{T('legacy_subtotal_plan_id', 'Plan ID')}</span>
            <code className="break-all">{preview.request.manifest.plan_id}</code>
            <span className="font-semibold">SHA-256</span>
            <code className="break-all">{preview.request.manifest_sha256}</code>
          </div>

          {!completed ? (
            <div className="space-y-2 rounded-lg border border-amber-300 bg-white/80 p-3 dark:border-amber-800 dark:bg-gray-900/50">
              <label className="flex items-start gap-2 text-xs text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={acknowledged}
                  disabled={applyLoading || needsNewPreview}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                <span>{T('legacy_subtotal_ack', 'I reviewed all 22 rows and understand that the server must create a fresh backup before changing only these subtotals.')}</span>
              </label>
              <label className="block text-xs text-gray-700 dark:text-gray-300" htmlFor="legacy-subtotal-confirmation">
                {T('legacy_subtotal_type_confirm', 'Type the exact confirmation to apply')}
              </label>
              <code className="block break-all rounded bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{LEGACY_SUBTOTAL_REPAIR_CONFIRMATION}</code>
              <input
                id="legacy-subtotal-confirmation"
                value={typedConfirmation}
                onChange={(event) => setTypedConfirmation(event.target.value)}
                disabled={applyLoading || needsNewPreview}
                className="input w-full font-mono text-xs disabled:opacity-60"
                autoComplete="off"
                spellCheck={false}
              />

              {applyFailure ? (
                <div className={`flex items-start gap-2 rounded-lg border p-2 text-xs ${needsNewPreview ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200' : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'}`} role="alert">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {applyFailure.message}
                    {applyFailure.uncertain ? ` ${T('legacy_subtotal_uncertain_hint', 'The result is uncertain. Retry sends the exact same frozen request; it does not generate a new manifest.')}` : ''}
                    {needsNewPreview ? ` ${T('legacy_subtotal_conflict_hint', 'The records changed, so this request cannot be reused. Load and review a new preview explicitly.')}` : ''}
                  </span>
                </div>
              ) : null}

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                {needsNewPreview ? (
                  <button type="button" onClick={loadPreview} disabled={previewLoading || applyLoading} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
                    <RefreshCw className={`h-4 w-4 ${previewLoading ? 'animate-spin' : ''}`} />
                    {previewLoading ? T('legacy_subtotal_preview_loading', 'Checking current records...') : T('legacy_subtotal_preview_new', 'Load a new preview')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmOpen(true)}
                    disabled={!confirmed || applyLoading}
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-amber-700 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-40"
                  >
                    <DatabaseBackup className="h-4 w-4" />
                    {applyLoading
                      ? T('legacy_subtotal_apply_working', 'Backing up and applying...')
                      : applyFailure?.uncertain
                        ? T('legacy_subtotal_retry_same', 'Retry same request')
                        : T('legacy_subtotal_apply_button', 'Back up and apply repair')}
                  </button>
                )}
                <span className="text-[11px] text-gray-500 dark:text-gray-400">{T('legacy_subtotal_server_history', 'The server records the single audit/history action; this panel does not add a duplicate.')}</span>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {completed ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200" role="status" aria-live="polite">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">{T('legacy_subtotal_complete_title', 'Repair complete — apply disabled')}</div>
            <div className="mt-0.5 text-xs">{applyResult?.message || T('legacy_subtotal_apply_success', 'Legacy subtotals repaired.')}</div>
          </div>
        </div>
      ) : null}

      {confirmOpen && preview && request && !completed ? (
        <ConfirmDialog
          t={t}
          title={repairTitle}
          message={T('legacy_subtotal_ack', 'I reviewed all 22 rows and understand that the server must create a fresh backup before changing only these subtotals.')}
          items={[
            { label: T('legacy_subtotal_summary_sales', 'Sales'), value: preview.summary.sale_count },
            { label: T('legacy_subtotal_summary_subtotal', 'Target subtotal'), value: fourDecimalUsd(preview.summary.subtotal_usd) },
            { label: T('legacy_subtotal_summary_discount', 'Item discounts'), value: fourDecimalUsd(preview.summary.item_discount_usd) },
            { label: T('legacy_subtotal_plan_id', 'Plan ID'), value: preview.request.manifest.plan_id },
          ]}
          note={T('legacy_subtotal_server_history', 'The server records the single audit/history action; this panel does not add a duplicate.')}
          confirmLabel={applyFailure?.uncertain
            ? T('legacy_subtotal_retry_same', 'Retry same request')
            : T('legacy_subtotal_apply_button', 'Back up and apply repair')}
          working={applyLoading}
          workingLabel={T('legacy_subtotal_apply_working', 'Backing up and applying...')}
          confirmDisabled={!confirmed || needsNewPreview}
          onConfirm={applyRepair}
          onClose={() => {
            if (!applyLoading) setConfirmOpen(false)
          }}
        />
      ) : null}
    </section>
  )
}

export default LegacySubtotalRepair
