import { useCallback, useEffect, useRef, useState } from 'react'
import Download from 'lucide-react/dist/esm/icons/download.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import Upload from 'lucide-react/dist/esm/icons/upload.js'
import { useApp as useAppHook } from '../../app/AppContextCore.tsx'
import InfoHint from '../shared/InfoHint.tsx'
import Modal from '../shared/Modal.tsx'
import { useConfirmDialog } from '../shared/useConfirmDialog.tsx'
import { captureActorReadScope, isActorReadScopeCurrent, type ActorReadScope } from '../../api/actorReadScope.ts'
import { captureOfflineSaleOwner, offlineSaleOwnersMatch, type OfflineSaleOwner } from '../../api/offlineQueueOwnership.ts'
import { saleSubmitRefusalText } from '../../api/saleSubmitErrors.ts'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'
import { downloadBlob } from '../../utils/csv.ts'
import { withLoaderTimeout } from '../../utils/loaders.ts'

// The one surface for sales a device queued before offline selling ended
// (26 Sep 2026). App mounts it only when legacyQueueProbe.ts counted rows, so
// nothing here (Dexie included) loads on a device without any. Every action is
// bound to a review of the signed-in account (pendingSyncTransport.ts): Upload
// is the one-time manual drain, Export saves the reviewed rows as a file, and
// Clear removes only rows exported in this review.

const STATE_TIMEOUT_MS = 8000
const ACTION_TIMEOUT_MS = 12000

type QueueItem = {
  _seq?: number | string
  created_at?: string | null
  status?: string
  entity_name?: string | null
  error?: string | null
  error_code?: string | null
}

type QueueState = {
  total: number
  items: QueueItem[]
  owner: OfflineSaleOwner | null
  review_token: string | null
}

type QueueApi = {
  getPendingSyncState?: () => Promise<unknown>
  exportPendingSyncReview?: (reviewToken: string) => Promise<{ rows?: unknown[] } & Record<string, unknown>>
  retryPendingSyncNow?: (reviewToken: string) => Promise<{ attempted?: number; synced?: number } | null | undefined>
  discardPendingSyncQueue?: (reason: string, reviewToken: string) => Promise<{ discarded?: number }>
}

type AppValue = {
  t: (key: string) => string
  notify: (message: string, type?: string) => void
  canWriteToServer: boolean
  formatDateTime: (value: unknown) => string
}

type LegacyQueueNoticeProps = {
  /** Rows the probe counted on this device, every account and both legacy stores. */
  recordCount: number
  storagePersisted: boolean | null
  onClose: () => void
  /** After an upload or clear: the shell probes again and unmounts this at zero. */
  onChanged: () => void
}

const useApp = useAppHook as () => AppValue

function queueApi(): QueueApi {
  return (window as unknown as { api?: QueueApi }).api || {}
}

function normalizeState(value: unknown): QueueState {
  const candidate = value && typeof value === 'object' ? value as Partial<QueueState> : {}
  return {
    total: Number(candidate.total || 0),
    items: Array.isArray(candidate.items) ? candidate.items : [],
    owner: candidate.owner || null,
    review_token: candidate.review_token || null,
  }
}

