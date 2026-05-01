import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileDown, Loader2, PlayCircle, RotateCcw, XCircle } from 'lucide-react'
import { useApp } from '../../AppContext'

const ACTIVE_STATUSES = new Set(['pending', 'queued', 'running', 'cancelling', 'approved'])
const REVIEW_STATUSES = new Set(['awaiting_review', 'completed_with_errors', 'failed', 'cancelled'])
const DONE_STATUSES = new Set(['completed'])
const CANCELLABLE_STATUSES = new Set(['pending', 'queued', 'running', 'approved'])

function normalizeJobStatus(job) {
  return String(job?.status || '').trim().toLowerCase()
}

function isRecent(job, maxAgeMs = 2 * 60 * 60 * 1000) {
  const stamp = Date.parse(job?.updated_at || job?.finished_at || job?.created_at || '')
  if (!Number.isFinite(stamp)) return true
  return Date.now() - stamp <= maxAgeMs
}

function getJobProgress(job) {
  const status = normalizeJobStatus(job)
  if (status === 'awaiting_review') return 60
  const rowsTotal = Number(job?.total_rows || 0)
  const rowsDone = Number(job?.processed_rows || 0)
  const imagesTotal = Number(job?.total_images || 0)
  const imagesDone = Number(job?.processed_images || 0)
  const total = rowsTotal + imagesTotal
  const done = rowsDone + imagesDone
  if (total <= 0) return 0
  const raw = Math.max(0, Math.min(100, Math.round((done / total) * 100)))
  return ACTIVE_STATUSES.has(status) ? Math.min(95, raw) : raw
}

function getJobLabel(job) {
  const type = String(job?.type || 'import').replaceAll('_', ' ')
  const phase = String(job?.phase || job?.status || '').replaceAll('_', ' ')
  return `${type} import${phase ? ` - ${phase}` : ''}`
}

function buildJobsSignature(jobs = []) {
  return jobs.map((job) => [
    job.id,
    job.status,
    job.phase,
    job.total_rows,
    job.processed_rows,
    job.failed_rows,
    job.total_images,
    job.processed_images,
    job.failed_images,
    job.updated_at,
  ].join(':')).join('|')
}

