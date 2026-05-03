'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { db } = require('../../database')
const {
  ACTIVE_ENV_FILE,
  DATA_ROOT,
  DATA_FOLDER_NAME,
  GOOGLE_DRIVE_CLIENT_ID,
  GOOGLE_DRIVE_CLIENT_SECRET,
  ORGANIZATION_FOLDER_NAME,
} = require('../../config')
const { walkFiles } = require('../../dataPath')
const { getRuntimeVersion } = require('../../runtimeVersion')
const { encryptSecret, decryptSecret } = require('../../security')
const {
  DRIVE_SYNC_DEFAULT_RETENTION_DAYS,
  resolveDriveSyncVersionState,
  selectExpiredDriveSyncVersions,
} = require('./versioning')
const { createFinalBackupPackage } = require('../backupPackages')

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_DRIVE_API = 'https://www.googleapis.com/drive/v3'
const GOOGLE_DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'
const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

const SETTINGS_KEYS = {
  enabled: 'google_drive_sync_enabled',
  clientId: 'google_drive_sync_client_id',
  clientSecretEncrypted: 'google_drive_sync_client_secret_encrypted',
  refreshTokenEncrypted: 'google_drive_sync_refresh_token_encrypted',
  folderName: 'google_drive_sync_folder_name',
  rootFolderId: 'google_drive_sync_root_folder_id',
  currentVersionFolderId: 'google_drive_sync_current_version_folder_id',
  currentVersionNumber: 'google_drive_sync_current_version_number',
  currentVersionStartedAt: 'google_drive_sync_current_version_started_at',
  retentionDays: 'google_drive_sync_retention_days',
  deleteMissing: 'google_drive_sync_delete_missing',
  syncIntervalSeconds: 'google_drive_sync_interval_seconds',
  connectedEmail: 'google_drive_sync_connected_email',
  connectedName: 'google_drive_sync_connected_name',
  lastSyncedAt: 'google_drive_sync_last_synced_at',
  lastError: 'google_drive_sync_last_error',
  lastStatus: 'google_drive_sync_last_status',
}

const runtimeState = {
  timer: null,
  syncPromise: null,
  queuedReason: '',
  lastRunAt: '',
  lastReason: '',
  lastSummary: null,
  lastError: '',
}

const pendingOauthStates = new Map()

function nowIso() {
  return new Date().toISOString()
}

function trim(value) {
  return String(value || '').trim()
}

function toBool(value, fallback = false) {
  if (value == null || value === '') return !!fallback
  const raw = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true
  if (['0', 'false', 'no', 'off'].includes(raw)) return false
  return !!fallback
}

