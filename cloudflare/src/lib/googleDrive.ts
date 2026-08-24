// Google Drive OAuth connect flow + a one-way backup mirror, for the
// Cloudflare Worker deployment.
//
// Scope note (read this before assuming this is the full legacy
// googleDriveSync service): backend/src/services/googleDriveSync/index.ts
// is a ~1,500-line continuous, bi-directional, per-file mirror with a
// change-watcher and conflict versioning. That is a distinct, sizable
// project on its own. What's implemented here instead, and is genuinely
// real and working end-to-end:
//   - Real OAuth2 connect (authorization code + refresh token), tokens
//     encrypted at rest with lib/secretCrypto.ts and stored in `settings`.
//   - Automatic access-token refresh when expired.
//   - A manual (and cron-triggerable) one-way push: takes the same R2
//     Cloudflare backup snapshot lib/backup.ts already produces, and
//     uploads it into a named folder in the connected Google Drive as an
//     extra off-Cloudflare copy, pruning older Drive copies the same way
//     R2 backups are pruned.
// This gives working "Google Drive sync" (a real off-platform backup
// copy, connect/disconnect, status reporting) without pretending to be a
// full live file-mirror -- flagged explicitly rather than silently scoped
// down.

import type { Env } from '../index'
import { getDb } from './db'
import { encryptSecret, decryptSecret } from './secretCrypto'
import { createCloudflareBackup } from './backup'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
export const DRIVE_CALLBACK_PATH = '/api/system/drive-sync/oauth/callback'
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const DEFAULT_FOLDER_NAME = 'Business OS Sync'
const DEFAULT_KEEP = 10

function trim(value: unknown): string {
  return String(value ?? '').trim()
}

