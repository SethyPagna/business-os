import { apiFetch, getSyncServerUrl, route } from './http.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'
import { apiFormPost, buildMultipartHeaders, withImportDeviceInfo } from './importTransport.ts'
import { getClientDeviceInfo } from '../utils/deviceInfo.ts'
import { compressImageFile, isCompressibleImageFile } from '../utils/imageCompression.ts'
import { resolvePublicAssetUrl } from '../utils/publicAssetUrls.ts'

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
// Shape of one entry in uploadImportJobZip's `images` array (storeUpload's
// return value in routes/importJobs.ts) -- only the fields
// recompressImportJobZipImages actually needs.
type ZipExtractedImage = {
  id?: number | string
  original_name?: string
  byte_size?: number
  public_path?: string
}

const lastImportJobsByQuery = new Map<string, unknown>()

// preflightImportJob and approveImportJob both land on a route that runs a
// real synchronous classify pass server-side (importEngine.ts's
// classifyContacts/classifyProducts -- a full existing-table load plus
// O(existing x rows) matching in JS, up to PREFLIGHT_MAX_ROWS=500 rows for
// preflight) before responding -- not a quick status flip. apiFetch's
// generic default (SYNC.REQUEST_TIMEOUT_MS, 12s) was being used here
// unchanged, so a request that took the Worker longer than 12s to finish
// classifying (a large existing customers/suppliers/delivery_contacts
// table is the realistic trigger -- there's no chunking on this synchronous
// path the way the queued analyze/apply phases have) got client-side
// aborted by apiFetch's own AbortController well before the server
// actually failed or disconnected. http.ts's isConnectivityError() then
// treats that abort's "timed out" message as a real connectivity failure,
// and route()'s write-path surfaces the generic "Server is offline.
// Changes are invalid until the server reconnects." message -- exactly
// what was reported as "approving an import throws a false 'server
// offline'" for Contacts imports. This is the same root cause
// systemRuntime.ts's resetData()/factoryReset() had (see Part 254): the
// client gave up before the server did, and the server kept working
// server-side regardless (the classify pass, or for approve, the queued
// apply it just kicked off) -- the request wasn't actually failing, it was
// just slower than the generic default assumed. Fixed the same way: give
// these two routes their own longer timeout instead of inheriting the
// generic one meant for quick reads/writes.
const IMPORT_JOB_SYNC_ACTION_TIMEOUT_MS = 45_000

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