function clamp(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

function escapeDriveQueryValue(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function readSettingsMap(keys = Object.values(SETTINGS_KEYS)) {
  if (!Array.isArray(keys) || keys.length === 0) return {}
  const placeholders = keys.map(() => '?').join(', ')
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`).all(...keys)
  return rows.reduce((acc, row) => {
    acc[row.key] = row.value
    return acc
  }, {})
}

function writeSettingsMap(updates = {}) {
  const entries = Object.entries(updates || {}).filter(([key]) => trim(key))
  if (!entries.length) return
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `)
  db.transaction(() => {
    entries.forEach(([key, value]) => {
      if (value == null) {
        db.prepare('DELETE FROM settings WHERE key = ?').run(key)
      } else {
        upsert.run(key, String(value))
      }
    })
  })()
}

function clearDriveSyncMappings() {
  db.prepare('DELETE FROM google_drive_sync_entries').run()
}

function resetDriveSyncRootState() {
  clearDriveSyncMappings()
  writeSettingsMap({
    [SETTINGS_KEYS.rootFolderId]: null,
    [SETTINGS_KEYS.currentVersionFolderId]: null,
    [SETTINGS_KEYS.currentVersionNumber]: null,
    [SETTINGS_KEYS.currentVersionStartedAt]: null,
  })
}

function getDriveSyncConfig() {
  const settings = readSettingsMap()
  const envClientId = trim(GOOGLE_DRIVE_CLIENT_ID)
  const envClientSecret = trim(GOOGLE_DRIVE_CLIENT_SECRET)
  const storedClientSecret = decryptSecret(settings[SETTINGS_KEYS.clientSecretEncrypted] || '')
  const folderName = trim(settings[SETTINGS_KEYS.folderName]) || 'Business OS Sync'
  const clientId = trim(settings[SETTINGS_KEYS.clientId]) || envClientId
  const clientSecret = storedClientSecret || envClientSecret
  const refreshToken = decryptSecret(settings[SETTINGS_KEYS.refreshTokenEncrypted] || '')
  return {
    enabled: toBool(settings[SETTINGS_KEYS.enabled], false),
    clientId,
    clientSecret,
    refreshToken,
    folderName,
    rootFolderId: trim(settings[SETTINGS_KEYS.rootFolderId]),
    currentVersionFolderId: trim(settings[SETTINGS_KEYS.currentVersionFolderId]),
    currentVersionNumber: trim(settings[SETTINGS_KEYS.currentVersionNumber]),
    currentVersionStartedAt: trim(settings[SETTINGS_KEYS.currentVersionStartedAt]),
    retentionDays: clamp(settings[SETTINGS_KEYS.retentionDays], 1, 365, DRIVE_SYNC_DEFAULT_RETENTION_DAYS),
    deleteMissing: toBool(settings[SETTINGS_KEYS.deleteMissing], true),
    syncIntervalSeconds: clamp(settings[SETTINGS_KEYS.syncIntervalSeconds], 30, 3600, 120),
    connectedEmail: trim(settings[SETTINGS_KEYS.connectedEmail]),
    connectedName: trim(settings[SETTINGS_KEYS.connectedName]),
    lastSyncedAt: trim(settings[SETTINGS_KEYS.lastSyncedAt]),
    lastError: trim(settings[SETTINGS_KEYS.lastError]),
    lastStatus: trim(settings[SETTINGS_KEYS.lastStatus]) || 'idle',
    ready: !!(clientId && clientSecret && refreshToken),
  }
}

function getDriveSyncEntriesMap() {
  const rows = db.prepare(`
    SELECT relative_path, item_type, remote_file_id, mime_type, md5_checksum, byte_size, local_modified_at, last_synced_at
    FROM google_drive_sync_entries
  `).all()
  return rows.reduce((acc, row) => {
    acc[row.relative_path] = row
    return acc
  }, {})
}

function upsertDriveSyncEntry(entry) {
  db.prepare(`
    INSERT INTO google_drive_sync_entries (
      relative_path, item_type, remote_file_id, mime_type,
      md5_checksum, byte_size, local_modified_at, last_synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(relative_path) DO UPDATE SET
      item_type = excluded.item_type,
      remote_file_id = excluded.remote_file_id,
      mime_type = excluded.mime_type,
      md5_checksum = excluded.md5_checksum,
      byte_size = excluded.byte_size,
      local_modified_at = excluded.local_modified_at,
      last_synced_at = excluded.last_synced_at
  `).run(
    entry.relativePath,
    entry.itemType || 'file',
    entry.remoteFileId,
    entry.mimeType || null,
    entry.md5Checksum || null,
    Number(entry.byteSize || 0) || 0,
    entry.localModifiedAt || null,
    entry.lastSyncedAt || nowIso(),
  )
}

function deleteDriveSyncEntry(relativePath) {
  db.prepare('DELETE FROM google_drive_sync_entries WHERE relative_path = ?').run(relativePath)
}

function deleteDriveSyncEntriesUnder(relativePrefix) {
  db.prepare('DELETE FROM google_drive_sync_entries WHERE relative_path = ? OR relative_path LIKE ?').run(
    relativePrefix,
    `${relativePrefix}/%`,
  )
}

function inferMimeType(filePath) {
  const ext = String(path.extname(filePath || '').toLowerCase())
  if (ext === '.sql') return 'application/sql'
  if (ext === '.json') return 'application/json'
  if (ext === '.csv') return 'text/csv'
  if (ext === '.txt' || ext === '.log') return 'text/plain'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.pdf') return 'application/pdf'
  if (ext === '.mp4') return 'video/mp4'
  return 'application/octet-stream'
}

function md5File(filePath) {
  const hash = crypto.createHash('md5')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function buildMultipartBody(metadata, mediaBuffer, mimeType) {
  const boundary = `business-os-${crypto.randomBytes(12).toString('hex')}`
  const head = Buffer.from(
    `--${boundary}\r\n`
    + 'Content-Type: application/json; charset=UTF-8\r\n\r\n'
    + `${JSON.stringify(metadata)}\r\n`
    + `--${boundary}\r\n`
    + `Content-Type: ${mimeType}\r\n\r\n`,
    'utf8',
  )
  const tail = Buffer.from(`\r\n--${boundary}--`, 'utf8')
  return {
    boundary,
    body: Buffer.concat([head, mediaBuffer, tail]),
  }
}

async function exchangeRefreshToken(config) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: 'refresh_token',
  })
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok || !trim(json.access_token)) {
    throw new Error(json.error_description || json.error || `Google token refresh failed (${response.status})`)
  }
  return trim(json.access_token)
}

async function exchangeAuthorizationCode(payload) {
  const body = new URLSearchParams({
    code: payload.code,
    client_id: payload.clientId,
    client_secret: payload.clientSecret,
    redirect_uri: payload.redirectUri,
    grant_type: 'authorization_code',
  })
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok || !trim(json.refresh_token)) {
    throw new Error(json.error_description || json.error || `Google authorization failed (${response.status})`)
  }
  return {
    accessToken: trim(json.access_token),
    refreshToken: trim(json.refresh_token),
  }
}

