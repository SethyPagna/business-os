import { apiFetch, getSyncServerUrl, route } from './http.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'
import { apiFormPost, buildMultipartHeaders, withImportDeviceInfo } from './importTransport.ts'
import { getClientDeviceInfo } from '../utils/deviceInfo.ts'

type ImportJobPayload = Record<string, unknown>
type ImportJobOptions = {
  source?: unknown
  force?: unknown
}
type ImportJobCsvPayload = {
  jobId: string | number
  text?: unknown
  fileName?: string
}
type ImportJobZipPayload = {
  jobId: string | number
  file?: File
}
type BrowserImageEntry = {
  file?: File
  relativePath?: string
}
type ImportJobImagePayload = {
  jobId: string | number
  files?: BrowserImageEntry[]
  onProgress?: (progress: { progress: number; label: string }) => void
  batchSize?: number
}
type ImportJobActivityDetail = {
  action: string
  jobId?: string
  ts: number
}

const lastImportJobsByQuery = new Map<string, unknown>()

function encodeId(id: string | number): string {
  return encodeURIComponent(String(id))
}

function getSource(options: ImportJobOptions = {}): string {
  return String(options.source || 'ui')
}

function appendDeviceFields(form: FormData): void {
  const device = getClientDeviceInfo()
  if (device.deviceName) form.append('deviceName', String(device.deviceName))
  if (device.deviceTz) form.append('deviceTz', String(device.deviceTz))
  if (device.clientTime) form.append('clientTime', String(device.clientTime))
}

function notifyImportJobActivity(action: string, jobId?: string | number): void {
  if (typeof window === 'undefined') return
  const detail: ImportJobActivityDetail = {
    action,
    jobId: jobId == null ? undefined : String(jobId),
    ts: Date.now(),
  }
  window.dispatchEvent(new CustomEvent('import-job:activity', { detail }))
}

export function createImportJob(payload: ImportJobPayload = {}): Promise<unknown> {
  notifyImportJobActivity('create')
  return route(
    'importJobs:create',
    () => apiFetch('POST', '/api/import-jobs', withImportDeviceInfo(payload)),
    null,
    true,
  )
}

export function listImportJobs(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params)
  return route(
    `importJobs:list:${query}`,
    async () => {
      const result = await apiFetch('GET', appendQuery('/api/import-jobs', query))
      lastImportJobsByQuery.set(query, result)
      return result
    },
    () => lastImportJobsByQuery.get(query) || { jobs: [], unavailable: true, transient: true },
  )
}

export function getImportJob(id: string | number): Promise<unknown> {
  return route(
    `importJobs:get:${id}`,
    () => apiFetch('GET', `/api/import-jobs/${encodeId(id)}`),
    null,
  )
}

export function getImportJobReview(id: string | number, params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params)
  return route(
    `importJobs:review:${id}:${query}`,
    () => apiFetch('GET', appendQuery(`/api/import-jobs/${encodeId(id)}/review`, query)),
    null,
  )
}

export function updateImportJobDecisions(id: string | number, decisions: ImportJobPayload = {}): Promise<unknown> {
  return route(
    `importJobs:decisions:${id}`,
    () => apiFetch('PATCH', `/api/import-jobs/${encodeId(id)}/decisions`, withImportDeviceInfo({ decisions })),
    null,
    true,
  )
}

export function preflightImportJob(id: string | number): Promise<unknown> {
  return route(
    `importJobs:preflight:${id}`,
    () => apiFetch('POST', `/api/import-jobs/${encodeId(id)}/preflight`, withImportDeviceInfo({})),
    null,
    true,
  )
}

function runImportJobAction(id: string | number, action: string, options: ImportJobOptions = {}): Promise<unknown> {
  notifyImportJobActivity(action, id)
  return route(
    `importJobs:${action}:${id}`,
    () => apiFetch('POST', `/api/import-jobs/${encodeId(id)}/${action}`, withImportDeviceInfo({ source: getSource(options) })),
    null,
    true,
  )
}

export function startImportJob(id: string | number, options: ImportJobOptions = {}): Promise<unknown> {
  return runImportJobAction(id, 'start', options)
}

export function approveImportJob(id: string | number, options: ImportJobOptions = {}): Promise<unknown> {
  return runImportJobAction(id, 'approve', options)
}

export function cancelImportJob(id: string | number, options: ImportJobOptions = {}): Promise<unknown> {
  return runImportJobAction(id, 'cancel', options)
}

