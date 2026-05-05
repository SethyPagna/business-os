function normalizeObject(value) {
  return value && typeof value === 'object' ? value : {}
}

export function buildSettingsConflictState({
  attempted = {},
  currentSettings = {},
  actualUpdatedAt = null,
  expectedUpdatedAt = null,
} = {}) {
  return {
    localDraft: { ...normalizeObject(attempted) },
    serverSettings: { ...normalizeObject(currentSettings) },
    serverUpdatedAt: actualUpdatedAt || null,
    expectedUpdatedAt: expectedUpdatedAt || null,
  }
}

export function diffSettingsConflictFields({
  localDraft = {},
  serverSettings = {},
} = {}) {
  const keys = new Set([
    ...Object.keys(normalizeObject(localDraft)),
    ...Object.keys(normalizeObject(serverSettings)),
  ])
  return Array.from(keys)
    .map((key) => ({
      key,
      localValue: normalizeObject(localDraft)[key],
      serverValue: normalizeObject(serverSettings)[key],
    }))
    .filter((row) => JSON.stringify(row.localValue) !== JSON.stringify(row.serverValue))
}