async function driveApiRequest(config, requestUrl, options = {}) {
  const accessToken = await exchangeRefreshToken(config)
  const response = await fetch(requestUrl, {
    ...options,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  })
  if (response.status === 204) return null
  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(json?.error?.message || `Google Drive request failed (${response.status})`)
  }
  return json
}

async function driveApiUpload(config, requestUrl, options = {}) {
  const accessToken = await exchangeRefreshToken(config)
  const response = await fetch(requestUrl, {
    ...options,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(json?.error?.message || `Google Drive upload failed (${response.status})`)
  }
  return json
}

async function fetchDriveUserProfile(config, accessToken = '') {
  const token = accessToken || await exchangeRefreshToken(config)
  const response = await fetch(`${GOOGLE_DRIVE_API}/about?fields=user(displayName,emailAddress)`, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(json?.error?.message || `Google profile lookup failed (${response.status})`)
  return {
    email: trim(json?.user?.emailAddress),
    name: trim(json?.user?.displayName),
  }
}

async function findDriveItem(config, parentId, name, mimeType) {
  const items = await findDriveItems(config, parentId, name, mimeType)
  return items.length ? items[0] : null
}

async function findDriveItems(config, parentId, name, mimeType) {
  const queryParts = [
    `name = '${escapeDriveQueryValue(name)}'`,
    `'${escapeDriveQueryValue(parentId)}' in parents`,
    'trashed = false',
  ]
  if (mimeType) queryParts.push(`mimeType = '${escapeDriveQueryValue(mimeType)}'`)
  const query = queryParts.join(' and ')
  const json = await driveApiRequest(
    config,
    `${GOOGLE_DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,md5Checksum,size,modifiedTime)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`,
  )
  return Array.isArray(json?.files) ? json.files : []
}

async function listDriveChildren(config, parentId) {
  const query = `'${escapeDriveQueryValue(parentId)}' in parents and trashed = false`
  const json = await driveApiRequest(
    config,
    `${GOOGLE_DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,md5Checksum,size,modifiedTime)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true`,
  )
  return Array.isArray(json?.files) ? json.files : []
}

async function getDriveFileIfExists(config, fileId) {
  try {
    return await driveApiRequest(
      config,
      `${GOOGLE_DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType&supportsAllDrives=true`,
    )
  } catch (error) {
    if (/not found|404/i.test(String(error?.message || ''))) return null
    throw error
  }
}

async function removeDuplicateDriveItems(config, items, keepId = '') {
  const keep = trim(keepId)
  let removed = 0
  for (const item of items || []) {
    const currentId = trim(item?.id || '')
    if (!currentId || currentId === keep) continue
    await removeDriveFile(config, currentId)
    removed += 1
  }
  return removed
}

async function createDriveFolder(config, parentId, name) {
  return driveApiRequest(config, `${GOOGLE_DRIVE_API}/files?supportsAllDrives=true`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  })
}

async function ensureRootFolder(config) {
  if (config.rootFolderId) {
    const existingById = await getDriveFileIfExists(config, config.rootFolderId)
    if (existingById?.id) return existingById.id
    writeSettingsMap({ [SETTINGS_KEYS.rootFolderId]: null })
  }
  const existingItems = await findDriveItems(config, 'root', config.folderName, 'application/vnd.google-apps.folder')
  const existing = existingItems[0] || null
  if (existing?.id) {
    await removeDuplicateDriveItems(config, existingItems, existing.id)
    writeSettingsMap({ [SETTINGS_KEYS.rootFolderId]: existing.id })
    return existing.id
  }
  const created = await createDriveFolder(config, 'root', config.folderName)
  if (!trim(created?.id)) throw new Error('Google Drive root folder could not be created')
  writeSettingsMap({ [SETTINGS_KEYS.rootFolderId]: created.id })
  return created.id
}

async function ensureDriveVersionFolder(config, rootFolderId) {
  const versionState = resolveDriveSyncVersionState({
    currentVersionNumber: config.currentVersionNumber,
    currentVersionStartedAt: config.currentVersionStartedAt,
  })

  let versionFolderId = ''
  if (!versionState.rotated && config.currentVersionFolderId) {
    const existingById = await getDriveFileIfExists(config, config.currentVersionFolderId)
    if (existingById?.id) versionFolderId = existingById.id
  }

  const matches = await findDriveItems(config, rootFolderId, versionState.versionName, 'application/vnd.google-apps.folder')
  if (!versionFolderId && matches[0]?.id) versionFolderId = matches[0].id
  if (!versionFolderId) {
    const created = await createDriveFolder(config, rootFolderId, versionState.versionName)
    versionFolderId = trim(created?.id)
  }
  if (!versionFolderId) throw new Error(`Google Drive version folder ${versionState.versionName} could not be created`)

  await removeDuplicateDriveItems(config, matches, versionFolderId)

  const folderChanged = trim(config.currentVersionFolderId) !== versionFolderId
  if (versionState.rotated || folderChanged) clearDriveSyncMappings()
  writeSettingsMap({
    [SETTINGS_KEYS.currentVersionFolderId]: versionFolderId,
    [SETTINGS_KEYS.currentVersionNumber]: String(versionState.versionNumber),
    [SETTINGS_KEYS.currentVersionStartedAt]: versionState.startedAt,
  })

  const rootChildren = await listDriveChildren(config, rootFolderId)
  const expired = selectExpiredDriveSyncVersions(rootChildren, config.retentionDays)
  let prunedVersions = 0
  for (const item of expired) {
    const itemId = trim(item?.id)
    if (!itemId || itemId === versionFolderId) continue
    await removeDriveFile(config, itemId)
    prunedVersions += 1
  }

  return {
    ...versionState,
    folderId: versionFolderId,
    prunedVersions,
  }
}

function writeSnapshotManifest(snapshotRoot, versionState) {
  const runtimeVersion = getRuntimeVersion()
  const manifest = {
    format: 'business-os-drive-sync',
    version: 1,
    createdAt: nowIso(),
    dataFolderName: DATA_FOLDER_NAME,
    organizationFolderName: ORGANIZATION_FOLDER_NAME,
    driveVersion: {
      number: versionState.versionNumber,
      name: versionState.versionName,
      startedAt: versionState.startedAt,
      folderId: versionState.folderId,
    },
    runtime: {
      app: runtimeVersion.app,
      packageVersion: runtimeVersion.packageVersion,
      revision: runtimeVersion.revision,
      sourceHash: runtimeVersion.sourceHash,
      frontend: runtimeVersion.frontend,
    },
    restore: {
      source: 'google-drive-sync-version',
      note: 'Restore only after Business OS validates this folder and its checksums.',
    },
  }
  fs.writeFileSync(
    path.join(snapshotRoot, 'business-os-drive-sync-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  )
  return manifest
}

function buildManagedSnapshotRoot(snapshotRoot) {
  return path.join(snapshotRoot, DATA_FOLDER_NAME, 'organizations', ORGANIZATION_FOLDER_NAME)
}

function ensureSnapshotLayout(snapshotRoot) {
  const managedRoot = buildManagedSnapshotRoot(snapshotRoot)
  fs.mkdirSync(path.join(managedRoot, 'uploads'), { recursive: true })
  fs.mkdirSync(path.join(managedRoot, 'backups'), { recursive: true })
}

function shouldSkipSnapshotFile(relativePath) {
  return !String(relativePath || '').trim()
}

function createDataRootSnapshot() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'business-os-drive-sync-'))
  const snapshotRoot = tempDir
  const managedRoot = buildManagedSnapshotRoot(snapshotRoot)
  ensureSnapshotLayout(snapshotRoot)

  try {
    walkFiles(DATA_ROOT, (absolutePath) => {
      const relativePath = path.relative(DATA_ROOT, absolutePath)
      if (!relativePath || shouldSkipSnapshotFile(relativePath)) return
      const targetPath = path.join(managedRoot, relativePath)
      fs.mkdirSync(path.dirname(targetPath), { recursive: true })
      fs.copyFileSync(absolutePath, targetPath)
    })

    fs.writeFileSync(path.join(managedRoot, 'manifest.json'), JSON.stringify({
      format: 'business-os-drive-snapshot-v3',
      createdAt: new Date().toISOString(),
      note: 'Live database and object storage are backed up through Docker final backup packages. This Drive snapshot mirrors runtime backup artifacts and metadata.',
    }, null, 2), 'utf8')

    return { tempDir, snapshotRoot, managedRoot }
  } catch (error) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch (_) {}
    throw error
  }
}