export function retryImportJob(id: string | number, options: ImportJobOptions = {}): Promise<unknown> {
  return runImportJobAction(id, 'retry', options)
}

export function deleteImportJob(id: string | number, options: ImportJobOptions = {}): Promise<unknown> {
  notifyImportJobActivity('delete', id)
  return route(
    `importJobs:delete:${id}`,
    async () => {
      const encodedId = encodeId(id)
      const force = options.force ? '?force=1' : ''
      let firstError: unknown = null
      try {
        return await apiFetch('DELETE', `/api/import-jobs/${encodedId}${force}`, withImportDeviceInfo({ source: getSource(options) }))
      } catch (error) {
        firstError = error
      }
      try {
        return await apiFetch('POST', `/api/import-jobs/${encodedId}/delete`, withImportDeviceInfo({ force: !!options.force, source: getSource(options) }))
      } catch (error) {
        const fallbackError = firstError as { message?: unknown } | null
        const currentError = error as { message?: unknown; status?: unknown }
        const message = String(currentError?.message || fallbackError?.message || '')
        if (Number(currentError?.status) === 404 || /Cannot DELETE|Cannot POST|<!DOCTYPE html/i.test(message)) {
          throw new Error('Import remove route is unavailable. Restart or update the server, then try Remove import again.')
        }
        throw error
      }
    },
    null,
    true,
  )
}

export function getImportQueueStatus(): Promise<unknown> {
  return route(
    'importJobs:queueStatus',
    () => apiFetch('GET', '/api/import-jobs/queue/status'),
    null,
  )
}

export async function downloadImportJobErrors(jobId: string | number): Promise<unknown> {
  const base = getSyncServerUrl().replace(/\/$/, '')
  const res = await fetch(`${base}/api/import-jobs/${encodeId(jobId)}/errors.csv`, {
    method: 'GET',
    headers: buildMultipartHeaders(),
    credentials: 'include',
  })
  if (!res.ok) throw new Error(await res.text().catch(() => 'Failed to download import errors'))
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${jobId}-errors.csv`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
  return { success: true }
}

export function uploadImportJobCsv({ jobId, text, fileName = 'products.csv' }: ImportJobCsvPayload): Promise<unknown> {
  notifyImportJobActivity('upload-csv', jobId)
  const form = new FormData()
  const source = String(text || '')
  form.append('file', new Blob([source.startsWith('\uFEFF') ? '' : '\uFEFF', source], { type: 'text/csv;charset=utf-8' }), fileName)
  appendDeviceFields(form)
  return apiFormPost(`/api/import-jobs/${jobId}/csv`, form, 'importJobs:csv')
}

export function uploadImportJobZip({ jobId, file }: ImportJobZipPayload): Promise<unknown> {
  notifyImportJobActivity('upload-zip', jobId)
  if (!(file instanceof File)) throw new Error('Choose a ZIP file first')
  const form = new FormData()
  form.append('file', file, file.name || 'images.zip')
  appendDeviceFields(form)
  return apiFormPost(`/api/import-jobs/${jobId}/zip`, form, 'importJobs:zip')
}

export async function uploadImportJobImages({
  jobId,
  files = [],
  onProgress,
  batchSize = 100,
}: ImportJobImagePayload): Promise<unknown[]> {
  notifyImportJobActivity('upload-images', jobId)
  const browserFiles: BrowserImageEntry[] = []
  for (const entry of Array.isArray(files) ? files : []) {
    if (entry?.file instanceof File) browserFiles.push(entry)
  }

  const uploaded: unknown[] = []
  for (let offset = 0; offset < browserFiles.length; offset += batchSize) {
    const batch = browserFiles.slice(offset, offset + batchSize)
    const form = new FormData()
    const relativePaths: string[] = []
    for (const entry of batch) {
      form.append('files', entry.file as File, entry.file?.name || 'image')
      relativePaths.push(entry.relativePath || entry.file?.webkitRelativePath || entry.file?.name || 'image')
    }
    form.append('relative_paths', JSON.stringify(relativePaths))
    appendDeviceFields(form)

    const result = await apiFormPost(`/api/import-jobs/${jobId}/images`, form, 'importJobs:images') as { files?: unknown[] } | null
    uploaded.push(...(Array.isArray(result?.files) ? result.files : []))
    onProgress?.({
      progress: browserFiles.length ? Math.round(((offset + batch.length) / browserFiles.length) * 100) : 100,
      label: `Uploading images ${Math.min(offset + batch.length, browserFiles.length)} / ${browserFiles.length}`,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return uploaded
}
