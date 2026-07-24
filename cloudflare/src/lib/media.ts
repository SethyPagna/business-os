// Ported from backend/src/settingsSnapshot.ts's normalizeUploadPublicPath /
// sanitizeMediaPath / sanitizeMediaList.
//
// The original's sanitizeMediaPath has a branch that checks
// uploadPublicPathExists() when object storage is disabled (the Docker
// path's local-disk fallback mode) -- that branch does not apply here.
// R2 is the only storage backend a Worker can have; there is no local disk
// to fall back to, so that check is correctly omitted rather than missed.

function normalizeUploadPublicPath(value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.startsWith('/uploads/')) {
    const [cleanPath] = raw.split(/[?#]/)
    return cleanPath || raw
  }
  if (raw.startsWith('uploads/')) {
    const [cleanPath] = raw.split(/[?#]/)
    return cleanPath ? `/${cleanPath}` : `/${raw}`
  }
  return raw
}

export function sanitizeMediaPath(value: unknown, emptyValue = ''): string {
  const normalized = normalizeUploadPublicPath(value)
  return normalized || emptyValue
}

export function sanitizeMediaList(values: unknown): string[] {
  const items = Array.isArray(values) ? values : []
  const seen = new Set<string>()
  const sanitized: string[] = []
  for (const value of items) {
    const nextValue = sanitizeMediaPath(value, '')
    if (!nextValue || seen.has(nextValue)) continue
    seen.add(nextValue)
    sanitized.push(nextValue)
  }
  return sanitized
}
