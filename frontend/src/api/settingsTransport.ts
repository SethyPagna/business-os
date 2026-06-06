import { refreshAppData } from '../utils/appRefresh.ts'
import { getSettingsRefreshChannels } from '../utils/settingsRefresh.ts'
import { buildAttemptedSettings } from './conflicts.ts'
import { withSettingsExpectedUpdatedAt, type ExpectedUpdatedAtPayload } from './expectedUpdatedAt.ts'
import { apiFetch, cacheInvalidate, isWriteConflictError, route } from './http.ts'
import { localGetSettings, localSaveSettings, localSaveSettingsMeta } from './localDb.ts'
import { routeMirrored } from './localMirrors.ts'

type SettingsPayload = Record<string, unknown>
type SettingsOptions = {
  force?: boolean
  refreshChannels?: unknown[]
  reason?: string
  source?: string
  skipExpectedUpdatedAt?: boolean
}
type SettingsConflictError = Error & {
  actualUpdatedAt?: unknown
  attempted?: SettingsPayload
  code?: string
  conflict?: boolean
  currentSettings?: SettingsPayload
}

let settingsSaveQueue: Promise<unknown> = Promise.resolve()

function asSettingsPayload(value: unknown): SettingsPayload {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as SettingsPayload : {}
}

function asSettingsConflictError(error: unknown): SettingsConflictError {
  return (error && typeof error === 'object' ? error : new Error(String(error || 'Settings request failed'))) as SettingsConflictError
}

async function saveSettingsLocally(updates: SettingsPayload): Promise<void> {
  await localSaveSettings(updates).catch(() => {})
}

async function saveSettingsMeta(updatedAt: unknown): Promise<void> {
  if (updatedAt) await localSaveSettingsMeta(updatedAt).catch(() => {})
}

async function getServerSettings(): Promise<SettingsPayload> {
  const settingsResponse = asSettingsPayload(await apiFetch('GET', '/api/settings'))
  const { updatedAt: inlineUpdatedAt, ...settings } = settingsResponse
  await saveSettingsMeta(inlineUpdatedAt)
  return settings
}

export async function getSettings(options: SettingsOptions = {}): Promise<SettingsPayload> {
  if (options.force) cacheInvalidate('settings')
  const settings = await routeMirrored(
    'settings:get',
    getServerSettings,
    localGetSettings,
    async (settings) => {
      await saveSettingsLocally(settings)
      return settings
    },
  )
  return asSettingsPayload(settings)
}

async function saveSettingsOnce(updates: SettingsPayload, options: SettingsOptions = {}): Promise<unknown> {
  const attempted = buildAttemptedSettings(updates)
  const refreshChannels = getSettingsRefreshChannels(attempted, options.refreshChannels)
  const refreshDetail = {
    reason: String(options.reason || 'settings-saved').trim() || 'settings-saved',
    source: String(options.source || 'settings:save').trim() || 'settings:save',
  }
  const payload: ExpectedUpdatedAtPayload = options.skipExpectedUpdatedAt
    ? { ...updates }
    : await withSettingsExpectedUpdatedAt(updates)
  try {
    const result = asSettingsPayload(await route('settings:save', () => apiFetch('POST', '/api/settings', payload), null, true))
    await saveSettingsMeta(result.updatedAt)
    await saveSettingsLocally(updates)
    refreshAppData(refreshChannels, refreshDetail)
    return result
  } catch (rawError) {
    let error = asSettingsConflictError(rawError)
    const attemptedSettings = asSettingsPayload(error.attempted || attempted)
    const attemptedKeys = Object.keys(attemptedSettings)
    if (
      isWriteConflictError(error)
      && error.actualUpdatedAt
      && attemptedKeys.length > 0
      && attemptedKeys.length <= 2
    ) {
      let nextExpectedUpdatedAt = error.actualUpdatedAt
      for (let retryAttempt = 0; retryAttempt < 3 && nextExpectedUpdatedAt; retryAttempt += 1) {
        const retryPayload = { ...attemptedSettings, expectedUpdatedAt: nextExpectedUpdatedAt }
        try {
          const retryResult = asSettingsPayload(await route('settings:save', () => apiFetch('POST', '/api/settings', retryPayload), null, true))
          await saveSettingsMeta(retryResult.updatedAt)
          await saveSettingsLocally(attemptedSettings)
          refreshAppData(refreshChannels, refreshDetail)
          return retryResult
        } catch (retryError) {
          error = asSettingsConflictError(retryError)
          if (!isWriteConflictError(error) || !error.actualUpdatedAt) break
          nextExpectedUpdatedAt = error.actualUpdatedAt
        }
      }
    }
    error.attempted = error.attempted || attemptedSettings
    await saveSettingsMeta(error.actualUpdatedAt)
    if (error.currentSettings) await saveSettingsLocally(error.currentSettings)
    throw error
  }
}

export function saveSettings(updates: SettingsPayload = {}, options: SettingsOptions = {}): Promise<unknown> {
  const queuedSave = settingsSaveQueue.catch(() => {}).then(() => saveSettingsOnce(updates, options))
  settingsSaveQueue = queuedSave.catch(() => {})
  return queuedSave
}
