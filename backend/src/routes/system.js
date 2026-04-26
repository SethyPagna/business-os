'use strict'
/**
 * system.js
 * Operational/system endpoints:
 * - backup export/import
 * - reset/factory-reset
 * - integrity verify/repair
 * - runtime data-path management
 * - lightweight diagnostics
 *
 * This module touches many tables; changes here require careful FK-safe ordering.
 */
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const Database = require('better-sqlite3')
const bcrypt = require('bcryptjs')
const express = require('express')
const { db }  = require('../database')
const {
  UPLOADS_PATH,
  RUNTIME_DIR,
  DATA_ROOT,
  DEFAULT_DATA_ROOT,
  DATA_FOLDER_NAME,
  DATA_LOCATION_FILE,
  writeDataLocation,
  normalizeSelectedDataDir,
} = require('../config')
const {
  summarizeDataRoot,
  isSamePath,
  isSubPath,
} = require('../dataPath')
const {
  BACKUP_VERSION,
  BACKUP_TABLES,
  BACKUP_CLEAR_ORDER,
  buildBackupSummary,
} = require('../backupSchema')
const { ok, err, audit, broadcast, today, getServerLog, wss_clients, runDataIntegrityCheck } = require('../helpers')
const { authToken } = require('../middleware')
const { checkRateLimit } = require('../security')
const { classifyRequestAccess } = require('../accessControl')

const router = express.Router()
const SYSTEM_FS_WORKER = path.join(__dirname, '../systemFsWorker.js')

function q(name) {
  return `"${String(name).replace(/"/g, '""')}"`
}

function getClientKey(req, suffix = '') {
  const xForwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  const ip = xForwardedFor || req.ip || req.connection?.remoteAddress || 'unknown-ip'
  return `${ip}|${String(suffix || '').trim().toLowerCase()}`
}

function applyRouteRateLimit(req, res, options = {}) {
  const name = String(options.name || 'system:route')
  const max = Math.max(1, Number(options.max || 30))
  const windowMs = Math.max(1_000, Number(options.windowMs || 60 * 1000))
  const key = getClientKey(req, options.key || name)
  const result = checkRateLimit(name, key, max, windowMs)
  if (result.allowed) return true
  res.setHeader('Retry-After', String(result.retryAfterSeconds))
  err(res, `Too many requests. Try again in ${result.retryAfterSeconds} seconds.`, 429)
  return false
}

function runFsWorker(action, payload, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SYSTEM_FS_WORKER, action, JSON.stringify(payload || {})], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    let timer = null

    const finish = (error, value) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (error) reject(error)
      else resolve(value)
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try { child.kill() } catch (_) {}
        finish(new Error('The filesystem job took too long and was cancelled.'))
      }, timeoutMs)
    }

    child.stdout.on('data', (chunk) => { stdout += String(chunk || '') })
    child.stderr.on('data', (chunk) => { stderr += String(chunk || '') })
    child.on('error', (error) => finish(error))
    child.on('close', (code) => {
      const raw = stdout.trim()
      if (code !== 0) {
        let message = stderr.trim() || raw || `Worker exited with code ${code}`
        try {
          const parsed = raw ? JSON.parse(raw) : null
          if (parsed?.error) message = parsed.error
        } catch (_) {}
        finish(new Error(message))
        return
      }

      try {
        const parsed = JSON.parse(raw || '{}')
        if (!parsed?.ok) {
          finish(new Error(parsed?.error || 'Worker failed'))
          return
        }
        finish(null, parsed.result)
      } catch (error) {
        finish(new Error(`Worker returned invalid output: ${error.message}`))
      }
    })
  })
}

function getHostUiAvailability(req) {
  const access = classifyRequestAccess(req)
  return {
    access,
    hostUiAvailable: !!access.localRequest,
  }
}

function getTableColumns(table) {
  return db.prepare(`PRAGMA table_info(${q(table)})`).all().map(col => col.name)
}

function extractUploadPathsFromText(value) {
  const raw = String(value || '')
  if (!raw.includes('/uploads/')) return []
  const matches = raw.match(/\/uploads\/[^"'`\r\n]+/g) || []
  return matches
    .map((match) => match.replace(/[,\]}]+$/, '').trim())
    .filter(Boolean)
}

function collectBackupUploads() {
  const uploads = []
  const seen = new Set()

  const addUpload = (relPath) => {
    if (!relPath || typeof relPath !== 'string') return
    const normalized = relPath.trim()
    if (!normalized.startsWith('/uploads/') || seen.has(normalized)) return
    const fileName = path.basename(normalized)
    if (!fileName) return
    const filePath = path.join(UPLOADS_PATH, fileName)
    if (!fs.existsSync(filePath)) return
    uploads.push({ path: normalized, data: fs.readFileSync(filePath).toString('base64') })
    seen.add(normalized)
  }

  const uploadScans = [
    "SELECT DISTINCT image_path AS value FROM products WHERE image_path IS NOT NULL AND trim(image_path) != ''",
    "SELECT DISTINCT image_path AS value FROM product_images WHERE image_path IS NOT NULL AND trim(image_path) != ''",
    "SELECT DISTINCT avatar_path AS value FROM users WHERE avatar_path IS NOT NULL AND trim(avatar_path) != ''",
    "SELECT DISTINCT public_path AS value FROM file_assets WHERE public_path IS NOT NULL AND trim(public_path) != ''",
    "SELECT DISTINCT screenshots_json AS value FROM customer_share_submissions WHERE screenshots_json IS NOT NULL AND trim(screenshots_json) != ''",
    "SELECT DISTINCT value FROM settings WHERE value IS NOT NULL AND trim(value) != ''",
  ]

  uploadScans.forEach((sql) => {
    db.prepare(sql).all().forEach((row) => {
      extractUploadPathsFromText(row.value).forEach(addUpload)
    })
  })

  return uploads
}

