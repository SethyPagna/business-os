#!/usr/bin/env node
/* eslint-disable no-console */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..', '..', '..')
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
  return {
    driver: String(env.OBJECT_STORAGE_DRIVER || '').trim().toLowerCase(),
    endpoint: String(env.S3_ENDPOINT || '').trim(),
    region: String(env.S3_REGION || 'auto').trim() || 'auto',
    bucket: String(env.S3_BUCKET || '').trim(),
    accessKeyId: String(env.S3_ACCESS_KEY_ID || '').trim(),
    secretAccessKey: String(env.S3_SECRET_ACCESS_KEY || '').trim(),
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

async function main() {
  const config = readConfig()
  if (config.driver !== 'r2') {
    throw new Error(`OBJECT_STORAGE_DRIVER must be r2 for live R2 verification; found ${config.driver || 'empty'}`)
  }
  const missing = Object.entries(config)
    .filter(([key, value]) => key !== 'driver' && !value)
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
}

main().catch((error) => {
  console.error(`R2 live verification failed: ${error?.message || error}`)
  process.exit(1)
})