function collectSnapshotItems(snapshotRoot) {
  const files = []
  const directories = new Set([''])
  walkFiles(snapshotRoot, (absolutePath) => {
    const relativePath = path.relative(snapshotRoot, absolutePath).replace(/\\/g, '/')
    if (!relativePath) return
    const stats = fs.statSync(absolutePath)
    const dirName = path.dirname(relativePath).replace(/\\/g, '/')
    let cursor = dirName === '.' ? '' : dirName
    while (cursor) {
      directories.add(cursor)
      const next = path.dirname(cursor).replace(/\\/g, '/')
      cursor = next === '.' ? '' : next
    }
    files.push({
      absolutePath,
      relativePath,
      size: stats.size,
      modifiedAt: new Date(stats.mtimeMs).toISOString(),
      mimeType: inferMimeType(absolutePath),
      md5Checksum: md5File(absolutePath),
    })
  })
  return {
    directories: Array.from(directories).filter(Boolean).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)),
    files,
  }
}

async function ensureRemoteDirectories(config, mappings, rootFolderId, relativeDirs) {
  const remoteDirs = { '': rootFolderId }
  if (mappings['']) remoteDirs[''] = mappings[''].remote_file_id || rootFolderId

  for (const relativeDir of relativeDirs) {
    const existing = mappings[relativeDir]
    if (existing?.remote_file_id) {
      remoteDirs[relativeDir] = existing.remote_file_id
      continue
    }
    const parentRelative = path.posix.dirname(relativeDir) === '.' ? '' : path.posix.dirname(relativeDir)
    const parentRemoteId = remoteDirs[parentRelative] || rootFolderId
    const folderName = path.posix.basename(relativeDir)
    const foundItems = await findDriveItems(config, parentRemoteId, folderName, 'application/vnd.google-apps.folder')
    const found = foundItems[0] || null
    const folder = found?.id ? found : await createDriveFolder(config, parentRemoteId, folderName)
    if (found?.id) {
      await removeDuplicateDriveItems(config, foundItems, found.id)
    }
    remoteDirs[relativeDir] = folder.id
    upsertDriveSyncEntry({
      relativePath: relativeDir,
      itemType: 'folder',
      remoteFileId: folder.id,
      mimeType: folder.mimeType || 'application/vnd.google-apps.folder',
      md5Checksum: '',
      byteSize: 0,
      localModifiedAt: null,
      lastSyncedAt: nowIso(),
    })
    mappings[relativeDir] = { remote_file_id: folder.id, item_type: 'folder' }
  }
  return remoteDirs
}

