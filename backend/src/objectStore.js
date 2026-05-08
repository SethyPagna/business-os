'use strict'

const { Readable } = require('stream')
const http = require('http')
const https = require('https')
const fs = require('fs')
const {
  OBJECT_STORAGE_DRIVER,
  S3_ACCESS_KEY_ID,
  S3_BUCKET,
  S3_ENDPOINT,
  S3_REGION,
  S3_SECRET_ACCESS_KEY,
} = require('./config')

let s3Client = null

function getS3RequestHandler() {
  const { NodeHttpHandler } = require('@smithy/node-http-handler')
  return new NodeHttpHandler({
    connectionTimeout: 5000,
    requestTimeout: 30000,
    socketAcquisitionWarningTimeout: 15000,
    httpAgent: new http.Agent({ keepAlive: true, maxSockets: 200 }),
    httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 200 }),
  })
}

function getObjectStorageDriver() {
  return String(OBJECT_STORAGE_DRIVER || '').toLowerCase()
}

function isObjectStorageEnabled() {
  return ['r2', 'minio'].includes(getObjectStorageDriver())
}

function isR2Enabled() {
  return getObjectStorageDriver() === 'r2'
}

function isMinioEnabled() {
  return getObjectStorageDriver() === 'minio'
}

function trim(value) {
  return String(value || '').trim()
}

function getCloudflareAccountId() {
  const explicit = trim(process.env.CLOUDFLARE_ACCOUNT_ID)
  if (explicit) return explicit
  const match = trim(S3_ENDPOINT).match(/^https:\/\/([a-f0-9]{32})\.(?:[a-z]+\.)?r2\.cloudflarestorage\.com/i)
  return match ? match[1] : ''
}

function getCloudflareApiToken() {
  const inline = trim(process.env.CLOUDFLARE_API_TOKEN)
  if (inline) return inline
  const filePath = trim(process.env.CLOUDFLARE_API_TOKEN_FILE)
  if (!filePath) return ''
  try {
    return trim(fs.readFileSync(filePath, 'utf8'))
  } catch (_) {
    return ''
  }
}

function canUseCloudflareR2Api() {
  return isR2Enabled() && Boolean(getCloudflareAccountId() && getCloudflareApiToken() && S3_BUCKET)
}

