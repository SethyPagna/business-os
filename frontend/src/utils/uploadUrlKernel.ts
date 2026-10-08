const ASSET_BASE_KEY = 'businessos_public_asset_base_url'
let currentBase = ''
let baseAuthority = ''

export function currentUploadAuthority(): string {
  try {
    const api = (window as Window & { api?: { getSyncServerUrl?: () => unknown } }).api
    return String(api?.getSyncServerUrl?.() || window.location.origin || '').trim().replace(/\/$/, '')
  } catch { return '' }
}

export function setCurrentAssetBase(value: unknown, authority = currentUploadAuthority()): string {
  const clean = String(value || '').trim().replace(/\/$/, '')
  currentBase = clean
  baseAuthority = authority
  try {
    if (clean) localStorage.setItem(ASSET_BASE_KEY, clean)
    else localStorage.removeItem(ASSET_BASE_KEY)
  } catch {}
  return clean
}

export function getCurrentAssetBase(authority = currentUploadAuthority()): string {
  return authority && authority === baseAuthority ? currentBase : ''
}

export function replaceAssetBaseFromBootstrap(payload: unknown): void {
  if (!payload || typeof payload !== 'object') return
  const value = payload as { offline?: unknown; unauthorized?: unknown; system?: { publicAssetBaseUrl?: unknown } | null }
  if (value.offline || value.unauthorized || !value.system || typeof value.system !== 'object') return
  setCurrentAssetBase(value.system.publicAssetBaseUrl)
}

export function splitLocalUploadPath(value: unknown): { path: string; suffix: string } | null {
  const raw = String(value || '').trim()
  if (!/^\/?uploads\//.test(raw)) return null
  const normalized = `/${raw.replace(/^\//, '')}`
  const queryAt = normalized.indexOf('?')
  return queryAt < 0 ? { path: normalized, suffix: '' } : {
    path: normalized.slice(0, queryAt), suffix: normalized.slice(queryAt),
  }
}

export function encodeLocalUploadPath(value: unknown): string | null {
  const local = splitLocalUploadPath(value)
  return local ? local.path.split('/').map(segment => encodeURIComponent(segment)).join('/') + local.suffix : null
}
