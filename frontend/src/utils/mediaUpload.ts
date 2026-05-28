import { resolvePublicAssetUrl } from './publicAssetUrls.ts'

type UploadStatus = 'idle' | 'uploading' | 'uploaded' | 'error' | 'cancelled'
type ProcessingStatus = 'idle' | 'uploading' | 'ready' | 'error' | 'cancelled' | string

interface UploadState {
  status: UploadStatus
  progress: number
  previewUrl: string
  error: string
  fileName: string
  publicPath: string
  processingStatus: ProcessingStatus
  mediaJobId: string
  cacheVersion: string
}

interface UploadAction {
  key?: unknown
  type?: unknown
  fileName?: unknown
  previewUrl?: unknown
  progress?: unknown
  publicPath?: unknown
  processingStatus?: unknown
  mediaJobId?: unknown
  cacheVersion?: unknown
  error?: unknown
}

type UploadStateMap = Record<string, UploadState> & Record<string, any>

export function createInitialUploadState(): UploadState {
  return {
    status: 'idle',
    progress: 0,
    previewUrl: '',
    error: '',
    fileName: '',
    publicPath: '',
    processingStatus: 'idle',
    mediaJobId: '',
    cacheVersion: '',
  }
}

export function isTemporaryPreviewUrl(value: unknown): boolean {
  const raw = String(value || '').trim().toLowerCase()
  return raw.startsWith('blob:') || raw.startsWith('data:')
}

export function sanitizePersistedMediaPath(value: unknown, fallback = ''): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (isTemporaryPreviewUrl(raw)) return String(fallback || '').trim()
  return raw
}

export function buildCacheBustedMediaPath(path: unknown, version: unknown): string {
  const rawPath = resolvePublicAssetUrl(path) || String(path || '').trim()
  const rawVersion = String(version || '').trim()
  if (!rawPath || !rawVersion) return rawPath
  if (isTemporaryPreviewUrl(rawPath)) return rawPath
  try {
    const parsed = new URL(rawPath, 'http://localhost')
    parsed.searchParams.set('v', rawVersion)
    if (/^https?:\/\//i.test(rawPath)) return parsed.toString()
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch (_) {
    const withoutVersion = String(rawPath).replace(/([?&])v=[^&#]*(&?)/, (match, prefix, suffix) => (
      suffix ? prefix : ''
    )).replace(/[?&]$/, '')
    return `${withoutVersion}${withoutVersion.includes('?') ? '&' : '?'}v=${encodeURIComponent(rawVersion)}`
  }
}

export function reduceUploadState(state: UploadStateMap = {}, action: UploadAction = {}): UploadStateMap {
  const key = String(action.key || '').trim()
  if (!key) return state
  const current = state[key] || {
    ...createInitialUploadState(),
  }
  if (action.type === 'start') {
    return {
      ...state,
      [key]: {
        ...current,
        status: 'uploading',
        progress: 0,
        fileName: String(action.fileName || current.fileName || ''),
        previewUrl: action.previewUrl || '',
        error: '',
        processingStatus: 'uploading',
      },
    }
  }
  if (action.type === 'progress') {
    return {
      ...state,
      [key]: {
        ...current,
        status: 'uploading',
        progress: Math.max(0, Math.min(100, Number(action.progress || 0))),
      },
    }
  }
  if (action.type === 'success') {
    return {
      ...state,
      [key]: {
        ...current,
        status: 'uploaded',
        progress: 100,
        error: '',
        publicPath: String(action.publicPath || current.publicPath || ''),
        processingStatus: String(action.processingStatus || current.processingStatus || 'ready'),
        mediaJobId: String(action.mediaJobId || current.mediaJobId || ''),
        cacheVersion: String(action.cacheVersion || current.cacheVersion || ''),
      },
    }
  }
  if (action.type === 'error') {
    return {
      ...state,
      [key]: {
        ...current,
        status: 'error',
        error: String(action.error || 'Upload failed'),
        processingStatus: 'error',
      },
    }
  }
  if (action.type === 'cancel') {
    return {
      ...state,
      [key]: {
        ...current,
        status: 'cancelled',
        processingStatus: 'cancelled',
      },
    }
  }
  return state
}
