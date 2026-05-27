#!/usr/bin/env node
/* eslint-disable no-console */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..', '..', '..', '..')
const requireFromBackend = createRequire(path.join(root, 'backend', 'package.json'))
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} = requireFromBackend('@aws-sdk/client-s3')

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const env = {}
  const text = fs.readFileSync(filePath, 'utf8')
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[match[1]] = value
  }
  return env
}

function readConfig() {
  const runtimeEnvPath = path.join(root, 'ops', 'runtime', 'docker-release', 'docker-release.env')
  const fileEnv = loadEnvFile(runtimeEnvPath)
  const env = { ...fileEnv, ...process.env }
  Object.entries(fileEnv).forEach(([name, value]) => {
    if (!process.env[name] && value) process.env[name] = value
  })
  const tokenFile = path.join(root, 'ops', 'runtime', 'secrets', 'cloudflare-api-token.txt')
  if (!process.env.CLOUDFLARE_API_TOKEN_FILE && fs.existsSync(tokenFile)) {
    process.env.CLOUDFLARE_API_TOKEN_FILE = tokenFile
  }
  return {
    driver: String(env.OBJECT_STORAGE_DRIVER || '').trim().toLowerCase(),
    endpoint: String(env.S3_ENDPOINT || '').trim(),
    region: String(env.S3_REGION || 'auto').trim() || 'auto',
    bucket: String(env.S3_BUCKET || '').trim(),
    accessKeyId: String(env.S3_ACCESS_KEY_ID || '').trim(),
    secretAccessKey: String(env.S3_SECRET_ACCESS_KEY || '').trim(),
    cloudflareApiToken: String(env.CLOUDFLARE_API_TOKEN || '').trim(),
    cloudflareApiTokenFile: String(env.CLOUDFLARE_API_TOKEN_FILE || process.env.CLOUDFLARE_API_TOKEN_FILE || '').trim(),
  }
}

async function bodyToString(body) {
  if (!body) return ''
  if (typeof body.transformToString === 'function') return body.transformToString()
  const chunks = []
  for await (const chunk of body) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function isMissingObjectError(error) {
  const code = String(error?.name || error?.Code || error?.code || '')
  const status = Number(error?.$metadata?.httpStatusCode || 0)
  return status === 404 || /NoSuchKey|NotFound/i.test(code)
}

function isAuthLikeError(error) {
  const code = String(error?.name || error?.Code || error?.code || '')
  const status = Number(error?.$metadata?.httpStatusCode || error?.statusCode || error?.status || 0)
  const message = String(error?.message || '')
  return status === 401
    || status === 403
    || /Unauthorized|Forbidden|Credential access key|InvalidAccessKeyId|SignatureDoesNotMatch/i.test(`${code} ${message}`)
}

function canUseApiFallback(config) {
  return Boolean(config.cloudflareApiToken || config.cloudflareApiTokenFile)
}

async function verifyRuntimeObjectStoreFallback(reason) {
  console.warn(`R2 S3-compatible check failed (${reason}); trying Cloudflare API fallback used by the runtime.`)
  const { testObjectStore } = requireFromBackend('./src/objectStore')
  const result = await testObjectStore()
  if (!result?.ok) throw new Error('Cloudflare API fallback object-store verification did not return ok')
  console.log(`R2 Cloudflare API fallback ok: bucket=${result.bucket} endpoint=${result.endpoint}`)
}

async function main() {
  const config = readConfig()
  if (config.driver !== 'r2') {
    throw new Error(`OBJECT_STORAGE_DRIVER must be r2 for live R2 verification; found ${config.driver || 'empty'}`)
  }
  const missing = Object.entries(config)
    .filter(([key, value]) => !['driver', 'cloudflareApiToken', 'cloudflareApiTokenFile'].includes(key) && !value)
    .map(([key]) => key)
  if (missing.length) {
    throw new Error(`Missing R2 configuration: ${missing.join(', ')}`)
  }

  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
  const key = `diagnostics/live-r2-check-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.txt`
  const body = `business-os-r2-live-check ${new Date().toISOString()}`

  console.log(`R2 live check: bucket=${config.bucket} endpoint=${config.endpoint}`)
  try {
    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: 'text/plain; charset=utf-8',
      Metadata: { purpose: 'business-os-live-check' },
    }))
    console.log(`R2 put ok: ${key}`)

    const read = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }))
    const readText = await bodyToString(read.Body)
    if (readText !== body) throw new Error('R2 readback mismatch')
    console.log('R2 read ok')

    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }))
    console.log('R2 delete ok')

    try {
      await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }))
      throw new Error('R2 object still exists after delete')
    } catch (error) {
      if (!isMissingObjectError(error)) throw error
    }
    console.log('R2 disappearance confirmed')
  } catch (error) {
    if (!canUseApiFallback(config) || !isAuthLikeError(error)) throw error
    await verifyRuntimeObjectStoreFallback(error?.message || error?.name || 'auth error')
    return
  }
}

main().catch((error) => {
  console.error(`R2 live verification failed: ${error?.message || error}`)
  process.exit(1)
})
