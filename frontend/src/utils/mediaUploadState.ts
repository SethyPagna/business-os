type UploadStatus = 'idle' | 'uploading' | 'uploaded' | 'error' | 'cancelled'
type ProcessingStatus = 'idle' | 'uploading' | 'ready' | 'error' | 'cancelled' | string

export interface UploadState {
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

export interface UploadAction {
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

export type UploadStateMap = Record<string, UploadState> & Record<string, any>

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
