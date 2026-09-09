import { useEffect, useRef, useState } from 'react'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2.js'
import DatabaseBackup from 'lucide-react/dist/esm/icons/database-backup.js'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check.js'
import { useApp as useAppFromContext } from '../../AppContext.tsx'
import { GENERAL_CUSTOMER_REPAIR_CONFIRMATION, applyGeneralCustomerRepair, previewGeneralCustomerRepair, type GeneralCustomerRepairApplyResponse, type GeneralCustomerRepairPreview } from '../../api/generalCustomerRepairTransport.ts'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'
import { refreshAppData } from '../../utils/appRefresh.ts'
import { registerDirtyWork } from '../../utils/dirtyWork.ts'
import ConfirmDialog from '../shared/ConfirmDialog.tsx'

type Translate = (key: string, fallback?: string) => string | undefined
type AppContextValue = { t?: Translate; notify: (message: string, type?: string) => void; hasPermission: (permission: string) => boolean }
type ApplyFailure = { message: string; uncertain: boolean }
const useApp = useAppFromContext as () => AppContextValue

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error || 'unknown error') }
function errorStatus(error: unknown): number { return Number((error as { status?: unknown } | null)?.status || 0) }
function uncertain(error: unknown): boolean { const status = errorStatus(error); return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500 }

