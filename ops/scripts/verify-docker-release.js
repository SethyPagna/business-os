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
    'BUSINESS_OS_POSTGRES_CUTOVER_VERIFIED',
    'DATABASE_DRIVER: "${DATABASE_DRIVER:-postgres}"',
    'OBJECT_STORAGE_DRIVER: "${OBJECT_STORAGE_DRIVER:-r2}"',
    'ANALYTICS_ENGINE: "${ANALYTICS_ENGINE:-duckdb}"',
    'PARQUET_STORE: "${PARQUET_STORE:-r2}"',
    'JOB_QUEUE_DRIVER: bullmq',
    'cloudflared:',
    'postgres:',
    'redis-queue:',
    'redis-cache:',
    'minio:',
    'import-worker:',
    'media-worker:',
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
    'COPY --from=backend-build /build/backend/node_modules/sharp /app/node_modules/sharp',
    'ln -s /app/node_modules/sharp /app/sharp',
    'BUSINESS_OS_DOCKER_DATA_MODE=postgres',
    'BUSINESS_OS_POSTGRES_CUTOVER_VERIFIED=1',
    'DATABASE_DRIVER=postgres',
    'OBJECT_STORAGE_DRIVER=r2',
    'ANALYTICS_ENGINE=duckdb',
    'PARQUET_STORE=r2',
  ].forEach((token) => {
    if (!dockerfile.includes(token)) failures.push(`Production Dockerfile is missing ${token}`)
  })

  const retiredObjectStoreDefault = `OBJECT_STORAGE_DRIVER=${'loc' + 'al'}`
  const retiredComposeObjectStoreDefault = `OBJECT_STORAGE_DRIVER: "\${OBJECT_STORAGE_DRIVER:-${'loc' + 'al'}}"`
  if (dockerfile.includes(retiredObjectStoreDefault)) {
    failures.push('Production Dockerfile must ship R2 storage defaults, with MinIO only as explicit offline mode.')
  }
  if (compose.includes(retiredComposeObjectStoreDefault)) {
    failures.push('Production Compose must ship R2 storage defaults, with MinIO only as explicit offline mode.')
  }
  if (compose.includes('legacy-adopter:')) {
    failures.push('Production Compose must not auto-adopt loose legacy business-os-data folders.')
  }

  const automation = read(scriptPath)
  ;['Release', 'Install', 'Start', 'Update', 'Backup', 'Restore', 'Doctor'].forEach((action) => {
    if (!automation.includes(`'${action}'`)) failures.push(`Docker release automation is missing ${action}`)
  })
  ;[
    'Docker image bundle',
    "Invoke-Docker -DockerArgs @('save'",
    "Invoke-Docker -DockerArgs @('load'",
    'Ensure-ReleaseImageAvailable',
    'business-os-image.tar',
    'Assert-PostgresCutoverReadyForApp',
    'Postgres migration finished, but the app data layer is not cut over yet',
  ].forEach((token) => {
    if (!automation.includes(token)) failures.push(`Docker release automation is missing local image bundle support: ${token}`)
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
