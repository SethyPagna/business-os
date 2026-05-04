'use strict'

let activeLock = null

function nowIso() {
  return new Date().toISOString()
}

function getMaintenanceLock() {
  return activeLock ? { ...activeLock } : null
}

function isMaintenanceLocked() {
  return !!activeLock
}

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

function releaseMaintenanceLock(id = '') {
  if (!activeLock) return false
  const safeId = String(id || '').trim()
  if (safeId && activeLock.id !== safeId && activeLock.ownerJobId !== safeId) return false
  activeLock = null
  return true
}

function withMaintenanceLock(input, worker) {
  const lock = acquireMaintenanceLock(input)
  return Promise.resolve()
    .then(() => worker(lock))
    .finally(() => {
      releaseMaintenanceLock(lock.id)
    })
}

function maintenanceWriteGuard(req, res, next) {
  if (!activeLock) return next()
  const method = String(req.method || 'GET').toUpperCase()
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return next()
  const path = String(req.originalUrl || req.url || '')
  const allowed = [
    '/api/auth/logout',
    '/api/system/jobs/',
    '/api/system/debug',
    '/api/system/config',
    '/api/system/drive-sync/status',
    '/api/backups',
    '/api/system/backups',
  ].some((prefix) => path.startsWith(prefix))
  if (allowed) return next()
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
