'use strict'

/**
 * @typedef {{ id?: unknown, reason?: unknown, label?: unknown, ownerJobId?: unknown }} MaintenanceLockInput
 * @typedef {{ id: string, reason: string, label: string, ownerJobId: string, createdAt: string }} MaintenanceLock
 * @typedef {{ method?: unknown, originalUrl?: unknown, url?: unknown }} MaintenanceRequest
 * @typedef {{ status(code: number): { json(payload: Record<string, unknown>): unknown } }} JsonResponse
 */

let activeLock = null

/**
 * @returns {string}
 */
function nowIso() {
  return new Date().toISOString()
}

/**
 * @returns {MaintenanceLock | null}
 */
function getMaintenanceLock() {
  return activeLock ? { ...activeLock } : null
}

/**
 * @returns {boolean}
 */
function isMaintenanceLocked() {
  return !!activeLock
}

/**
 * @param {MaintenanceLockInput} [input]
 * @returns {MaintenanceLock}
 */
function acquireMaintenanceLock(input = {}) {
  if (activeLock) return { ...activeLock }
  activeLock = {
    id: String(input.id || `maintenance_${Date.now()}`),
    reason: String(input.reason || 'system_maintenance'),
    label: String(input.label || 'System maintenance is running'),
    ownerJobId: String(input.ownerJobId || ''),
    createdAt: nowIso(),
  }
  return { ...activeLock }
}

/**
 * @param {unknown} [id]
 * @returns {boolean}
 */
function releaseMaintenanceLock(id = '') {
  if (!activeLock) return false
  const safeId = String(id || '').trim()
  if (safeId && activeLock.id !== safeId && activeLock.ownerJobId !== safeId) return false
  activeLock = null
  return true
}

/**
 * @param {MaintenanceLockInput} input
 * @param {(lock: MaintenanceLock) => unknown | Promise<unknown>} worker
 * @returns {Promise<unknown>}
 */
function withMaintenanceLock(input, worker) {
  const lock = acquireMaintenanceLock(input)
  return Promise.resolve()
    .then(() => worker(lock))
    .finally(() => {
      releaseMaintenanceLock(lock.id)
    })
}

/**
 * @param {string} method
 * @returns {boolean}
 */
function isReadOnlyMethod(method) {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isMaintenanceWriteAllowed(path) {
  const allowedPrefixes = [
    '/api/auth/logout',
    '/api/system/jobs/',
    '/api/system/debug',
    '/api/system/config',
    '/api/system/drive-sync/status',
    '/api/backups',
    '/api/system/backups',
  ]
  for (const prefix of allowedPrefixes) {
    if (path.startsWith(prefix)) return true
  }
  return false
}

/**
 * @param {MaintenanceRequest} req
 * @param {JsonResponse} res
 * @param {() => unknown} next
 * @returns {unknown}
 */
function maintenanceWriteGuard(req, res, next) {
  if (!activeLock) return next()
  const method = String(req.method || 'GET').toUpperCase()
  if (isReadOnlyMethod(method)) return next()
  const path = String(req.originalUrl || req.url || '')
  if (isMaintenanceWriteAllowed(path)) return next()
  return res.status(423).json({
    success: false,
    code: 'system_busy',
    error: activeLock.label || 'System maintenance is running. Try again when it finishes.',
    maintenance: getMaintenanceLock(),
  })
}

module.exports = {
  acquireMaintenanceLock,
  getMaintenanceLock,
  isMaintenanceLocked,
  maintenanceWriteGuard,
  releaseMaintenanceLock,
  withMaintenanceLock,
}
