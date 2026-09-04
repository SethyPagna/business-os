import { refreshAppData } from '../utils/appRefresh.ts'
import { getSettingsRefreshChannels } from '../utils/settingsRefresh.ts'
import { buildAttemptedSettings } from './conflicts.ts'
import { withSettingsExpectedUpdatedAt, type ExpectedUpdatedAtPayload } from './expectedUpdatedAt.ts'
import { apiFetch, cacheInvalidate, isWriteConflictError, route } from './http.ts'
import { localGetSettings, localSaveSettings, localSaveSettingsMeta } from './localDb.ts'
import { routeMirrored } from './localMirrors.ts'

type SettingsPayload = Record<string, unknown>
type SettingsOptions = {
  // Caller-supplied snapshot of what the server was known to hold for these
  // fields immediately before the person started editing (see savePortalDraft
  // in CatalogPage.tsx for the real caller). Optional -- callers that don't
  // have a meaningful baseline (most small single-toggle saves) simply omit
  // it and get the old <=2-keys-only auto-retry behavior unchanged.
  baselineSettings?: SettingsPayload
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

// Real, confirmed bug (traced from a live report of "Portal settings
// changed on another device" firing on nearly every portal-editor save):
// the old `withSettingsExpectedUpdatedAt` (expectedUpdatedAt.ts) read a
// single cached GLOBAL updated_at (the newest of every row in the settings
// table), while the backend's own conflict check scopes its comparison to
// only the keys actually being written in this save. Any unrelated
// settings save anywhere in the app -- switching theme, editing receipt
// settings -- bumps that global cached value, so a save that touches
// specific keys (the portal editor writes ~60 customer_portal_* keys at
// once) almost always carried a stale, too-new "expected" value relative
// to what those specific keys were actually last set to -- a near-
// guaranteed false conflict, not an occasional real one. Fixed by asking
// the server what the real current version of THESE keys is, right before
// sending them, via GET /api/settings/meta?keys=... (added alongside this
// fix) -- matching the exact scoping POST / already uses server-side, so
// the comparison is finally apples-to-apples. Falls back to the old
// (unscoped, best-effort) behavior if this request fails for any reason
// (e.g. offline) rather than blocking the save entirely.
async function getScopedExpectedUpdatedAt(keys: string[]): Promise<unknown> {
  if (!keys.length) return null
  try {
    const query = keys.map((key) => encodeURIComponent(key)).join(',')
    const meta = asSettingsPayload(await apiFetch('GET', `/api/settings/meta?keys=${query}`))
    return meta.updatedAt || null
  } catch (_) {
    return null
  }
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

// A previous session (Part 101) deliberately declined to widen the small-
// save-only auto-retry to a bulk save like the portal editor's: that retry
// blindly resubmits every `attemptedSettings` value against a fresh
// `actualUpdatedAt` with no check against what the OTHER device actually
// changed, which for a 1-2-key toggle is a low-odds, low-cost trade but for
// a ~60-key save would mean a real, unrelated edit from someone else could
// get silently overwritten -- a "shortcut on writes" this project's own
// Engineering Standards rule out (see progress.md). This helper is what
// makes widening it safe instead of just wider: it only clears a key for
// auto-retry when the server's post-conflict value for that key
// (`currentSettings[key]`, always returned on a settings conflict) is
// unchanged from what the editor started from (`baselineSettings[key]`,
// the pre-edit snapshot the caller captured before the person touched
// anything). If a key's baseline and current server value differ, someone
// else genuinely changed THAT field since the person started editing, and
// this helper reports it as unsafe so the caller still gets the honest
// "someone else changed this" error instead of a silent overwrite.
function attemptedKeysAreSafeToAutoRetry(
  attemptedKeys: string[],
  currentSettings: SettingsPayload | undefined,
  baselineSettings: SettingsPayload | undefined,
): boolean {
  if (!currentSettings || !baselineSettings) return false
  return attemptedKeys.every((key) => {
    if (!Object.prototype.hasOwnProperty.call(baselineSettings, key)) return false
    if (!Object.prototype.hasOwnProperty.call(currentSettings, key)) return false
    return String(currentSettings[key] ?? '') === String(baselineSettings[key] ?? '')
  })
}

async function saveSettingsOnce(updates: SettingsPayload, options: SettingsOptions = {}): Promise<unknown> {
  const attempted = buildAttemptedSettings(updates)
  const refreshChannels = getSettingsRefreshChannels(attempted, options.refreshChannels)
  const refreshDetail = {
    reason: String(options.reason || 'settings-saved').trim() || 'settings-saved',
    source: String(options.source || 'settings:save').trim() || 'settings:save',
  }
  let payload: ExpectedUpdatedAtPayload = options.skipExpectedUpdatedAt
    ? { ...updates }
    : await withSettingsExpectedUpdatedAt(updates)
  if (!options.skipExpectedUpdatedAt) {
    const scopedUpdatedAt = await getScopedExpectedUpdatedAt(Object.keys(updates))
    if (scopedUpdatedAt) payload = { ...payload, expectedUpdatedAt: scopedUpdatedAt }
  }
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
    // Small saves (<=2 keys, e.g. a single toggle) keep the original
    // unconditional retry -- unchanged behavior, already covered by
    // existing tests. Bulk saves (the portal editor's ~60-key payload)
    // only get the same self-heal when `attemptedKeysAreSafeToAutoRetry`
    // confirms none of the touched keys actually diverged from what the
    // caller's baseline expected -- see that function's comment above.
    const canAutoRetry = attemptedKeys.length > 0 && (
      attemptedKeys.length <= 2
      || attemptedKeysAreSafeToAutoRetry(attemptedKeys, error.currentSettings, options.baselineSettings)
    )
    if (isWriteConflictError(error) && error.actualUpdatedAt && canAutoRetry) {
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
          // Re-check safety against the NEW conflict's currentSettings before
          // looping again -- a key that was safe against the first conflict
          // could still have been changed again by the time this retry lands.
          if (attemptedKeys.length > 2 && !attemptedKeysAreSafeToAutoRetry(attemptedKeys, error.currentSettings, options.baselineSettings)) break
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

export function getPaymentMethodImpact(from: string, to: string): Promise<unknown> {
  const query = new URLSearchParams({ from, to })
  return apiFetch('GET', `/api/settings/payment-methods/impact?${query.toString()}`)
}

export function replacePaymentMethod(payload: { from: string; to: string; scope: 'settings_only' | 'linked' }): Promise<unknown> {
  return apiFetch('POST', '/api/settings/payment-methods/replace', payload)
}

/**
 * Methods money has actually come in through that nobody ever added to the
 * configured list.
 *
 * The POS method field is a free-text datalist, so a cashier can type "ACLEDA"
 * at the till, the sale records it, and Settings never hears about it. That is
 * the gap the owner hit: the list of choices was shorter than the list of
 * things the shop is paid with, so the next cashier typed it again by hand,
 * slightly differently, and the day's report grew two columns for one method.
 *
 * Read-only -- it reports, it does not write. The write is the explicit
 * `backfillPaymentMethods` below, so nothing lands in the checkout list
 * without someone deciding it should.
 */
export function getUnregisteredPaymentMethods(): Promise<unknown> {
  return apiFetch('GET', '/api/settings/payment-methods/unregistered')
}

/** Append every method already used on a sale to the configured list. */
export function backfillPaymentMethods(): Promise<unknown> {
  return apiFetch('POST', '/api/settings/payment-methods/backfill', {})
}
