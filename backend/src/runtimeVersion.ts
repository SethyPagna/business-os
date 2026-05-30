'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const BACKEND_ROOT = path.resolve(__dirname, '..')
const PROJECT_ROOT = path.resolve(BACKEND_ROOT, '..')

/**
 * @typedef {{ revision: string, hash: string, builtAt: string }} FrontendBuildInfo
 * @typedef {{
 *   app: string,
 *   packageVersion: string,
 *   revision: string,
 *   sourceHash: string,
 *   frontend: FrontendBuildInfo,
 *   bootedAt: string,
 * }} RuntimeVersion
 */

/**
 * @param {string[]} [candidates]
 * @returns {string}
 */
function firstExistingDir(candidates = []) {
  for (const candidate of candidates || []) {
    if (candidate && fs.existsSync(candidate)) return candidate
  }
  return ''
}

/**
 * @param {string[]} [files]
 * @returns {string[]}
 */
function collectExistingFiles(files = []) {
  const existing = []
  for (const file of files || []) {
    if (fs.existsSync(file)) existing.push(file)
  }
  existing.sort()
  return existing
}

/**
 * @returns {string}
 */
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

/**
 * @param {string} dir
 * @param {string[]} [output]
 * @returns {string[]}
 */
function collectFiles(dir, output = []) {
  if (!fs.existsSync(dir)) return output
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'frontend-dist') continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectFiles(fullPath, output)
    } else if (entry.isFile() && /\.(js|ts|json)$/i.test(entry.name)) {
      output.push(fullPath)
    }
  }
  return output
}

/**
 * @returns {string}
 */
function computeSourceHash() {
  if (process.env.BUSINESS_OS_BUILD_HASH) return process.env.BUSINESS_OS_BUILD_HASH
  try {
    const hash = crypto.createHash('sha256')
    const files = [
      path.join(BACKEND_ROOT, 'server.js'),
      path.join(BACKEND_ROOT, 'package.json'),
      ...collectFiles(path.join(BACKEND_ROOT, 'src')),
    ]
    const existingFiles = collectExistingFiles(files)

    if (!existingFiles.length) return ''
    for (const file of existingFiles) {
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

/**
 * @returns {FrontendBuildInfo}
 */
function emptyFrontendBuildInfo() {
  return {
    revision: '',
    hash: '',
    builtAt: '',
  }
}

/**
 * @param {string} [rootDir]
 * @returns {FrontendBuildInfo}
 */
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

/** @type {RuntimeVersion} */
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

/**
 * @returns {RuntimeVersion}
 */
function getRuntimeVersion() {
  return {
    ...runtimeVersion,
    frontend: readFrontendBuildInfoFromRoot(PROJECT_ROOT),
  }
}

module.exports = {
  getRuntimeVersion,
  readFrontendBuildInfoFromRoot,
}