// Full import report (grouped "row-number notation" warnings, error list,
// per-action counts) for one job -- what the Dashboard's import-warnings
// card and the Audit Log's per-file drilldown both open on click. Distinct
// from getImportJobReview above: review is paginated/filterable for the
// row-by-row approval screen, report is the whole-job summary.
export function getImportJobReport(id: string | number): Promise<unknown> {
  return route(
    `importJobs:report:${id}`,
    () => apiFetch('GET', `/api/import-jobs/${encodeId(id)}/report`),
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

// Manually matches (or clears the match for) an image that best-fit
// auto-matching (importEngine.ts's computeImportImageMatch) couldn't
// place -- or placed against the wrong row. rowNumber: null clears a
// previous manual assignment.
export function assignImportJobImage(id: string | number, fileId: string | number, rowNumber: number | null): Promise<unknown> {
  return route(
    `importJobs:imageAssign:${id}:${fileId}`,
    () => apiFetch('PATCH', `/api/import-jobs/${encodeId(id)}/images/assign`, withImportDeviceInfo({ file_id: fileId, row_number: rowNumber })),
    null,
    true,
  )
}

// Manually attaches an unmatched image straight to an EXISTING catalog
// product -- not a row in this import's own CSV (assignImportJobImage,
// above, is for that case). Use when the operator is bulk-uploading
// images with no matching CSV row at all (a stray photo, or a product
// that already exists and just needed a picture added). Takes effect
// immediately server-side (writes into that product's live gallery),
// unlike a row assignment which only takes effect once the job is
// approved/applied -- so this never shows up again in the "unmatched"
// panel on the next analyze.
export function assignImportJobImageToExistingProduct(id: string | number, fileId: string | number, productId: string | number): Promise<unknown> {
  return route(
    `importJobs:imageAssignExisting:${id}:${fileId}`,
    () => apiFetch('PATCH', `/api/import-jobs/${encodeId(id)}/images/assign-existing`, withImportDeviceInfo({ file_id: fileId, product_id: productId })),
    null,
    true,
  )
}

// Records which images win when more than MAX_IMAGES_PER_PRODUCT (5)
// auto-matched the same row -- keepFileIds: [] clears the override and
// reverts to the engine's score-based auto-pick.
export function resolveImportJobImageLimit(id: string | number, rowNumber: number, keepFileIds: Array<string | number>): Promise<unknown> {
  return route(
    `importJobs:imageLimit:${id}:${rowNumber}`,
    () => apiFetch('PATCH', `/api/import-jobs/${encodeId(id)}/images/resolve-limit`, withImportDeviceInfo({ row_number: rowNumber, keep_file_ids: keepFileIds })),
    null,
    true,
  )
}

export function preflightImportJob(id: string | number): Promise<unknown> {
  return route(
    `importJobs:preflight:${id}`,
    // See IMPORT_JOB_SYNC_ACTION_TIMEOUT_MS's comment above -- this route
    // does real synchronous classify work, not a quick status check.
    () => apiFetch('POST', `/api/import-jobs/${encodeId(id)}/preflight`, withImportDeviceInfo({}), IMPORT_JOB_SYNC_ACTION_TIMEOUT_MS),
    null,
    true,
  )
}

function runImportJobAction(id: string | number, action: string, options: ImportJobOptions = {}, timeoutMs?: number): Promise<unknown> {
  notifyImportJobActivity(action, id)
  return route(
    `importJobs:${action}:${id}`,
    () => apiFetch('POST', `/api/import-jobs/${encodeId(id)}/${action}`, withImportDeviceInfo({ source: getSource(options) }), timeoutMs),
    null,
    true,
  )
}

export function startImportJob(id: string | number, options: ImportJobOptions = {}): Promise<unknown> {
  return runImportJobAction(id, 'start', options)
}

export function approveImportJob(id: string | number, options: ImportJobOptions = {}): Promise<unknown> {
  // See IMPORT_JOB_SYNC_ACTION_TIMEOUT_MS's comment above -- approve
  // immediately flips status and enqueues the apply phase, which is fast on
  // its own, but this route is what Part-254-class false "server offline"
  // reports on Contacts imports actually traced back to (the preceding
  // preflight call in the same UI action was the slow one -- this timeout
  // is raised too for the same margin-of-safety reason Reset's write got
  // raised, not because /approve itself is known to be slow).
  return runImportJobAction(id, 'approve', options, IMPORT_JOB_SYNC_ACTION_TIMEOUT_MS)
}

export function cancelImportJob(id: string | number, options: ImportJobOptions = {}): Promise<unknown> {
  return runImportJobAction(id, 'cancel', options)
}

// Server-side "seen this, stop showing it" -- separate from approve/cancel,
// see cloudflare/src/routes/importJobs.ts's /:id/dismiss for why.
export function dismissImportJob(id: string | number, options: ImportJobOptions = {}): Promise<unknown> {
  return runImportJobAction(id, 'dismiss', options)
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

// `text` here is always already-converted, comma-delimited CSV -- callers
// that picked a real Excel workbook (.xlsx/.xls/.xlsm) ran it through
// parseImportFile (utils/spreadsheetImport.ts) client-side first, same as
// every other import entry point. The `fileName` passed in is only the
// *original* picked file's name, though, and callers pass it straight
// through unchanged for display purposes (e.g. "Q3 products.xlsx") -- so an
// Excel pick reaches here with an .xlsx name attached to what is, on the
// wire, plain CSV bytes. The backend's /:id/csv route (importJobs.ts)
// validates the upload by filename extension (.csv/.tsv only, no way for it
// to sniff Excel from bytes it's never given), so forwarding the original
// name verbatim made every Excel-sourced background import fail with
// "Upload a CSV or TSV file" even though the content was perfectly valid --
// this was true for products, contacts, inventory, and sales, since all
// four route through this one function. Force a .csv extension on the
// upload itself so the name always matches the content's real format;
// this doesn't touch the original name shown anywhere else in the UI.
function toCsvUploadFileName(name: string): string {
  const trimmed = String(name || '').trim()
  const base = trimmed.replace(/\.[^./\\]+$/, '') || 'import'
  return `${base}.csv`
}

export function uploadImportJobCsv({ jobId, text, fileName = 'products.csv' }: ImportJobCsvPayload): Promise<unknown> {
  notifyImportJobActivity('upload-csv', jobId)
  const form = new FormData()
  const source = String(text || '')
  form.append('file', new Blob([source.startsWith('\uFEFF') ? '' : '\uFEFF', source], { type: 'text/csv;charset=utf-8' }), toCsvUploadFileName(fileName))
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
      const original = entry.file as File
      // Same client-side re-encode/resize manual Product-form and Library
      // uploads already get (see fileTransport.ts's uploadFileAsset) --
      // the Workers backend has no `sharp`, so this is the only place
      // these bytes get compressed at all before landing in R2. Only
      // applies to this direct/per-file browser-picked path; a ZIP's
      // contents are extracted server-side (see routes/importJobs.ts's
      // POST /:id/zip) and can't be pre-compressed here since the browser
      // never sees the individual images before upload -- see
      // recompressImportJobImage below for that path's round-trip fix.
      const uploadFile = isCompressibleImageFile(original) ? await compressImageFile(original) : original
      form.append('files', uploadFile, uploadFile.name || original.name || 'image')
      relativePaths.push(entry.relativePath || original.webkitRelativePath || original.name || 'image')
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

// Replaces one already-stored import image's bytes with a smaller,
// client-recompressed version -- the browser-round-trip half of the ZIP
// compression fix (see routes/importJobs.ts's POST
// /:id/images/:fileId/recompress for the full explanation of why this
// can't just happen server-side). Not exported for direct use by callers
// other than recompressImportJobZipImages below; kept as its own function
// mainly so a single image's failure/skip is independently reportable.
async function recompressImportJobImage(jobId: string | number, fileId: string | number, file: File): Promise<{ applied: boolean }> {
  const form = new FormData()
  form.append('file', file, file.name || 'image')
  appendDeviceFields(form)
  const result = await apiFormPost(
    `/api/import-jobs/${encodeId(jobId)}/images/${encodeId(fileId)}/recompress`,
    form,
    'importJobs:imageRecompress',
  ) as { applied?: boolean } | null
  return { applied: !!result?.applied }
}

// Runs after uploadImportJobZip: fetches each server-extracted image back
// from its public path, re-encodes it through the same Canvas compressor
// every other upload path uses, and -- only for the ones that actually
// shrank -- posts the smaller bytes back in place. Best-effort by design:
// a fetch/compress/upload failure on one image is swallowed (the import
// already has the original, uncompressed bytes stored and fully usable;
// this pass only ever makes things smaller, never blocks the import on
// its own success) and reported back per-file so a caller can log/surface
// a summary without it needing to affect the import flow itself.
export async function recompressImportJobZipImages(
  jobId: string | number,
  images: ZipExtractedImage[] = [],
  onProgress?: (progress: { done: number; total: number }) => void,
): Promise<{ attempted: number; compressed: number; savedBytes: number }> {
  const candidates = (Array.isArray(images) ? images : []).filter(
    (image) => image?.id != null && image.public_path && isCompressibleImageFile({ name: String(image.original_name || ''), type: '' }),
  )
  let compressed = 0
  let savedBytes = 0
  for (let index = 0; index < candidates.length; index += 1) {
    const image = candidates[index]
    try {
      const response = await fetch(resolvePublicAssetUrl(image.public_path), {
        headers: { 'bypass-tunnel-reminder': 'true' },
        credentials: 'include',
      })
      if (!response.ok) continue
      const blob = await response.blob()
      const originalName = image.original_name || 'image'
      const original = new File([blob], originalName, { type: blob.type })
      const recompressedFile = await compressImageFile(original)
      // compressImageFile already only returns a smaller file when it's
      // worth it (or the original, renamed-only, otherwise) -- skip the
      // round-trip upload entirely when nothing was actually saved.
      if (recompressedFile.size >= original.size) continue
      const outcome = await recompressImportJobImage(jobId, image.id as string | number, recompressedFile)
      if (outcome.applied) {
        compressed += 1
        savedBytes += Math.max(0, original.size - recompressedFile.size)
      }
    } catch (_) {
      // Best-effort -- see function comment above.
    } finally {
      onProgress?.({ done: index + 1, total: candidates.length })
    }
  }
  return { attempted: candidates.length, compressed, savedBytes }
}
