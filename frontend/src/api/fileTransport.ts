import { getClientDeviceInfo } from '../utils/deviceInfo.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'
import { getCurrentUserContext } from './actorQuery.ts'
import {
  apiFetch,
  getSyncServerUrl,
  requireLiveServerWrite,
  route,
} from './http.ts'
import { buildMultipartHeaders } from './importTransport.ts'

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
}

type ImageUploadPayload = {
  productId?: string | number
  file?: File
  filePath?: string
  fileName?: string
}

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
    () => [],
  )
  return normalizeFileListResult(result, params)
}

export async function uploadFileAsset(payload: FileUploadPayload = {}): Promise<unknown> {
  const { file, signal, onProgress } = payload
  if (!(file instanceof File)) throw new Error('Choose a file first')
  requireLiveServerWrite('files:upload', {
    offlineMessage: 'Server is offline. File uploads are invalid until the server reconnects.',
    notConfiguredMessage: 'Server is not connected. File uploads are invalid until a live server is configured.',
  })

  const base = getSyncServerUrl().replace(/\/$/, '')
  const form = new FormData()
  form.append('file', file, file.name)
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

export async function uploadProductImage({
  productId,
  file,
  filePath,
  fileName,
}: ImageUploadPayload): Promise<unknown> {
  void productId
  requireLiveServerWrite('products:uploadImage', {
    offlineMessage: 'Server is offline. Product image uploads are invalid until the server reconnects.',
    notConfiguredMessage: 'Server is not connected. Product image uploads are invalid until a live server is configured.',
  })

  const form = new FormData()
  if (file instanceof File) {
    form.append('image', file, file.name || fileName || 'product.jpg')
  } else if (filePath?.startsWith('data:')) {
    form.append('image', dataUrlToBlob(filePath), fileName || 'product.jpg')
  } else if (filePath) {
    throw new Error('Native file path upload not supported in browser mode')
  } else {
    throw new Error('No image file provided')
  }

  const base = getSyncServerUrl().replace(/\/$/, '')
  const res = await fetch(`${base}/api/products/upload-image`, {
    method: 'POST',
    headers: { 'bypass-tunnel-reminder': 'true' },
    credentials: 'include',
    body: form,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Image upload failed: ${text || res.status}`)
  }
  return res.json()
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

  const form = new FormData()
  form.append('image', dataUrlToBlob(filePath), fileName || 'avatar.jpg')

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
