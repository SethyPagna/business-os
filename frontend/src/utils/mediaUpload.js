export function createInitialUploadState() {
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

export function isTemporaryPreviewUrl(value) {
  const raw = String(value || '').trim().toLowerCase()
  return raw.startsWith('blob:') || raw.startsWith('data:')
}

export function sanitizePersistedMediaPath(value, fallback = '') {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (isTemporaryPreviewUrl(raw)) return String(fallback || '').trim()
  return raw
}

export function buildCacheBustedMediaPath(path, version) {
  const rawPath = String(path || '').trim()
  const rawVersion = String(version || '').trim()
  if (!rawPath || !rawVersion) return rawPath
  return `${rawPath}${rawPath.includes('?') ? '&' : '?'}v=${encodeURIComponent(rawVersion)}`
}

export function reduceUploadState(state = {}, action = {}) {
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
