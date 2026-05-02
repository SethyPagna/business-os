/* eslint-disable no-console */
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')

const PROJECT_ROOT = path.resolve(__dirname, '../..')
const DOCKER_CONFIG = path.join(PROJECT_ROOT, 'ops', 'runtime', 'docker-config')
const DOCKER_SCALE_ENV = path.join(PROJECT_ROOT, 'ops', 'runtime', 'docker-scale.env')
const COMPOSE_FILE = path.join(PROJECT_ROOT, 'ops', 'docker', 'compose.scale.yml')
const args = new Set(process.argv.slice(2))
const requireServices = args.has('--require') || process.env.BUSINESS_OS_REQUIRE_SCALE_SERVICES === '1'
const printComposeCommand = args.has('--print-compose-command')
const failures = []
const warnings = []

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function run(exe, commandArgs, options = {}) {
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

function firstExisting(candidates) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || ''
}

function whereDocker() {
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

function resolveDocker() {
  return firstExisting([
    whereDocker(),
    process.env.DOCKER_EXE,
    'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe',
    '/usr/bin/docker',
    '/usr/local/bin/docker',
  ])
}

function checkSecretIgnoreRules() {
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

function main() {
  ensureDir(DOCKER_CONFIG)
  ensureDir(path.dirname(DOCKER_SCALE_ENV))
  checkSecretIgnoreRules()
  if (!fs.existsSync(COMPOSE_FILE)) {
    failures.push('Scale Compose file is missing: ops/docker/compose.scale.yml')
  } else {
    const composeText = fs.readFileSync(COMPOSE_FILE, 'utf8')
    ;['redis-queue:', 'redis-cache:', 'postgres:', 'minio:', 'business_os_internal:'].forEach((token) => {
      if (!composeText.includes(token)) failures.push(`Scale Compose is missing ${token.replace(':', '')}`)
    })
    if (!composeText.includes('127.0.0.1')) {
      failures.push('Scale Compose must bind database/cache/object-storage ports to localhost only.')
    }
  }

  const dockerExe = resolveDocker()
  if (!dockerExe) {
    const message = 'Docker CLI was not found on PATH or at the standard Windows Docker Desktop path.'
    if (requireServices) failures.push(message)
    else warnings.push(message)
  } else {
    const version = run(dockerExe, ['--version'])
    if (!version.ok) {
      const message = `Docker CLI did not run: ${version.stderr || version.stdout || `exit ${version.status}`}`
      if (requireServices) failures.push(message)
      else warnings.push(message)
    } else {
      console.log(`Docker: ${version.stdout}`)
    }
    const compose = run(dockerExe, ['compose', 'version'])
    if (!compose.ok) {
      const message = `Docker Compose did not run: ${compose.stderr || compose.stdout || `exit ${compose.status}`}`
      if (requireServices) failures.push(message)
      else warnings.push(message)
    } else {
      console.log(`Compose: ${compose.stdout}`)
    }
    const info = run(dockerExe, ['info', '--format', '{{.ServerVersion}}'])
    if (!info.ok) {
      const message = 'Docker Desktop engine is not reachable. Double-click Start Business OS.bat or run run\\setup.bat so Business OS can start the required services.'
      if (requireServices) failures.push(message)
      else warnings.push(message)
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