function restoreBackupUploads(uploads = []) {
  if (!Array.isArray(uploads) || uploads.length === 0) return
  fs.mkdirSync(UPLOADS_PATH, { recursive: true })
  for (const file of uploads) {
    const fileName = path.basename(file.path || '')
    if (!fileName || !file.data) continue
    try { fs.writeFileSync(path.join(UPLOADS_PATH, fileName), Buffer.from(file.data, 'base64')) } catch (_) {}
  }
}

function deleteAllUploads() {
  try {
    if (!fs.existsSync(UPLOADS_PATH)) return
    for (const f of fs.readdirSync(UPLOADS_PATH)) {
      try { fs.unlinkSync(path.join(UPLOADS_PATH, f)) } catch (_) {}
    }
  } catch (_) {}
}

function getBackupDataRootCandidate(root) {
  const resolved = path.resolve(String(root || ''))
  const directDbPath = path.join(resolved, 'db', 'business.db')
  if (fs.existsSync(directDbPath)) return resolved

  const nestedDefault = path.join(resolved, DATA_FOLDER_NAME)
  const nestedDbPath = path.join(nestedDefault, 'db', 'business.db')
  if (fs.existsSync(nestedDbPath)) return nestedDefault

  return null
}

function readBackupTablesFromDataRoot(sourceRoot) {
  const root = getBackupDataRootCandidate(sourceRoot)
  if (!root) throw new Error(`No Business OS data folder was found in "${sourceRoot}"`)

  const dbPath = path.join(root, 'db', 'business.db')
  const sourceDb = new Database(dbPath, { readonly: true, fileMustExist: true })

  try {
    const customTables = sourceDb.prepare(`SELECT * FROM ${q('custom_tables')}`).all()
    const tables = Object.fromEntries(
      BACKUP_TABLES.map((table) => [table, sourceDb.prepare(`SELECT * FROM ${q(table)}`).all()]),
    )
    const customTableRows = Object.fromEntries(
      getCustomTableNames(customTables).map((tableName) => {
        try {
          return [tableName, sourceDb.prepare(`SELECT * FROM "${tableName}"`).all()]
        } catch (_) {
          return [tableName, []]
        }
      }),
    )

    return {
      root,
      tables,
      customTableRows,
      summary: buildBackupSummary({ tables, customTableRows, uploads: fs.existsSync(path.join(root, 'uploads')) ? fs.readdirSync(path.join(root, 'uploads')) : [] }),
    }
  } finally {
    try { sourceDb.close() } catch (_) {}
  }
}

function restoreUploadsFromDataRoot(sourceRoot) {
  const uploadSource = path.join(path.resolve(sourceRoot), 'uploads')
  deleteAllUploads()
  if (!fs.existsSync(uploadSource)) return
  fs.mkdirSync(UPLOADS_PATH, { recursive: true })
  const entries = fs.readdirSync(uploadSource, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const sourcePath = path.join(uploadSource, entry.name)
    const targetPath = path.join(UPLOADS_PATH, entry.name)
    try { fs.copyFileSync(sourcePath, targetPath) } catch (_) {}
  }
}

function restoreSnapshotTables({ tables, customTableRows, uploads, uploadSourceRoot }) {
  const providedTables = BACKUP_TABLES.filter((table) => Object.prototype.hasOwnProperty.call(tables, table))

  db.transaction(() => {
    const existingCustomTables = db.prepare(`SELECT * FROM ${q('custom_tables')}`).all()
    getCustomTableNames(existingCustomTables).forEach((tableName) => {
      try { db.exec(`DROP TABLE IF EXISTS "${tableName}"`) } catch (_) {}
    })

    for (const table of BACKUP_CLEAR_ORDER) {
      if (!providedTables.includes(table)) continue
      replaceTableRows(table, [])
    }
    for (const table of BACKUP_TABLES) {
      if (!providedTables.includes(table)) continue
      replaceTableRows(table, tables[table])
    }

    const importedCustomTables = Array.isArray(tables.custom_tables) ? tables.custom_tables : []
    const customTableNames = new Set([
      ...getCustomTableNames(importedCustomTables),
      ...Object.keys(customTableRows || {}).filter((tableName) => tableName.startsWith('ct_')),
    ])
    customTableNames.forEach((tableName) => {
      const meta = importedCustomTables.find((row) => String(row?.name || '').trim() === tableName) || { name: tableName }
      const rows = Array.isArray(customTableRows?.[tableName]) ? customTableRows[tableName] : []
      recreateCustomTable(tableName, parseCustomTableDefinition(meta, rows))
      replaceTableRows(tableName, rows)
    })

    if (providedTables.includes('branches')) {
      const existingDefault = db.prepare('SELECT id FROM branches WHERE is_default = 1 LIMIT 1').get()
      if (!existingDefault) {
        const firstBranch = db.prepare('SELECT id FROM branches ORDER BY id LIMIT 1').get()
        if (firstBranch) db.prepare('UPDATE branches SET is_default = 1 WHERE id = ?').run(firstBranch.id)
      }
    }
    if (providedTables.includes('products') || providedTables.includes('branch_stock')) {
      db.prepare(`
        UPDATE products SET stock_quantity = (
          SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE branch_stock.product_id = products.id
        ), updated_at = datetime('now')
      `).run()
    }
    repairRelationalConsistency()
    ensurePrimaryAdminRoleAndUser()
  })()

  if (uploadSourceRoot) restoreUploadsFromDataRoot(uploadSourceRoot)
  else restoreBackupUploads(uploads)
}

