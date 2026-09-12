import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2.js'
import Upload from 'lucide-react/dist/esm/icons/upload.js'
import Modal from '../shared/Modal.tsx'
import { captureActorReadScope, isActorReadScopeCurrent } from '../../api/actorReadScope.ts'
import { effectivePermissions, type PermissionUser } from '../../utils/permissions.ts'
import {
  CUSTOMER_GENDER_RESTORATION_CAMPAIGN,
  CUSTOMER_GENDER_RESTORATION_MAX_FILE_BYTES,
  CUSTOMER_GENDER_RESTORATION_TOTAL,
  appliedRecordCount,
  claimGenderRestorationAction,
  executeCustomerGenderRestorationChunk,
  parseCustomerGenderRestorationFile,
  receiptMap,
  releaseGenderRestorationAction,
  type GenderRestorationFile,
  type GenderRestorationStatus,
} from './customerGenderRestorationFlow.ts'

type TranslateFn = (key: string) => string | undefined
type NotifyFn = (message: string, tone?: string) => void

type Props = {
  t: TranslateFn
  notify: NotifyFn
  user: PermissionUser
  onClose: () => void
  onDone?: () => void | Promise<void>
}

type Transport = typeof import('../../api/contactWriteTransport.ts')
let transportPromise: Promise<Transport> | null = null
function loadTransport(): Promise<Transport> {
  if (!transportPromise) transportPromise = import('../../api/contactWriteTransport.ts')
  return transportPromise
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export default function CustomerGenderRestorationModal({ t, notify, user, onClose, onDone }: Props) {
  const tr = (key: string, fallback: string) => {
    const translated = t(key)
    return translated && translated !== key ? translated : fallback
  }
  const permission = effectivePermissions(user)
  const allowed = permission.isAdmin && permission.getPermissionTier('contacts') === 'full' && permission.can('contacts', 'edit')
  const allowedRef = useRef(allowed)
  allowedRef.current = allowed
  const openedScopeRef = useRef(captureActorReadScope('customers:gender-restoration'))
  const operationGenerationRef = useRef(0)
  const inFlightRef = useRef(false)
  const aliveRef = useRef(true)
  const inputRef = useRef<HTMLInputElement>(null)
  const [manifest, setManifest] = useState<GenderRestorationFile | null>(null)
  const [status, setStatus] = useState<GenderRestorationStatus | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [unknown, setUnknown] = useState(false)
  const [currentChunk, setCurrentChunk] = useState<number | null>(null)

  useEffect(() => () => {
    aliveRef.current = false
    operationGenerationRef.current += 1
  }, [])

  const isCallbackCurrent = (scope = openedScopeRef.current, generation = operationGenerationRef.current) =>
    aliveRef.current && generation === operationGenerationRef.current
    && allowedRef.current && isActorReadScopeCurrent(scope, false)

  const applied = appliedRecordCount(status)
  const remaining = Math.max(0, CUSTOMER_GENDER_RESTORATION_TOTAL - applied)
  const reversed = useMemo(() => status?.receipts.filter((receipt) => receipt.status === 'reversed') || [], [status])
  const complete = Boolean(status && applied === CUSTOMER_GENDER_RESTORATION_TOTAL && reversed.length === 0)

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    const generation = ++operationGenerationRef.current
    const scope = captureActorReadScope('customers:gender-restoration')
    setManifest(null)
    setStatus(null)
    setConfirmed(false)
    setUnknown(false)
    setError('')
    if (!file) return
    try {
      if (file.size > CUSTOMER_GENDER_RESTORATION_MAX_FILE_BYTES) throw new Error(tr('customer_gender_restore_invalid_file', 'The restoration file could not be read.'))
      const text = await file.text()
      if (!isCallbackCurrent(scope, generation)) return
      setManifest(parseCustomerGenderRestorationFile(text))
    } catch (cause) {
      if (!isCallbackCurrent(scope, generation)) return
      setError(message(cause, tr('customer_gender_restore_invalid_file', 'The restoration file could not be read.')))
    }
  }

  const refreshStatus = async () => {
    if (!allowedRef.current || !claimGenderRestorationAction(inFlightRef)) return
    const generation = ++operationGenerationRef.current
    const scope = captureActorReadScope('customers:gender-restoration')
    setBusy(true)
    setError('')
    try {
      const api = await loadTransport()
      if (!isCallbackCurrent(scope, generation)) return
      const next = await api.getCustomerGenderRestorationStatus(CUSTOMER_GENDER_RESTORATION_CAMPAIGN)
      if (!isCallbackCurrent(scope, generation)) return
      setStatus(next)
      setUnknown(false)
    } catch (cause) {
      if (!isCallbackCurrent(scope, generation)) return
      setError(message(cause, tr('customer_gender_restore_status_failed', 'Could not recover restoration status.')))
    } finally {
      releaseGenderRestorationAction(inFlightRef)
      if (isCallbackCurrent(scope, generation)) setBusy(false)
    }
  }

  const applyAll = async () => {
    if (!manifest || !confirmed || !allowedRef.current || !claimGenderRestorationAction(inFlightRef)) return
    const generation = ++operationGenerationRef.current
    const scope = captureActorReadScope('customers:gender-restoration')
    setBusy(true)
    setUnknown(false)
    setError('')
    try {
      const api = await loadTransport()
      if (!isCallbackCurrent(scope, generation)) return
      let latestStatus = await api.getCustomerGenderRestorationStatus(manifest.campaign_id)
      if (!isCallbackCurrent(scope, generation)) return
      setStatus(latestStatus)
      const known = receiptMap(latestStatus)
      for (const chunk of [...manifest.chunks].sort((a, b) => a.chunk_index - b.chunk_index)) {
        if (!isCallbackCurrent(scope, generation)) return
        const existing = known.get(chunk.chunk_index)
        if (existing?.status === 'applied') continue
        if (existing?.status === 'reversed') throw new Error(tr('customer_gender_restore_reversed_stop', 'A completed chunk was undone. Use Records to redo it before continuing.'))
        setCurrentChunk(chunk.chunk_index + 1)
        const result = await executeCustomerGenderRestorationChunk({
          chunk,
          isCurrent: () => isCallbackCurrent(scope, generation),
          preview: api.previewCustomerGenderRestoration,
          apply: api.applyCustomerGenderRestoration,
          status: () => api.getCustomerGenderRestorationStatus(manifest.campaign_id),
        })
        if (result.kind === 'stale') return
        if (result.kind === 'unknown') {
          if (result.status) setStatus(result.status)
          setUnknown(true)
          setError(tr('customer_gender_restore_unknown', 'The last chunk may have been applied. Check status before explicitly retrying.'))
          return
        }
        if (result.kind === 'failed') throw result.error
        known.set(chunk.chunk_index, result.receipt)
        latestStatus = result.status || { ...latestStatus, receipts: [...known.values()] }
        setStatus(latestStatus)
      }
      const finalStatus = await api.getCustomerGenderRestorationStatus(manifest.campaign_id)
      if (!isCallbackCurrent(scope, generation)) return
      setStatus(finalStatus)
      if (appliedRecordCount(finalStatus) === CUSTOMER_GENDER_RESTORATION_TOTAL) {
        notify(tr('customer_gender_restore_complete', 'Customer gender restoration is complete.'), 'success')
        await onDone?.()
      }
    } catch (cause) {
      if (!isCallbackCurrent(scope, generation)) return
      setError(message(cause, tr('customer_gender_restore_failed', 'Restoration stopped. No later chunks were submitted.')))
    } finally {
      releaseGenderRestorationAction(inFlightRef)
      if (isCallbackCurrent(scope, generation)) {
        setBusy(false)
        setCurrentChunk(null)
      }
    }
  }

  if (!allowed || !isActorReadScopeCurrent(openedScopeRef.current, false)) return null

  return (
    <Modal
      title={tr('customer_gender_restore_title', 'Restore customer gender')}
      onClose={onClose}
      closeDisabled={busy}
      size="lg"
      unsavedChanges={{ dirty: Boolean(manifest && !complete) }}
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{tr('customer_gender_restore_help', 'Use only the approved restoration manifest. The app sends one bounded chunk at a time and changes customer gender only. Names, phones, addresses, membership, balances, notes, and dates are not displayed here or changed.')}</p>
          </div>
        </div>

        <input ref={inputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleFile} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary inline-flex items-center gap-2 text-sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            <Upload className="h-4 w-4" />
            {tr('customer_gender_restore_choose_file', 'Choose approved file')}
          </button>
          <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={() => void refreshStatus()}>
            {tr('customer_gender_restore_check_status', 'Check saved status')}
          </button>
        </div>

        {manifest ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
            <div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4" />{tr('customer_gender_restore_file_ready', 'Approved file structure loaded')}</div>
            <p className="mt-1 text-xs">{CUSTOMER_GENDER_RESTORATION_TOTAL.toLocaleString()} {tr('records', 'records')} · {manifest.chunks.length} {tr('chunks', 'chunks')}</p>
          </div>
        ) : null}

        {status ? (
          <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl bg-slate-100 p-3 dark:bg-slate-800"><div className="text-xs text-slate-500 dark:text-slate-400">{tr('completed', 'Completed')}</div><div className="text-lg font-bold">{applied.toLocaleString()}</div></div>
            <div className="rounded-xl bg-slate-100 p-3 dark:bg-slate-800"><div className="text-xs text-slate-500 dark:text-slate-400">{tr('remaining', 'Remaining')}</div><div className="text-lg font-bold">{remaining.toLocaleString()}</div></div>
            <div className="rounded-xl bg-slate-100 p-3 dark:bg-slate-800"><div className="text-xs text-slate-500 dark:text-slate-400">{tr('receipts', 'Receipts')}</div><div className="text-lg font-bold">{status.receipts.length}</div></div>
            <div className="rounded-xl bg-slate-100 p-3 dark:bg-slate-800"><div className="text-xs text-slate-500 dark:text-slate-400">{tr('history', 'Records')}</div><div className="text-lg font-bold">{status.receipts.filter((item) => item.history_id).length}</div></div>
          </div>
          {status.receipts.some((item) => item.history_id) ? <p className="break-words text-xs text-slate-500 dark:text-slate-400">{tr('history', 'Records')}: {status.receipts.flatMap((item) => item.history_id ? [`#${item.history_id}`] : []).join(', ')}</p> : null}
          </>
        ) : null}

        {busy ? <p role="status" className="text-sm font-medium text-blue-700 dark:text-blue-300">{currentChunk ? tr('customer_gender_restore_applying_chunk', 'Previewing and applying chunk {current} of {total}').replace('{current}', String(currentChunk)).replace('{total}', String(CUSTOMER_GENDER_RESTORATION_CHUNKS)) : tr('loading', 'Loading...')}</p> : null}
        {error ? <div role="alert" className={`rounded-xl p-3 text-sm ${unknown ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200' : 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300'}`}>{error}</div> : null}
        {reversed.length ? <div role="alert" className="rounded-xl bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{tr('customer_gender_restore_reversed_stop', 'A completed chunk was undone. Use Records to redo it before continuing.')}</div> : null}

        {manifest && !complete ? (
          <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" className="mt-0.5" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>{tr('customer_gender_restore_confirm', 'I confirm this is the approved manifest and want to apply the remaining chunks. Each chunk will be previewed again by the server before it is changed.')}</span>
          </label>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
          <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>{tr('close', 'Close')}</button>
          {manifest && !complete ? <button type="button" className="btn-primary" disabled={busy || !confirmed || reversed.length > 0} onClick={() => void applyAll()}>{unknown ? tr('customer_gender_restore_explicit_retry', 'Explicitly retry remaining chunks') : tr('customer_gender_restore_apply', 'Apply remaining approved chunks')}</button> : null}
        </div>
      </div>
    </Modal>
  )
}
