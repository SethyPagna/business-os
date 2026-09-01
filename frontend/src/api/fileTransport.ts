import { getClientDeviceInfo } from '../utils/deviceInfo.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'
import { getCurrentUserContext } from './actorQuery.ts'
import {
  apiFetch,
  getSyncServerUrl,
  requireLiveServerWrite,
  route,
} from './http.ts'
import { buildMultipartHeaders } from './multipartHeaders.ts'
import { compressImageFile, isCompressibleImageFile, type CompressImageOptions } from '../utils/imageCompression.ts'
import { compressVideoFile, isCompressibleVideoFile } from '../utils/videoCompression.ts'

type FileListResponse = {
  items?: unknown[]
  total?: unknown
  page?: unknown
  pageSize?: unknown
  page_size?: unknown
  hasMore?: unknown
  has_more?: unknown
}

type FileListMeta = {
  items: unknown[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

type FileListParams = QueryParams & {
  includeMeta?: boolean
  page?: number
  pageSize?: number
  limit?: number
}

export type UploadProgress = {
  loaded: number
  total: number
  percent: number
}

type FileUploadPayload = {
  file?: File
  userId?: string | number | null
  userName?: string | null
  signal?: AbortSignal
  onProgress?: (progress: UploadProgress) => void
  // Optional override for compressImageFile's own byte/dimension budget.
  // Left unset, every caller keeps today's shared DEFAULT_COMPRESS_OPTIONS
  // (150KB max / 2560px) -- callers whose images genuinely need that
  // headroom (Catalog promo banners, Settings branding) are untouched.
  // The Library page (FilesPage.tsx) passes a tighter budget here for its
  // own uploads specifically, since those are typically just reference/
  // content thumbnails rather than full-bleed product photography.
  compressOptions?: CompressImageOptions
}

// The Library page used to carry its OWN, much tighter budget
// (1200px/70KB/40KB) on the reasoning that grid thumbnails don't need
// full-bleed headroom. That is why library objects were landing around 70KB
// while everything else used a different budget entirely -- two competing
// definitions of "compressed enough" for one library, and the tighter one
// applied to the images the user actually looks at most.
//
// There is now ONE budget for every stored image (the shared quality-preserving image budget in
// utils/imageCompression.ts's DEFAULT_COMPRESS_OPTIONS), so the Library no
// longer overrides anything. Kept as an explicit named export rather than
// deleted so FilesPage.tsx's call site still reads as a deliberate choice,
// and so a future page-specific budget has an obvious place to live.
export const LIBRARY_IMAGE_COMPRESS_OPTIONS: CompressImageOptions = {}

type AvatarUploadPayload = {
  file?: File
  filePath?: string
  fileName?: string
}

function normalizeFileListResult(result: unknown, params: FileListParams): unknown[] | FileListMeta {
  const response = result as FileListResponse | null
  const items = Array.isArray(response?.items) ? response.items : (Array.isArray(result) ? result : [])
  if (!params.includeMeta) return items

  return {
    items,
    total: Number(response?.total || items.length || 0),
    page: Number(response?.page || params.page || 1),
    pageSize: Number(response?.pageSize || response?.page_size || params.pageSize || params.limit || items.length || 0),
    hasMore: Boolean(response?.hasMore || response?.has_more),
  }
}

function appendUserAndDeviceFields(form: FormData, payload: FileUploadPayload): void {
  const device = getClientDeviceInfo()
  if (payload.userId) form.append('userId', String(payload.userId))
  if (payload.userName) form.append('userName', String(payload.userName))
  if (device.deviceName) form.append('deviceName', String(device.deviceName))
  if (device.deviceTz) form.append('deviceTz', String(device.deviceTz))
  if (device.clientTime) form.append('clientTime', String(device.clientTime))
}

function dataUrlToBlob(filePath: string, fallbackMime = 'image/jpeg'): Blob {
  const [meta, b64 = ''] = filePath.split(',')
  const mime = meta.match(/:(.*?);/)?.[1] || fallbackMime
  const bytes = Uint8Array.from(atob(b64), (char) => char.charCodeAt(0))
  return new Blob([bytes], { type: mime })
}

function parseJsonResponse(text: string): { data?: unknown; error?: string; message?: string } | null {
  try {
    return text ? JSON.parse(text) : null
  } catch (_) {
    return null
  }
}

export async function getFiles(params: FileListParams = {}): Promise<unknown[] | FileListMeta> {
  const query = buildQueryString(params)
  const result = await route(
    `files:get:${query}`,
    () => apiFetch('GET', appendQuery('/api/files', query)),
    // The media library has no offline mirror. Returning [] on a failed
    // server read makes a real error look like an empty successful library,
    // which clears the visible upload list until a manual refresh. Let the
    // caller keep its current list and show the actual error instead.
    null,
  )
  if (result == null) throw new Error('Files library is unavailable')
  return normalizeFileListResult(result, params)
}

export async function uploadFileAsset(payload: FileUploadPayload = {}): Promise<unknown> {
  const { file, signal, onProgress, compressOptions } = payload
  if (!(file instanceof File)) throw new Error('Choose a file first')
  requireLiveServerWrite('files:upload', {
    offlineMessage: 'Server is offline. File uploads are invalid until the server reconnects.',
    notConfiguredMessage: 'Server is not connected. File uploads are invalid until a live server is configured.',
  })

  // Images get re-encoded/resized client-side before leaving the browser --
  // the Workers backend has no `sharp` and can't compress on its end (see
  // routes/files.ts). Video now gets the same treatment via ffmpeg.wasm
  // (utils/videoCompression.ts) -- automatic settings, no manual
  // codec/bitrate picker. Documents still pass through untouched; there is
  // no meaningful client-side compression to do for those file types.
  const uploadFile = isCompressibleImageFile(file)
    ? await compressImageFile(file, compressOptions)
    : isCompressibleVideoFile(file)
      ? await compressVideoFile(file)
      : file

  const base = getSyncServerUrl().replace(/\/$/, '')
  const form = new FormData()
  form.append('file', uploadFile, uploadFile.name)
  appendUserAndDeviceFields(form, payload)

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let settled = false

    const finish = (handler: (value: unknown) => void, value: unknown): void => {
      if (settled) return
      settled = true
      if (signal) signal.removeEventListener('abort', abortListener)
      handler(value)
    }

    const abortListener = (): void => {
      try { xhr.abort() } catch (_) {}
    }

    xhr.open('POST', `${base}/api/files/upload`, true)
    xhr.withCredentials = true
    for (const [key, value] of Object.entries(buildMultipartHeaders())) {
      if (value) xhr.setRequestHeader(key, value)
    }

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || typeof onProgress !== 'function') return
      onProgress({
        loaded: event.loaded,
        total: event.total,
        percent: Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100))),
      })
    }

    xhr.onerror = () => finish(reject, new Error('File upload failed. Check your server connection and try again.'))
    xhr.onabort = () => finish(reject, new Error('Upload cancelled'))
    xhr.onload = () => {
      const parsed = parseJsonResponse(xhr.responseText)
      if (xhr.status < 200 || xhr.status >= 300) {
        const message = parsed?.error || parsed?.message || xhr.responseText || xhr.status
        finish(reject, new Error(`File upload failed: ${message}`))
        return
      }
      finish(resolve, parsed?.data || parsed)
    }

    if (signal) {
      if (signal.aborted) {
        finish(reject, new Error('Upload cancelled'))
        return
      }
      signal.addEventListener('abort', abortListener, { once: true })
    }

    xhr.send(form)
  })
}