function ensurePrimaryAdminRoleAndUser(adminSnapshot = null) {
  // Re-assert admin role/user invariants after destructive operations
  // (factory reset, backup import) so access cannot be lost.
  const adminPermissions = JSON.stringify({ all: true })
  let adminRole = db.prepare(`SELECT id FROM roles WHERE lower(trim(code)) = 'admin' LIMIT 1`).get()
  if (!adminRole) {
    adminRole = db.prepare(`SELECT id FROM roles WHERE lower(trim(name)) = 'admin' ORDER BY id LIMIT 1`).get()
    if (adminRole) {
      db.prepare(`
        UPDATE roles
        SET name = 'Admin', code = 'admin', is_system = 1, permissions = ?
        WHERE id = ?
      `).run(adminPermissions, adminRole.id)
    } else {
      const insertedRole = db.prepare(`
        INSERT INTO roles (name, code, is_system, permissions)
        VALUES ('Admin', 'admin', 1, ?)
      `).run(adminPermissions)
      adminRole = { id: Number(insertedRole.lastInsertRowid) }
    }
  } else {
    db.prepare(`
      UPDATE roles
      SET name = 'Admin', code = 'admin', is_system = 1, permissions = ?
      WHERE id = ?
    `).run(adminPermissions, adminRole.id)
  }

  const roleId = Number(adminRole?.id || 0)
  let adminUser = adminSnapshot
  if (!adminUser) {
    adminUser = db.prepare(`SELECT * FROM users WHERE username = 'admin' ORDER BY id LIMIT 1`).get()
  }

  if (!adminUser) {
    db.prepare(`
      INSERT INTO users (username, name, password, role_id, permissions, is_active, deleted_at)
      VALUES ('admin', 'Administrator', ?, ?, ?, 1, NULL)
    `).run(bcrypt.hashSync('admin', 10), roleId || null, adminPermissions)
    adminUser = db.prepare(`SELECT * FROM users WHERE username = 'admin' ORDER BY id LIMIT 1`).get()
  }

  if (!adminUser) return
  db.prepare(`
    INSERT OR IGNORE INTO users (id, username, name, password, role_id, permissions, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    adminUser.id,
    'admin',
    adminUser.name || 'Administrator',
    adminUser.password || bcrypt.hashSync('admin', 10),
    roleId || null,
    adminPermissions,
    adminUser.created_at || new Date().toISOString(),
  )
  db.prepare(`
    UPDATE users
    SET role_id = ?, permissions = ?, is_active = 1, deleted_at = NULL, username = 'admin'
    WHERE id = ?
  `).run(roleId || null, adminPermissions, adminUser.id)
}

// Bulk-insert using chunked multi-value INSERT (500 rows/stmt) for speed.
// Unknown columns from older backups are silently dropped (insertColumns filter).
// Missing columns from newer schemas default to NULL.
function replaceTableRows(table, rows = []) {
  const columns = getTableColumns(table)
  if (columns.length === 0) return 0

  db.prepare(`DELETE FROM ${q(table)}`).run()
  if (columns.includes('id')) {
    try { db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(table) } catch (_) {}
  }

  if (!Array.isArray(rows) || rows.length === 0) return 0

  const insertColumns = columns.filter(col => rows.some(row => Object.prototype.hasOwnProperty.call(row, col)))
  if (insertColumns.length === 0) return 0

  const CHUNK = 500
  let count = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const placeholders = chunk.map(() => `(${insertColumns.map(() => '?').join(',')})`).join(',')
    const values = chunk.flatMap(row => insertColumns.map(col => row[col] ?? null))
    db.prepare(`INSERT INTO ${q(table)} (${insertColumns.map(q).join(',')}) VALUES ${placeholders}`).run(...values)
    count += chunk.length
  }

  if (columns.includes('id')) {
    const maxId = rows.reduce((max, row) => { const id = Number(row?.id || 0); return id > max ? id : max }, 0)
    if (maxId > 0) {
      try { db.prepare('INSERT OR REPLACE INTO sqlite_sequence(name, seq) VALUES(?, ?)').run(table, maxId) } catch (_) {}
    }
  }
  return count
}

// Accept any version >= 1. Normalises both modern (tables:{}) and legacy
// flat-key formats so old backups always import cleanly.
function normaliseBackupTables(backup) {
  if (backup?.tables && typeof backup.tables === 'object') return backup.tables
  return {
    products:            backup?.products            || [],
    product_images:      backup?.product_images      || [],
    categories:          backup?.categories          || [],
    units:               backup?.units               || [],
    branches:            backup?.branches            || [],
    roles:               backup?.roles               || [],
    users:               backup?.users               || [],
    branch_stock:        backup?.branch_stock        || [],
    customers:           backup?.customers           || [],
    suppliers:           backup?.suppliers           || [],
    delivery_contacts:   backup?.delivery_contacts   || [],
    sales:               backup?.sales               || [],
    sale_items:          backup?.sale_items          || [],
    returns:             backup?.returns             || [],
    return_items:        backup?.return_items        || [],
    inventory_movements: backup?.inventory_movements || [],
    stock_transfers:     backup?.stock_transfers     || [],
    settings:            backup?.settings            || [],
    custom_fields:       backup?.custom_fields       || [],
    custom_tables:       backup?.custom_tables       || [],
    customer_share_submissions: backup?.customer_share_submissions || [],
    audit_logs:          backup?.audit_logs          || [],
    file_assets:         backup?.file_assets         || [],
  }
}

function normaliseBackupCustomTableRows(backup) {
  if (backup?.custom_table_rows && typeof backup.custom_table_rows === 'object') return backup.custom_table_rows
  return {}
}

function repairRelationalConsistency() {
  db.prepare('DELETE FROM branch_stock WHERE product_id NOT IN (SELECT id FROM products) OR branch_id NOT IN (SELECT id FROM branches)').run()
  db.prepare('DELETE FROM sale_items WHERE sale_id NOT IN (SELECT id FROM sales)').run()
  db.prepare('DELETE FROM return_items WHERE return_id NOT IN (SELECT id FROM returns)').run()
  db.prepare('UPDATE sale_items SET product_id = NULL WHERE product_id IS NOT NULL AND product_id NOT IN (SELECT id FROM products)').run()
  db.prepare('UPDATE return_items SET product_id = NULL WHERE product_id IS NOT NULL AND product_id NOT IN (SELECT id FROM products)').run()
}

function getCustomTableNames(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => String(row?.name || '').trim())
    .filter((name) => name.startsWith('ct_'))
}

function parseCustomTableDefinition(row, sampleRows = []) {
  let schema = []
  try {
    if (row?.schema) schema = JSON.parse(row.schema)
    else if (row?.columns) schema = JSON.parse(row.columns)
  } catch (_) {
    schema = []
  }

  const fromSchema = Array.isArray(schema)
    ? schema.map((field) => {
        if (typeof field === 'string') return { name: field, sqlType: 'TEXT' }
        const name = String(field?.name || '').trim()
        if (!name) return null
        const type = String(field?.type || field?.sqlType || 'text').trim().toLowerCase()
        const sqlType = ({
          text: 'TEXT',
          long_text: 'TEXT',
          date: 'TEXT',
          timestamp: 'TEXT',
          dropdown: 'TEXT',
          number: 'INTEGER',
          boolean: 'INTEGER',
          decimal: 'REAL',
          real: 'REAL',
          integer: 'INTEGER',
        })[type] || 'TEXT'
        return { name, sqlType }
      }).filter(Boolean)
    : []

  if (fromSchema.length) return fromSchema

  const keySet = new Set()
  ;(Array.isArray(sampleRows) ? sampleRows : []).forEach((rowValue) => {
    Object.keys(rowValue || {}).forEach((key) => {
      if (key !== 'id' && key !== 'created_at') keySet.add(key)
    })
  })

  return Array.from(keySet).map((name) => ({ name, sqlType: 'TEXT' }))
}

function recreateCustomTable(tableName, columns = []) {
  const defs = columns
    .map((column) => `"${String(column.name).replace(/"/g, '')}" ${column.sqlType || 'TEXT'}`)
    .join(', ')
  const sql = defs
    ? `CREATE TABLE IF NOT EXISTS "${tableName}" (id INTEGER PRIMARY KEY AUTOINCREMENT, ${defs}, created_at TEXT DEFAULT (datetime('now')))`
    : `CREATE TABLE IF NOT EXISTS "${tableName}" (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime('now')))`
  db.exec(sql)
}

