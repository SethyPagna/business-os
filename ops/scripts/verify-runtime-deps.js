'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const BACKEND_PACKAGE_JSON = path.join(ROOT, 'backend', 'package.json')
const FRONTEND_PACKAGE_JSON = path.join(ROOT, 'frontend', 'package.json')
const FRONTEND_PACKAGE_LOCK = path.join(ROOT, 'frontend', 'package-lock.json')
const FRONTEND_POSTCSS_CONFIG = path.join(ROOT, 'frontend', 'postcss.config.mjs')
const FRONTEND_TAILWIND_CONFIG = path.join(ROOT, 'frontend', 'tailwind.config.mjs')
const FORBIDDEN_TRACKED_CONFIGS = [
  path.join(ROOT, 'frontend', 'postcss.config.cjs'),
  path.join(ROOT, 'frontend', 'tailwind.config.cjs'),
]

const REQUIRED_FRONTEND_DEPS = [
  '@zxing/browser',
  '@zxing/library',
]

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function assertTrackedFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing tracked file: ${path.relative(ROOT, filePath)}`)
  }
}

function hasLockDependency(lock, packageName) {
  if (lock?.packages?.[`node_modules/${packageName}`]) return true
  if (lock?.dependencies?.[packageName]) return true
  return false
}

function main() {
  assertTrackedFile(BACKEND_PACKAGE_JSON)
  assertTrackedFile(FRONTEND_PACKAGE_JSON)
  assertTrackedFile(FRONTEND_PACKAGE_LOCK)
  assertTrackedFile(FRONTEND_POSTCSS_CONFIG)
  assertTrackedFile(FRONTEND_TAILWIND_CONFIG)

  const backendPackage = readJson(BACKEND_PACKAGE_JSON)
  const frontendPackage = readJson(FRONTEND_PACKAGE_JSON)
  const frontendLock = readJson(FRONTEND_PACKAGE_LOCK)
  const manifestDeps = {
    ...(frontendPackage.dependencies || {}),
    ...(frontendPackage.devDependencies || {}),
  }

  if (String(backendPackage.version || '').trim() !== String(frontendPackage.version || '').trim()) {
    throw new Error(`Version mismatch: backend/package.json=${backendPackage.version} frontend/package.json=${frontendPackage.version}`)
  }

  REQUIRED_FRONTEND_DEPS.forEach((packageName) => {
    if (!manifestDeps[packageName]) {
      throw new Error(`Missing ${packageName} in frontend/package.json`)
    }
    if (!hasLockDependency(frontendLock, packageName)) {
      throw new Error(`Missing ${packageName} in frontend/package-lock.json`)
    }
  })

  FORBIDDEN_TRACKED_CONFIGS.forEach((filePath) => {
    if (fs.existsSync(filePath)) {
      throw new Error(`Tracked legacy config still present: ${path.relative(ROOT, filePath)}`)
    }
  })

  console.log('Runtime dependency manifests are in sync.')
}

try {
  main()
} catch (error) {
  console.error(error?.message || error)
  process.exitCode = 1
}
