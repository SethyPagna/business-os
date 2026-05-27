type PermissionMap = Record<string, unknown>

function isPermissionMap(value: unknown): value is PermissionMap {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function parsePermissionMap(value: unknown): PermissionMap {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value || '{}')
      return isPermissionMap(parsed) ? parsed : {}
    } catch (_) {
      return {}
    }
  }
  if (isPermissionMap(value)) {
    return value
  }
  return {}
}
