'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const BACKEND_ROOT = path.resolve(__dirname, '..')
const PROJECT_ROOT = path.resolve(BACKEND_ROOT, '..')

function firstExistingDir(candidates = []) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || ''
}

function readGitRevision() {
  if (process.env.BUSINESS_OS_BUILD_REVISION) return process.env.BUSINESS_OS_BUILD_REVISION
  const cwd = firstExistingDir([PROJECT_ROOT, BACKEND_ROOT])
  if (!cwd) return ''
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch (_) {
    return ''
  }
}

function collectFiles(dir, output = []) {
  if (!fs.existsSync(dir)) return output
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'frontend-dist') continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectFiles(fullPath, output)
    } else if (entry.isFile() && /\.(js|json)$/i.test(entry.name)) {
      output.push(fullPath)
    }
  }
  return output
}

function computeSourceHash() {
  if (process.env.BUSINESS_OS_BUILD_HASH) return process.env.BUSINESS_OS_BUILD_HASH
  try {
    const hash = crypto.createHash('sha256')
    const files = [
      path.join(BACKEND_ROOT, 'server.js'),
      path.join(BACKEND_ROOT, 'package.json'),
      ...collectFiles(path.join(BACKEND_ROOT, 'src')),
    ]
      .filter((file) => fs.existsSync(file))
      .sort()

    if (!files.length) return ''
    for (const file of files) {
      hash.update(path.relative(BACKEND_ROOT, file).replace(/\\/g, '/'))
      hash.update('\0')
      hash.update(fs.readFileSync(file))
      hash.update('\0')
    }
    return hash.digest('hex').slice(0, 16)
  } catch (_) {
    return ''
  }
}

function emptyFrontendBuildInfo() {
  return {
    revision: '',
    hash: '',
    builtAt: '',
  }
}

function readFrontendBuildInfoFromRoot(rootDir = PROJECT_ROOT) {
  const candidates = [
    path.join(rootDir, 'frontend', 'dist', 'business-os-build.json'),
    path.join(rootDir, 'backend', 'frontend-dist', 'business-os-build.json'),
    path.join(BACKEND_ROOT, 'frontend-dist', 'business-os-build.json'),
  ]
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'))
      return {
        revision: String(parsed?.revision || '').trim(),
        hash: String(parsed?.hash || '').trim(),
        builtAt: String(parsed?.builtAt || '').trim(),
      }
    } catch (_) {}
  }
  return emptyFrontendBuildInfo()
}

const runtimeVersion = {
  app: 'business-os',
  packageVersion: (() => {
    try {
      return require('../package.json').version || ''
    } catch (_) {
      return ''
    }
  })(),
  revision: readGitRevision(),
  sourceHash: computeSourceHash(),
  frontend: readFrontendBuildInfoFromRoot(PROJECT_ROOT),
  bootedAt: new Date().toISOString(),
}

function getRuntimeVersion() {
  return { ...runtimeVersion }
}

module.exports = {
  getRuntimeVersion,
  readFrontendBuildInfoFromRoot,
}
