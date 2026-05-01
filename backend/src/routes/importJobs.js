'use strict'

const fs = require('fs')
const path = require('path')
const express = require('express')
const multer = require('multer')
const { IMPORTS_PATH, IMPORT_MAX_CSV_MB, IMPORT_MAX_ZIP_MB } = require('../config')
const { ok, err } = require('../helpers')
const { authToken, hasPermission, routeRateLimit, getAuditActor } = require('../middleware')
const { sanitizeOriginalFileName } = require('../fileAssets')
const {
  addJobFile,
  approveImportJob,
  buildErrorsCsv,
  cancelImportJob,
  createImportJob,
  deleteImportJob,
  enqueueImportJob,
  getImportJob,
  getJobErrors,
  getJobFiles,
  getQueueStatus,
  listImportJobs,
} = require('../services/importJobs')

const router = express.Router()
const ALLOWED_TYPES = new Set(['products', 'customers', 'suppliers', 'delivery_contacts', 'inventory', 'sales'])
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'])

function permissionForImportType(type) {
  const normalized = String(type || 'products').trim().toLowerCase()
  if (['customers', 'suppliers', 'delivery_contacts'].includes(normalized)) return 'contacts'
  if (normalized === 'inventory') return 'inventory'
  if (normalized === 'sales') return 'sales'
  return 'products'
}

function requireImportPermission(req, res, next) {
  const existingJob = req.params?.id ? getImportJob(req.params.id) : null
  const type = existingJob?.type || req.body?.type || req.query?.type || 'products'
  const permission = permissionForImportType(type)
  if (hasPermission(req.user, permission)) return next()
  return res.status(403).json({
    success: false,
    error: 'No permission',
    code: 'forbidden',
    permission,
  })
}

function hasAnyImportPermission(user) {
  return ['products', 'contacts', 'inventory', 'sales'].some((permission) => hasPermission(user, permission))
}