async function uploadDriveFile(config, parentRemoteId, file) {
  const buffer = fs.readFileSync(file.absolutePath)
  const multipart = buildMultipartBody({
    name: path.posix.basename(file.relativePath),
    parents: [parentRemoteId],
  }, buffer, file.mimeType)
  return driveApiUpload(config, `${GOOGLE_DRIVE_UPLOAD_API}/files?uploadType=multipart&supportsAllDrives=true`, {
    method: 'POST',
    headers: {
      'content-type': `multipart/related; boundary=${multipart.boundary}`,
    },
    body: multipart.body,
  })
}

async function updateDriveFile(config, remoteFileId, file) {
  const buffer = fs.readFileSync(file.absolutePath)
  return driveApiUpload(config, `${GOOGLE_DRIVE_UPLOAD_API}/files/${encodeURIComponent(remoteFileId)}?uploadType=media&supportsAllDrives=true`, {
    method: 'PATCH',
    headers: {
      'content-type': file.mimeType,
    },
    body: buffer,
  })
}

async function removeDriveFile(config, remoteFileId) {
  try {
    await driveApiRequest(config, `${GOOGLE_DRIVE_API}/files/${encodeURIComponent(remoteFileId)}?supportsAllDrives=true`, {
      method: 'DELETE',
    })
    return true
  } catch (error) {
    if (/not found|404/i.test(String(error?.message || ''))) return false
    throw error
  }
}

