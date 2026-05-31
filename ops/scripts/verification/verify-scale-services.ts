/* eslint-disable no-console */
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')
const { readUtf8 } = require('../lib/fs-utils.ts')

const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const DOCKER_CONFIG = path.join(PROJECT_ROOT, 'ops', 'runtime', 'docker-config')
const DOCKER_SCALE_ENV = path.join(PROJECT_ROOT, 'ops', 'runtime', 'docker-scale.env')
const COMPOSE_FILE = path.join(PROJECT_ROOT, 'ops', 'docker', 'compose.scale.yml')
type CommandResult = {
  ok: boolean
  status: number | null
  stdout: string
  stderr: string
}
type SpawnOptions = Parameters<typeof spawnSync>[2]

const args = new Set<string>(process.argv.slice(2))
const requireServices = args.has('--require') || process.env.BUSINESS_OS_REQUIRE_SCALE_SERVICES === '1'
const printComposeCommand = args.has('--print-compose-command')
const failures: string[] = []
const warnings: string[] = []

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function run(exe: string, commandArgs: string[], options: SpawnOptions = {}): CommandResult {
  const result = spawnSync(exe, commandArgs, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      DOCKER_CONFIG,
    },
    ...options,
  })
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || result.error?.message || '').trim(),
  }
}

function firstExisting(candidates: Array<string | undefined>): string {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || ''
}

function whereDocker(): string {
  try {
    const output = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['docker'], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return output.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || ''
  } catch (_) {
    return ''
  }
}

function resolveDocker(): string {
  return firstExisting([
    whereDocker(),
    process.env.DOCKER_EXE,
    'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe',
    '/usr/bin/docker',
    '/usr/local/bin/docker',
  ])
}

function checkSecretIgnoreRules(): void {
  const trackedLicenses = (() => {
    try {
      return execFileSync('git', ['ls-files'], { cwd: PROJECT_ROOT, encoding: 'utf8' })
        .split(/\r?\n/)
        .filter((file) => /(^|\/)minio\.license$/i.test(file) || /\.license$/i.test(file))
    } catch (_) {
      return []
    }
  })()
  if (trackedLicenses.length) {
    failures.push(`License/secret files must not be tracked: ${trackedLicenses.join(', ')}`)
  }

  const localMinioLicense = path.join(PROJECT_ROOT, 'minio.license')
  if (fs.existsSync(localMinioLicense)) {
    try {
      execFileSync('git', ['check-ignore', '--quiet', 'minio.license'], {
        cwd: PROJECT_ROOT,
        stdio: 'ignore',
      })
    } catch (_) {
      failures.push('minio.license exists but is not ignored by git.')
    }
  }
}

function pushDockerAvailabilityMessage(message: string): void {
  if (requireServices) failures.push(message)
  else warnings.push(message)
}

function main(): void {
  ensureDir(DOCKER_CONFIG)
  ensureDir(path.dirname(DOCKER_SCALE_ENV))
  checkSecretIgnoreRules()
  if (!fs.existsSync(COMPOSE_FILE)) {
    failures.push('Scale Compose file is missing: ops/docker/compose.scale.yml')
  } else {
    const composeText = readUtf8(COMPOSE_FILE)
    ;['redis-queue:', 'redis-cache:', 'postgres:', 'minio:', 'business_os_internal:'].forEach((token) => {
      if (!composeText.includes(token)) failures.push(`Scale Compose is missing ${token.replace(':', '')}`)
    })
    if (!composeText.includes('127.0.0.1')) {
      failures.push('Scale Compose must bind database/cache/object-storage ports to localhost only.')
    }
    if (composeText.includes('S3_ENDPOINT: http://minio:9000')) {
      failures.push('Scale Compose must not hardcode the app runtime to MinIO while OBJECT_STORAGE_DRIVER defaults to R2.')
    }
    ;[
      'S3_ENDPOINT: "${S3_ENDPOINT:-https://743e5b727d139e85ed11679097f6f99e.r2.cloudflarestorage.com}"',
      'S3_REGION: "${S3_REGION:-auto}"',
      'S3_ACCESS_KEY_ID: "${S3_ACCESS_KEY_ID:-businessos}"',
      'S3_SECRET_ACCESS_KEY: "${S3_SECRET_ACCESS_KEY:-businessos-dev-password}"',
      'CLOUDFLARE_API_TOKEN: "${CLOUDFLARE_API_TOKEN:-}"',
    ].forEach((token) => {
      if (!composeText.includes(token)) failures.push(`Scale Compose is missing R2 runtime env token: ${token}`)
    })
    const startRuntime = readUtf8(path.join(PROJECT_ROOT, 'ops', 'scripts', 'powershell', 'start-runtime.ps1'))
    ;['docker-release\\docker-release.env', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'CLOUDFLARE_API_TOKEN'].forEach((token) => {
      if (!startRuntime.includes(token)) failures.push(`Runtime starter is missing R2 env bridge token: ${token}`)
    })
  }

  const dockerExe = resolveDocker()
  if (!dockerExe) {
    pushDockerAvailabilityMessage('Docker CLI was not found on PATH or at the standard Windows Docker Desktop path.')
  } else {
    const version = run(dockerExe, ['--version'])
    if (!version.ok) {
      pushDockerAvailabilityMessage(`Docker CLI did not run: ${version.stderr || version.stdout || `exit ${version.status}`}`)
    } else {
      console.log(`Docker: ${version.stdout}`)
    }
    const compose = run(dockerExe, ['compose', 'version'])
    if (!compose.ok) {
      pushDockerAvailabilityMessage(`Docker Compose did not run: ${compose.stderr || compose.stdout || `exit ${compose.status}`}`)
    } else {
      console.log(`Compose: ${compose.stdout}`)
    }
    const info = run(dockerExe, ['info', '--format', '{{.ServerVersion}}'])
    if (!info.ok) {
      pushDockerAvailabilityMessage('Docker Desktop engine is not reachable. Double-click Start Business OS.bat or run run\\setup.bat so Business OS can start the required services.')
    } else {
      console.log(`Docker engine: ${info.stdout}`)
    }
    if (printComposeCommand) {
      console.log(`Compose file: ${COMPOSE_FILE}`)
      console.log(`Compose env: ${DOCKER_SCALE_ENV}`)
      console.log(`Docker config: ${DOCKER_CONFIG}`)
      console.log(`Start scale services: "${dockerExe}" compose --env-file "${DOCKER_SCALE_ENV}" -f "${COMPOSE_FILE}" up -d --remove-orphans`)
    }
  }

  warnings.forEach((warning) => console.warn(`[warn] ${warning}`))
  if (failures.length) {
    console.error('Scale service verification failed:')
    failures.forEach((failure) => console.error(`- ${failure}`))
    process.exit(1)
  }
  console.log('Scale service verification passed.')
}

main()