export default function BackgroundImportTracker() {
  const { notify, t } = useApp()
  const [jobs, setJobs] = useState([])
  const [expanded, setExpanded] = useState(false)
  const [busyJobId, setBusyJobId] = useState('')
  const aliveRef = useRef(true)
  const timerRef = useRef(null)
  const jobsSignatureRef = useRef('')

  const visibleJobs = useMemo(() => (
    jobs.filter((job) => {
      const status = normalizeJobStatus(job)
      if (ACTIVE_STATUSES.has(status) || REVIEW_STATUSES.has(status)) return true
      return DONE_STATUSES.has(status) && isRecent(job, 10 * 60 * 1000)
    }).slice(0, 5)
  ), [jobs])

  const activeJobs = useMemo(() => visibleJobs.filter((job) => ACTIVE_STATUSES.has(normalizeJobStatus(job))), [visibleJobs])
  const reviewJobs = useMemo(() => visibleJobs.filter((job) => REVIEW_STATUSES.has(normalizeJobStatus(job))), [visibleJobs])
  const primaryJob = activeJobs[0] || reviewJobs[0] || visibleJobs[0] || null

  const loadJobs = useCallback(async () => {
    try {
      const result = await window.api.listImportJobs?.({ limit: 8 })
      if (!aliveRef.current) return
      const nextJobs = Array.isArray(result?.jobs) ? result.jobs : (Array.isArray(result) ? result : [])
      const nextSignature = buildJobsSignature(nextJobs)
      if (nextSignature === jobsSignatureRef.current) return
      jobsSignatureRef.current = nextSignature
      startTransition(() => setJobs(nextJobs))
    } catch (_) {
      if (!aliveRef.current) return
      if (!jobsSignatureRef.current) return
      jobsSignatureRef.current = ''
      startTransition(() => setJobs([]))
    }
  }, [])

  useEffect(() => {
    aliveRef.current = true
    loadJobs()
    const intervalMs = activeJobs.length ? 5000 : 12000
    timerRef.current = window.setInterval(() => {
      if (document.visibilityState === 'hidden' && !activeJobs.length) return
      loadJobs()
    }, intervalMs)
    return () => {
      aliveRef.current = false
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [activeJobs.length, loadJobs])

  if (!primaryJob) return null

  const status = normalizeJobStatus(primaryJob)
  const progress = getJobProgress(primaryJob)
  const hasAttention = reviewJobs.length > 0
  const isActive = ACTIVE_STATUSES.has(status)
  const title = hasAttention
    ? (t('import_needs_review') || 'Import needs review')
    : isActive
      ? (t('import_running_background') || 'Import running in background')
      : (t('import_finished') || 'Import finished')
  const rowsLabel = t('import_rows_label') || t('rows') || 'rows'
  const imagesLabel = t('import_images_label') || t('images') || 'images'
  const issuesLabel = t('import_issues_label') || 'issue(s)'
  const cancelLabel = t('cancel') || 'Cancel'
  const errorsLabel = t('errors') || 'Errors'
  const retryLabel = t('retry') || 'Retry'
  const approveLabel = t('approve_import') || 'Approve import'

  const handleCancel = async (job) => {
    if (!job?.id || busyJobId) return
    setBusyJobId(job.id)
    try {
      await window.api.cancelImportJob(job.id)
      await loadJobs()
      notify(t('import_cancel_requested') || 'Import cancel requested', 'info')
    } catch (error) {
      notify(error?.message || (t('import_cancel_failed') || 'Could not cancel import'), 'error')
    } finally {
      setBusyJobId('')
    }
  }

  const handleRetry = async (job) => {
    if (!job?.id || busyJobId) return
    setBusyJobId(job.id)
    try {
      await window.api.retryImportJob(job.id)
      await loadJobs()
      notify(t('import_retry_started') || 'Import retry started', 'success')
    } catch (error) {
      notify(error?.message || (t('import_retry_failed') || 'Could not retry import'), 'error')
    } finally {
      setBusyJobId('')
    }
  }

  const handleApprove = async (job) => {
    if (!job?.id || busyJobId) return
    setBusyJobId(job.id)
    try {
      await window.api.approveImportJob(job.id)
      await loadJobs()
      notify(t('import_apply_started') || 'Import apply started. You can keep using the app.', 'success')
    } catch (error) {
      notify(error?.message || (t('import_apply_failed') || 'Could not approve import'), 'error')
    } finally {
      setBusyJobId('')
    }
  }

  const handleDownloadErrors = async (job) => {
    if (!job?.id || busyJobId) return
    setBusyJobId(job.id)
    try {
      await window.api.downloadImportJobErrors(job.id)
    } catch (error) {
      notify(error?.message || (t('import_errors_download_failed') || 'Could not download import errors'), 'error')
    } finally {
      setBusyJobId('')
    }
  }

  return (
    <div className={`sticky top-0 z-40 border-b px-3 py-2 text-sm shadow-sm backdrop-blur [content-visibility:auto] ${
      hasAttention
        ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100'
        : 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-100'
    }`}>
      <div className="mx-auto flex max-w-screen-2xl flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setExpanded((value) => !value)}
        >
          {hasAttention ? <AlertTriangle className="h-4 w-4 flex-shrink-0" /> : isActive ? <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" /> : <CheckCircle2 className="h-4 w-4 flex-shrink-0" />}
          <span className="min-w-0 flex-1">
            <span className="font-semibold">{title}</span>
            <span className="ml-2 text-xs opacity-80">{getJobLabel(primaryJob)}</span>
          </span>
          <span className="text-xs font-semibold">{progress}%</span>
        </button>
        <div className="h-1.5 overflow-hidden rounded-full bg-black/10 md:w-48 dark:bg-white/10">
          <div className={`h-full rounded-full ${hasAttention ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${progress}%` }} />
        </div>
      </div>

      {expanded ? (
        <div className="mx-auto mt-2 grid max-w-screen-2xl gap-2">
          {visibleJobs.map((job) => {
            const jobStatus = normalizeJobStatus(job)
            const jobProgress = getJobProgress(job)
            const isJobCancellable = CANCELLABLE_STATUSES.has(jobStatus)
            const isAwaitingReview = jobStatus === 'awaiting_review'
            const failedRows = Number(job.failed_rows || job.summary?.failed || 0)
            const failedImages = Number(job.failed_images || 0)
            const lastError = String(job.last_error || '').trim()
            return (
              <div key={job.id} className="rounded-xl border border-current/15 bg-white/65 p-2 dark:bg-slate-950/45">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{getJobLabel(job)}</div>
                    <div className="text-xs opacity-75">
                      {Number(job.processed_rows || 0)} / {Number(job.total_rows || 0)} {rowsLabel}
                      {Number(job.total_images || 0) ? ` - ${Number(job.processed_images || 0)} / ${Number(job.total_images || 0)} ${imagesLabel}` : ''}
                      {(failedRows || failedImages) ? ` - ${failedRows + failedImages} ${issuesLabel}` : ''}
                      {lastError ? ` - ${lastError}` : ''}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-black/10 px-2 py-1 text-xs font-semibold dark:bg-white/10">{jobProgress}%</span>
                    {isJobCancellable ? (
                      <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busyJobId === job.id} aria-label={`${cancelLabel} ${getJobLabel(job)}`} onClick={() => handleCancel(job)}>
                        <XCircle className="mr-1 inline h-3.5 w-3.5" /> {cancelLabel}
                      </button>
                    ) : null}
                    {isAwaitingReview ? (
                      <button type="button" className="btn-primary px-2 py-1 text-xs" disabled={busyJobId === job.id} aria-label={`${approveLabel} ${getJobLabel(job)}`} onClick={() => handleApprove(job)}>
                        <PlayCircle className="mr-1 inline h-3.5 w-3.5" /> {approveLabel}
                      </button>
                    ) : null}
                    {REVIEW_STATUSES.has(jobStatus) && !isAwaitingReview ? (
                      <>
                        <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busyJobId === job.id} aria-label={`${errorsLabel} ${getJobLabel(job)}`} onClick={() => handleDownloadErrors(job)}>
                          <FileDown className="mr-1 inline h-3.5 w-3.5" /> {errorsLabel}
                        </button>
                        <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busyJobId === job.id} aria-label={`${retryLabel} ${getJobLabel(job)}`} onClick={() => handleRetry(job)}>
                          <RotateCcw className="mr-1 inline h-3.5 w-3.5" /> {retryLabel}
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