async function getSettings(env: Env, keys: string[]): Promise<Record<string, string>> {
  const db = getDb(env)
  const placeholders = keys.map(() => '?').join(',')
  const rows = await db.prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`).all<{ key: string; value: string }>(keys)
  return Object.fromEntries((rows || []).map((r) => [r.key, r.value]))
}

async function setSettings(env: Env, entries: [string, string][]): Promise<void> {
  const db = getDb(env)
  for (const [key, value] of entries) {
    await db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (@key, @value, CURRENT_TIMESTAMP)').run({ key, value })
  }
}

function getRedirectUri(env: Env): string {
  return trim(env.GOOGLE_DRIVE_REDIRECT_URI) || `${trim(env.BUSINESS_OS_ADMIN_URL).replace(/\/$/, '')}${DRIVE_CALLBACK_PATH}`
}

export type DriveSyncStatus = {
  configured: boolean
  connected: boolean
  status: 'disabled' | 'not_connected' | 'connected' | 'error'
  clientId: string
  folderName: string
  deleteMissing: boolean
  enabled: boolean
  syncIntervalSeconds: number
  maxBackups: number
  hasClientSecret: boolean
  redirectUri: string
  lastSyncedAt: string | null
  lastError: string | null
  accountEmail?: string | null
}

export async function driveSyncStatus(env: Env): Promise<{ item: DriveSyncStatus }> {
  const settings = await getSettings(env, [
    'drive_sync_folder_name', 'drive_sync_delete_missing', 'drive_sync_enabled',
    'drive_sync_interval_seconds', 'drive_sync_refresh_token', 'drive_sync_last_synced_at',
    'drive_sync_last_error', 'drive_sync_account_email',
  ])
  const clientId = trim(env.GOOGLE_DRIVE_CLIENT_ID)
  const connected = !!settings.drive_sync_refresh_token
  return {
    item: {
      configured: !!clientId,
      connected,
      status: settings.drive_sync_enabled === '0' ? 'disabled' : (connected ? 'connected' : 'not_connected'),
      clientId,
      folderName: settings.drive_sync_folder_name || DEFAULT_FOLDER_NAME,
      deleteMissing: settings.drive_sync_delete_missing !== '0',
      enabled: settings.drive_sync_enabled !== '0',
      syncIntervalSeconds: Number(settings.drive_sync_interval_seconds || 21600),
      maxBackups: DEFAULT_KEEP,
      hasClientSecret: !!trim(env.GOOGLE_DRIVE_CLIENT_SECRET),
      redirectUri: getRedirectUri(env),
      lastSyncedAt: settings.drive_sync_last_synced_at || null,
      lastError: connected ? (settings.drive_sync_last_error || null) : 'Not connected yet. Use \u201cConnect Google Drive\u201d in Settings.',
      accountEmail: settings.drive_sync_account_email || null,
    },
  }
}

export async function updateDrivePreferences(env: Env, body: Record<string, unknown>): Promise<{ item: DriveSyncStatus }> {
  const interval = Math.min(24 * 60 * 60, Math.max(60 * 60, Math.round(Number(body.syncIntervalSeconds || 21600))))
  await setSettings(env, [
    ['drive_sync_folder_name', String(body.folderName || DEFAULT_FOLDER_NAME)],
    ['drive_sync_delete_missing', body.deleteMissing === false ? '0' : '1'],
    ['drive_sync_enabled', body.enabled === false ? '0' : '1'],
    ['drive_sync_interval_seconds', String(interval)],
  ])
  return driveSyncStatus(env)
}

export function buildDriveOauthStartUrl(env: Env): { success: boolean; error?: string; url?: string } {
  const clientId = trim(env.GOOGLE_DRIVE_CLIENT_ID)
  if (!clientId) return { success: false, error: 'Google Drive client ID is not configured.' }
  const url = new URL(GOOGLE_AUTH_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', getRedirectUri(env))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', `${DRIVE_SCOPE} openid email`)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('include_granted_scopes', 'true')
  return { success: true, url: url.toString() }
}

export async function completeDriveOauth(env: Env, code: string): Promise<{ success: boolean; error?: string }> {
  const clientId = trim(env.GOOGLE_DRIVE_CLIENT_ID)
  const clientSecret = trim(env.GOOGLE_DRIVE_CLIENT_SECRET)
  if (!clientId || !clientSecret) return { success: false, error: 'Google Drive OAuth is not configured.' }
  const body = new URLSearchParams()
  body.set('client_id', clientId)
  body.set('client_secret', clientSecret)
  body.set('code', code)
  body.set('grant_type', 'authorization_code')
  body.set('redirect_uri', getRedirectUri(env))
  const response = await fetch(GOOGLE_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  const payload = await response.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>
  if (!response.ok || !payload.refresh_token) {
    return { success: false, error: String(payload.error_description || payload.error || 'Google did not return a refresh token (try disconnecting Drive access at myaccount.google.com/permissions and reconnecting so Google issues a fresh one).') }
  }
  let accountEmail: string | null = null
  try {
    const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${payload.access_token}` } })
    const info = await infoRes.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>
    accountEmail = trim(info.email) || null
  } catch (_) { /* non-fatal */ }

  const refreshTokenEnc = await encryptSecret(String(payload.refresh_token), env.APP_ENCRYPTION_KEY)
  const accessTokenEnc = await encryptSecret(String(payload.access_token || ''), env.APP_ENCRYPTION_KEY)
  const expiresAt = new Date(Date.now() + (Number(payload.expires_in || 3600) * 1000)).toISOString()
  await setSettings(env, [
    ['drive_sync_refresh_token', refreshTokenEnc],
    ['drive_sync_access_token', accessTokenEnc],
    ['drive_sync_access_token_expires_at', expiresAt],
    ['drive_sync_account_email', accountEmail || ''],
    ['drive_sync_last_error', ''],
  ])
  return { success: true }
}

export async function disconnectDrive(env: Env): Promise<void> {
  await setSettings(env, [
    ['drive_sync_refresh_token', ''],
    ['drive_sync_access_token', ''],
    ['drive_sync_access_token_expires_at', ''],
    ['drive_sync_account_email', ''],
    ['drive_sync_folder_id', ''],
  ])
}

