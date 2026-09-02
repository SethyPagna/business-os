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
import {
  DRIVE_STAGED_BACKUP_PREFIX,
  inspectCloudflareBackupStream,
  listCloudflareBackups,
  validateCloudflareBackup,
} from './backup'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
export const DRIVE_CALLBACK_PATH = '/api/system/drive-sync/oauth/callback'
export const DRIVE_OAUTH_STATE_TTL_SECONDS = 10 * 60
const DRIVE_OAUTH_MAX_FUTURE_SKEW_MS = 60 * 1000
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const DEFAULT_FOLDER_NAME = 'Business OS Sync'
// 10, not 7, since Part 386 -- the user's standing spec is "2 in R2 and
// 10 in Google Drive".
export const DRIVE_BACKUP_KEEP = 10
export const DRIVE_STAGED_BACKUP_KEEP = 2
// R2's current single-PUT ceiling is 5 GiB minus 5 MiB. Drive staging uses
// one streamed binding PUT, so reject metadata outside that bound before
// opening a remote body.
export const DRIVE_STAGED_BACKUP_MAX_BYTES = (5 * 1024 * 1024 * 1024) - (5 * 1024 * 1024)

function trim(value: unknown): string {
  return String(value ?? '').trim()
}

export type DriveOauthStatePayload = {
  provider: 'google-drive'
  nonce: string
  codeVerifier: string
  createdAt: number
  userId: number
  returnOrigin: string
  returnPath: string
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecodeToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(value.length + ((4 - (value.length % 4)) % 4), '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function randomBase64Url(byteLength: number): string {
  return base64UrlEncodeBytes(crypto.getRandomValues(new Uint8Array(byteLength)))
}

async function sha256Base64Url(value: string): Promise<string> {
  return base64UrlEncodeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
}

async function hmacSignBase64Url(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return base64UrlEncodeBytes(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))))
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let diff = 0
  for (let index = 0; index < left.length; index++) diff |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return diff === 0
}

function driveOauthStateKey(nonce: string): string {
  return `oauth-state:google-drive:${nonce}`
}

function driveOauthStateSecret(env: Env): string {
  return trim(env.AUTH_SESSION_SECRET || env.GOOGLE_DRIVE_CLIENT_SECRET)
}

function normalizeDriveReturnTarget(env: Env, returnOrigin: unknown, returnPath: unknown): { origin: string; path: string; url: string } {
  const admin = new URL(trim(env.BUSINESS_OS_ADMIN_URL))
  const origin = trim(returnOrigin)
  const path = trim(returnPath)
  const safePath = path.startsWith('/') && !path.startsWith('//') ? path : '/?settings=integrations'
  const selectedOrigin = origin === admin.origin ? origin : admin.origin
  return { origin: selectedOrigin, path: safePath, url: `${selectedOrigin}${safePath}` }
}

async function signDriveOauthState(env: Env, payload: DriveOauthStatePayload): Promise<{ state?: string; error?: string }> {
  const secret = driveOauthStateSecret(env)
  if (!secret) return { error: 'Google Drive OAuth state signing is not configured.' }
  const encoded = base64UrlEncodeBytes(new TextEncoder().encode(JSON.stringify(payload)))
  return { state: `${encoded}.${await hmacSignBase64Url(secret, encoded)}` }
}

export async function consumeDriveOauthState(env: Env, state: string | undefined): Promise<{ success: boolean; payload?: DriveOauthStatePayload; error?: string }> {
  const [encoded, signature] = trim(state).split('.')
  const secret = driveOauthStateSecret(env)
  if (!encoded || !signature || !secret) return { success: false, error: 'Invalid Google Drive OAuth state.' }
  const expected = await hmacSignBase64Url(secret, encoded)
  if (!timingSafeEqual(signature, expected)) return { success: false, error: 'Google Drive OAuth state failed verification.' }
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecodeToBytes(encoded))) as DriveOauthStatePayload
    const ageMs = Date.now() - Number(payload.createdAt || 0)
    if (payload.provider !== 'google-drive' || !trim(payload.nonce) || !trim(payload.codeVerifier) || !Number(payload.userId)) {
      return { success: false, error: 'Invalid Google Drive OAuth state.' }
    }
    if (ageMs < -DRIVE_OAUTH_MAX_FUTURE_SKEW_MS || ageMs > DRIVE_OAUTH_STATE_TTL_SECONDS * 1000) {
      return { success: false, error: 'Google Drive OAuth state expired. Please connect again.' }
    }
    const remembered = await env.CACHE.get(driveOauthStateKey(payload.nonce))
    if (!remembered || !timingSafeEqual(remembered, signature)) {
      return { success: false, error: 'Google Drive OAuth state was already used or is no longer valid.' }
    }
    await env.CACHE.delete(driveOauthStateKey(payload.nonce))
    return { success: true, payload }
  } catch (_) {
    return { success: false, error: 'Google Drive OAuth state could not be decoded.' }
  }
}

