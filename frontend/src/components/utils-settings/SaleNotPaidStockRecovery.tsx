import { useEffect, useRef, useState } from 'react'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2.js'
import DatabaseBackup from 'lucide-react/dist/esm/icons/database-backup.js'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check.js'
import { useApp as useAppFromContext } from '../../AppContext.tsx'
import {
  applySaleNotPaidStockRecovery,
  previewSaleNotPaidStockRecovery,
  saleNotPaidStockRecoveryIsComplete,
  type SaleNotPaidStockRecoveryPreview,
  type SaleNotPaidStockRecoveryResult,
} from '../../utils/saleNotPaidStockRecovery.ts'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'
import { refreshAppData } from '../../utils/appRefresh.ts'
import { registerDirtyWork } from '../../utils/dirtyWork.ts'
import ConfirmDialog from '../shared/ConfirmDialog.tsx'

type Translate = (key: string, fallback?: string) => string | undefined
type AppContextValue = { t?: Translate; notify: (message: string, type?: string) => void; hasPermission: (permission: string) => boolean }
type Failure = { message: string; uncertain: boolean }
const useApp = useAppFromContext as () => AppContextValue

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error || 'unknown error') }
function errorStatus(error: unknown): number { return Number((error as { status?: unknown } | null)?.status || 0) }
function uncertain(error: unknown): boolean { const status = errorStatus(error); return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500 }

