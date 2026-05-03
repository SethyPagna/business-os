'use strict'

const { Readable } = require('stream')
const {
  OBJECT_STORAGE_DRIVER,
  S3_ACCESS_KEY_ID,
  S3_BUCKET,
  S3_ENDPOINT,
  S3_REGION,
  S3_SECRET_ACCESS_KEY,
} = require('./config')

let s3Client = null

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

function getS3Client() {
  if (!isObjectStorageEnabled()) return null
  if (!s3Client) {
    const { S3Client } = require('@aws-sdk/client-s3')
    s3Client = new S3Client({
      endpoint: S3_ENDPOINT,
      region: S3_REGION || (isR2Enabled() ? 'auto' : 'us-east-1'),
      forcePathStyle: true,
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
  const { PutObjectCommand } = require('@aws-sdk/client-s3')
  await ensureBucket()
  await getS3Client().send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: normalizeObjectKey(key),
    Body: body,
    ContentType: options.contentType || 'application/octet-stream',
  }))
  return true
}

async function getObjectStream(key) {
  if (!isObjectStorageEnabled()) return null
  const { GetObjectCommand } = require('@aws-sdk/client-s3')
  const result = await getS3Client().send(new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: normalizeObjectKey(key),
  }))
  return {
    body: result.Body,
    contentType: result.ContentType || 'application/octet-stream',
    contentLength: result.ContentLength || null,
  }
}

async function deleteObject(key) {
  if (!isObjectStorageEnabled()) return false
  const { DeleteObjectCommand } = require('@aws-sdk/client-s3')
  await getS3Client().send(new DeleteObjectCommand({
    Bucket: S3_BUCKET,
    Key: normalizeObjectKey(key),
  }))
  return true
}

async function listObjects(prefix = '', options = {}) {
  if (!isObjectStorageEnabled()) return []
  const { ListObjectsV2Command } = require('@aws-sdk/client-s3')
  const maxKeys = Math.max(1, Math.min(1000, Number(options.maxKeys || 1000)))
  const result = await getS3Client().send(new ListObjectsV2Command({
    Bucket: S3_BUCKET,
    Prefix: normalizeObjectKey(prefix),
    MaxKeys: maxKeys,
  }))
  return (result.Contents || []).map((item) => ({
    key: item.Key,
    size: item.Size || 0,
    lastModified: item.LastModified ? item.LastModified.toISOString() : null,
    etag: item.ETag || '',
  }))
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
