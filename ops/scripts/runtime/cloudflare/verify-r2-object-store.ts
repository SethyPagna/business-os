#!/usr/bin/env node
/* eslint-disable no-console */
// Live R2 verification, ported off the Docker-era S3-compatible SDK check.
// Uses `wrangler r2 object` directly against the real R2 bucket/binding
// declared in cloudflare/wrangler.toml, so it exercises the same credentials
// and account path as an actual `wrangler deploy` — no docker-release.env,
// no S3 access keys, no backend/ dependency.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..', '..', '..', '..')
const cloudflareDir = path.join(root, 'cloudflare')
const wranglerBin = path.join(cloudflareDir, 'node_modules', '.bin', 'wrangler')

function readBucketNameFromWranglerToml() {
  const tomlPath = path.join(cloudflareDir, 'wrangler.toml')
  const text = fs.readFileSync(tomlPath, 'utf8')
  // Match the bucket_name that follows the first [[r2_buckets]] block whose
  // binding is ASSETS (the bucket the runtime actually writes uploads to).
  const blocks = text.split(/\[\[r2_buckets\]\]/g).slice(1)
  for (const block of blocks) {
    const bindingMatch = block.match(/binding\s*=\s*"([^"]+)"/)
    const bucketMatch = block.match(/bucket_name\s*=\s*"([^"]+)"/)
    if (bindingMatch?.[1] === 'ASSETS' && bucketMatch?.[1]) return bucketMatch[1]
  }
  throw new Error('Could not find an ASSETS r2_buckets binding in cloudflare/wrangler.toml')
}

function runWrangler(args, options = {}) {
  const useRemote = options.remote !== false
  const fullArgs = [...args, ...(useRemote ? ['--remote'] : ['--local'])]
  const result = spawnSync(wranglerBin, fullArgs, {
    cwd: cloudflareDir,
    encoding: 'utf8',
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim()
    throw new Error(`wrangler ${fullArgs.join(' ')} failed (exit ${result.status}): ${detail}`)
  }
  return result.stdout || ''
}

function assertWranglerAvailable() {
  if (fs.existsSync(wranglerBin)) return
  const result = spawnSync('npx', ['--yes', 'wrangler', '--version'], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error('wrangler is not installed in cloudflare/node_modules and npx could not resolve it. Run `npm install` in cloudflare/ first.')
  }
}

function main() {
  assertWranglerAvailable()
  const bucket = readBucketNameFromWranglerToml()
  const key = `diagnostics/live-r2-check-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.txt`
  const body = `business-os-r2-live-check ${new Date().toISOString()}`
  const tmpFile = path.join(os.tmpdir(), `r2-live-check-${crypto.randomBytes(4).toString('hex')}.txt`)
  fs.writeFileSync(tmpFile, body, 'utf8')

  console.log(`R2 live check: bucket=${bucket} (via wrangler r2 object, --remote)`)
  try {
    runWrangler(['r2', 'object', 'put', `${bucket}/${key}`, '--file', tmpFile, '--content-type', 'text/plain; charset=utf-8'])
    console.log(`R2 put ok: ${key}`)

    const downloadPath = `${tmpFile}.download`
    runWrangler(['r2', 'object', 'get', `${bucket}/${key}`, '--file', downloadPath])
    const readText = fs.readFileSync(downloadPath, 'utf8')
    fs.rmSync(downloadPath, { force: true })
    if (readText !== body) throw new Error('R2 readback mismatch')
    console.log('R2 read ok')

    runWrangler(['r2', 'object', 'delete', `${bucket}/${key}`])
    console.log('R2 delete ok')

    let stillExists = true
    try {
      runWrangler(['r2', 'object', 'get', `${bucket}/${key}`, '--file', `${tmpFile}.postdelete`])
      stillExists = true
    } catch (error) {
      const message = String(error?.message || '')
      if (!/does not exist|not found|404/i.test(message)) throw error
      stillExists = false
    } finally {
      fs.rmSync(`${tmpFile}.postdelete`, { force: true })
    }
    if (stillExists) throw new Error('R2 object still exists after delete')
    console.log('R2 disappearance confirmed')
  } finally {
    fs.rmSync(tmpFile, { force: true })
  }
}

try {
  main()
} catch (error) {
  console.error(`R2 live verification failed: ${error?.message || error}`)
  process.exit(1)
}