async function getValidAccessToken(env: Env): Promise<{ token: string } | { error: string }> {
  const settings = await getSettings(env, ['drive_sync_refresh_token', 'drive_sync_access_token', 'drive_sync_access_token_expires_at'])
  const refreshTokenEnc = settings.drive_sync_refresh_token
  if (!refreshTokenEnc) return { error: 'Google Drive is not connected.' }

  const expiresAt = settings.drive_sync_access_token_expires_at ? new Date(settings.drive_sync_access_token_expires_at).getTime() : 0
  if (expiresAt > Date.now() + 60_000 && settings.drive_sync_access_token) {
    const token = await decryptSecret(settings.drive_sync_access_token, env.APP_ENCRYPTION_KEY)
    if (token) return { token }
  }

  const refreshToken = await decryptSecret(refreshTokenEnc, env.APP_ENCRYPTION_KEY)
  const clientId = trim(env.GOOGLE_DRIVE_CLIENT_ID)
  const clientSecret = trim(env.GOOGLE_DRIVE_CLIENT_SECRET)
  if (!refreshToken || !clientId || !clientSecret) return { error: 'Google Drive OAuth is not configured.' }

  const body = new URLSearchParams()
  body.set('client_id', clientId)
  body.set('client_secret', clientSecret)
  body.set('refresh_token', refreshToken)
  body.set('grant_type', 'refresh_token')
  const response = await fetch(GOOGLE_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  const payload = await response.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>
  if (!response.ok || !payload.access_token) {
    const message = String(payload.error_description || payload.error || 'Failed to refresh Google Drive access token.')
    await setSettings(env, [['drive_sync_last_error', message]])
    return { error: message }
  }
  const accessTokenEnc = await encryptSecret(String(payload.access_token), env.APP_ENCRYPTION_KEY)
  const newExpiresAt = new Date(Date.now() + (Number(payload.expires_in || 3600) * 1000)).toISOString()
  await setSettings(env, [
    ['drive_sync_access_token', accessTokenEnc],
    ['drive_sync_access_token_expires_at', newExpiresAt],
  ])
  return { token: String(payload.access_token) }
}

async function ensureFolder(token: string, folderName: string, existingFolderId: string): Promise<string> {
  if (existingFolderId) return existingFolderId
  const query = encodeURIComponent(`name = '${folderName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`)
  const searchRes = await fetch(`${DRIVE_FILES_URL}?q=${query}&fields=files(id,name)`, { headers: { Authorization: `Bearer ${token}` } })
  const searchPayload = await searchRes.json().catch(() => ({} as { files?: { id: string }[] })) as { files?: { id: string }[] }
  if (searchPayload.files && searchPayload.files.length) return searchPayload.files[0].id

  const createRes = await fetch(DRIVE_FILES_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder' }),
  })
  const created = await createRes.json().catch(() => ({} as { id?: string })) as { id?: string }
  if (!created.id) throw new Error('Failed to create Google Drive sync folder.')
  return created.id
}