function buildR2ApiObjectUrl(key = '', query = {}) {
  const accountId = getCloudflareAccountId()
  const bucket = encodeURIComponent(S3_BUCKET)
  const normalizedKey = normalizeObjectKey(key)
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects`
  const url = normalizedKey ? `${base}/${encodeURIComponent(normalizedKey)}` : base
  const params = new URLSearchParams()
  Object.entries(query || {}).forEach(([name, value]) => {
    if (value === undefined || value === null || value === '') return
    params.set(name, String(value))
  })
  const suffix = params.toString()
  return suffix ? `${url}?${suffix}` : url
}

async function cloudflareR2ApiRequest(method, key = '', options = {}) {
  if (!canUseCloudflareR2Api()) throw new Error('Cloudflare R2 API fallback is not configured')
  const controller = new AbortController()
  const safeTimeout = Math.max(1000, Math.min(120000, Number(options.timeoutMs || 30000)))
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, safeTimeout)
  const headers = { Authorization: `Bearer ${getCloudflareApiToken()}` }
  if (options.contentType) headers['Content-Type'] = options.contentType
  try {
    const init = { method, headers, signal: controller.signal }
    if (options.body !== undefined) {
      init.body = options.body
      if (options.body && typeof options.body.pipe === 'function') init.duplex = 'half'
    }
    let response = null
    try {
      response = await fetch(buildR2ApiObjectUrl(key, options.query), init)
    } catch (error) {
      if (timedOut && error?.name === 'AbortError') {
        throw new Error(`Cloudflare R2 API ${method} ${normalizeObjectKey(key) || 'objects'} timed out after ${safeTimeout}ms`)
      }
      throw error
    }
    if (!response.ok) {
      const message = await response.text().catch(() => '')
      throw new Error(`Cloudflare R2 API ${method} ${normalizeObjectKey(key) || 'objects'} failed (${response.status}): ${message.slice(0, 240)}`)
    }
    return response
  } finally {
    clearTimeout(timer)
  }
}

function shouldFallbackToR2Api(error) {
  if (!canUseCloudflareR2Api()) return false
  const status = Number(error?.$metadata?.httpStatusCode || error?.statusCode || error?.status || 0)
  const message = String(error?.message || error?.Code || error?.name || '')
  return status === 401
    || status === 403
    || status === 404
    || /Unauthorized|Forbidden|UnknownError|bucket .*not reachable|Credential access key/i.test(message)
}

function getS3Client() {
  if (!isObjectStorageEnabled()) return null
  if (!s3Client) {
    const { S3Client } = require('@aws-sdk/client-s3')
    s3Client = new S3Client({
      endpoint: S3_ENDPOINT,
      region: S3_REGION || (isR2Enabled() ? 'auto' : 'us-east-1'),
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      requestHandler: getS3RequestHandler(),
      credentials: {
        accessKeyId: S3_ACCESS_KEY_ID,
        secretAccessKey: S3_SECRET_ACCESS_KEY,
      },
    })
  }
  return s3Client
}

function normalizeObjectKey(key = '') {
  return String(key || '').replace(/^\/+/, '').replace(/\\/g, '/')
}

async function ensureBucket() {
  if (!isObjectStorageEnabled()) return
  if (canUseCloudflareR2Api()) {
    try {
      await cloudflareR2ApiRequest('GET', '', { query: { per_page: 1 }, timeoutMs: 8000 })
      return
    } catch (_) {}
  }
  const { CreateBucketCommand, HeadBucketCommand } = require('@aws-sdk/client-s3')
  const client = getS3Client()
  try {
    await client.send(new HeadBucketCommand({ Bucket: S3_BUCKET }))
  } catch (_) {
    if (isR2Enabled()) throw new Error(`R2 bucket "${S3_BUCKET}" is not reachable. Create it in Cloudflare R2 or update S3_BUCKET.`)
    try { await client.send(new CreateBucketCommand({ Bucket: S3_BUCKET })) } catch (_) {}
  }
}

async function putObject(key, body, options = {}) {
  if (!isObjectStorageEnabled()) return false
  const contentLength = Number(options.contentLength || 0)
  if (canUseCloudflareR2Api()) {
    await cloudflareR2ApiRequest('PUT', key, {
      body,
      contentType: options.contentType || 'application/octet-stream',
      timeoutMs: options.timeoutMs || (Number.isFinite(contentLength) && contentLength > 5 * 1024 * 1024 ? 120000 : 30000),
    })
    return true
  }
  const { PutObjectCommand } = require('@aws-sdk/client-s3')
  const params = {
    Bucket: S3_BUCKET,
    Key: normalizeObjectKey(key),
    Body: body,
    ContentType: options.contentType || 'application/octet-stream',
  }
  if (Number.isFinite(contentLength) && contentLength > 0) {
    params.ContentLength = contentLength
  }
  try {
    await ensureBucket()
    await getS3Client().send(new PutObjectCommand(params))
  } catch (error) {
    if (!shouldFallbackToR2Api(error)) throw error
    await cloudflareR2ApiRequest('PUT', key, {
      body,
      contentType: params.ContentType,
      timeoutMs: options.timeoutMs || 30000,
    })
  }
  return true
}

async function sendWithTimeout(command, { timeoutMs = 30000 } = {}) {
  const client = getS3Client()
  const safeTimeout = Math.max(1000, Math.min(120000, Number(timeoutMs || 30000)))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), safeTimeout)
  try {
    return await client.send(command, { abortSignal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function getObjectStream(key) {
  if (!isObjectStorageEnabled()) return null
  if (canUseCloudflareR2Api()) {
    const response = await cloudflareR2ApiRequest('GET', key, { timeoutMs: 30000 })
    return {
      body: response.body ? Readable.fromWeb(response.body) : Readable.from(Buffer.from(await response.arrayBuffer())),
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      contentLength: Number(response.headers.get('content-length') || 0) || null,
    }
  }
  const { GetObjectCommand } = require('@aws-sdk/client-s3')
  let result = null
  try {
    result = await getS3Client().send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: normalizeObjectKey(key),
    }))
  } catch (error) {
    if (!shouldFallbackToR2Api(error)) throw error
    const response = await cloudflareR2ApiRequest('GET', key, { timeoutMs: 30000 })
    return {
      body: response.body ? Readable.fromWeb(response.body) : Readable.from(Buffer.from(await response.arrayBuffer())),
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      contentLength: Number(response.headers.get('content-length') || 0) || null,
    }
  }
  return {
    body: result.Body,
    contentType: result.ContentType || 'application/octet-stream',
    contentLength: result.ContentLength || null,
  }
}

async function deleteObject(key) {
  if (!isObjectStorageEnabled()) return false
  if (canUseCloudflareR2Api()) {
    await cloudflareR2ApiRequest('DELETE', key, { timeoutMs: 15000 })
    return true
  }
  const { DeleteObjectCommand } = require('@aws-sdk/client-s3')
  try {
    await getS3Client().send(new DeleteObjectCommand({
      Bucket: S3_BUCKET,
      Key: normalizeObjectKey(key),
    }))
  } catch (error) {
    if (!shouldFallbackToR2Api(error)) throw error
    await cloudflareR2ApiRequest('DELETE', key, { timeoutMs: 15000 })
  }
  return true
}

async function deleteObjects(keys = []) {
  if (!isObjectStorageEnabled()) return 0
  const normalizedKeys = Array.from(new Set((Array.isArray(keys) ? keys : [])
    .map((key) => normalizeObjectKey(key))
    .filter(Boolean)))
  if (!normalizedKeys.length) return 0
  if (canUseCloudflareR2Api()) {
    for (const key of normalizedKeys) {
      await cloudflareR2ApiRequest('DELETE', key, { timeoutMs: 15000 })
    }
    return normalizedKeys.length
  }
  const { DeleteObjectsCommand } = require('@aws-sdk/client-s3')
  let deleted = 0
  for (let index = 0; index < normalizedKeys.length; index += 1000) {
    const chunk = normalizedKeys.slice(index, index + 1000)
    try {
      await getS3Client().send(new DeleteObjectsCommand({
        Bucket: S3_BUCKET,
        Delete: {
          Objects: chunk.map((key) => ({ Key: key })),
          Quiet: true,
        },
      }))
    } catch (error) {
      if (!shouldFallbackToR2Api(error)) throw error
      for (const key of chunk) {
        await cloudflareR2ApiRequest('DELETE', key, { timeoutMs: 15000 })
      }
    }
    deleted += chunk.length
  }
  return deleted
}

async function listObjects(prefix = '', options = {}) {
  if (!isObjectStorageEnabled()) return []
  const { ListObjectsV2Command } = require('@aws-sdk/client-s3')
  const maxKeys = Math.max(1, Math.min(1000, Number(options.maxKeys || 1000)))
  if (canUseCloudflareR2Api()) {
    const response = await cloudflareR2ApiRequest('GET', '', {
      query: {
        prefix: normalizeObjectKey(prefix),
        per_page: maxKeys,
      },
      timeoutMs: options.timeoutMs || 8000,
    })
    const payload = await response.json()
    return (payload.result || []).map((item) => ({
      key: item.key,
      size: Number(item.size || 0) || 0,
      lastModified: item.last_modified || null,
      etag: item.etag || '',
    }))
  }
  try {
    const result = await sendWithTimeout(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: normalizeObjectKey(prefix),
      MaxKeys: maxKeys,
    }), { timeoutMs: options.timeoutMs || 8000 })
    return (result.Contents || []).map((item) => ({
      key: item.Key,
      size: item.Size || 0,
      lastModified: item.LastModified ? item.LastModified.toISOString() : null,
      etag: item.ETag || '',
    }))
  } catch (error) {
    if (!shouldFallbackToR2Api(error)) throw error
    const response = await cloudflareR2ApiRequest('GET', '', {
      query: {
        prefix: normalizeObjectKey(prefix),
        per_page: maxKeys,
      },
      timeoutMs: options.timeoutMs || 8000,
    })
    const payload = await response.json()
    return (payload.result || []).map((item) => ({
      key: item.key,
      size: Number(item.size || 0) || 0,
      lastModified: item.last_modified || null,
      etag: item.etag || '',
    }))
  }
}

async function testObjectStore() {
  const key = `system/doctor/object-store-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`
  const body = Buffer.from('business-os-object-store-test', 'utf8')
  await putObject(key, body, { contentType: 'text/plain; charset=utf-8' })
  const object = await getObjectStream(key)
  if (!object?.body) throw new Error('Object store test read returned no body')
  await deleteObject(key)
  return {
    ok: true,
    driver: getObjectStorageDriver(),
    endpoint: S3_ENDPOINT,
    bucket: S3_BUCKET,
  }
}

function bufferToStream(buffer) {
  return Readable.from(buffer)
}

module.exports = {
  bufferToStream,
  deleteObject,
  deleteObjects,
  ensureBucket,
  getObjectStorageDriver,
  getObjectStream,
  isObjectStorageEnabled,
  isMinioEnabled,
  isR2Enabled,
  listObjects,
  normalizeObjectKey,
  putObject,
  testObjectStore,
}
