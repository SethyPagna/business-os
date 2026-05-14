export function parsePermissionMap(value) {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      return JSON.parse(value || '{}') || {}
    } catch (_) {
      return {}
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value
  }
  return {}
}
