/* eslint-disable no-console */
'use strict'

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '../..')
const composePath = path.join(root, 'ops', 'docker', 'compose.release.yml')
const dockerfilePath = path.join(root, 'ops', 'docker', 'Dockerfile.release')
const scriptPath = path.join(root, 'ops', 'scripts', 'powershell', 'docker-release.ps1')
const wrappers = [
  'release.bat',
  'publish-release.bat',
  'install.bat',
  'start.bat',
  'update.bat',
  'backup.bat',
  'restore.bat',
  'doctor.bat',
].map((file) => path.join(root, 'run', 'docker', file))

const failures = []

function read(file) {
  try { return fs.readFileSync(file, 'utf8') } catch (_) { return '' }
}

function requireFile(file) {
  if (!fs.existsSync(file)) failures.push(`Missing required Docker release file: ${path.relative(root, file)}`)
}

function main() {
  ;[composePath, dockerfilePath, scriptPath, ...wrappers].forEach(requireFile)

  const compose = read(composePath)
  if (compose.includes('../../:/app') || compose.includes('node_modules')) {
    failures.push('Production release Compose must not bind-mount the source tree or node_modules.')
  }
  ;[
    'DATABASE_DRIVER: postgres',
    'OBJECT_STORAGE_DRIVER: minio',
    'JOB_QUEUE_DRIVER: bullmq',
    'cloudflared:',
    'postgres:',
    'redis-queue:',
    'redis-cache:',
    'minio:',
    'import-worker:',
    'media-worker:',
    'migrator:',
  ].forEach((token) => {
    if (!compose.includes(token)) failures.push(`Production release Compose is missing ${token}`)
  })

  const dockerfile = read(dockerfilePath)
  ;[
    'FROM node:24-bookworm AS frontend-build',
    'FROM node:24-bookworm AS backend-build',
    'npm run build:linux',
    'PKG_CACHE_PATH=/root/.pkg-cache',
    'COPY --from=backend-build /build/backend/node_modules/sharp /app/sharp',
    'BUSINESS_OS_ENFORCE_POSTGRES=1',
  ].forEach((token) => {
    if (!dockerfile.includes(token)) failures.push(`Production Dockerfile is missing ${token}`)
  })

  const automation = read(scriptPath)
  ;['Release', 'Install', 'Start', 'Update', 'Backup', 'Restore', 'Doctor', 'Publish'].forEach((action) => {
    if (!automation.includes(`'${action}'`)) failures.push(`Docker release automation is missing ${action}`)
  })

  if (failures.length) {
    console.error('Docker release verification failed:')
    failures.forEach((failure) => console.error(`- ${failure}`))
    process.exit(1)
  }
  console.log('Docker release verification passed.')
}

main()