async function runDriveSync(reason = 'manual') {
  const config = getDriveSyncConfig()
  if (!config.enabled) throw new Error('Google Drive sync is turned off.')
  if (!config.ready) throw new Error('Finish connecting Google Drive before syncing.')

  runtimeState.lastRunAt = nowIso()
  runtimeState.lastReason = reason
  runtimeState.lastError = ''
  writeSettingsMap({
    [SETTINGS_KEYS.lastStatus]: 'syncing',
    [SETTINGS_KEYS.lastError]: '',
  })

  const backupPackage = await createFinalBackupPackage({
    destinationDir: path.join(DATA_ROOT, 'backups'),
    actor: { userName: 'Google Drive sync' },
  })
  const snapshot = createDataRootSnapshot()
  try {
    let mappings = getDriveSyncEntriesMap()
    const rootFolderId = await ensureRootFolder(config)
    const versionState = await ensureDriveVersionFolder(config, rootFolderId)
    mappings = getDriveSyncEntriesMap()
    const manifest = writeSnapshotManifest(snapshot.snapshotRoot, versionState)
    const items = collectSnapshotItems(snapshot.snapshotRoot)
    const canonicalRootRelative = `${DATA_FOLDER_NAME}/organizations/${ORGANIZATION_FOLDER_NAME}`
    const hasCanonicalLayout = !!mappings[canonicalRootRelative]
      || Object.keys(mappings).some((relativePath) => (
        relativePath === canonicalRootRelative
        || relativePath.startsWith(`${canonicalRootRelative}/`)
      ))
    const legacyFlatLayout = !hasCanonicalLayout && Object.keys(mappings).length > 0
    if (legacyFlatLayout) {
      clearDriveSyncMappings()
      mappings = {}
    }
    const remoteDirs = await ensureRemoteDirectories(config, mappings, versionState.folderId, items.directories)

    let removed = 0
    if (legacyFlatLayout && config.deleteMissing) {
      const rootChildren = await listDriveChildren(config, rootFolderId)
      for (const child of rootChildren) {
        if (!trim(child?.id)) continue
        if (trim(child?.id) === trim(versionState.folderId)) continue
        if (/^datasync-\d+$/i.test(trim(child?.name))) continue
        await removeDriveFile(config, child.id)
        removed += 1
      }
    }

    let uploaded = 0
    let updated = 0
    let skipped = 0

    for (const file of items.files) {
      const parentRelative = path.posix.dirname(file.relativePath) === '.' ? '' : path.posix.dirname(file.relativePath)
      const parentRemoteId = remoteDirs[parentRelative] || versionState.folderId
      const existing = mappings[file.relativePath]
      const alreadySynced = existing
        && existing.item_type === 'file'
        && trim(existing.md5_checksum) === file.md5Checksum
        && Number(existing.byte_size || 0) === file.size
      if (alreadySynced) {
        skipped += 1
        continue
      }

      let remote = null
      const siblingMatches = await findDriveItems(config, parentRemoteId, path.posix.basename(file.relativePath), null)
      const reusable = siblingMatches.find((item) => trim(item?.mimeType) !== 'application/vnd.google-apps.folder')
      if (existing?.remote_file_id) {
        try {
          remote = await updateDriveFile(config, existing.remote_file_id, file)
          updated += 1
        } catch (error) {
          const message = String(error?.message || '')
          if (!/not found|file not found|404/i.test(message)) throw error
          if (reusable?.id) {
            remote = await updateDriveFile(config, reusable.id, file)
            updated += 1
          } else {
            remote = await uploadDriveFile(config, parentRemoteId, file)
            uploaded += 1
          }
        }
      } else if (reusable?.id) {
        remote = await updateDriveFile(config, reusable.id, file)
        updated += 1
      } else {
        remote = await uploadDriveFile(config, parentRemoteId, file)
        uploaded += 1
      }

      await removeDuplicateDriveItems(
        config,
        siblingMatches.filter((item) => trim(item?.mimeType) !== 'application/vnd.google-apps.folder'),
        trim(remote?.id) || existing?.remote_file_id || reusable?.id || '',
      )

      upsertDriveSyncEntry({
        relativePath: file.relativePath,
        itemType: 'file',
        remoteFileId: trim(remote?.id) || existing?.remote_file_id,
        mimeType: file.mimeType,
        md5Checksum: file.md5Checksum,
        byteSize: file.size,
        localModifiedAt: file.modifiedAt,
        lastSyncedAt: nowIso(),
      })
      mappings[file.relativePath] = {
        remote_file_id: trim(remote?.id) || existing?.remote_file_id,
        item_type: 'file',
        md5_checksum: file.md5Checksum,
        byte_size: file.size,
      }
    }

    if (config.deleteMissing) {
      const livePaths = new Set(['', ...items.directories, ...items.files.map((file) => file.relativePath)])
      const staleEntries = Object.entries(mappings)
        .filter(([relativePath]) => !livePaths.has(relativePath))
        .sort((a, b) => b[0].split('/').length - a[0].split('/').length)

      for (const [relativePath, entry] of staleEntries) {
        if (!trim(entry?.remote_file_id)) {
          deleteDriveSyncEntry(relativePath)
          continue
        }
        await removeDriveFile(config, entry.remote_file_id)
        if (entry.item_type === 'folder') deleteDriveSyncEntriesUnder(relativePath)
        else deleteDriveSyncEntry(relativePath)
        removed += 1
      }
    }

    const summary = {
      uploaded,
      updated,
      skipped,
      removed,
      prunedVersions: versionState.prunedVersions || 0,
      fileCount: items.files.length,
      folderCount: items.directories.length,
      version: {
        number: versionState.versionNumber,
        name: versionState.versionName,
        startedAt: versionState.startedAt,
        rotated: versionState.rotated,
      },
      backupPackage: {
        packageId: backupPackage.packageId,
        localPath: backupPackage.localPath,
        objectPrefix: backupPackage.objectPrefix,
        objectsCopied: backupPackage.objectsCopied,
        objectsFailed: backupPackage.objectsFailed,
      },
      manifest,
    }
    runtimeState.lastSummary = summary
    writeSettingsMap({
      [SETTINGS_KEYS.lastSyncedAt]: nowIso(),
      [SETTINGS_KEYS.lastError]: '',
      [SETTINGS_KEYS.lastStatus]: 'ok',
    })
    return summary
  } catch (error) {
    runtimeState.lastSummary = null
    runtimeState.lastError = error?.message || 'Google Drive sync failed'
    writeSettingsMap({
      [SETTINGS_KEYS.lastError]: runtimeState.lastError,
      [SETTINGS_KEYS.lastStatus]: 'error',
    })
    throw error
  } finally {
    try { fs.rmSync(snapshot.tempDir, { recursive: true, force: true }) } catch (_) {}
  }
}

