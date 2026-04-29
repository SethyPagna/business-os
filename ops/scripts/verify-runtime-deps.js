'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const FRONTEND_PACKAGE_JSON = path.join(ROOT, 'frontend', 'package.json')
const FRONTEND_PACKAGE_LOCK = path.join(ROOT, 'frontend', 'package-lock.json')

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
  assertTrackedFile(FRONTEND_PACKAGE_JSON)
  assertTrackedFile(FRONTEND_PACKAGE_LOCK)

  const frontendPackage = readJson(FRONTEND_PACKAGE_JSON)
  const frontendLock = readJson(FRONTEND_PACKAGE_LOCK)
  const manifestDeps = {
    ...(frontendPackage.dependencies || {}),
    ...(frontendPackage.devDependencies || {}),
  }

  REQUIRED_FRONTEND_DEPS.forEach((packageName) => {
    if (!manifestDeps[packageName]) {
      throw new Error(`Missing ${packageName} in frontend/package.json`)
    }
    if (!hasLockDependency(frontendLock, packageName)) {
      throw new Error(`Missing ${packageName} in frontend/package-lock.json`)
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