function GeneralCustomerRepair() {
  const { t, notify, hasPermission } = useApp()
  const T = (key: string, fallback: string) => (typeof t === 'function' ? t(key, fallback) || fallback : fallback)
  const permitted = hasPermission('backup_restore')
  const [preview, setPreview] = useState<GeneralCustomerRepairPreview | null>(null)
  const [result, setResult] = useState<GeneralCustomerRepairApplyResponse | null>(null)
  const [failure, setFailure] = useState<ApplyFailure | null>(null)
  const [needsNewPreview, setNeedsNewPreview] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [typedConfirmation, setTypedConfirmation] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [applyLoading, setApplyLoading] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const previewInFlight = useRef(false)
  const applyInFlight = useRef(false)
  const confirmationOpen = useRef(false)
  const complete = result?.success === true && result.verification_pending === false && result.refresh_pending === false && result.cache_invalidated === true
  const canApply = Boolean(preview && acknowledged && typedConfirmation === GENERAL_CUSTOMER_REPAIR_CONFIRMATION && !needsNewPreview && !complete)
  confirmationOpen.current = confirmOpen

  const title = T('general_customer_repair_title', 'Mark confirmed shared General customer')
  useEffect(() => registerDirtyWork({
    key: 'general-customer-repair-confirmation',
    pageId: 'settings',
    label: title,
    isDirty: () => confirmationOpen.current,
    discard: () => { if (!applyInFlight.current) setConfirmOpen(false) },
  }), [title])
  if (!permitted) return null

  const loadPreview = async () => {
    if (!hasPermission('backup_restore') || !beginSingleAction(previewInFlight, { blocked: previewLoading || applyLoading })) return
    setPreviewLoading(true); setFailure(null); setNeedsNewPreview(false); setResult(null); setPreview(null); setAcknowledged(false); setTypedConfirmation('')
    try { setPreview(await previewGeneralCustomerRepair()) } catch (error) { setFailure({ message: errorMessage(error), uncertain: false }) } finally { finishSingleAction(previewInFlight); setPreviewLoading(false) }
  }
  const apply = async () => {
    if (!preview || !canApply || !beginSingleAction(applyInFlight, { blocked: applyLoading })) return
    setApplyLoading(true); setFailure(null)
    try {
      const next = await applyGeneralCustomerRepair(preview.request)
      if (!next.success) { setFailure({ message: T('general_customer_repair_failed', 'The repair was not applied.'), uncertain: false }); return }
      setResult(next)
      refreshAppData(['customers', 'audit_log'], { reason: 'shared-general-customer-repair' })
      if (!next.verification_pending && !next.refresh_pending) notify(next.message || T('general_customer_repair_success', 'Shared General customer marked.'), 'success')
    } catch (error) {
      if (errorStatus(error) === 409) setNeedsNewPreview(true)
      setFailure({ message: errorMessage(error), uncertain: errorStatus(error) !== 409 && uncertain(error) })
    } finally { finishSingleAction(applyInFlight); setApplyLoading(false); setConfirmOpen(false) }
  }

  return <section className="rounded-xl border border-amber-300 bg-amber-50/40 p-3 dark:border-amber-800 dark:bg-amber-950/20 sm:p-4" aria-labelledby="general-customer-repair-title">
    <div className="flex items-start gap-3"><div className="rounded-lg bg-amber-100 p-2 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"><ShieldCheck className="h-4 w-4" /></div><div><h2 id="general-customer-repair-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h2><p className="mt-1 text-xs text-gray-600 dark:text-gray-300">{T('general_customer_repair_desc', 'Fixed backup-first maintenance for the owner-confirmed shared checkout identity. It accepts no customer ID, SQL, or file.')}</p></div></div>
    {!preview && !complete ? <button type="button" onClick={loadPreview} disabled={previewLoading || applyLoading} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${previewLoading ? 'animate-spin' : ''}`} />{previewLoading ? T('general_customer_repair_preview_loading', 'Checking current records...') : needsNewPreview ? T('general_customer_repair_preview_new', 'Load a new preview') : T('general_customer_repair_preview', 'Preview exact repair')}</button> : null}
    {failure ? <div className="mt-3 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" role="alert"><AlertTriangle className="h-4 w-4 shrink-0" /><span>{failure.message}{needsNewPreview ? ` ${T('general_customer_repair_conflict', 'Records changed. Load and review a new preview.')}` : failure.uncertain ? ` ${T('general_customer_repair_uncertain', 'The result is uncertain. Retry sends the exact same request.')}` : ''}</span></div> : null}
    {preview ? <div className="mt-3 space-y-3"><div className="grid gap-2 rounded-lg border border-gray-200 bg-white/80 p-2 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-300 sm:grid-cols-2"><span><strong>{T('general_customer_repair_target', 'Target')}:</strong> #{preview.target.id}</span><span><strong>{T('general_customer_repair_protected', 'Protected')}:</strong> #{preview.protected_customer.id}</span><span><strong>{T('general_customer_repair_sales', 'Linked sales')}:</strong> {preview.target.sale_count}</span><span><strong>{T('general_customer_repair_returns', 'Linked returns')}:</strong> {preview.target.return_count}</span><span><strong>{T('general_customer_repair_portal', 'Portal accounts')}:</strong> {preview.target.portal_account_count}</span></div>
      {!complete ? <div className="space-y-2 rounded-lg border border-amber-300 bg-white/80 p-3 dark:border-amber-800 dark:bg-gray-900/50"><label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={acknowledged} disabled={applyLoading || needsNewPreview} onChange={(event) => setAcknowledged(event.target.checked)} /><span>{T('general_customer_repair_ack', 'I reviewed the fixed target and counts. The server will create a customers-only backup before an unapplied repair.')}</span></label><label className="block text-xs" htmlFor="general-customer-repair-confirmation">{T('general_customer_repair_type', 'Type the exact confirmation to apply')}</label><code className="block break-all rounded bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{GENERAL_CUSTOMER_REPAIR_CONFIRMATION}</code><input id="general-customer-repair-confirmation" value={typedConfirmation} onChange={(event) => setTypedConfirmation(event.target.value)} disabled={applyLoading || needsNewPreview} className="input w-full font-mono text-xs disabled:opacity-60" autoComplete="off" spellCheck={false} />
        <div className="flex flex-col gap-2 sm:flex-row"><button type="button" onClick={needsNewPreview ? loadPreview : () => setConfirmOpen(true)} disabled={needsNewPreview ? previewLoading : !canApply || applyLoading} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-amber-700 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-40"><DatabaseBackup className="h-4 w-4" />{needsNewPreview ? T('general_customer_repair_preview_new', 'Load a new preview') : result ? T('general_customer_repair_replay', 'Replay same request') : T('general_customer_repair_apply', 'Back up and apply repair')}</button><span className="text-[11px] text-gray-500 dark:text-gray-400">{T('general_customer_repair_server_history', 'The server records the audit/history action; this panel does not add local history.')}</span></div>
        {result?.success && (result.verification_pending || result.refresh_pending) ? <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{T('general_customer_repair_pending', 'The marker may be committed but verification or refresh is pending. Replay this exact request.')}</div> : null}
      </div> : null}
    </div> : null}
    {complete ? <div className="mt-3 flex gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200" role="status"><CheckCircle2 className="h-4 w-4 shrink-0" /><span>{result?.message || T('general_customer_repair_success', 'Shared General customer marked.')}</span></div> : null}
    {confirmOpen && preview && !complete ? <ConfirmDialog t={t} title={title} message={T('general_customer_repair_ack', 'I reviewed the fixed target and counts. The server will create a customers-only backup before an unapplied repair.')} items={[{ label: T('general_customer_repair_target', 'Target'), value: `#${preview.target.id}` }, { label: T('general_customer_repair_sales', 'Linked sales'), value: preview.target.sale_count }, { label: T('general_customer_repair_returns', 'Linked returns'), value: preview.target.return_count }]} note={T('general_customer_repair_server_history', 'The server records the audit/history action; this panel does not add local history.')} confirmLabel={result ? T('general_customer_repair_replay', 'Replay same request') : T('general_customer_repair_apply', 'Back up and apply repair')} working={applyLoading} workingLabel={T('general_customer_repair_working', 'Backing up and applying...')} confirmDisabled={!canApply} onConfirm={apply} onClose={() => { if (!applyLoading) setConfirmOpen(false) }} /> : null}
  </section>
}

export default GeneralCustomerRepair