async function getSettings(env: Env, keys: string[]): Promise<Record<string, string>> {
  const db = getDb(env)
  // sql-bound-params: bounded by construction -- every caller passes a
  // fixed, hard-coded list of setting keys.
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
      maxBackups: DRIVE_BACKUP_KEEP,
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

export async function buildDriveOauthStartUrl(
  env: Env,
  options: { userId: number; returnOrigin?: unknown; returnPath?: unknown },
): Promise<{ success: boolean; error?: string; url?: string }> {
  const clientId = trim(env.GOOGLE_DRIVE_CLIENT_ID)
  if (!clientId) return { success: false, error: 'Google Drive client ID is not configured.' }
  const returnTarget = normalizeDriveReturnTarget(env, options.returnOrigin, options.returnPath)
  const codeVerifier = randomBase64Url(32)
  const payload: DriveOauthStatePayload = {
    provider: 'google-drive',
    nonce: randomBase64Url(16),
    codeVerifier,
    createdAt: Date.now(),
    userId: Number(options.userId || 0),
    returnOrigin: returnTarget.origin,
    returnPath: returnTarget.path,
  }
  if (!payload.userId) return { success: false, error: 'Google Drive OAuth requires an authenticated user.' }
  const signed = await signDriveOauthState(env, payload)
  if (!signed.state) return { success: false, error: signed.error || 'Failed to secure Google Drive OAuth state.' }
  const signature = signed.state.split('.')[1]
  await env.CACHE.put(driveOauthStateKey(payload.nonce), signature, { expirationTtl: DRIVE_OAUTH_STATE_TTL_SECONDS })
  const url = new URL(GOOGLE_AUTH_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', getRedirectUri(env))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', `${DRIVE_SCOPE} openid email`)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('state', signed.state)
  url.searchParams.set('code_challenge', await sha256Base64Url(codeVerifier))
  url.searchParams.set('code_challenge_method', 'S256')
  return { success: true, url: url.toString() }
}

export async function completeDriveOauth(env: Env, code: string, codeVerifier: string): Promise<{ success: boolean; error?: string }> {
  const clientId = trim(env.GOOGLE_DRIVE_CLIENT_ID)
  const clientSecret = trim(env.GOOGLE_DRIVE_CLIENT_SECRET)
  if (!clientId || !clientSecret) return { success: false, error: 'Google Drive OAuth is not configured.' }
  const body = new URLSearchParams()
  body.set('client_id', clientId)
  body.set('client_secret', clientSecret)
  body.set('code', code)
  body.set('grant_type', 'authorization_code')
  body.set('redirect_uri', getRedirectUri(env))
  body.set('code_verifier', trim(codeVerifier))
  const response = await fetch(GOOGLE_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, redirect: 'error' })
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
  const response = await fetch(GOOGLE_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, redirect: 'error' })
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
// older Drive copies beyond `maxBackups`. The HTTP and scheduled paths enqueue
// this work through lib/driveSyncQueue.ts; this function is the queue worker's
// idempotent upload operation and remains directly callable in focused tests.
export async function pushBackupToDrive(env: Env): Promise<{ success: boolean; error?: string; fileId?: string; fileName?: string }> {
  const tokenResult = await getValidAccessToken(env)
  if ('error' in tokenResult) return { success: false, error: tokenResult.error }
  const token = tokenResult.token

  const settings = await getSettings(env, ['drive_sync_folder_name', 'drive_sync_folder_id'])
  const folderName = settings.drive_sync_folder_name || DEFAULT_FOLDER_NAME

  try {
    const folderId = await ensureFolder(token, folderName, settings.drive_sync_folder_id || '')
    await setSettings(env, [['drive_sync_folder_id', folderId]])

    // Mirror the newest already-finalized R2 backup. Drive sync used to call
    // createCloudflareBackup() again, doubling backup work/storage and racing
    // R2's own retention. A copying/partial/failed set is never eligible.
    const backups = await listCloudflareBackups(env)
    const backup = backups.find((item) => item.finalized)
    if (!backup) throw new Error('No finalized R2 backup is available to mirror yet.')
    const fileName = backup.name || `backup-${Date.now()}.json`
    const existingFiles = await listDriveBackups(token, folderId)
    const existing = existingFiles.find((file) => file.appProperties?.backupKey === backup.key && file.appProperties?.status === 'finalized')
    if (existing) {
      await pruneDriveBackups(token, existingFiles, DRIVE_BACKUP_KEEP)
      await setSettings(env, [['drive_sync_last_synced_at', new Date().toISOString()], ['drive_sync_last_error', '']])
      return { success: true, fileId: existing.id, fileName }
    }

    const object = await env.ASSETS.get(backup.key)
    if (!object?.body) throw new Error('The finalized R2 backup could not be streamed.')

    const metadata = {
      name: fileName,
      parents: [folderId],
      appProperties: {
        businessOsBackup: 'true',
        backupKey: backup.key,
        status: 'finalized',
      },
    }
    const initRes = await fetch(`${DRIVE_UPLOAD_URL}?uploadType=resumable&fields=id,name,size,appProperties`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'application/json',
        'X-Upload-Content-Length': String(object.size),
      },
      body: JSON.stringify(metadata),
    })
    const sessionUrl = initRes.headers.get('location') || ''
    if (!initRes.ok || !isTrustedDriveUploadSession(sessionUrl)) {
      throw new Error('Google Drive did not return a trusted resumable upload session.')
    }
    const uploadRes = await fetch(sessionUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': String(object.size),
      },
      body: object.body,
    })
    const uploaded = await uploadRes.json().catch(() => ({} as { id?: string; size?: string; error?: unknown })) as { id?: string; size?: string; error?: unknown }
    if (!uploadRes.ok || !uploaded.id) throw new Error(typeof uploaded.error === 'string' ? uploaded.error : 'Google Drive upload failed.')
    if (uploaded.size && Number(uploaded.size) !== object.size) throw new Error('Google Drive upload size verification failed.')

    await pruneDriveBackups(token, [{ id: uploaded.id, appProperties: metadata.appProperties }, ...existingFiles], DRIVE_BACKUP_KEEP)
    await setSettings(env, [['drive_sync_last_synced_at', new Date().toISOString()], ['drive_sync_last_error', '']])
    return { success: true, fileId: uploaded.id, fileName }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Google Drive sync failed.'
    await setSettings(env, [['drive_sync_last_error', message]])
    return { success: false, error: message }
  }
}