function scheduleDriveSync(reason = 'change', delayMs = 5000) {
  const config = getDriveSyncConfig()
  if (!config.enabled || !config.ready) return
  runtimeState.queuedReason = reason || runtimeState.queuedReason || 'change'
  if (runtimeState.timer) clearTimeout(runtimeState.timer)
  runtimeState.timer = setTimeout(async () => {
    runtimeState.timer = null
    if (runtimeState.syncPromise) return
    runtimeState.syncPromise = runDriveSync(runtimeState.queuedReason || 'change')
      .catch(() => null)
      .finally(() => {
        runtimeState.syncPromise = null
        const queuedAgain = trim(runtimeState.queuedReason)
        runtimeState.queuedReason = ''
        if (queuedAgain && queuedAgain !== reason) {
          scheduleDriveSync(queuedAgain, 3000)
        }
      })
    runtimeState.queuedReason = ''
    await runtimeState.syncPromise
  }, Math.max(500, Number(delayMs || 0)))
}

function getDriveSyncStatus(redirectUri = '') {
  const config = getDriveSyncConfig()
  const hasPreviousAccount = !!(config.connectedEmail || config.connectedName || config.rootFolderId)
  const needsReconnect = !config.ready && hasPreviousAccount
  const reconnectMessage = needsReconnect
    ? 'Google Drive was connected before, but the saved OAuth secret or token is missing. Reconnect Google Drive to resume sync.'
    : ''
  return {
    enabled: config.enabled,
    connected: !!config.ready,
    ready: !!config.ready,
    clientId: config.clientId,
    hasClientSecret: !!config.clientSecret,
    hasRefreshToken: !!config.refreshToken,
    folderName: config.folderName,
    rootFolderId: config.rootFolderId,
    activeVersion: config.currentVersionNumber ? {
      number: Number(config.currentVersionNumber || 0) || null,
      name: config.currentVersionNumber ? `datasync-${config.currentVersionNumber}` : '',
      folderId: config.currentVersionFolderId,
      startedAt: config.currentVersionStartedAt,
      retentionDays: config.retentionDays,
    } : null,
    retentionDays: config.retentionDays,
    deleteMissing: config.deleteMissing,
    syncIntervalSeconds: config.syncIntervalSeconds,
    connectedEmail: config.connectedEmail,
    connectedName: config.connectedName,
    redirectUri,
    scope: GOOGLE_DRIVE_SCOPE,
    runtime: {
      syncing: !!runtimeState.syncPromise,
      queued: !!runtimeState.timer || !!trim(runtimeState.queuedReason),
      lastRunAt: runtimeState.lastRunAt,
      lastReason: runtimeState.lastReason,
      lastError: runtimeState.lastError || config.lastError || reconnectMessage,
      lastSummary: runtimeState.lastSummary,
    },
    lastSyncedAt: config.lastSyncedAt,
    lastError: runtimeState.lastError || config.lastError || reconnectMessage,
    lastStatus: needsReconnect ? 'needs_reconnect' : config.lastStatus,
  }
}

function beginGoogleDriveOAuth(payload = {}) {
  const state = crypto.randomBytes(18).toString('base64url')
  pendingOauthStates.set(state, {
    clientId: trim(payload.clientId),
    clientSecret: trim(payload.clientSecret),
    folderName: trim(payload.folderName) || 'Business OS Sync',
    deleteMissing: payload.deleteMissing == null ? true : !!payload.deleteMissing,
    syncIntervalSeconds: clamp(payload.syncIntervalSeconds, 30, 3600, 120),
    enabled: payload.enabled !== false,
    redirectUri: trim(payload.redirectUri),
    returnOrigin: trim(payload.returnOrigin),
    returnPath: trim(payload.returnPath) || '/',
    userId: Number(payload.userId || 0) || null,
    userName: trim(payload.userName),
    createdAt: Date.now(),
  })
  return state
}

function prunePendingOauthStates() {
  const cutoff = Date.now() - (15 * 60 * 1000)
  for (const [state, value] of pendingOauthStates.entries()) {
    if (!value?.createdAt || value.createdAt < cutoff) pendingOauthStates.delete(state)
  }
}

async function finalizeGoogleDriveOAuth({ state, code }) {
  prunePendingOauthStates()
  const pending = pendingOauthStates.get(trim(state))
  if (!pending) throw new Error('Google Drive connection session expired. Start again.')
  pendingOauthStates.delete(trim(state))

  const tokens = await exchangeAuthorizationCode({
    code,
    clientId: pending.clientId,
    clientSecret: pending.clientSecret,
    redirectUri: pending.redirectUri,
  })
  const profile = await fetchDriveUserProfile({
    clientId: pending.clientId,
    clientSecret: pending.clientSecret,
    refreshToken: tokens.refreshToken,
  }, tokens.accessToken)

  resetDriveSyncRootState()
  writeSettingsMap({
    [SETTINGS_KEYS.clientId]: pending.clientId,
    [SETTINGS_KEYS.clientSecretEncrypted]: encryptSecret(pending.clientSecret),
    [SETTINGS_KEYS.refreshTokenEncrypted]: encryptSecret(tokens.refreshToken),
    [SETTINGS_KEYS.folderName]: pending.folderName,
    [SETTINGS_KEYS.deleteMissing]: pending.deleteMissing ? '1' : '0',
    [SETTINGS_KEYS.syncIntervalSeconds]: String(pending.syncIntervalSeconds),
    [SETTINGS_KEYS.enabled]: pending.enabled ? '1' : '0',
    [SETTINGS_KEYS.connectedEmail]: profile.email || '',
    [SETTINGS_KEYS.connectedName]: profile.name || '',
    [SETTINGS_KEYS.lastError]: '',
    [SETTINGS_KEYS.lastStatus]: 'connected',
  })

  scheduleDriveSync('oauth-connected', 1500)
  return {
    returnOrigin: pending.returnOrigin,
    returnPath: pending.returnPath,
    email: profile.email,
    name: profile.name,
  }
}