export function deleteFileAsset(id: string | number, payload: Record<string, unknown> = {}): Promise<unknown> {
  return route(
    'files:delete',
    () => apiFetch('DELETE', `/api/files/${encodeURIComponent(String(id))}`, {
      ...getCurrentUserContext(),
      ...(payload || {}),
    }),
    null,
    true,
  )
}

// Renames only the asset's display name (`original_name`) -- the storage
// key / public path are untouched server-side (see routes/files.ts's own
// comment), so this never breaks an existing product image, avatar, or
// portal-setting reference to the file.
// 8.1 (Part 418): the drill-in behind the list's usage counts -- which
// products/gallery rows/avatars/settings reference this asset, by name.
export type FileUsageDetail = {
  id: number
  public_path: string
  covers: Array<{ id: number; name: string | null; barcode: string | null }>
  gallery: Array<{ product_id: number; name: string | null; sort_order: number | null }>
  avatars: Array<{ id: number; name: string | null; username: string | null }>
  settings: string[]
}

export async function getFileUsage(id: string | number): Promise<FileUsageDetail> {
  const result = await route<FileUsageDetail>(
    `files:usage:${id}`,
    () => apiFetch('GET', `/api/files/${encodeURIComponent(String(id))}/usage`),
    // No offline mirror, same reasoning as getFiles: a failed read must
    // surface as an error, never as "this file is used by nothing".
    null,
  )
  if (result == null) throw new Error('File usage is unavailable')
  return result
}

// 8.1: repoint every product cover/gallery/avatar reference from this
// asset to another library image (settings references stay put -- the
// server says so in its response).
export function rewireFileAsset(id: string | number, toFileId: string | number): Promise<{ success?: boolean; rewired?: { products?: number; gallery?: number; avatars?: number }; settingsSkipped?: number } | null> {
  return route(
    'files:rewire',
    () => apiFetch('POST', `/api/files/${encodeURIComponent(String(id))}/rewire`, { to_file_id: Number(toFileId) }),
    null,
    true,
  )
}

export function renameFileAsset(id: string | number, originalName: string): Promise<unknown> {
  return route(
    'files:rename',
    () => apiFetch('PATCH', `/api/files/${encodeURIComponent(String(id))}`, { original_name: originalName }),
    null,
    true,
  )
}

export async function uploadUserAvatar({ filePath, fileName, file }: AvatarUploadPayload): Promise<unknown> {
  if (file instanceof File) {
    const { userId, userName } = getCurrentUserContext()
    const asset = await uploadFileAsset({ file, userId, userName }) as { public_path?: string } | null
    return {
      path: asset?.public_path || '',
      asset,
    }
  }

  requireLiveServerWrite('users:uploadAvatar', {
    offlineMessage: 'Server is offline. Avatar uploads are invalid until the server reconnects.',
    notConfiguredMessage: 'Server is not connected. Avatar uploads are invalid until a live server is configured.',
  })
  if (!filePath?.startsWith('data:')) throw new Error('No avatar image data provided')

  const sourceBlob = dataUrlToBlob(filePath)
  const sourceFile = new File([sourceBlob], fileName || 'avatar.jpg', { type: sourceBlob.type })
  const compressed = isCompressibleImageFile(sourceFile) ? await compressImageFile(sourceFile) : sourceFile

  const form = new FormData()
  form.append('image', compressed, compressed.name || fileName || 'avatar.jpg')

  const base = getSyncServerUrl().replace(/\/$/, '')
  const res = await fetch(`${base}/api/users/avatar-upload`, {
    method: 'POST',
    headers: { 'bypass-tunnel-reminder': 'true' },
    credentials: 'include',
    body: form,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Avatar upload failed: ${text || res.status}`)
  }
  return res.json()
}