function requireAnyImportPermission(req, res, next) {
  if (hasAnyImportPermission(req.user)) return next()
  return res.status(403).json({
    success: false,
    error: 'No permission',
    code: 'forbidden',
    permission: 'imports',
  })
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function getJobUploadRoot(jobId) {
  const safeId = String(jobId || '').replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(IMPORTS_PATH, safeId, 'incoming')
}

function getJobOr404(req, res) {
  const job = getImportJob(req.params.id)
  if (!job) {
    err(res, 'Import job not found', 404)
    return null
  }
  return job
}

const storage = multer.diskStorage({
  destination(req, _file, cb) {
    try {
      const root = getJobUploadRoot(req.params.id || 'new')
      ensureDir(root)
      cb(null, root)
    } catch (error) {
      cb(error)
    }
  },
  filename(_req, file, cb) {
    try {
      const safe = sanitizeOriginalFileName(file.originalname || 'upload.bin')
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${safe}`)
    } catch (error) {
      cb(error)
    }
  },
})

function isAllowedImportFile(file) {
  const ext = path.extname(String(file?.originalname || '')).toLowerCase()
  const mime = String(file?.mimetype || '').toLowerCase()
  if (ext === '.csv' || ext === '.tsv' || mime === 'text/csv' || mime === 'text/tab-separated-values') return true
  if (ext === '.zip' || mime === 'application/zip' || mime === 'application/x-zip-compressed') return true
  return IMAGE_EXTENSIONS.has(ext) || mime.startsWith('image/')
}

const importUpload = multer({
  storage,
  limits: {
    fileSize: Math.max(IMPORT_MAX_ZIP_MB, IMPORT_MAX_CSV_MB) * 1024 * 1024,
    files: 200,
    fields: 220,
    parts: 450,
    fieldSize: 2 * 1024 * 1024,
    fieldNameSize: 160,
  },
  fileFilter(_req, file, cb) {
    if (isAllowedImportFile(file)) return cb(null, true)
    cb(new Error('Unsupported import file type. Upload CSV, TSV, ZIP, or image files.'))
  },
})

function parsePolicy(req) {
  const raw = req.body?.policy_json || req.body?.policy || '{}'
  if (raw && typeof raw === 'object') return raw
  try { return JSON.parse(String(raw || '{}')) } catch (_) { return {} }
}

function parseRelativePaths(req) {
  const raw = req.body?.relative_paths || req.body?.relativePaths || '[]'
  if (Array.isArray(raw)) return raw
  try {
    const parsed = JSON.parse(String(raw || '[]'))
    return Array.isArray(parsed) ? parsed : []
  } catch (_) {
    return []
  }
}

router.get('/queue/status', authToken, requireAnyImportPermission, (_req, res) => {
  ok(res, { queue: getQueueStatus() })
})

router.get('/', authToken, requireAnyImportPermission, (req, res) => {
  const jobs = listImportJobs({ limit: req.query?.limit || 50 })
    .filter((job) => hasPermission(req.user, permissionForImportType(job.type)))
  ok(res, { jobs })
})

router.post('/', authToken, requireImportPermission, routeRateLimit({ name: 'import_jobs:create', max: 30, windowMs: 15 * 60 * 1000, message: 'Too many import jobs.' }), (req, res) => {
  try {
    const type = String(req.body?.type || 'products').trim().toLowerCase()
    if (!ALLOWED_TYPES.has(type)) return err(res, 'Unsupported import job type')
    const actor = getAuditActor(req)
    const job = createImportJob({
      type,
      actor,
      policy: parsePolicy(req),
      queueDriver: getQueueStatus().driver || 'sqlite',
    })
    ok(res, { job })
  } catch (error) {
    err(res, error?.message || 'Failed to create import job')
  }
})

router.get('/:id', authToken, requireImportPermission, (req, res) => {
  const job = getJobOr404(req, res)
  if (!job) return
  ok(res, {
    job,
    files: getJobFiles(job.id).map((file) => ({
      id: file.id,
      kind: file.kind,
      original_name: file.original_name,
      relative_path: file.relative_path,
      byte_size: file.byte_size,
      status: file.status,
      error_message: file.error_message,
    })),
    errors: getJobErrors(job.id, { limit: 200 }),
  })
})

router.post('/:id/csv', authToken, requireImportPermission, importUpload.single('file'), (req, res) => {
  try {
    const job = getJobOr404(req, res)
    if (!job) return
    if (!req.file) return err(res, 'CSV file required')
    const ext = path.extname(String(req.file.originalname || '')).toLowerCase()
    if (ext !== '.csv' && ext !== '.tsv') return err(res, 'Upload a CSV or TSV file')
    const file = addJobFile(job.id, req.file, 'csv', req.file.originalname)
    ok(res, { file, job: getImportJob(job.id) })
  } catch (error) {
    err(res, error?.message || 'Failed to upload CSV')
  }
})

router.post('/:id/zip', authToken, requireImportPermission, importUpload.single('file'), (req, res) => {
  try {
    const job = getJobOr404(req, res)
    if (!job) return
    if (job.type !== 'products') return err(res, 'Image ZIP imports are only supported for products')
    if (!req.file) return err(res, 'ZIP file required')
    const ext = path.extname(String(req.file.originalname || '')).toLowerCase()
    if (ext !== '.zip') return err(res, 'Upload a ZIP file for images')
    const file = addJobFile(job.id, req.file, 'zip', req.file.originalname)
    ok(res, { file, job: getImportJob(job.id) })
  } catch (error) {
    err(res, error?.message || 'Failed to upload ZIP')
  }
})

router.post('/:id/images', authToken, requireImportPermission, importUpload.array('files', 200), (req, res) => {
  try {
    const job = getJobOr404(req, res)
    if (!job) return
    if (job.type !== 'products') return err(res, 'Image imports are only supported for products')
    const files = Array.isArray(req.files) ? req.files : []
    const relativePaths = parseRelativePaths(req)
    const saved = files.map((file, index) => addJobFile(job.id, file, 'image', relativePaths[index] || file.originalname))
    ok(res, { files: saved, job: getImportJob(job.id) })
  } catch (error) {
    err(res, error?.message || 'Failed to upload images')
  }
})

router.post('/:id/start', authToken, requireImportPermission, routeRateLimit({ name: 'import_jobs:start', max: 20, windowMs: 15 * 60 * 1000, message: 'Too many import starts.' }), async (req, res) => {
  try {
    const job = getJobOr404(req, res)
    if (!job) return
    if (!getJobFiles(job.id, 'csv').length) return err(res, 'Upload a CSV before starting the import')
    const queued = await enqueueImportJob(job.id, { mode: 'analyze' })
    ok(res, { job: queued, queue: getQueueStatus() })
  } catch (error) {
    err(res, error?.message || 'Failed to start import job')
  }
})

router.post('/:id/approve', authToken, requireImportPermission, routeRateLimit({ name: 'import_jobs:approve', max: 20, windowMs: 15 * 60 * 1000, message: 'Too many import approvals.' }), async (req, res) => {
  try {
    const job = getJobOr404(req, res)
    if (!job) return
    const queued = await approveImportJob(job.id)
    ok(res, { job: queued, queue: getQueueStatus() })
  } catch (error) {
    err(res, error?.message || 'Failed to approve import job')
  }
})

router.post('/:id/cancel', authToken, requireImportPermission, async (req, res) => {
  try {
    const job = getJobOr404(req, res)
    if (!job) return
    ok(res, { job: await cancelImportJob(job.id) })
  } catch (error) {
    err(res, error?.message || 'Failed to cancel import job')
  }
})

router.delete('/:id', authToken, requireImportPermission, async (req, res) => {
  try {
    const job = getJobOr404(req, res)
    if (!job) return
    ok(res, await deleteImportJob(job.id))
  } catch (error) {
    const status = error?.code === 'import_still_stopping' ? 409 : 400
    err(res, error?.message || 'Failed to remove import job', status)
  }
})

router.post('/:id/retry', authToken, requireImportPermission, async (req, res) => {
  try {
    const job = getJobOr404(req, res)
    if (!job) return
    const mode = ['awaiting_review', 'approved'].includes(String(job.status || '').toLowerCase()) ? 'apply' : 'analyze'
    const queued = mode === 'apply'
      ? await approveImportJob(job.id)
      : await enqueueImportJob(job.id, { mode: 'analyze' })
    ok(res, { job: queued, queue: getQueueStatus() })
  } catch (error) {
    err(res, error?.message || 'Failed to retry import job')
  }
})

router.get('/:id/errors.csv', authToken, requireImportPermission, (req, res) => {
  const job = getJobOr404(req, res)
  if (!job) return
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${job.id}-errors.csv"`)
  res.send(buildErrorsCsv(job.id))
})

module.exports = router