function currentOwner(): OfflineSaleOwner | null {
  try { return captureOfflineSaleOwner() } catch { return null }
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export default function LegacyQueueNotice({ recordCount, storagePersisted, onClose, onChanged }: LegacyQueueNoticeProps) {
  const { t, notify, canWriteToServer, formatDateTime } = useApp()
  const { askToConfirm, confirmDialog } = useConfirmDialog()
  const [loaded, setLoaded] = useState<{ state: QueueState; scope: ActorReadScope } | null>(null)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [exportedToken, setExportedToken] = useState('')
  const actionRef = useRef(false)

  const load = useCallback(async () => {
    const scope = captureActorReadScope('legacy-queue')
    try {
      const value = await withLoaderTimeout(() => queueApi().getPendingSyncState?.(), 'Retained sales', STATE_TIMEOUT_MS)
      if (!isActorReadScopeCurrent(scope, false)) return
      setLoaded({ state: normalizeState(value), scope })
      setLoadError('')
    } catch (error) {
      if (isActorReadScopeCurrent(scope, false)) setLoadError(errorText(error, t('legacy_queue_load_failed')))
    }
  }, [t])

  useEffect(() => { void load() }, [load])

  // Fence the render: a reply for another account or server never shows.
  const state = loaded && isActorReadScopeCurrent(loaded.scope, false) && offlineSaleOwnersMatch(loaded.state.owner, currentOwner())
    ? loaded.state
    : null
  const ownTotal = state?.total ?? 0
  const otherRecords = Math.max(0, recordCount - ownTotal)
  const reviewToken = state?.review_token || ''
  const exported = !!reviewToken && exportedToken === reviewToken
  const reviewed = state?.items.length ?? 0

  async function run(action: () => Promise<void>) {
    if (!beginSingleAction(actionRef, { blocked: busy })) return
    setBusy(true)
    try { await action() } finally {
      finishSingleAction(actionRef)
      setBusy(false)
    }
  }

  const handleExport = () => run(async () => {
    try {
      const file = await withLoaderTimeout(() => queueApi().exportPendingSyncReview!(reviewToken), 'Export retained sales', ACTION_TIMEOUT_MS)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      downloadBlob(`business-os-retained-sales-${stamp}.json`, new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }))
      setExportedToken(reviewToken)
      notify(t('legacy_queue_exported').replace('{count}', String(file.rows?.length ?? 0)), 'success')
    } catch (error) {
      notify(errorText(error, t('legacy_queue_action_failed')), 'error')
    }
  })

  const handleUpload = async () => {
    if (!(await askToConfirm({
      title: t('legacy_queue_upload_title'),
      items: [{ label: t('legacy_queue_on_device'), value: `${reviewed} → 0` }],
      confirmLabel: t('legacy_queue_upload'),
    }))) return
    await run(async () => {
      try {
        const result = await withLoaderTimeout(() => queueApi().retryPendingSyncNow!(reviewToken), 'Upload retained sales', ACTION_TIMEOUT_MS)
        notify(t('legacy_queue_uploaded')
          .replace('{synced}', String(result?.synced ?? 0))
          .replace('{attempted}', String(result?.attempted ?? 0)), (result?.synced ?? 0) === (result?.attempted ?? 0) ? 'success' : 'warning')
      } catch (error) {
        notify(errorText(error, t('legacy_queue_action_failed')), 'error')
      }
      onChanged()
      await load()
    })
  }

  const handleClear = async () => {
    if (!(await askToConfirm({
      title: t('server_clear_reviewed_title'),
      message: t('server_clear_reviewed_message'),
      items: [{ label: t('server_reviewed_sales_count'), value: `${reviewed} → 0` }],
      confirmLabel: t('server_clear_reviewed_sales'),
      danger: true,
    }))) return
    await run(async () => {
      try {
        const result = await withLoaderTimeout(() => queueApi().discardPendingSyncQueue!('Reviewed pending sales were exported and cleared.', reviewToken), 'Clear retained sales', ACTION_TIMEOUT_MS)
        notify(t('legacy_queue_cleared').replace('{count}', String(result?.discarded ?? 0)), 'success')
      } catch (error) {
        notify(errorText(error, t('legacy_queue_action_failed')), 'error')
      }
      onChanged()
      await load()
    })
  }

  const canAct = !busy && !!reviewToken && ownTotal > 0
  const statusLabel = (status?: string) => (status === 'failed' || status === 'pending' || status === 'syncing' ? t(status) : String(status || ''))

  return (
    <Modal title={t('legacy_queue_title')} onClose={onClose} closeDisabled={busy} keyboard size="md" unsavedChanges="read-only">
      <div className="space-y-3 text-sm leading-6">
        <p>{t('legacy_queue_intro')}</p>
        {/* Only a browser that refused persistent storage can evict these rows; null (not asked yet) stays silent. */}
        {storagePersisted === false ? (
          <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            <span className="min-w-0 flex-1 break-words font-semibold">{t('storage_eviction_title')}</span>
            <InfoHint className="shrink-0" label={t('storage_eviction_title')} text={t('storage_eviction_detail')} />
          </div>
        ) : null}
        {loadError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700 dark:bg-red-950/40 dark:text-red-200">{loadError}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{t('legacy_queue_own_count')}: {ownTotal}</span>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={handleExport} disabled={!canAct}
              aria-label={t('legacy_queue_export')} title={t('legacy_queue_export')}
              className="flex h-11 w-11 items-center justify-center rounded-lg border border-gray-300 disabled:opacity-40 dark:border-gray-600">
              <Download className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={handleClear} disabled={!canAct || !exported}
              aria-label={t('server_clear_reviewed_sales')} title={exported ? t('server_clear_reviewed_sales') : t('legacy_queue_clear_after_export')}
              className="flex h-11 w-11 items-center justify-center rounded-lg border border-red-300 text-red-600 disabled:opacity-40 dark:border-red-700 dark:text-red-300">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={handleUpload} disabled={!canAct || !canWriteToServer}
              title={canWriteToServer ? t('legacy_queue_upload') : t('waiting_for_server')}
              className="btn-primary flex h-11 items-center gap-1.5 px-3 disabled:opacity-40">
              <Upload className="h-4 w-4" aria-hidden="true" />
              {t('legacy_queue_upload')}
            </button>
          </div>
        </div>
        {state?.items.length ? (
          <ul className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
            {state.items.map((item) => {
              const keptReason = saleSubmitRefusalText({ code: item.error_code }, t)
              return (
                <li key={String(item._seq)} className="border-b border-gray-100 px-3 py-1.5 last:border-b-0 dark:border-gray-700/40">
                  <div className="flex items-center gap-2 text-xs leading-6">
                    <span className="shrink-0 text-gray-500">{item.created_at ? formatDateTime(item.created_at) : ''}</span>
                    <span className={`shrink-0 rounded px-1 ${item.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{statusLabel(item.status)}</span>
                    <span className="min-w-0 flex-1 truncate">{item.entity_name || ''}</span>
                  </div>
                  {keptReason ? <p className="break-words pb-1 text-xs leading-relaxed text-red-600 dark:text-red-400">{keptReason}</p>
                    : item.error ? <p className="break-words pb-1 text-xs leading-relaxed text-red-600 dark:text-red-400">{item.error}</p> : null}
                </li>
              )
            })}
          </ul>
        ) : null}
        {otherRecords > 0 ? (
          <p className="text-xs leading-6 text-gray-600 dark:text-gray-300">{t('legacy_queue_other_records').replace('{count}', String(otherRecords))}</p>
        ) : null}
      </div>
      {confirmDialog}
    </Modal>
  )
}
