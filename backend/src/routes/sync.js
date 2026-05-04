'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const express = require('express')
const { PORT, STORAGE_ROOT } = require('../config')
const { authToken, routeRateLimit, validateUploadBufferPayload } = require('../middleware')
const { getCloudflareAccessDiagnostics } = require('../serverUtils')

const router = express.Router()
const CHUNK_SIZE_BYTES = 1024 * 1024
const MAX_SYNC_OPERATIONS = Math.max(1, Number(process.env.SYNC_OUTBOX_MAX_OPERATIONS || 50))
const SYNC_CHUNKS_DIR = path.join(STORAGE_ROOT, 'sync-upload-chunks')

const OUTBOX_OPERATION_MAP = {
  'products.create': { method: 'POST', path: '/api/products' },
  'products.update': { method: 'PUT', path: (operation) => `/api/products/${encodeURIComponent(operation.entity_id || operation.payload?.id || '')}` },
  'products.delete': { method: 'DELETE', path: (operation) => `/api/products/${encodeURIComponent(operation.entity_id || operation.payload?.id || '')}` },
  'products.variant.create': { method: 'POST', path: (operation) => `/api/products/${encodeURIComponent(operation.payload?.product_id || operation.entity_id || '')}/variants` },
  'products.discount.update': { method: 'POST', path: (operation) => `/api/products/${encodeURIComponent(operation.entity_id || operation.payload?.product_id || '')}/discounts` },
  'inventory.adjust': { method: 'POST', path: '/api/inventory/adjustments' },
  'inventory.transfer': { method: 'POST', path: '/api/transfers' },
  'branches.create': { method: 'POST', path: '/api/branches' },
  'branches.update': { method: 'PUT', path: (operation) => `/api/branches/${encodeURIComponent(operation.entity_id || operation.payload?.id || '')}` },
  'categories.create': { method: 'POST', path: '/api/categories' },
  'categories.update': { method: 'PUT', path: (operation) => `/api/categories/${encodeURIComponent(operation.entity_id || operation.payload?.id || '')}` },
  'units.create': { method: 'POST', path: '/api/units' },
  'units.update': { method: 'PUT', path: (operation) => `/api/units/${encodeURIComponent(operation.entity_id || operation.payload?.id || '')}` },
  'contacts.customers.create': { method: 'POST', path: '/api/customers' },
  'contacts.customers.update': { method: 'PUT', path: (operation) => `/api/customers/${encodeURIComponent(operation.entity_id || operation.payload?.id || '')}` },
  'contacts.suppliers.create': { method: 'POST', path: '/api/suppliers' },
  'contacts.suppliers.update': { method: 'PUT', path: (operation) => `/api/suppliers/${encodeURIComponent(operation.entity_id || operation.payload?.id || '')}` },
  'sales.create': { method: 'POST', path: '/api/sales' },
  'returns.create': { method: 'POST', path: '/api/returns' },
  'settings.update': { method: 'POST', path: '/api/settings' },
  'portal.content.update': { method: 'POST', path: '/api/portal/content' },
  'files.upload': { method: 'POST', path: '/api/files' },
  dangerous: { onlineOnly: true },
  'users.update': { onlineOnly: true },
  'roles.update': { onlineOnly: true },
  'backup.restore': { onlineOnly: true },
  'backup.reset': { onlineOnly: true },
  'google.oauth': { onlineOnly: true },
}

