'use strict'

const fs = require('fs')
const path = require('path')
const { readJson, readUtf8 } = require('../lib/fs-utils.js')

const ROOT = path.resolve(__dirname, '..', '..', '..')
const ROOT_PACKAGE_JSON = path.join(ROOT, 'package.json')
const BACKEND_PACKAGE_JSON = path.join(ROOT, 'backend', 'package.json')
const BACKEND_PACKAGE_LOCK = path.join(ROOT, 'backend', 'package-lock.json')
const FRONTEND_PACKAGE_JSON = path.join(ROOT, 'frontend', 'package.json')
const FRONTEND_PACKAGE_LOCK = path.join(ROOT, 'frontend', 'package-lock.json')
const OPS_PACKAGE_JSON = path.join(ROOT, 'ops', 'package.json')
const OPS_PACKAGE_LOCK = path.join(ROOT, 'ops', 'package-lock.json')
const FRONTEND_VITE_CONFIG = path.join(ROOT, 'frontend', 'vite.config.mjs')
const FRONTEND_API_HTTP = path.join(ROOT, 'frontend', 'src', 'api', 'http.js')
const FRONTEND_APP_CONTEXT = path.join(ROOT, 'frontend', 'src', 'AppContext.jsx')
const FRONTEND_SERVICE_WORKER = path.join(ROOT, 'frontend', 'public', 'sw.js')
const FRONTEND_DIST_BUILD_MANIFEST = path.join(ROOT, 'frontend', 'dist', 'business-os-build.json')
const BACKEND_RUNTIME_VERSION = path.join(ROOT, 'backend', 'src', 'runtimeVersion.js')
const BACKEND_RUNTIME_ROUTE = path.join(ROOT, 'backend', 'src', 'routes', 'runtime.js')
const FRONTEND_PERFORMANCE_VERIFY = path.join(ROOT, 'ops', 'scripts', 'frontend', 'verify-performance.js')
const FRONTEND_POSTCSS_CONFIG = path.join(ROOT, 'frontend', 'postcss.config.mjs')
const FRONTEND_TAILWIND_CONFIG = path.join(ROOT, 'frontend', 'tailwind.config.mjs')
const VERIFY_LOCAL_BAT = path.join(ROOT, 'run', 'verify-local.bat')
const NPM_INSTALL_MODE_HELPER = path.join(ROOT, 'ops', 'scripts', 'powershell', 'npm-install-mode.ps1')
const SUMMARY_PATH = path.join(ROOT, 'ops', 'docs', 'reference', 'RUNTIME-DEPS-GUARDRAIL.json')
const FORBIDDEN_TRACKED_CONFIGS = [
  path.join(ROOT, 'frontend', 'postcss.config.cjs'),
  path.join(ROOT, 'frontend', 'tailwind.config.cjs'),
]

const REQUIRED_FRONTEND_DEPS = [
  '@zxing/browser',
  '@zxing/library',
]

function assertTrackedFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing tracked file: ${path.relative(ROOT, filePath)}`)
  }
}

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/')
}

function requireToken(source, token, label) {
  if (!source.includes(token)) {
    throw new Error(`${label} is missing ${token}`)
  }
}

function hasLockDependency(lock, packageName) {
  if (lock?.packages?.[`node_modules/${packageName}`]) return true
  if (lock?.dependencies?.[packageName]) return true
  return false
}

function readIncludes(filePath, token) {
  return readUtf8(filePath).includes(token)
}

function packageLockVersion(lock) {
  return String(lock?.version || lock?.packages?.['']?.version || '').trim()
}

function buildVersionConsistency(packages) {
  const appVersion = String(packages.backendPackage.version || '').trim()
  const versions = {
    backendPackage: appVersion,
    backendLock: packageLockVersion(packages.backendLock),
    frontendPackage: String(packages.frontendPackage.version || '').trim(),
    frontendLock: packageLockVersion(packages.frontendLock),
    opsPackage: String(packages.opsPackage.version || '').trim(),
    opsLock: packageLockVersion(packages.opsLock),
  }
  if (packages.rootPackage) {
    versions.rootPackage = String(packages.rootPackage.version || '').trim()
  }
  const mismatches = Object.entries(versions)
    .filter(([, version]) => version !== appVersion)
    .map(([name, version]) => `${name}=${version || '<missing>'}`)
  return {
    appVersion,
    versions,
    rootPackageTracked: false,
    rootPackagePresent: Boolean(packages.rootPackage),
    mismatches,
    consistent: mismatches.length === 0,
  }
}

function assertVersionConsistency(versionConsistency) {
  if (!versionConsistency.consistent) {
    throw new Error(`Version mismatch: ${versionConsistency.mismatches.join(', ')} expected=${versionConsistency.appVersion}`)
  }
}

function assertRuntimeVersionGuardWiring() {
  ;[
    FRONTEND_VITE_CONFIG,
    FRONTEND_API_HTTP,
    FRONTEND_APP_CONTEXT,
    FRONTEND_SERVICE_WORKER,
    BACKEND_RUNTIME_VERSION,
    BACKEND_RUNTIME_ROUTE,
    FRONTEND_PERFORMANCE_VERIFY,
  ].forEach(assertTrackedFile)

  const viteConfig = readUtf8(FRONTEND_VITE_CONFIG)
  ;[
    'business-os-build-manifest',
    'business-os-build.json',
    '__BUSINESS_OS_BUILD_HASH__',
    '__FRONTEND_BUILD_HASH__',
    '__FRONTEND_BUILD_REVISION__',
  ].forEach((token) => requireToken(viteConfig, token, rel(FRONTEND_VITE_CONFIG)))

  const apiHttp = readUtf8(FRONTEND_API_HTTP)
  ;[
    'FRONTEND_BUILD_INFO',
    'shouldCompareRuntimeVersions',
    'checkRuntimeVersionFromHealth',
    'runtime:version-mismatch',
    'frontendHash',
    'servedFrontend',
  ].forEach((token) => requireToken(apiHttp, token, rel(FRONTEND_API_HTTP)))

  const appContext = readUtf8(FRONTEND_APP_CONTEXT)
  ;[
    'runtime:version-mismatch',
    'onRuntimeMismatch',
    'addEventListener',
    'removeEventListener',
  ].forEach((token) => requireToken(appContext, token, rel(FRONTEND_APP_CONTEXT)))

  const serviceWorker = readUtf8(FRONTEND_SERVICE_WORKER)
  ;[
    '__BUSINESS_OS_BUILD_HASH__',
    'APP_SHELL_VERSION',
    'STATIC_CACHE',
  ].forEach((token) => requireToken(serviceWorker, token, rel(FRONTEND_SERVICE_WORKER)))

  const runtimeVersion = readUtf8(BACKEND_RUNTIME_VERSION)
  ;[
    'getRuntimeVersion',
    'readFrontendBuildInfoFromRoot',
    'business-os-build.json',
    'frontend:',
    'sourceHash',
  ].forEach((token) => requireToken(runtimeVersion, token, rel(BACKEND_RUNTIME_VERSION)))

  const runtimeRoute = readUtf8(BACKEND_RUNTIME_ROUTE)
  ;[
    "router.get('/version'",
    'getRuntimeVersion',
  ].forEach((token) => requireToken(runtimeRoute, token, rel(BACKEND_RUNTIME_ROUTE)))

  const performanceVerify = readUtf8(FRONTEND_PERFORMANCE_VERIFY)
  ;[
    'business-os-build.json',
    'hash',
    'buildHash',
  ].forEach((token) => requireToken(performanceVerify, token, rel(FRONTEND_PERFORMANCE_VERIFY)))
}

function assertBuildManifestShapeWhenPresent() {
  if (!fs.existsSync(FRONTEND_DIST_BUILD_MANIFEST)) return

  const manifest = readJson(FRONTEND_DIST_BUILD_MANIFEST, null)
  if (!manifest || typeof manifest !== 'object') {
    throw new Error(`Invalid JSON in ${rel(FRONTEND_DIST_BUILD_MANIFEST)}`)
  }
  ;['revision', 'hash', 'builtAt'].forEach((key) => {
    if (!String(manifest[key] || '').trim()) {
      throw new Error(`${rel(FRONTEND_DIST_BUILD_MANIFEST)} is missing ${key}`)
    }
  })
  if (String(manifest.hash).trim() === 'dev') {
    throw new Error(`${rel(FRONTEND_DIST_BUILD_MANIFEST)} must contain a concrete build hash, not dev`)
  }
}

function buildLocalVerificationCoverage() {
  assertTrackedFile(VERIFY_LOCAL_BAT)
  assertTrackedFile(NPM_INSTALL_MODE_HELPER)
  const verifyLocal = readUtf8(VERIFY_LOCAL_BAT)
  const npmInstallModeHelper = readUtf8(NPM_INSTALL_MODE_HELPER)
  const progressLabelCoverage = {
    preflightStart: verifyLocal.includes('[preflight 1/6]'),
    preflightEnd: verifyLocal.includes('[preflight 6/6]'),
    frontendStart: verifyLocal.includes('[frontend 1/6]'),
    frontendEnd: verifyLocal.includes('[frontend 6/6]'),
    backendStart: verifyLocal.includes('[backend 1/3]'),
    backendEnd: verifyLocal.includes('[backend 3/3]'),
    staleFractionLabelsAbsent: !/\[[0-9][a-z]?\/6\]/i.test(verifyLocal),
  }
  return {
    progressLabelCoverage,
    runtimeDepsGuard: verifyLocal.includes('verify-runtime-deps.js'),
    dockerReleaseGuard: verifyLocal.includes('verify-docker-release.js'),
    secretHygieneGuard: verifyLocal.includes('verify-secret-hygiene.js'),
    dockerDoctor: verifyLocal.includes('docker-release.ps1') && verifyLocal.includes('-Action Doctor'),
    routeContractSmoke: verifyLocal.includes('check-route-contract.mjs') && verifyLocal.includes('--skip-if-unavailable'),
    postStartDiagnostics: verifyLocal.includes('post-start-diagnostics.mjs') &&
      verifyLocal.includes('verify-local-post-start-diagnostics.json') &&
      verifyLocal.includes('--skip-if-unavailable'),
    frontendDependencyInstall: verifyLocal.includes('FRONTEND_INSTALL_MODE') &&
      verifyLocal.includes('npm-install-mode.ps1') &&
      verifyLocal.includes('npm.cmd install --prefer-offline --no-audit --loglevel=warn'),
    frontendBuild: verifyLocal.includes('npm.cmd run build') &&
      verifyLocal.includes('frontend\\dist\\index.html'),
    frontendUtils: verifyLocal.includes('Running frontend utility tests') &&
      verifyLocal.includes('npm.cmd run test:utils'),
    frontendI18n: verifyLocal.includes('npm.cmd run verify:i18n'),
    frontendUiCoverage: verifyLocal.includes('npm.cmd run verify:ui'),
    frontendPerformance: verifyLocal.includes('npm.cmd run verify:performance'),
    backendDependencyInstall: verifyLocal.includes('BACKEND_INSTALL_MODE') &&
      verifyLocal.includes('npm-install-mode.ps1') &&
      verifyLocal.includes('npm.cmd install --prefer-offline --no-audit --loglevel=warn'),
    backendUtils: verifyLocal.includes('Running backend utility/security/core tests') &&
      verifyLocal.includes('npm.cmd run test:utils'),
    backendIntegrity: verifyLocal.includes('npm.cmd run verify:integrity'),
    sharedNpmInstallModeHelper: npmInstallModeHelper.includes('node_modules/.package-lock.json') &&
      npmInstallModeHelper.includes('package-lock.json') &&
      npmInstallModeHelper.includes('package.json') &&
      npmInstallModeHelper.includes("Write-Output 'skip'") &&
      npmInstallModeHelper.includes("Write-Output 'install'"),
  }
}

function assertCoverageComplete(coverage, label, prefix = '') {
  Object.entries(coverage).forEach(([key, value]) => {
    const pathLabel = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      assertCoverageComplete(value, label, pathLabel)
      return
    }
    if (value !== true) {
      throw new Error(`${label} is missing coverage: ${pathLabel}`)
    }
  })
}

function main() {
  assertTrackedFile(BACKEND_PACKAGE_JSON)
  assertTrackedFile(BACKEND_PACKAGE_LOCK)
  assertTrackedFile(FRONTEND_PACKAGE_JSON)
  assertTrackedFile(FRONTEND_PACKAGE_LOCK)
  assertTrackedFile(OPS_PACKAGE_JSON)
  assertTrackedFile(OPS_PACKAGE_LOCK)
  assertTrackedFile(FRONTEND_POSTCSS_CONFIG)
  assertTrackedFile(FRONTEND_TAILWIND_CONFIG)

  const rootPackage = fs.existsSync(ROOT_PACKAGE_JSON) ? readJson(ROOT_PACKAGE_JSON) : null
  const backendPackage = readJson(BACKEND_PACKAGE_JSON)
  const backendLock = readJson(BACKEND_PACKAGE_LOCK)
  const frontendPackage = readJson(FRONTEND_PACKAGE_JSON)
  const frontendLock = readJson(FRONTEND_PACKAGE_LOCK)
  const opsPackage = readJson(OPS_PACKAGE_JSON)
  const opsLock = readJson(OPS_PACKAGE_LOCK)
  const manifestDeps = {
    ...(frontendPackage.dependencies || {}),
    ...(frontendPackage.devDependencies || {}),
  }

  const versionConsistency = buildVersionConsistency({
    rootPackage,
    backendPackage,
    backendLock,
    frontendPackage,
    frontendLock,
    opsPackage,
    opsLock,
  })
  assertVersionConsistency(versionConsistency)

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

  assertRuntimeVersionGuardWiring()
  assertBuildManifestShapeWhenPresent()
  const localVerificationCoverage = buildLocalVerificationCoverage()
  assertCoverageComplete(localVerificationCoverage, rel(VERIFY_LOCAL_BAT))

  const runtimeVersionGuardCoverage = {
    viteBuildManifest: readIncludes(FRONTEND_VITE_CONFIG, 'business-os-build-manifest') &&
      readIncludes(FRONTEND_VITE_CONFIG, 'business-os-build.json'),
    viteDefinesFrontendBuild: readIncludes(FRONTEND_VITE_CONFIG, '__FRONTEND_BUILD_HASH__') &&
      readIncludes(FRONTEND_VITE_CONFIG, '__FRONTEND_BUILD_REVISION__'),
    serviceWorkerBuildHash: readIncludes(FRONTEND_SERVICE_WORKER, '__BUSINESS_OS_BUILD_HASH__') &&
      readIncludes(FRONTEND_SERVICE_WORKER, 'APP_SHELL_VERSION') &&
      readIncludes(FRONTEND_SERVICE_WORKER, 'STATIC_CACHE'),
    frontendMismatchDispatch: readIncludes(FRONTEND_API_HTTP, 'runtime:version-mismatch') &&
      readIncludes(FRONTEND_API_HTTP, 'shouldCompareRuntimeVersions') &&
      readIncludes(FRONTEND_API_HTTP, 'checkRuntimeVersionFromHealth'),
    appContextMismatchListener: readIncludes(FRONTEND_APP_CONTEXT, 'runtime:version-mismatch') &&
      readIncludes(FRONTEND_APP_CONTEXT, 'addEventListener') &&
      readIncludes(FRONTEND_APP_CONTEXT, 'removeEventListener'),
    backendRuntimeVersionRoute: readIncludes(BACKEND_RUNTIME_ROUTE, "router.get('/version'") &&
      readIncludes(BACKEND_RUNTIME_ROUTE, 'getRuntimeVersion'),
    backendFrontendBuildReader: readIncludes(BACKEND_RUNTIME_VERSION, 'readFrontendBuildInfoFromRoot') &&
      readIncludes(BACKEND_RUNTIME_VERSION, 'business-os-build.json'),
    performanceBuildMetadataGuard: readIncludes(FRONTEND_PERFORMANCE_VERIFY, 'business-os-build.json') &&
      readIncludes(FRONTEND_PERFORMANCE_VERIFY, 'buildHash'),
    distBuildManifestPresent: fs.existsSync(FRONTEND_DIST_BUILD_MANIFEST),
  }
  const summary = {
    summary: rel(SUMMARY_PATH),
    status: 'passed',
    appVersion: versionConsistency.appVersion,
    backendVersion: versionConsistency.versions.backendPackage,
    frontendVersion: versionConsistency.versions.frontendPackage,
    opsVersion: versionConsistency.versions.opsPackage,
    versionConsistency,
    requiredFrontendDeps: REQUIRED_FRONTEND_DEPS,
    missingFrontendDeps: REQUIRED_FRONTEND_DEPS.filter((packageName) => !manifestDeps[packageName]),
    missingLockDeps: REQUIRED_FRONTEND_DEPS.filter((packageName) => !hasLockDependency(frontendLock, packageName)),
    forbiddenTrackedConfigsPresent: FORBIDDEN_TRACKED_CONFIGS.filter((filePath) => fs.existsSync(filePath)).map(rel),
    runtimeVersionGuardCoverage,
    localVerificationCoverage,
  }
  fs.mkdirSync(path.dirname(SUMMARY_PATH), { recursive: true })
  fs.writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`)

  console.log('Runtime dependency manifests and version guard wiring are in sync.')
  console.log(JSON.stringify(summary, null, 2))
}

try {
  main()
} catch (error) {
  console.error(error?.message || error)
  process.exitCode = 1
}