export function isTrustedDriveUploadSession(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (url.hostname === 'www.googleapis.com' || url.hostname.endsWith('.googleapis.com'))
  } catch {
    return false
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
// `driveSyncScheduleDue` is intentionally separate from executing the upload:
// index.ts can evaluate due-ness on cron and enqueue the expensive network/R2
// work instead of holding the scheduled handler open for the full transfer.
export async function driveSyncScheduleDue(env: Env): Promise<{ due: boolean; reason?: string }> {
  const settings = await getSettings(env, [
    'drive_sync_enabled', 'drive_sync_refresh_token', 'drive_sync_last_synced_at', 'drive_sync_interval_seconds',
  ])
  if (settings.drive_sync_enabled === '0') return { due: false, reason: 'disabled' }
  if (!settings.drive_sync_refresh_token) return { due: false, reason: 'not-connected' }

  const intervalSeconds = Math.min(24 * 60 * 60, Math.max(60 * 60, Number(settings.drive_sync_interval_seconds || 21600)))
  const lastSyncedMs = settings.drive_sync_last_synced_at ? Date.parse(settings.drive_sync_last_synced_at) : 0
  if (lastSyncedMs && (Date.now() - lastSyncedMs) < intervalSeconds * 1000) {
    return { due: false, reason: 'not-due' }
  }

  return { due: true }
}

export async function maybeRunScheduledDriveSync(env: Env): Promise<{ skipped: boolean; reason?: string; result?: Awaited<ReturnType<typeof pushBackupToDrive>> }> {
  const schedule = await driveSyncScheduleDue(env)
  if (!schedule.due) return { skipped: true, reason: schedule.reason }

  const result = await pushBackupToDrive(env)
  return { skipped: false, result }
}

type DriveBackupFile = {
  id: string
  name?: string
  createdTime?: string
  size?: string
  mimeType?: string
  md5Checksum?: string
  appProperties?: Record<string, string>
}

async function listDriveBackups(token: string, folderId: string): Promise<DriveBackupFile[]> {
  // Only files created and tagged by this app are eligible. The old query
  // listed every file in the configured folder and could delete unrelated
  // user content after the retention index. Follow every result page so the
  // "keep exactly seven" promise remains true even after a historic pile-up.
  const files: DriveBackupFile[] = []
  let pageToken = ''
  do {
    const url = new URL(DRIVE_FILES_URL)
    url.searchParams.set('q', `'${folderId}' in parents and trashed = false and appProperties has { key='businessOsBackup' and value='true' }`)
    url.searchParams.set('fields', 'nextPageToken,files(id,name,createdTime,size,mimeType,md5Checksum,appProperties)')
    url.searchParams.set('orderBy', 'createdTime desc')
    url.searchParams.set('pageSize', '1000')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const listRes = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` }, redirect: 'error' })
    if (!listRes.ok) throw new Error('Failed to list Google Drive backups for retention.')
    const listed = await listRes.json().catch(() => ({} as { files?: DriveBackupFile[]; nextPageToken?: string })) as { files?: DriveBackupFile[]; nextPageToken?: string }
    files.push(...(listed.files || []))
    pageToken = String(listed.nextPageToken || '')
  } while (pageToken)
  return files
}

export type DriveRestoreStageResult = {
  success: true
  backupKey: string
  driveFileId: string
  driveFileName: string
  originalBackupKey: string
  size: number
  reused: boolean
  manifestOnly: true
  validation: Awaited<ReturnType<typeof validateCloudflareBackup>>
}

function stableDriveStageKey(fileId: string): string {
  const safeId = fileId.replace(/[^a-zA-Z0-9_-]/g, '')
  if (!safeId) throw new Error('Google Drive returned an invalid backup file id.')
  return `${DRIVE_STAGED_BACKUP_PREFIX}${safeId}.json`
}

async function pruneDriveRestoreStages(env: Env, keep = DRIVE_STAGED_BACKUP_KEEP): Promise<void> {
  const objects: R2Object[] = []
  let cursor: string | undefined
  do {
    const page = await env.ASSETS.list({ prefix: DRIVE_STAGED_BACKUP_PREFIX, cursor, limit: 1000 })
    objects.push(...(page.objects || []))
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  objects.sort((left, right) => right.uploaded.getTime() - left.uploaded.getTime())
  const stale = objects.slice(Math.max(0, keep)).map((object) => object.key)
  for (let offset = 0; offset < stale.length; offset += 1000) {
    await env.ASSETS.delete(stale.slice(offset, offset + 1000))
  }
}

/**
 * Downloads only the newest finalized blob tagged by this OAuth app, streams
 * it into a non-retention R2 staging key, and validates the complete JSON
 * structure in parallel. It never writes D1 or invokes restore.
 */
export async function stageLatestDriveBackupToR2(env: Env): Promise<DriveRestoreStageResult> {
  const tokenResult = await getValidAccessToken(env)
  if ('error' in tokenResult) throw new Error(tokenResult.error)
  const settings = await getSettings(env, ['drive_sync_folder_id'])
  const folderId = trim(settings.drive_sync_folder_id)
  if (!folderId) throw new Error('No app-owned Google Drive backup folder is registered. Run Drive sync first.')

  const files = await listDriveBackups(tokenResult.token, folderId)
  const file = files.find((candidate) => {
    const properties = candidate.appProperties || {}
    return properties.businessOsBackup === 'true'
      && properties.status === 'finalized'
      && properties.backupKey?.startsWith('backups/cloudflare/')
      && !properties.backupKey?.startsWith(DRIVE_STAGED_BACKUP_PREFIX)
      && trim(candidate.name).toLowerCase().endsWith('.json')
      && candidate.mimeType === 'application/json'
  })
  if (!file) throw new Error('No finalized app-owned Google Drive backup is available to stage.')

  const size = Number(file.size || 0)
  if (!Number.isSafeInteger(size) || size <= 0 || size > DRIVE_STAGED_BACKUP_MAX_BYTES) {
    throw new Error('The Google Drive backup size is missing or exceeds the safe R2 single-upload limit.')
  }
  const md5 = trim(file.md5Checksum).toLowerCase()
  if (!/^[a-f0-9]{32}$/.test(md5)) throw new Error('The Google Drive backup is missing a valid content checksum.')

  const backupKey = stableDriveStageKey(file.id)
  const existing = await env.ASSETS.head(backupKey)
  if (existing
    && existing.size === size
    && existing.customMetadata?.source === 'google-drive-stage'
    && existing.customMetadata?.driveFileId === file.id
    && existing.customMetadata?.driveMd5 === md5) {
    try {
      const validation = await validateCloudflareBackup(env, backupKey)
      await pruneDriveRestoreStages(env)
      return {
        success: true,
        backupKey,
        driveFileId: file.id,
        driveFileName: trim(file.name),
        originalBackupKey: String(file.appProperties?.backupKey || ''),
        size,
        reused: true,
        manifestOnly: true,
        validation,
      }
    } catch (_) {
      // Matching metadata is not enough if the object was ever corrupted.
      // Remove it and rebuild from the checksum-bound Drive source below.
      await env.ASSETS.delete(backupKey)
    }
  }

  const downloadUrl = new URL(`${DRIVE_FILES_URL}/${encodeURIComponent(file.id)}`)
  downloadUrl.searchParams.set('alt', 'media')
  downloadUrl.searchParams.set('supportsAllDrives', 'true')
  const response = await fetch(downloadUrl.toString(), {
    headers: { Authorization: `Bearer ${tokenResult.token}` },
    redirect: 'error',
  })
  if (!response.ok || !response.body) throw new Error(`Google Drive backup download failed (${response.status}).`)
  if ((response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    throw new Error('Google Drive returned an unexpected backup content type.')
  }
  const responseLength = response.headers.get('content-length')
  if (responseLength && Number(responseLength) !== size) throw new Error('Google Drive backup size changed before download.')

  const [r2Body, validationBody] = response.body.tee()
  const storedMetadata = {
    format: 'business-os-cloudflare-backup',
    source: 'google-drive-stage',
    driveFileId: file.id,
    driveBackupKey: String(file.appProperties?.backupKey || ''),
    driveMd5: md5,
    stagedAt: new Date().toISOString(),
  }
  const [putResult, inspectionResult] = await Promise.allSettled([
    env.ASSETS.put(backupKey, r2Body, {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
      customMetadata: storedMetadata,
      md5,
    }),
    inspectCloudflareBackupStream(validationBody),
  ])
  const stored = putResult.status === 'fulfilled' ? putResult.value : null
  if (putResult.status === 'rejected' || inspectionResult.status === 'rejected' || !stored || stored.size !== size) {
    await env.ASSETS.delete(backupKey)
    if (inspectionResult.status === 'rejected') throw inspectionResult.reason
    if (putResult.status === 'rejected') throw putResult.reason
    throw new Error('The staged R2 backup failed size verification.')
  }
  let validation: Awaited<ReturnType<typeof validateCloudflareBackup>>
  try {
    validation = await validateCloudflareBackup(env, backupKey)
  } catch (error) {
    await env.ASSETS.delete(backupKey)
    throw error
  }
  await pruneDriveRestoreStages(env)
  return {
    success: true,
    backupKey,
    driveFileId: file.id,
    driveFileName: trim(file.name),
    originalBackupKey: String(file.appProperties?.backupKey || ''),
    size,
    reused: false,
    manifestOnly: true,
    validation,
  }
}

async function pruneDriveBackups(token: string, files: DriveBackupFile[], keep: number): Promise<void> {
  const finalized = files.filter((file) => file.appProperties?.businessOsBackup === 'true' && file.appProperties?.status === 'finalized')
  for (const file of finalized.slice(Math.max(0, keep))) {
    const response = await fetch(`${DRIVE_FILES_URL}/${encodeURIComponent(file.id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok && response.status !== 404) throw new Error(`Failed to prune Google Drive backup ${file.id}.`)
  }
}