function stableStringify(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function verifyOperationDigest(operation = {}) {
  const expected = String(operation.payload_digest || '').trim().toLowerCase()
  if (!expected) return false
  const payload = operation.encrypted_payload || operation.payload || {}
  return sha256(stableStringify(payload)) === expected
}

function normalizeOperation(raw = {}) {
  const operation_id = String(raw.operation_id || raw.type || '').trim()
  return {
    ...raw,
    operation_id,
    client_request_id: String(raw.client_request_id || raw.id || '').trim(),
    schema_version: Number(raw.schema_version || 0),
    base_updated_at: raw.base_updated_at == null ? null : String(raw.base_updated_at),
    payload_digest: String(raw.payload_digest || '').trim().toLowerCase(),
    payload: raw.payload && typeof raw.payload === 'object' ? raw.payload : {},
  }
}

function hasWriteConflict(operation = {}) {
  const base = String(operation.base_updated_at || '').trim()
  const server = String(operation.server_updated_at || operation.payload?.server_updated_at || '').trim()
  if (!base || !server) return false
  return base !== server
}

function buildReplayUrl(routePath) {
  return `http://127.0.0.1:${PORT}${routePath}`
}

async function replayOperation(req, operation, route) {
  if (route.onlineOnly) {
    return { status: 'rejected', code: 'online_only', error: 'This operation must be completed while online.' }
  }
  if (hasWriteConflict(operation)) {
    return { status: 'conflict', code: 'write_conflict', error: 'Server data changed after this offline edit was queued.' }
  }

  const routePath = typeof route.path === 'function' ? route.path(operation) : route.path
  if (!routePath || routePath.includes('%20') || routePath.endsWith('/')) {
    return { status: 'failed', code: 'invalid_operation_target', error: 'Operation target is incomplete.' }
  }

  const headers = {
    'content-type': 'application/json',
    'x-client-request-id': operation.client_request_id,
  }
  if (req.headers.cookie) headers.cookie = req.headers.cookie

  const response = await fetch(buildReplayUrl(routePath), {
    method: route.method,
    headers,
    body: ['GET', 'HEAD'].includes(route.method) ? undefined : JSON.stringify({
      ...operation.payload,
      client_request_id: operation.client_request_id,
      base_updated_at: operation.base_updated_at,
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (response.status === 409) {
    return { status: 'conflict', code: 'write_conflict', error: body?.error || 'Server data changed.' }
  }
  if (!response.ok) {
    return { status: 'failed', code: body?.code || 'replay_failed', error: body?.error || 'Offline replay failed.' }
  }
  return { status: 'applied', code: 'applied', response: body }
}

router.post('/outbox', authToken, routeRateLimit({
  name: 'sync-outbox',
  max: 30,
  windowMs: 60_000,
  message: 'Too many offline sync attempts.',
}), async (req, res) => {
  const operations = Array.isArray(req.body?.operations) ? req.body.operations.map(normalizeOperation) : []
  const maxOperations = MAX_SYNC_OPERATIONS
  if (!operations.length) {
    return res.json({ success: true, results: [], maxOperations, cloudflareAccess: getCloudflareAccessDiagnostics(req) })
  }
  if (operations.length > maxOperations) {
    return res.status(413).json({ success: false, code: 'too_many_operations', maxOperations, error: 'Sync batch is too large.' })
  }

  const results = []
  for (const operation of operations) {
    const route = OUTBOX_OPERATION_MAP[operation.operation_id]
    if (!route) {
      results.push({ client_request_id: operation.client_request_id, operation_id: operation.operation_id, status: 'rejected', code: 'unsupported_operation' })
      continue
    }
    if (!operation.client_request_id || !operation.schema_version || !operation.base_updated_at) {
      results.push({ client_request_id: operation.client_request_id, operation_id: operation.operation_id, status: 'rejected', code: 'invalid_operation_metadata' })
      continue
    }
    if (!verifyOperationDigest(operation)) {
      results.push({ client_request_id: operation.client_request_id, operation_id: operation.operation_id, status: 'rejected', code: 'payload_digest_failed' })
      continue
    }
    try {
      results.push({
        client_request_id: operation.client_request_id,
        operation_id: operation.operation_id,
        ...(await replayOperation(req, operation, route)),
      })
    } catch (error) {
      results.push({
        client_request_id: operation.client_request_id,
        operation_id: operation.operation_id,
        status: 'failed',
        code: 'transient_replay_error',
        error: error?.message || 'Offline replay failed.',
      })
    }
  }

  const hasConflict = results.some((result) => result.code === 'write_conflict')
  return res.status(hasConflict ? 409 : 200).json({
    success: !results.some((result) => ['failed', 'rejected', 'conflict'].includes(result.status)),
    results,
    maxOperations,
    cloudflareAccess: getCloudflareAccessDiagnostics(req),
  })
})

function getUploadDir(uploadId) {
  return path.join(SYNC_CHUNKS_DIR, String(uploadId || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 80))
}

function readManifest(uploadId) {
  return JSON.parse(fs.readFileSync(path.join(getUploadDir(uploadId), 'manifest.json'), 'utf8'))
}

router.post('/files/chunks/init', authToken, routeRateLimit({
  name: 'sync-file-init',
  max: 40,
  windowMs: 60_000,
  message: 'Too many file sync attempts.',
}), (req, res) => {
  const manifest = req.body?.manifest || req.body || {}
  const uploadId = String(manifest.upload_id || manifest.uploadId || '').trim()
  const size = Number(manifest.size || 0)
  const chunkCount = Number(manifest.chunk_count || manifest.chunkCount || 0)
  const fileHash = String(manifest.sha256 || '').trim().toLowerCase()
  if (!uploadId || !size || !chunkCount || !/^[a-f0-9]{64}$/.test(fileHash)) {
    return res.status(400).json({ success: false, code: 'invalid_manifest', error: 'File sync manifest is invalid.' })
  }
  if (Number(manifest.chunk_size || manifest.chunkSize || CHUNK_SIZE_BYTES) !== CHUNK_SIZE_BYTES) {
    return res.status(400).json({ success: false, code: 'invalid_chunk_size', chunkSize: CHUNK_SIZE_BYTES })
  }
  const dir = getUploadDir(uploadId)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ ...manifest, upload_id: uploadId, size, chunk_count: chunkCount, sha256: fileHash }, null, 2))
  return res.json({ success: true, uploadId, chunkSize: CHUNK_SIZE_BYTES })
})

router.post('/files/chunks/:uploadId/chunk', authToken, routeRateLimit({
  name: 'sync-file-chunk',
  max: 120,
  windowMs: 60_000,
  message: 'Too many file chunk sync attempts.',
}), (req, res) => {
  const uploadId = req.params.uploadId
  const chunkIndex = Number(req.body?.chunk_index ?? req.body?.chunkIndex ?? -1)
  const chunkSha256 = String(req.body?.chunk_sha256 || req.body?.chunkSha256 || '').trim().toLowerCase()
  const encoded = String(req.body?.chunk || req.body?.encrypted_chunk || '')
  if (chunkIndex < 0 || !/^[a-f0-9]{64}$/.test(chunkSha256) || !encoded) {
    return res.status(400).json({ success: false, code: 'invalid_chunk' })
  }
  const buffer = Buffer.from(encoded, 'base64')
  if (!buffer.length || buffer.length > CHUNK_SIZE_BYTES) {
    return res.status(413).json({ success: false, code: 'chunk_too_large', chunkSize: CHUNK_SIZE_BYTES })
  }
  if (sha256(buffer) !== chunkSha256) {
    return res.status(400).json({ success: false, code: 'chunk_hash_mismatch' })
  }
  const dir = getUploadDir(uploadId)
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) return res.status(404).json({ success: false, code: 'upload_not_found' })
  fs.writeFileSync(path.join(dir, `${chunkIndex}.chunk`), buffer)
  return res.json({ success: true, uploadId, chunkIndex })
})

router.post('/files/chunks/:uploadId/complete', authToken, routeRateLimit({
  name: 'sync-file-complete',
  max: 40,
  windowMs: 60_000,
  message: 'Too many file completion attempts.',
}), async (req, res) => {
  const uploadId = req.params.uploadId
  const manifest = readManifest(uploadId)
  const chunks = []
  for (let index = 0; index < Number(manifest.chunk_count || 0); index += 1) {
    const chunkPath = path.join(getUploadDir(uploadId), `${index}.chunk`)
    if (!fs.existsSync(chunkPath)) return res.status(409).json({ success: false, code: 'missing_chunk', chunkIndex: index })
    chunks.push(fs.readFileSync(chunkPath))
  }
  const buffer = Buffer.concat(chunks)
  if (buffer.length !== Number(manifest.size || 0) || sha256(buffer) !== String(manifest.sha256 || '').toLowerCase()) {
    return res.status(400).json({ success: false, code: 'file_hash_mismatch' })
  }
  await validateUploadBufferPayload(buffer, {
    originalname: manifest.file_name || manifest.fileName || 'offline-upload.bin',
    mimetype: manifest.mime || manifest.mime_type || manifest.mimeType || '',
  })
  return res.json({ success: true, uploadId, size: buffer.length, sha256: sha256(buffer) })
})

module.exports = router