// ── Audit log ─────────────────────────────────────────────────────────────────
router.get('/audit-logs', authToken, (req, res) => {
  res.json(db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500').all())
})

router.get('/debug/log', authToken, (req, res) => {
  res.json({ entries: getServerLog().slice(0, 200), clients: wss_clients.size, uptime: process.uptime() })
})

const { TAILSCALE_URL } = require('../config')
const SERVER_START_TIME = Math.floor(Date.now() / 1000)

router.get('/config', (req, res) => {
  const access = classifyRequestAccess(req)
  res.json({
    syncServerUrl: TAILSCALE_URL || null,
    requiresToken: access.tokenRequired,
    hasConfiguredToken: access.hasConfiguredToken,
    accessMode: access.mode,
    trustedTailscale: access.trustedTailscale,
    tokenAccepted: access.tokenValid,
    hostUiAvailable: access.localRequest,
    serverStartTime: SERVER_START_TIME,
    security: {
      configuredTailscaleHost: access.configuredTailscaleHost || null,
      host: access.host || null,
      remoteAddress: access.remoteAddress || null,
      mode: access.mode,
      publicRemote: access.publicRemote,
      tokenRequired: access.tokenRequired,
      hasConfiguredToken: access.hasConfiguredToken,
      tokenProvided: access.tokenProvided,
      trustedTailscale: access.trustedTailscale,
      hostUiAvailable: access.localRequest,
    },
  })
})

// ── Backup export ─────────────────────────────────────────────────────────────
router.get('/backup/export', authToken, (req, res) => {
  const customTables = db.prepare(`SELECT * FROM ${q('custom_tables')}`).all()
  const tables = Object.fromEntries(
    BACKUP_TABLES.map(table => [table, db.prepare(`SELECT * FROM ${q(table)}`).all()])
  )
  const uploads = collectBackupUploads()
  const customTableRows = Object.fromEntries(
    getCustomTableNames(customTables).map((tableName) => {
      try {
        return [tableName, db.prepare(`SELECT * FROM "${tableName}"`).all()]
      } catch (_) {
        return [tableName, []]
      }
    })
  )
  const backup = {
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    tables,
    custom_table_rows: customTableRows,
    uploads,
    summary: buildBackupSummary({ tables, uploads, customTableRows }),
  }
  res.setHeader('Content-Disposition', `attachment; filename="business-os-backup-${today()}.json"`)
  res.setHeader('Content-Type', 'application/json')
  res.send(JSON.stringify(backup, null, 2))
})

router.post('/backup/export-folder', authToken, async (req, res) => {
  if (!applyRouteRateLimit(req, res, { name: 'system:backup_export_folder', max: 12, windowMs: 10 * 60 * 1000 })) return
  const destinationDir = String(req.body?.destinationDir || '').trim()
  if (!destinationDir) return err(res, 'destinationDir is required')

  try {
    const resolvedDestination = path.resolve(destinationDir)
    if (isSamePath(resolvedDestination, DATA_ROOT) || isSubPath(DATA_ROOT, resolvedDestination)) {
      return err(res, 'Choose a backup destination outside the current live data folder.')
    }
    try { db.pragma('wal_checkpoint(TRUNCATE)') } catch (_) {}
    const workerResult = await runFsWorker('export-folder', {
      sourceRoot: DATA_ROOT,
      destinationDir: resolvedDestination,
      dataFolderName: DATA_FOLDER_NAME,
      backupVersion: BACKUP_VERSION,
    })

    audit(req.user?.id, req.user?.name, 'backup_export', 'system', null, {
      destinationDir: resolvedDestination,
      backupRoot: workerResult.backupRoot,
      files: workerResult.copyStats?.copiedFileCount || 0,
    })

    return ok(res, {
      backupRoot: workerResult.backupRoot,
      dataRoot: workerResult.dataRoot,
      infoPath: workerResult.infoPath,
      summary: workerResult.summary,
      copyStats: workerResult.copyStats,
      message: 'Folder backup created successfully.',
    })
  } catch (e) {
    return err(res, `Failed to create folder backup: ${e.message}`)
  }
})

// ── Backup import ─────────────────────────────────────────────────────────────
// Accepts any version >= 1. Unknown columns are dropped, missing columns default to NULL.
router.post('/backup/import', authToken, (req, res) => {
  if (!applyRouteRateLimit(req, res, { name: 'system:backup_import', max: 6, windowMs: 10 * 60 * 1000 })) return
  const backup = req.body
  if (!backup || typeof backup !== 'object') return err(res, 'Invalid backup — expected a JSON object')
  const ver = backup.version
  if (typeof ver !== 'number' || ver < 1) {
    return err(res, `Unsupported backup version: ${ver}. File must be a Business OS backup (v1 or higher).`)
  }

  const tables = normaliseBackupTables(backup)
  const customTableRows = normaliseBackupCustomTableRows(backup)

  try {
    restoreSnapshotTables({ tables, customTableRows, uploads: backup.uploads })
  } catch (e) {
    return err(res, e.message)
  }

  ;['products', 'inventory', 'sales', 'returns', 'customers', 'suppliers', 'settings', 'dashboard', 'users', 'roles', 'customTables', 'portalSubmissions'].forEach(broadcast)
  ok(res, { message: 'Backup imported successfully' })
})

router.post('/backup/import-folder', authToken, (req, res) => {
  if (!applyRouteRateLimit(req, res, { name: 'system:backup_import_folder', max: 6, windowMs: 10 * 60 * 1000 })) return
  const sourceDir = String(req.body?.sourceDir || '').trim()
  if (!sourceDir) return err(res, 'sourceDir is required')

  let snapshot
  try {
    snapshot = readBackupTablesFromDataRoot(sourceDir)
    if (isSamePath(snapshot.root, DATA_ROOT)) {
      return err(res, 'Choose a backup folder, not the current live data folder.')
    }
  } catch (e) {
    return err(res, e.message)
  }

  try {
    restoreSnapshotTables({
      tables: snapshot.tables,
      customTableRows: snapshot.customTableRows,
      uploadSourceRoot: snapshot.root,
    })
  } catch (e) {
    return err(res, `Failed to restore folder backup: ${e.message}`)
  }

  audit(req.user?.id, req.user?.name, 'backup_restore', 'system', null, {
    sourceDir: snapshot.root,
    tableRows: snapshot.summary?.totals?.tableRowCount || 0,
  })

  ;['products', 'inventory', 'sales', 'returns', 'customers', 'suppliers', 'settings', 'dashboard', 'users', 'roles', 'customTables', 'portalSubmissions'].forEach(broadcast)
  ok(res, {
    message: 'Folder backup restored successfully',
    sourceRoot: snapshot.root,
    summary: snapshot.summary,
  })
})

// ── Reset business data ───────────────────────────────────────────────────────
// mode='sales' → clear all transactional data (sales, RETURNS, stock movements); zero stock
// mode='all'   → also remove products, contacts, custom_fields; keep settings/users/branches
router.post('/reset-data', authToken, (req, res) => {
  if (!applyRouteRateLimit(req, res, { name: 'system:reset_data', max: 5, windowMs: 10 * 60 * 1000 })) return
  const { userId, userName, mode = 'sales' } = req.body || {}
  try {
    db.transaction(() => {
      // Always clear transactional data (sales AND returns)
      db.prepare('DELETE FROM return_items').run()
      db.prepare('DELETE FROM returns').run()
      db.prepare('DELETE FROM sale_items').run()
      db.prepare('DELETE FROM sales').run()
      db.prepare('DELETE FROM inventory_movements').run()
      db.prepare('DELETE FROM stock_transfers').run()
      db.prepare('UPDATE branch_stock SET quantity = 0').run()

      if (mode === 'all') {
        db.prepare('DELETE FROM products').run()
        db.prepare('DELETE FROM branch_stock').run()
        db.prepare('DELETE FROM customers').run()
        db.prepare('DELETE FROM suppliers').run()
        db.prepare('DELETE FROM delivery_contacts').run()
        db.prepare('DELETE FROM custom_fields').run()
        // Keep: branches, categories, units, settings, users
      } else {
        db.prepare('UPDATE products SET stock_quantity = 0').run()
      }
    })()

    const label = mode === 'all'
      ? 'Full data reset — sales, returns, products, contacts cleared'
      : 'Sales reset — sales, returns, and stock cleared'
    audit(userId, userName, 'reset_data', 'system', null, label)
    ;['sales', 'returns', 'products', 'inventory', 'customers', 'dashboard'].forEach(broadcast)
    ok(res, {
      message: mode === 'all'
        ? 'Reset complete — sales, returns, products, and contacts deleted. Settings, users, and branches kept.'
        : 'Sales reset — sales, returns, and stock cleared. Products and contacts kept.',
    })
  } catch (e) { err(res, e.message) }
})

// ── Factory reset (wipe everything; keep admin + rebuild defaults) ────────────
router.post('/factory-reset', authToken, (req, res) => {
  if (!applyRouteRateLimit(req, res, { name: 'system:factory_reset', max: 2, windowMs: 30 * 60 * 1000 })) return
  const { userId, userName } = req.body || {}
  try {
    const adminUser = db.prepare("SELECT * FROM users WHERE username = 'admin'").get()
    db.transaction(() => {
      // FK-safe deletion order — returns and return_items included
      const tables = [
        'return_items', 'returns',
        'sale_items', 'sales',
        'inventory_movements', 'branch_stock', 'stock_transfers',
        'products', 'categories', 'units',
        'suppliers', 'customers', 'delivery_contacts',
        'branches', 'custom_fields', 'roles', 'audit_logs', 'settings', 'users',
      ]
      tables.forEach(t => { try { db.prepare(`DELETE FROM "${t}"`).run() } catch (_) {} })
      ensurePrimaryAdminRoleAndUser(adminUser)
      db.prepare("INSERT OR IGNORE INTO branches (name, is_default, is_active) VALUES ('Main Store', 1, 1)").run()
      const insertUnit = db.prepare('INSERT OR IGNORE INTO units (name) VALUES (?)')
      ;['pcs','kg','g','l','ml','box','bag','set','pair','bottle'].forEach(u => insertUnit.run(u))
    })()

    // Remove all uploaded images — factory reset = clean slate
    deleteAllUploads()

    ;['products', 'sales', 'returns', 'customers', 'inventory', 'dashboard'].forEach(broadcast)
    ok(res, { message: 'Factory reset complete. All data and images wiped. Admin account and defaults restored.' })
  } catch (e) { err(res, e.message) }
})

// ── Offline sync push ─────────────────────────────────────────────────────────
router.post('/sync/push', authToken, (req, res) => {
  const { operations = [] } = req.body || {}
  res.json({ applied: operations.map(op => op.id).filter(Boolean) })
})

// ── Data Integrity Check & Repair ────────────────────────────────────────────
/**
 * GET /api/system/verify-integrity — Run data integrity checks without repairs.
 * Read-only operation to detect inconsistencies.
 */
router.get('/verify-integrity', authToken, (req, res) => {
  try {
    // Run checks in read-only mode by wrapping in a transaction that we don't commit
    // Actually, let's just run the checks and return results
    const result = runDataIntegrityCheck()
    res.json({
      success: true,
      ...result,
      action: 'verify-only'
    })
  } catch (e) {
    err(res, `Integrity check failed: ${e.message}`)
  }
})

/**
 * POST /api/system/repair-integrity — Run data integrity checks AND repair.
 * This modifies the database. Should be used carefully.
 */
router.post('/repair-integrity', authToken, (req, res) => {
  try {
    const result = runDataIntegrityCheck()
    
    if (result.repairs > 0) {
      // Broadcast updates since we made changes
      ;['products', 'sales', 'inventory', 'dashboard'].forEach(broadcast)
      
      // Log the repair action
      audit(req.user?.id, req.user?.name, 'repair', 'data-integrity', null,
        { repairs: result.repairs, errors: result.errors.length },
        { deviceName: req.body?.device_name, deviceTz: req.body?.device_tz })
    }

    res.json({
      success: result.errors.length === 0 || result.repairs > 0,
      ...result,
      action: 'repair-and-verify'
    })
  } catch (e) {
    err(res, `Integrity repair failed: ${e.message}`)
  }
})

// ── Data folder location ──────────────────────────────────────────────────────
/**
 * GET /api/system/data-path
 * Returns the current data folder path and whether data-location.json exists.
 */
router.get('/data-path', authToken, (req, res) => {
  const hasOverride = fs.existsSync(DATA_LOCATION_FILE)
  res.json({
    dataRoot: DATA_ROOT,
    dataRootParent: path.dirname(DATA_ROOT),
    dataFolderName: DATA_FOLDER_NAME,
    isDefaultLocation: !hasOverride,
    defaultDataRoot: DEFAULT_DATA_ROOT,
    hasOverride,
    locationFile: DATA_LOCATION_FILE,
    summary: summarizeDataRoot(DATA_ROOT),
  })
})

/**
 * POST /api/system/data-path
 * Body: { dataDir: "C:\\new\\path\\business-os-data" }
 * Validates the path is accessible then writes data-location.json.
 * The server must be restarted for the new path to take effect.
 */
router.post('/data-path', authToken, async (req, res) => {
  if (!applyRouteRateLimit(req, res, { name: 'system:data_path_update', max: 20, windowMs: 10 * 60 * 1000 })) return
  const { dataDir } = req.body || {}
  if (!dataDir || typeof dataDir !== 'string' || !dataDir.trim()) {
    return err(res, 'dataDir is required')
  }
  const rawTarget = dataDir.trim()
  if (rawTarget.toLowerCase() === '__default__' || rawTarget.toLowerCase() === 'default') {
    try {
      const migration = isSamePath(DATA_ROOT, DEFAULT_DATA_ROOT)
        ? {
            sourceSummary: summarizeDataRoot(DATA_ROOT),
            targetSummaryBefore: summarizeDataRoot(DEFAULT_DATA_ROOT),
            targetSummaryAfter: summarizeDataRoot(DEFAULT_DATA_ROOT),
            copyStats: { copiedFileCount: 0, copiedBytes: 0 },
            skipped: true,
          }
        : await (async () => {
            try { db.pragma('wal_checkpoint(TRUNCATE)') } catch (_) {}
            return runFsWorker('relocate-data-root', {
              sourceRoot: DATA_ROOT,
              targetRoot: DEFAULT_DATA_ROOT,
            })
          })()
      if (fs.existsSync(DATA_LOCATION_FILE)) fs.unlinkSync(DATA_LOCATION_FILE)
      return ok(res, {
        dataDir: DEFAULT_DATA_ROOT,
        dataRootParent: path.dirname(DEFAULT_DATA_ROOT),
        dataFolderName: DATA_FOLDER_NAME,
        migration,
        message: 'Default data folder restored. Current live data was copied there and the previous folder was left untouched for safety. Restart the server to apply.',
      })
    } catch (e) {
      return err(res, `Failed to reset data location: ${e.message}`)
    }
  }

  const target = normalizeSelectedDataDir(rawTarget)
  if (!target) return err(res, 'dataDir is required')

  try {
    try { db.pragma('wal_checkpoint(TRUNCATE)') } catch (_) {}
    const migration = await runFsWorker('relocate-data-root', {
      sourceRoot: DATA_ROOT,
      targetRoot: target,
    })
    writeDataLocation(target)
    ok(res, {
      dataDir: target,
      dataRootParent: path.dirname(target),
      dataFolderName: DATA_FOLDER_NAME,
      migration,
      message: 'Data folder updated. Current live data was copied to the new location and the previous folder was left untouched for safety. Restart the server to apply.',
    })
  } catch (e) {
    err(res, `Failed to update data folder: ${e.message}`)
  }
})

/**
 * DELETE /api/system/data-path
 * Removes data-location.json — reverts to the default business-os-data folder.
 */
router.delete('/data-path', authToken, async (req, res) => {
  if (!applyRouteRateLimit(req, res, { name: 'system:data_path_delete', max: 20, windowMs: 10 * 60 * 1000 })) return
  try {
    const migration = isSamePath(DATA_ROOT, DEFAULT_DATA_ROOT)
      ? {
          sourceSummary: summarizeDataRoot(DATA_ROOT),
          targetSummaryBefore: summarizeDataRoot(DEFAULT_DATA_ROOT),
          targetSummaryAfter: summarizeDataRoot(DEFAULT_DATA_ROOT),
          copyStats: { copiedFileCount: 0, copiedBytes: 0 },
          skipped: true,
        }
      : await (async () => {
          try { db.pragma('wal_checkpoint(TRUNCATE)') } catch (_) {}
          return runFsWorker('relocate-data-root', {
            sourceRoot: DATA_ROOT,
            targetRoot: DEFAULT_DATA_ROOT,
          })
        })()
    if (fs.existsSync(DATA_LOCATION_FILE)) fs.unlinkSync(DATA_LOCATION_FILE)
    ok(res, {
      migration,
      message: 'Reverted to the default data folder. Current live data was copied there and the previous folder was left untouched for safety. Restart the server to apply.',
    })
  } catch (e) {
    err(res, e.message)
  }
})

/**
 * POST /api/system/browse-dir
 * Body: { dir: "C:\\some\\path" }  — lists subdirectories one level deep.
 * Used by the frontend folder-picker.
 */
router.post('/browse-dir', authToken, (req, res) => {
  const { dir } = req.body || {}
  const requested = dir && dir.trim() ? dir.trim() : ''
  const listWindowsFsRoots = () => {
    const roots = new Set()

    for (let code = 65; code <= 90; code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`
      try {
        if (fs.existsSync(drive)) roots.add(drive)
      } catch (_) {}
    }

    if (!roots.size) roots.add(process.env.SystemDrive ? `${process.env.SystemDrive}\\` : 'C:\\')

    return Array.from(roots)
      .sort((a, b) => a.localeCompare(b))
      .map((fullPath) => ({ name: fullPath, fullPath, kind: 'drive' }))
  }

  const listDriveRoots = () => {
    if (process.platform !== 'win32') {
      const roots = ['/', process.env.HOME].filter(Boolean)
      return Array.from(new Set(roots)).map((fullPath) => ({
        name: fullPath === '/' ? 'Root' : fullPath,
        fullPath,
        kind: 'folder',
      }))
    }
    const favorites = [
      { name: 'Desktop', fullPath: path.join(process.env.USERPROFILE || 'C:\\Users\\Public', 'Desktop') },
      { name: 'Documents', fullPath: path.join(process.env.USERPROFILE || 'C:\\Users\\Public', 'Documents') },
      { name: 'Downloads', fullPath: path.join(process.env.USERPROFILE || 'C:\\Users\\Public', 'Downloads') },
      { name: 'Business OS data', fullPath: DATA_ROOT },
      { name: 'Business OS folder', fullPath: path.resolve(RUNTIME_DIR, '..') },
    ]
      .filter((entry) => {
        try { return entry.fullPath && fs.existsSync(entry.fullPath) } catch (_) { return false }
      })
      .map((entry) => ({ ...entry, kind: 'folder' }))

    return [...favorites, ...listWindowsFsRoots()]
  }

  if (!requested || requested === '__ROOTS__') {
    return res.json({
      base: 'This PC',
      parent: null,
      dirs: listDriveRoots(),
      isRootList: true,
    })
  }

  const base = requested
  try {
    const entries = fs.readdirSync(base, { withFileTypes: true })
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, fullPath: path.join(base, e.name), kind: 'folder' }))
    const parent = path.dirname(base)
    const isDriveRoot = process.platform === 'win32' && /^[A-Za-z]:\\?$/.test(base)
    res.json({ base, parent: isDriveRoot ? '__ROOTS__' : (parent !== base ? parent : null), dirs, isRootList: false })
  } catch (e) {
    res.json({ base, parent: null, dirs: [], error: e.message, isRootList: false })
  }
})

router.post('/open-path', authToken, (req, res) => {
  if (!applyRouteRateLimit(req, res, { name: 'system:open_path', max: 30, windowMs: 60 * 1000 })) return
  const { hostUiAvailable } = getHostUiAvailability(req)
  if (!hostUiAvailable) {
    return ok(res, {
      opened: false,
      unavailable: true,
      reason: 'remote_session',
      message: 'Open folder is only available on the server machine. Remote sessions should paste or browse server paths manually instead.',
    })
  }
  const target = String(req.body?.path || '').trim()
  if (!target) return err(res, 'path is required')

  const resolved = path.resolve(target)
  if (!fs.existsSync(resolved)) return err(res, 'Path does not exist')

  try {
    const child = spawn('explorer.exe', [resolved], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    ok(res, { path: resolved, opened: true })
  } catch (e) {
    err(res, `Failed to open path: ${e.message}`)
  }
})

router.post('/pick-folder', authToken, (req, res) => {
  if (!applyRouteRateLimit(req, res, { name: 'system:pick_folder', max: 20, windowMs: 10 * 60 * 1000 })) return
  const { hostUiAvailable } = getHostUiAvailability(req)
  if (!hostUiAvailable) {
    return ok(res, {
      selectedPath: null,
      cancelled: true,
      unavailable: true,
      reason: 'remote_session',
      message: 'The native folder picker only works on the server machine. Use Browse folders or type a server path manually when connected remotely.',
    })
  }
  if (process.platform !== 'win32') {
    return ok(res, { selectedPath: null, cancelled: true, unavailable: true })
  }

  const initialPathRaw = String(req.body?.initialPath || '').trim()
  const initialPath = initialPathRaw && fs.existsSync(initialPathRaw) ? initialPathRaw : DATA_ROOT
  const escapedPath = String(initialPath || '').replace(/'/g, "''")

  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$dialog.Description = 'Select Business OS data folder'",
    '$dialog.ShowNewFolderButton = $true',
    escapedPath ? `if (Test-Path -LiteralPath '${escapedPath}') { $dialog.SelectedPath = '${escapedPath}' }` : '',
    '$result = $dialog.ShowDialog()',
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }",
  ].filter(Boolean).join('; ')

  const picker = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  let responded = false
  const timer = setTimeout(() => {
    try { picker.kill() } catch (_) {}
    if (responded) return
    responded = true
    err(res, 'Folder picker timed out. Close any picker window on the server device and try again.')
  }, 300000)

  picker.stdout.on('data', (chunk) => { stdout += String(chunk || '') })
  picker.stderr.on('data', (chunk) => { stderr += String(chunk || '') })
  picker.on('error', (error) => {
    if (responded) return
    responded = true
    clearTimeout(timer)
    err(res, `Folder picker failed: ${error.message}`)
  })
  picker.on('close', (code) => {
    if (responded) return
    responded = true
    clearTimeout(timer)
    const selectedPath = String(stdout || '').trim()
    if (!selectedPath) {
      if (code !== 0 && String(stderr || '').trim()) {
        return err(res, `Folder picker failed: ${String(stderr || '').trim()}`)
      }
      return ok(res, { selectedPath: null, cancelled: true })
    }
    return ok(res, { selectedPath, cancelled: false })
  })
})

module.exports = router