function saveDriveSyncPreferences(payload = {}) {
  const current = getDriveSyncConfig()
  const nextFolderName = trim(payload.folderName) || current.folderName || 'Business OS Sync'
  const updates = {
    [SETTINGS_KEYS.folderName]: nextFolderName,
    [SETTINGS_KEYS.enabled]: (payload.enabled == null ? current.enabled : !!payload.enabled) ? '1' : '0',
    [SETTINGS_KEYS.deleteMissing]: (payload.deleteMissing == null ? current.deleteMissing : !!payload.deleteMissing) ? '1' : '0',
    [SETTINGS_KEYS.syncIntervalSeconds]: String(clamp(payload.syncIntervalSeconds, 30, 3600, current.syncIntervalSeconds || 120)),
  }
  if (trim(current.folderName).toLowerCase() !== nextFolderName.toLowerCase()) {
    updates[SETTINGS_KEYS.rootFolderId] = null
    clearDriveSyncMappings()
  }
  writeSettingsMap(updates)
  if (toBool(updates[SETTINGS_KEYS.enabled]) && current.ready) {
    scheduleDriveSync('preferences-updated', 1500)
  }
}

function disconnectDriveSync() {
  clearDriveSyncMappings()
  writeSettingsMap({
    [SETTINGS_KEYS.refreshTokenEncrypted]: null,
    [SETTINGS_KEYS.rootFolderId]: null,
    [SETTINGS_KEYS.connectedEmail]: null,
    [SETTINGS_KEYS.connectedName]: null,
    [SETTINGS_KEYS.lastError]: null,
    [SETTINGS_KEYS.lastStatus]: 'idle',
    [SETTINGS_KEYS.lastSyncedAt]: null,
    [SETTINGS_KEYS.currentVersionFolderId]: null,
    [SETTINGS_KEYS.currentVersionNumber]: null,
    [SETTINGS_KEYS.currentVersionStartedAt]: null,
  })
  runtimeState.lastSummary = null
  runtimeState.lastError = ''
  runtimeState.lastRunAt = ''
}

function updateEnvSettingLines(filePath, updates = {}) {
  const lines = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8').split(/\r?\n/) : []
  const nextLines = [...lines]
  Object.entries(updates).forEach(([key, value]) => {
    const nextLine = `${key}=${String(value ?? '').trim()}`
    const index = nextLines.findIndex((entry) => entry.startsWith(`${key}=`))
    if (index >= 0) nextLines[index] = nextLine
    else nextLines.push(nextLine)
  })
  const normalized = nextLines.filter((line, index, all) => !(index === all.length - 1 && line === ''))
  fs.writeFileSync(filePath, `${normalized.join('\r\n')}\r\n`, 'utf8')
}

function forgetDriveSyncCredentials() {
  disconnectDriveSync()
  writeSettingsMap({
    [SETTINGS_KEYS.clientId]: null,
    [SETTINGS_KEYS.clientSecretEncrypted]: null,
  })
  if (trim(ACTIVE_ENV_FILE)) {
    updateEnvSettingLines(ACTIVE_ENV_FILE, {
      GOOGLE_DRIVE_CLIENT_ID: '',
      GOOGLE_DRIVE_CLIENT_SECRET: '',
      GOOGLE_DRIVE_OAUTH_REDIRECT_URI: '',
    })
  }
}

function schedulePeriodicDriveSync() {
  setInterval(() => {
    const config = getDriveSyncConfig()
    if (!config.enabled || !config.ready) return
    const lastSyncMs = config.lastSyncedAt ? Date.parse(config.lastSyncedAt) : 0
    const dueMs = Math.max(30, config.syncIntervalSeconds) * 1000
    if (!lastSyncMs || (Date.now() - lastSyncMs) >= dueMs) {
      scheduleDriveSync('interval', 1000)
    }
  }, 30 * 1000).unref?.()
}

schedulePeriodicDriveSync()

module.exports = {
  GOOGLE_DRIVE_SCOPE,
  beginGoogleDriveOAuth,
  disconnectDriveSync,
  finalizeGoogleDriveOAuth,
  forgetDriveSyncCredentials,
  getDriveSyncConfig,
  getDriveSyncStatus,
  runDriveSync,
  saveDriveSyncPreferences,
  scheduleDriveSync,
}