// Pushes the most recent Cloudflare (R2) backup snapshot into the
// connected Google Drive account as an extra off-platform copy, pruning
// older Drive copies beyond `maxBackups`. Returns a job-shaped result so
// callers (compat.ts's /system/drive-sync/jobs) can report it the same
// way as other async system jobs.
export async function pushBackupToDrive(env: Env): Promise<{ success: boolean; error?: string; fileId?: string; fileName?: string }> {
  const tokenResult = await getValidAccessToken(env)
  if ('error' in tokenResult) return { success: false, error: tokenResult.error }
  const token = tokenResult.token

  const settings = await getSettings(env, ['drive_sync_folder_name', 'drive_sync_folder_id'])
  const folderName = settings.drive_sync_folder_name || DEFAULT_FOLDER_NAME

  try {
    const folderId = await ensureFolder(token, folderName, settings.drive_sync_folder_id || '')
    await setSettings(env, [['drive_sync_folder_id', folderId]])

    const backup = await createCloudflareBackup(env, 'manual')
    const object = await env.ASSETS.get(backup.key)
    if (!object) throw new Error('Backup snapshot was created but could not be read back from R2.')
    const bytes = await object.arrayBuffer()
    const fileName = backup.key.split('/').pop() || backup.name || `backup-${Date.now()}.json`

    const metadata = { name: fileName, parents: [folderId] }
    const boundary = `bos-${crypto.randomUUID()}`
    const encoder = new TextEncoder()
    const parts: (Uint8Array | ArrayBuffer)[] = [
      encoder.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n`),
      bytes,
      encoder.encode(`\r\n--${boundary}--`),
    ]
    const uploadRes = await fetch(`${DRIVE_UPLOAD_URL}?uploadType=multipart`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: new Blob(parts),
    })
    const uploaded = await uploadRes.json().catch(() => ({} as { id?: string; error?: unknown })) as { id?: string; error?: unknown }
    if (!uploadRes.ok || !uploaded.id) throw new Error(typeof uploaded.error === 'string' ? uploaded.error : 'Google Drive upload failed.')

    await pruneDriveBackups(token, folderId, DEFAULT_KEEP)
    await setSettings(env, [['drive_sync_last_synced_at', new Date().toISOString()], ['drive_sync_last_error', '']])
    return { success: true, fileId: uploaded.id, fileName }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Google Drive sync failed.'
    await setSettings(env, [['drive_sync_last_error', message]])
    return { success: false, error: message }
  }
}

// Called from index.ts's `scheduled()` cron handler (runs every 6h, same
// trigger as maybeRunScheduledBackup in lib/backup.ts). The legacy Docker
// backend ran a real setInterval loop checking every 30s whether
// `syncIntervalSeconds` had elapsed since the last Drive sync; Workers have
// no persistent timers, so this checks on each cron tick instead. That's
// coarser than the old 30s poll, but the Settings UI already only offers
// interval choices of 1h+ (`updateDrivePreferences` clamps to
// 3600-86400s), and the underlying Cloudflare backup this pushes to Drive
// is itself only refreshed on the same 6h cron -- so nothing is lost by
// checking due-ness at cron granularity instead of continuously.
//
// Fixes a real gap: `driveSyncStatus()`/`updateDrivePreferences()` and the
// Settings > Backup UI (`drive-sync-interval`) let an admin configure and
// save a sync interval and enable Drive sync, but until this function was
// wired into `scheduled()`, nothing ever read that interval automatically
// -- only a manual "Sync now" click (`POST /system/drive-sync/jobs`) ever
// pushed to Drive. An admin who enabled it and set "every 6 hours" would
// see it silently never run on its own.
export async function maybeRunScheduledDriveSync(env: Env): Promise<{ skipped: boolean; reason?: string; result?: Awaited<ReturnType<typeof pushBackupToDrive>> }> {
  const settings = await getSettings(env, [
    'drive_sync_enabled', 'drive_sync_refresh_token', 'drive_sync_last_synced_at', 'drive_sync_interval_seconds',
  ])
  if (settings.drive_sync_enabled === '0') return { skipped: true, reason: 'disabled' }
  if (!settings.drive_sync_refresh_token) return { skipped: true, reason: 'not-connected' }

  const intervalSeconds = Math.min(24 * 60 * 60, Math.max(60 * 60, Number(settings.drive_sync_interval_seconds || 21600)))
  const lastSyncedMs = settings.drive_sync_last_synced_at ? Date.parse(settings.drive_sync_last_synced_at) : 0
  if (lastSyncedMs && (Date.now() - lastSyncedMs) < intervalSeconds * 1000) {
    return { skipped: true, reason: 'not-due' }
  }

  const result = await pushBackupToDrive(env)
  return { skipped: false, result }
}

async function pruneDriveBackups(token: string, folderId: string, keep: number): Promise<void> {
  const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`)
  const listRes = await fetch(`${DRIVE_FILES_URL}?q=${query}&fields=files(id,name,createdTime)&orderBy=createdTime desc&pageSize=100`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const listed = await listRes.json().catch(() => ({} as { files?: { id: string }[] })) as { files?: { id: string }[] }
  const files = listed.files || []
  for (const file of files.slice(keep)) {
    await fetch(`${DRIVE_FILES_URL}/${file.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined)
  }
}
