'use strict'

const { Readable } = require('stream')
const {
  OBJECT_STORAGE_DRIVER,
  S3_ACCESS_KEY_ID,
  S3_BUCKET,
  S3_ENDPOINT,
  S3_SECRET_ACCESS_KEY,
} = require('./config')

let s3Client = null

function isMinioEnabled() {
  return String(OBJECT_STORAGE_DRIVER || '').toLowerCase() === 'minio'
}

function getS3Client() {
  if (!isMinioEnabled()) return null
  if (!s3Client) {
    const { S3Client } = require('@aws-sdk/client-s3')
    s3Client = new S3Client({
      endpoint: S3_ENDPOINT,
      region: process.env.S3_REGION || 'us-east-1',
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
  if (!isMinioEnabled()) return
  const { CreateBucketCommand, HeadBucketCommand } = require('@aws-sdk/client-s3')
  const client = getS3Client()
  try {
    await client.send(new HeadBucketCommand({ Bucket: S3_BUCKET }))
  } catch (_) {
    try { await client.send(new CreateBucketCommand({ Bucket: S3_BUCKET })) } catch (_) {}
  }
}

async function putObject(key, body, options = {}) {
  if (!isMinioEnabled()) return false
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
  if (!isMinioEnabled()) return null
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
  if (!isMinioEnabled()) return false
  const { DeleteObjectCommand } = require('@aws-sdk/client-s3')
  await getS3Client().send(new DeleteObjectCommand({
    Bucket: S3_BUCKET,
    Key: normalizeObjectKey(key),
  }))
  return true
}

function bufferToStream(buffer) {
  return Readable.from(buffer)
}

module.exports = {
  bufferToStream,
  deleteObject,
  getObjectStream,
  isMinioEnabled,
  normalizeObjectKey,
  putObject,
}
