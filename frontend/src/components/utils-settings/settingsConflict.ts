type SettingsMap = Record<string, unknown>

type SettingsConflictStateInput = {
  attempted?: unknown
  currentSettings?: unknown
  actualUpdatedAt?: unknown
  expectedUpdatedAt?: unknown
}

type SettingsConflictDiffInput = {
  localDraft?: unknown
  serverSettings?: unknown
}

export type SettingsConflictState = {
  localDraft: SettingsMap
  serverSettings: SettingsMap
  serverUpdatedAt: unknown
  expectedUpdatedAt: unknown
}

export type SettingsConflictFieldDiff = {
  key: string
  localValue: unknown
  serverValue: unknown
}

function normalizeObject(value: unknown): SettingsMap {
  return value && typeof value === 'object' ? value as SettingsMap : {}
}

export function buildSettingsConflictState({
  attempted = {},
  currentSettings = {},
  actualUpdatedAt = null,
  expectedUpdatedAt = null,
}: SettingsConflictStateInput = {}): SettingsConflictState {
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
}: SettingsConflictDiffInput = {}): SettingsConflictFieldDiff[] {
  const normalizedLocalDraft = normalizeObject(localDraft)
  const normalizedServerSettings = normalizeObject(serverSettings)
  const keys = new Set([
    ...Object.keys(normalizedLocalDraft),
    ...Object.keys(normalizedServerSettings),
  ])
  return Array.from(keys)
    .map((key) => ({
      key,
      localValue: normalizedLocalDraft[key],
      serverValue: normalizedServerSettings[key],
    }))
    .filter((row) => JSON.stringify(row.localValue) !== JSON.stringify(row.serverValue))
}
