/* eslint-disable no-console */
'use strict'

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '../..')
const composePath = path.join(root, 'ops', 'docker', 'compose.release.yml')
const dockerfilePath = path.join(root, 'ops', 'docker', 'Dockerfile.release')
const scriptPath = path.join(root, 'ops', 'scripts', 'powershell', 'docker-release.ps1')
const wrappers = [
  'build-release.bat',
  'release.bat',
  'publish-release.bat',
  'install.bat',
  'start.bat',
  'update.bat',
  'backup.bat',
  'restore.bat',
  'doctor.bat',
].map((file) => file === 'build-release.bat' ? path.join(root, 'run', file) : path.join(root, 'run', 'docker', file))

const retiredReleaseFiles = [
  'run/release/start-server.bat',
  'run/release/stop-server.bat',
  'ops/config/installer.nsi',
  'release/business-os-docker',
  'release/BusinessOS-Setup-v6.0.0.exe',
].map((file) => path.join(root, file))

const failures = []

function read(file) {
  try { return fs.readFileSync(file, 'utf8') } catch (_) { return '' }
}

function requireFile(file) {
  if (!fs.existsSync(file)) failures.push(`Missing required Docker release file: ${path.relative(root, file)}`)
}

function main() {
  ;[composePath, dockerfilePath, scriptPath, ...wrappers].forEach(requireFile)
  retiredReleaseFiles.forEach((file) => {
    if (fs.existsSync(file)) failures.push(`Retired standalone release artifact still exists: ${path.relative(root, file)}`)
  })

  const compose = read(composePath)
  if (!compose.includes('name: business-os')) {
    failures.push('Production release Compose project must be named business-os.')
  }
  if (compose.includes('../../:/app') || compose.includes('node_modules')) {
    failures.push('Production release Compose must not bind-mount the source tree or node_modules.')
  }
  ;[
    'BUSINESS_OS_DOCKER_DATA_MODE',
    'DATABASE_DRIVER: "${DATABASE_DRIVER:-sqlite}"',
    'OBJECT_STORAGE_DRIVER: "${OBJECT_STORAGE_DRIVER:-local}"',
    'JOB_QUEUE_DRIVER: bullmq',
    'cloudflared:',
    'postgres:',
    'redis-queue:',
    'redis-cache:',
    'minio:',
    'legacy-adopter:',
    'import-worker:',
    'media-worker:',
    'migrator:',
    'business_os_runtime:/runtime',
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
    'BUSINESS_OS_DOCKER_DATA_MODE=sqlite',
    'DATABASE_DRIVER=sqlite',
  ].forEach((token) => {
    if (!dockerfile.includes(token)) failures.push(`Production Dockerfile is missing ${token}`)
  })

  if (dockerfile.includes('BUSINESS_OS_ENFORCE_POSTGRES=1')) {
    failures.push('Production Dockerfile must not force Postgres before route-level Postgres serving is complete.')
  }

  const automation = read(scriptPath)
  ;['Release', 'Install', 'Start', 'Update', 'Backup', 'Restore', 'Doctor', 'Publish'].forEach((action) => {
    if (!automation.includes(`'${action}'`)) failures.push(`Docker release automation is missing ${action}`)
  })

  const rootLauncher = read(path.join(root, 'Start Business OS.bat'))
  if (rootLauncher.includes('run\\start-server.bat') || rootLauncher.includes('start-server.bat"')) {
    failures.push('Root launcher must use the final Docker release path, not the retired start-server path.')
  }
  const buildRelease = read(path.join(root, 'run', 'build-release.bat'))
  if (!buildRelease.includes('run\\docker\\release.bat')) {
    failures.push('run/build-release.bat must delegate to the final Docker release builder.')
  }

  if (failures.length) {
    console.error('Docker release verification failed:')
    failures.forEach((failure) => console.error(`- ${failure}`))
    process.exit(1)
  }
  console.log('Docker release verification passed.')
}

main()