function SaleNotPaidStockRecovery() {
  const { t, notify, hasPermission } = useApp()
  const T = (key: string, fallback: string) => (typeof t === 'function' ? t(key, fallback) || fallback : fallback)
  const permitted = hasPermission('backup_restore')
  const [preview, setPreview] = useState<SaleNotPaidStockRecoveryPreview | null>(null)
  const [result, setResult] = useState<SaleNotPaidStockRecoveryResult | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [needsNewPreview, setNeedsNewPreview] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [typedConfirmation, setTypedConfirmation] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [applyLoading, setApplyLoading] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const previewInFlight = useRef(false)
  const applyInFlight = useRef(false)
  const confirmationOpen = useRef(false)
  const title = T('sale_not_paid_stock_recovery_title', 'Correct Not Paid stock')
  const confirmationInputId = 'sale-not-paid-stock-recovery-confirmation'
  const complete = saleNotPaidStockRecoveryIsComplete(result)
  const canApply = Boolean(preview && acknowledged && typedConfirmation === preview.request.confirmation && !needsNewPreview && !complete)
  confirmationOpen.current = confirmOpen

  useEffect(() => registerDirtyWork({
    key: 'sale-not-paid-stock-recovery-confirmation', pageId: 'settings', label: title,
    isDirty: () => confirmationOpen.current,
    discard: () => { if (!applyInFlight.current) setConfirmOpen(false) },
  }), [title])
  if (!permitted) return null

  const loadPreview = async () => {
    if (!hasPermission('backup_restore') || !beginSingleAction(previewInFlight, { blocked: previewLoading || applyLoading })) return
    setPreviewLoading(true); setFailure(null); setNeedsNewPreview(false); setResult(null); setPreview(null); setAcknowledged(false); setTypedConfirmation('')
    try { setPreview(await previewSaleNotPaidStockRecovery()) }
    catch (error) { setFailure({ message: errorMessage(error), uncertain: false }) }
    finally { finishSingleAction(previewInFlight); setPreviewLoading(false) }
  }

  const apply = async () => {
    if (!preview || !canApply || !beginSingleAction(applyInFlight, { blocked: applyLoading })) return
    setApplyLoading(true); setFailure(null)
    try {
      const next = await applySaleNotPaidStockRecovery(preview.request)
      setResult(next)
      if (!next.success) { setFailure({ message: next.message, uncertain: true }); return }
      if (saleNotPaidStockRecoveryIsComplete(next)) {
        refreshAppData(['sales', 'products', 'inventory', 'audit_log'], { reason: 'sale-not-paid-stock-recovery' })
        notify(next.message || T('sale_not_paid_stock_recovery_success', 'Not Paid stock correction completed.'), 'success')
      }
    } catch (error) {
      if (errorStatus(error) === 409) setNeedsNewPreview(true)
      setFailure({ message: errorMessage(error), uncertain: errorStatus(error) !== 409 && uncertain(error) })
    } finally { finishSingleAction(applyInFlight); setApplyLoading(false); setConfirmOpen(false) }
  }

  return <section className="rounded-xl border border-amber-300 bg-amber-50/40 p-3 dark:border-amber-800 dark:bg-amber-950/20 sm:p-4" aria-labelledby="sale-not-paid-stock-recovery-title">
    <div className="flex items-start gap-3"><div className="rounded-lg bg-amber-100 p-2 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"><ShieldCheck className="h-4 w-4" /></div><div className="min-w-0"><h2 id="sale-not-paid-stock-recovery-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h2><p className="mt-1 text-xs text-gray-600 dark:text-gray-300">{T('sale_not_paid_stock_recovery_desc', 'Review the fixed awaiting-payment receipts. The server creates a backup, then deducts the missing stock once.')}</p></div></div>
    {!preview && !complete ? <button type="button" onClick={loadPreview} disabled={previewLoading || applyLoading} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${previewLoading ? 'animate-spin' : ''}`} />{previewLoading ? T('sale_not_paid_stock_recovery_preview_loading', 'Checking current receipts...') : needsNewPreview ? T('sale_not_paid_stock_recovery_preview_new', 'Load a new preview') : T('sale_not_paid_stock_recovery_preview', 'Preview stock correction')}</button> : null}
    {failure ? <div className="mt-3 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" role="alert"><AlertTriangle className="h-4 w-4 shrink-0" /><span>{failure.message}{needsNewPreview ? ` ${T('sale_not_paid_stock_recovery_conflict', 'Records changed. Load and review a new preview.')}` : failure.uncertain ? ` ${T('sale_not_paid_stock_recovery_uncertain', 'The result is uncertain. Replay the exact same request.')}` : ''}</span></div> : null}
    {preview ? <div className="mt-3 space-y-3"><div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-gray-200 bg-white/80 p-2 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-300"><span><strong>{T('sale_not_paid_stock_recovery_target', 'Correction target')}:</strong> {preview.target}</span><span><strong>{T('sale_not_paid_stock_recovery_sales', 'Receipts')}:</strong> {preview.summary.sales}</span><span><strong>{T('sale_not_paid_stock_recovery_units', 'Units to deduct')}:</strong> {preview.summary.units}</span></div>
      <div className="max-h-64 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700" tabIndex={0} aria-label={T('sale_not_paid_stock_recovery_table_label', 'Fixed Not Paid stock correction rows')}><table className="w-full min-w-[680px] table-fixed text-left text-xs"><thead className="sticky top-0 bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200"><tr><th className="w-24 px-2 py-2">{T('sale_not_paid_stock_recovery_col_id', 'Sale ID')}</th><th className="w-44 px-2 py-2">{T('sale_not_paid_stock_recovery_col_receipt', 'Receipt')}</th><th className="px-2 py-2">{T('sale_not_paid_stock_recovery_col_status', 'Status')}</th><th className="px-2 py-2">{T('sale_not_paid_stock_recovery_col_lines', 'Product lines')}</th><th className="px-2 py-2">{T('sale_not_paid_stock_recovery_col_units', 'Units')}</th><th className="px-2 py-2">{T('sale_not_paid_stock_recovery_col_stock', 'Stock action')}</th></tr></thead><tbody className="divide-y divide-gray-100 bg-white dark:divide-gray-800 dark:bg-gray-900/60">{preview.sales.map((sale) => <tr key={sale.id}><td className="px-2 py-1.5 font-mono text-gray-800 dark:text-gray-200">{sale.id}</td><td className="px-2 py-1.5 font-mono text-gray-800 dark:text-gray-200">{sale.receipt_number}</td><td className="px-2 py-1.5 text-gray-600 dark:text-gray-400">{T('sale_not_paid_stock_recovery_status', 'Awaiting payment')}</td><td className="px-2 py-1.5 text-gray-600 dark:text-gray-400">{sale.line_count}</td><td className="px-2 py-1.5 text-gray-600 dark:text-gray-400">{sale.unit_count}</td><td className="px-2 py-1.5 text-gray-600 dark:text-gray-400">{T('sale_not_paid_stock_recovery_stock_deduct', 'Deduct stock now')}</td></tr>)}</tbody></table></div>
      <div className="grid gap-1 rounded-lg bg-gray-100 p-2 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300 sm:grid-cols-[auto_1fr]"><span className="font-semibold">SHA-256</span><code className="break-all">{preview.request.manifest_sha256}</code></div>
      {!complete ? <div className="space-y-2 rounded-lg border border-amber-300 bg-white/80 p-3 dark:border-amber-800 dark:bg-gray-900/50"><label className="flex items-start gap-2 text-xs text-gray-700 dark:text-gray-300"><input type="checkbox" className="mt-0.5" checked={acknowledged} disabled={applyLoading || needsNewPreview} onChange={(event) => setAcknowledged(event.target.checked)} /><span>{T('sale_not_paid_stock_recovery_ack', 'I reviewed every receipt, product-line count, and stock deduction. The server will back up before applying this digest-bound request.')}</span></label><label className="block text-xs" htmlFor={confirmationInputId}>{T('sale_not_paid_stock_recovery_type', 'Type the exact confirmation to apply')}</label><code className="block break-all rounded bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{preview.request.confirmation}</code><input id={confirmationInputId} value={typedConfirmation} onChange={(event) => setTypedConfirmation(event.target.value)} disabled={applyLoading || needsNewPreview} className="input w-full font-mono text-xs disabled:opacity-60" autoComplete="off" spellCheck={false} />
        <div className="flex flex-col gap-2 sm:flex-row"><button type="button" onClick={needsNewPreview ? loadPreview : () => setConfirmOpen(true)} disabled={needsNewPreview ? previewLoading : !canApply || applyLoading} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-amber-700 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-40"><DatabaseBackup className="h-4 w-4" />{needsNewPreview ? T('sale_not_paid_stock_recovery_preview_new', 'Load a new preview') : failure?.uncertain ? T('sale_not_paid_stock_recovery_replay', 'Replay same request') : T('sale_not_paid_stock_recovery_apply', 'Back up and apply correction')}</button><span className="text-[11px] text-gray-500 dark:text-gray-400">{T('sale_not_paid_stock_recovery_server_history', 'The server records the audit and history; this panel does not add local history.')}</span></div>
        {result?.success && !complete ? <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{T('sale_not_paid_stock_recovery_pending', 'The correction may be committed but verification or refresh is pending. Replay this exact request.')}</div> : null}
      </div> : null}
    </div> : null}
    {complete ? <div className="mt-3 flex gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200" role="status"><CheckCircle2 className="h-4 w-4 shrink-0" /><span>{result?.message || T('sale_not_paid_stock_recovery_success', 'Not Paid stock correction completed.')}</span></div> : null}
    {confirmOpen && preview && !complete ? <ConfirmDialog t={t} title={title} message={T('sale_not_paid_stock_recovery_ack', 'I reviewed every receipt, product-line count, and stock deduction. The server will back up before applying this digest-bound request.')} items={[{ label: T('sale_not_paid_stock_recovery_sales', 'Receipts'), value: preview.summary.sales }, { label: T('sale_not_paid_stock_recovery_units', 'Units to deduct'), value: preview.summary.units }, { label: 'SHA-256', value: preview.request.manifest_sha256 }]} note={T('sale_not_paid_stock_recovery_server_history', 'The server records the audit and history; this panel does not add local history.')} confirmLabel={failure?.uncertain ? T('sale_not_paid_stock_recovery_replay', 'Replay same request') : T('sale_not_paid_stock_recovery_apply', 'Back up and apply correction')} working={applyLoading} workingLabel={T('sale_not_paid_stock_recovery_working', 'Backing up and applying stock correction...')} confirmDisabled={!canApply} onConfirm={apply} onClose={() => { if (!applyLoading) setConfirmOpen(false) }} /> : null}
  </section>
}

export default SaleNotPaidStockRecovery
