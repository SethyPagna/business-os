/* eslint-disable no-console */
'use strict'

const fs = require('fs')
const path = require('path')
const { readUtf8 } = require('../lib/fs-utils.ts')

const root = path.resolve(__dirname, '../../..')
const composePath = path.join(root, 'ops', 'docker', 'compose.release.yml')
const dockerfilePath = path.join(root, 'ops', 'docker', 'Dockerfile.release')
const scriptPath = path.join(root, 'ops', 'scripts', 'powershell', 'docker-release.ps1')
const dockerignorePath = path.join(root, '.dockerignore')
const gitignorePath = path.join(root, '.gitignore')
const pruneStoragePath = path.join(root, 'ops', 'scripts', 'runtime', 'storage', 'prune-storage.ts')
const cleanupTestDataPath = path.join(root, 'ops', 'scripts', 'runtime', 'storage', 'cleanup-test-data.ts')
const actionHistoryCheckPath = path.join(root, 'ops', 'scripts', 'runtime', 'audits', 'action-history-undo-redo-check.ts')
const liveSmokePath = path.join(root, 'ops', 'scripts', 'runtime', 'smoke', 'live-smoke.ts')
const routeContractPath = path.join(root, 'ops', 'scripts', 'runtime', 'smoke', 'check-route-contract.ts')
const postStartDiagnosticsPath = path.join(root, 'ops', 'scripts', 'runtime', 'smoke', 'post-start-diagnostics.ts')
const cloudflareStartupWarmupPath = path.join(root, 'ops', 'scripts', 'runtime', 'cloudflare', 'warm-cloudflare-startup-assets.ts')
const fullAppAuditPath = path.join(root, 'ops', 'scripts', 'runtime', 'audits', 'full-app-audit.ts')
const fullAutomationPath = path.join(root, 'ops', 'scripts', 'powershell', 'full-automation.ps1')
const startRuntimePath = path.join(root, 'ops', 'scripts', 'powershell', 'start-runtime.ps1')
const automationPolicyPath = path.join(root, 'ops', 'automation', 'business-os-automation.json')
const opsPackagePath = path.join(root, 'ops', 'package.json')
const backendPackagePath = path.join(root, 'backend', 'package.json')
const buildServerEntryPath = path.join(root, 'ops', 'scripts', 'backend', 'build-server-entry.ts')
const buildPackageStagePath = path.join(root, 'ops', 'scripts', 'backend', 'build-package-stage.ts')
const summaryPath = path.join(root, 'ops', 'docs', 'reference', 'DOCKER-RELEASE-GUARDRAIL.json')
const cloudflareRuntimePaths = {
  rotateToken: path.join(root, 'ops', 'scripts', 'runtime', 'cloudflare', 'rotate-cloudflare-tunnel-token.ts'),
  updateOrigin: path.join(root, 'ops', 'scripts', 'runtime', 'cloudflare', 'update-cloudflare-tunnel-origin.ts'),
  verifyAutomation: path.join(root, 'ops', 'scripts', 'runtime', 'cloudflare', 'verify-cloudflare-automation.ts'),
  verifyR2ObjectStore: path.join(root, 'ops', 'scripts', 'runtime', 'cloudflare', 'verify-r2-object-store.ts'),
  hostOriginWrapper: path.join(root, 'run', 'cloudflare-origin.bat'),
  dockerRotateWrapper: path.join(root, 'run', 'docker', 'rotate-cloudflare.bat'),
  runtimeApiToken: path.join(root, 'ops', 'runtime', 'secrets', 'cloudflare-api-token.txt'),
  runtimeHostTunnelToken: path.join(root, 'ops', 'runtime', 'secrets', 'cloudflare-business-os-leangcosmetics.token'),
  runtimeDockerTunnelToken: path.join(root, 'ops', 'runtime', 'docker-release', 'secrets', 'cloudflare-tunnel.token'),
  runtimeAccessEmails: path.join(root, 'ops', 'runtime', 'automation', 'access-emails.txt'),
  dockerReleaseEnv: path.join(root, 'ops', 'runtime', 'docker-release', 'docker-release.env'),
}
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
  return readUtf8(file)
}

function rel(file) {
  return path.relative(root, file).replace(/\\/g, '/')
}

function requireFile(file) {
  if (!fs.existsSync(file)) failures.push(`Missing required Docker release file: ${rel(file)}`)
}

function requireToken(source, token, label) {
  if (!source.includes(token)) failures.push(`${label} is missing ${token}`)
}

function buildCloudflareRuntimeCoverage({ policy, policyParseError, pruneStorage, gitignore, fullAutomation, opsPackage }) {
  const rotateToken = read(cloudflareRuntimePaths.rotateToken)
  const updateOrigin = read(cloudflareRuntimePaths.updateOrigin)
  const verifyAutomation = read(cloudflareRuntimePaths.verifyAutomation)
  const verifyR2ObjectStore = read(cloudflareRuntimePaths.verifyR2ObjectStore)
  const hostOriginWrapper = read(cloudflareRuntimePaths.hostOriginWrapper)
  const dockerRotateWrapper = read(cloudflareRuntimePaths.dockerRotateWrapper)

  return {
    mode: 'local-runtime-and-cloudflare-retention-guardrail',
    scriptsPresent: {
      rotateToken: fs.existsSync(cloudflareRuntimePaths.rotateToken),
      updateOrigin: fs.existsSync(cloudflareRuntimePaths.updateOrigin),
      verifyAutomation: fs.existsSync(cloudflareRuntimePaths.verifyAutomation),
      verifyR2ObjectStore: fs.existsSync(cloudflareRuntimePaths.verifyR2ObjectStore),
      hostOriginWrapper: fs.existsSync(cloudflareRuntimePaths.hostOriginWrapper),
      dockerRotateWrapper: fs.existsSync(cloudflareRuntimePaths.dockerRotateWrapper),
    },
    wrapperPaths: {
      hostOriginWrapper: rel(cloudflareRuntimePaths.hostOriginWrapper),
      dockerRotateWrapper: rel(cloudflareRuntimePaths.dockerRotateWrapper),
    },
    wrappers: {
      hostOriginDelegatesToScript: hostOriginWrapper.includes('update-cloudflare-tunnel-origin.ts'),
      hostOriginSupportsHostAndDocker: hostOriginWrapper.includes('host^|docker') &&
        hostOriginWrapper.includes('--mode "%MODE%"'),
      dockerRotateDelegatesToScript: dockerRotateWrapper.includes('rotate-cloudflare-tunnel-token.ts') &&
        dockerRotateWrapper.includes('--mode docker'),
    },
    tokenRotation: {
      rotatesTunnelSecret: rotateToken.includes('rotateTunnelSecret') &&
        rotateToken.includes('tunnel_secret'),
      refreshesTunnelTokenFile: rotateToken.includes('fetchTunnelToken') &&
        rotateToken.includes('writeSecret(tunnelTokenFile, tunnelToken)'),
      disconnectsOldConnections: rotateToken.includes('disconnectTunnelConnections') &&
        rotateToken.includes('/connections'),
      dryRunSupported: rotateToken.includes('--dry-run') &&
        rotateToken.includes('args.dryRun'),
    },
    originSwitch: {
      supportsHostMode: updateOrigin.includes("args.mode === 'docker' ?") &&
        updateOrigin.includes('http://127.0.0.1:${port}'),
      supportsDockerMode: updateOrigin.includes("args.mode === 'docker' ?") &&
        updateOrigin.includes('http://app:${port}'),
      dryRunSupported: updateOrigin.includes('--dry-run') &&
        updateOrigin.includes('dryRun'),
    },
    automationPolicy: {
      parsed: !policyParseError,
      zoneNameConfigured: Boolean(policy?.cloudflare?.zoneName),
      apiTokenFileRuntimeOnly: policy?.cloudflare?.apiTokenFile === 'ops/runtime/secrets/cloudflare-api-token.txt',
      tunnelTokenFileRuntimeOnly: policy?.cloudflare?.tunnelTokenFile === 'ops/runtime/secrets/cloudflare-business-os-leangcosmetics.token',
      allowedEmailsRuntimeOnly: policy?.cloudflare?.allowedEmailsFile === 'ops/runtime/automation/access-emails.txt',
      longAccessSessionConfigured: policy?.cloudflare?.accessSessionDuration === '720h',
      remoteBackupsKeepLatestOne: policy?.backups?.cloudflareR2KeepLatest === 1,
      remoteBackupPruneEnabled: policy?.backups?.deleteExpiredBackupVersions === true,
    },
    accessAndR2: {
      accessAppUpsert: verifyAutomation.includes('upsertAccessApp') &&
        verifyAutomation.includes('access/apps'),
      wafRulesetUpsert: verifyAutomation.includes('upsertEntrypointRuleset') &&
        verifyAutomation.includes('http_request_firewall_custom'),
      permissionHints: verifyAutomation.includes('Account.Cloudflare Access: Edit') &&
        verifyAutomation.includes('Zone.Rulesets: Edit'),
      r2Fallback: verifyR2ObjectStore.includes('Cloudflare API fallback') &&
        verifyR2ObjectStore.includes('testObjectStore'),
      authErrorDetection: verifyR2ObjectStore.includes('isAuthLikeError'),
    },
    retentionCleanup: {
      policyDefaultsLoadedByPruneStorage: pruneStorage.includes('DEFAULT_POLICY_PATH') &&
        pruneStorage.includes('--policy') &&
        pruneStorage.includes('runtimeReportsKeepLatest') &&
        pruneStorage.includes('recoveryReportsKeepLatest') &&
        pruneStorage.includes('runtimeLogFileMaxBytes') &&
        fullAutomation.includes("'--policy', $PolicyPath") &&
        !fullAutomation.includes('runtimeReportsKeepLatest) {'),
      pruneStorageOutputFlagSupported: pruneStorage.includes('--output') &&
        pruneStorage.includes('outputPath') &&
        pruneStorage.includes('Refusing to write a preview-named prune report without --dry-run') &&
        pruneStorage.includes('fs.writeFileSync(args.outputPath'),
      previewScriptDryRun: opsPackage?.scripts?.['prune-storage:preview'] === 'node scripts/runtime/storage/prune-storage.ts --dry-run --skip-remote --output ops/runtime/reports/prune-storage-preview-latest.json',
      previewNameRequiresDryRun: pruneStorage.includes('preview-named prune report') &&
        pruneStorage.includes('!args.dryRun'),
      latestCleanupReportWrittenByAutomation: fullAutomation.includes('$StoragePruneReport') &&
        fullAutomation.includes("'--output', $StoragePruneReport") &&
        fullAutomation.includes('prune-storage-latest.json'),
      latestCleanupReportRuntimeOnly: fullAutomation.includes("Join-Path $Root 'ops\\runtime\\reports\\prune-storage-latest.json'") &&
        gitignore.includes('/ops/runtime/'),
      localReportsPruned: pruneStorage.includes("targetDir: path.join(root, 'ops', 'runtime', 'reports')") &&
        pruneStorage.includes('--reports-keep') &&
        pruneStorage.includes('includeFiles: true'),
      runtimeLogsCompacted: pruneStorage.includes('compactRuntimeLogs') &&
        pruneStorage.includes('--log-file-max-bytes') &&
        pruneStorage.includes("'ops', 'runtime', 'logs'") &&
        pruneStorage.includes("'ops', 'runtime', 'pm2'") &&
        pruneStorage.includes('business-os log compacted'),
      localBackupsPruned: pruneStorage.includes('pruneLocalBackupVersions') &&
        pruneStorage.includes('--local-backups-keep'),
      remoteR2BackupsPruned: pruneStorage.includes('pruneRemoteBackupVersions') &&
        pruneStorage.includes('--remote-backups-keep'),
      remoteSkipAvailable: pruneStorage.includes('--skip-remote'),
      dockerSafePruneOnly: pruneStorage.includes("args: ['container', 'prune', '-f']") &&
        pruneStorage.includes("args: ['builder', 'prune', '-f']") &&
        pruneStorage.includes('Volumes and images are never pruned'),
      fullAutomationRunsRetention: fullAutomation.includes('prune-storage.ts') &&
        fullAutomation.includes('--policy') &&
        !fullAutomation.includes('--docker-safe-prune'),
    },
    secretBoundary: {
      runtimeSecretsIgnored: gitignore.includes('/ops/runtime/'),
      apiTokenPath: rel(cloudflareRuntimePaths.runtimeApiToken),
      hostTunnelTokenPath: rel(cloudflareRuntimePaths.runtimeHostTunnelToken),
      dockerTunnelTokenPath: rel(cloudflareRuntimePaths.runtimeDockerTunnelToken),
      accessEmailsPath: rel(cloudflareRuntimePaths.runtimeAccessEmails),
      dockerReleaseEnvPath: rel(cloudflareRuntimePaths.dockerReleaseEnv),
      tokenFileContentsNotRead: true,
    },
  }
}

function assertCloudflareRuntimeCoverage(coverage) {
  const missing = []
  function walk(value, prefix) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.entries(value).forEach(([key, child]) => walk(child, prefix ? `${prefix}.${key}` : key))
      return
    }
    if (value === false || value === null || value === undefined || value === '') missing.push(prefix)
  }
  walk(coverage, 'cloudflareRuntimeCoverage')
  if (missing.length) {
    failures.push(`Cloudflare runtime coverage is missing: ${missing.join(', ')}`)
  }
}

function buildTestDataCleanupCoverage({ cleanupTestData, actionHistoryCheck, fullAppAudit, liveSmoke, fullAutomation, opsPackage }) {
  return {
    mode: 'qa-smoke-test-data-cleanup-guardrail',
    scriptPresent: fs.existsSync(cleanupTestDataPath),
    actionHistoryCheckPresent: fs.existsSync(actionHistoryCheckPath),
    liveSmokeScriptPresent: fs.existsSync(liveSmokePath),
    actionHistoryPackageScriptPresent: opsPackage?.scripts?.['action-history:check'] === 'node scripts/runtime/audits/action-history-undo-redo-check.ts',
    packageScriptPresent: opsPackage?.scripts?.['cleanup-test-data'] === 'node scripts/runtime/storage/cleanup-test-data.ts',
    packagePostcheckScriptsPresent: opsPackage?.scripts?.['cleanup-test-data:check']?.includes('--fail-on-match') &&
      opsPackage?.scripts?.['cleanup-test-data:check-smoke']?.includes('--fail-on-match') &&
      opsPackage?.scripts?.['cleanup-test-data:check-action-history']?.includes('--fail-on-match'),
    dryRunDefault: cleanupTestData.includes("apply: false") &&
      cleanupTestData.includes('--dry-run') &&
      cleanupTestData.includes('ROLLBACK'),
    explicitApplyRequired: cleanupTestData.includes('--apply') &&
      cleanupTestData.includes('COMMIT') &&
      cleanupTestData.includes('Refusing to scan without --all-qa or --prefix'),
    failOnMatchPostcheckSupported: cleanupTestData.includes('--fail-on-match') &&
      cleanupTestData.includes('countMatchedRows') &&
      cleanupTestData.includes('Refusing clean postcheck'),
    qaSelectorBounded: cleanupTestData.includes('QA Audit %') &&
      cleanupTestData.includes('QA Smoke %') &&
      cleanupTestData.includes('QA Deep Audit %') &&
      cleanupTestData.includes('QA Action History %') &&
      cleanupTestData.includes('business-os-full-audit') &&
      cleanupTestData.includes('business-os-live-smoke') &&
      cleanupTestData.includes('allQa') &&
      cleanupTestData.includes('prefix'),
    deletesDependentBusinessRows: [
      'return_item_batch_allocations',
      'sale_item_batch_allocations',
      'return_items',
      'returns',
      'sale_items',
      'sales',
      'inventory_movements',
      'stock_transfers',
      'branch_batch_stock',
      'product_batches',
      'branch_stock',
      'products',
      'import_job_files',
      'import_job_batches',
      'import_job_errors',
      'import_jobs',
      'action_history',
      'audit_logs',
    ].every((token) => cleanupTestData.includes(token)),
    lookupResiduePostcheck: cleanupTestData.includes('lookupNameWhere') &&
      cleanupTestData.includes('_bos_test_categories') &&
      cleanupTestData.includes('_bos_test_units') &&
      cleanupTestData.includes('QA Smoke %') &&
      cleanupTestData.includes('QA Deep Audit %') &&
      cleanupTestData.includes('QA Action History %'),
    diskImportCleanupBounded: cleanupTestData.includes('business-os-data') &&
      cleanupTestData.includes("'imports'") &&
      cleanupTestData.includes('/^imp_/i') &&
      cleanupTestData.includes('pathIsInside(ROOT_DIR'),
    prefixImportCleanupSupported: cleanupTestData.includes('f.original_name ILIKE') &&
      cleanupTestData.includes('fileMatchesGeneratedImport') &&
      cleanupTestData.includes('findGeneratedImportDirectories(args)'),
    reportOutputSupported: cleanupTestData.includes('--output') &&
      cleanupTestData.includes('fs.writeFileSync(args.output'),
    fullAppAuditFinallyCleanup: fullAppAudit.includes('cleanupAuditData') &&
      fullAppAudit.includes('finally') &&
      fullAppAudit.includes('cleanup-test-data.ts') &&
      fullAppAudit.includes('--all-qa') &&
      fullAppAudit.includes('--apply') &&
      fullAppAudit.includes('BOS_AUDIT_CLEANUP'),
    fullAppAuditCleanupReport: fullAppAudit.includes('test-data-cleanup.json') &&
      fullAppAudit.includes('summary.writeFlows.cleanup'),
    actionHistoryUndoRedoCheck: actionHistoryCheck.includes('/api/action-history') &&
      actionHistoryCheck.includes('/undo') &&
      actionHistoryCheck.includes('/redo') &&
      actionHistoryCheck.includes('payloadRoundTrip') &&
      actionHistoryCheck.includes('cleanupActionHistoryData') &&
      actionHistoryCheck.includes('action-history-undo-redo-cleanup-latest.json') &&
      actionHistoryCheck.includes('action-history-undo-redo-cleanup-postcheck-latest.json') &&
      actionHistoryCheck.includes('--fail-on-match'),
    fullAutomationActionHistoryCheck: fullAutomation.includes('Action history undo/redo live verification') &&
      fullAutomation.includes('action-history-undo-redo-check.ts'),
    liveSmokeFinallyCleanup: liveSmoke.includes('cleanupLiveSmokeData') &&
      liveSmoke.includes('finally') &&
      liveSmoke.includes('BOS_SMOKE_CLEANUP') &&
      liveSmoke.includes('cleanup-test-data.ts') &&
      liveSmoke.includes('--prefix') &&
      liveSmoke.includes('--apply'),
    liveSmokeLookupPrefixScoped: liveSmoke.includes('category: seed') &&
      liveSmoke.includes('brand: seed') &&
      liveSmoke.includes('"${seed}","${seed}",pcs'),
    liveSmokeCleanupReport: liveSmoke.includes('live-smoke-cleanup-latest.json') &&
      liveSmoke.includes('ops/runtime/reports'),
    fullAutomationPostcheck: fullAutomation.includes('Invoke-TestDataCleanupPostcheck') &&
      fullAutomation.includes('test-data-cleanup-postcheck-latest.json') &&
      fullAutomation.includes('live-smoke-cleanup-postcheck-latest.json') &&
      fullAutomation.includes('action-history-cleanup-postcheck-latest.json') &&
      fullAutomation.includes('QA Action History') &&
      fullAutomation.includes('--fail-on-match'),
  }
}

function assertBooleanCoverage(coverage, label) {
  const missing = []
  function walk(value, prefix) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.entries(value).forEach(([key, child]) => walk(child, prefix ? `${prefix}.${key}` : key))
      return
    }
    if (value === false || value === null || value === undefined || value === '') missing.push(prefix)
  }
  walk(coverage, label)
  if (missing.length) failures.push(`${label} is missing: ${missing.join(', ')}`)
}

function main() {
  const requiredFiles = [
    composePath,
    dockerfilePath,
    scriptPath,
    dockerignorePath,
    gitignorePath,
    pruneStoragePath,
    cleanupTestDataPath,
    actionHistoryCheckPath,
    liveSmokePath,
    routeContractPath,
    postStartDiagnosticsPath,
    cloudflareStartupWarmupPath,
    fullAppAuditPath,
    fullAutomationPath,
    startRuntimePath,
    automationPolicyPath,
    opsPackagePath,
    backendPackagePath,
    buildPackageStagePath,
    cloudflareRuntimePaths.rotateToken,
    cloudflareRuntimePaths.updateOrigin,
    cloudflareRuntimePaths.verifyAutomation,
    cloudflareRuntimePaths.verifyR2ObjectStore,
    cloudflareRuntimePaths.hostOriginWrapper,
    cloudflareRuntimePaths.dockerRotateWrapper,
    ...wrappers,
  ]
  requiredFiles.forEach(requireFile)
  retiredReleaseFiles.forEach((file) => {
    if (fs.existsSync(file)) failures.push(`Retired standalone release artifact still exists: ${rel(file)}`)
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
    'FROM node:24-bookworm-slim AS runtime',
    'BUSINESS_OS_BUILD_REVISION="$BUILD_COMMIT" npm run build',
    'BUSINESS_OS_BUILD_REVISION=${BUILD_COMMIT}',
    'npm run build:server-entry',
    'node ../ops/scripts/backend/build-package-stage.ts',
    'COPY --from=backend-build /build/backend/.pkg-stage/ /app/',
    'COPY --from=backend-build /build/backend/node_modules /app/node_modules',
    'ln -s /app/node_modules/sharp /app/sharp',
    'ENTRYPOINT ["/usr/bin/tini", "--", "node", "/app/server.js"]',
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
  ;[
    'post-start-diagnostics.ts',
    'post-start-diagnostics.json',
    'PostStartDiagnosticsReport',
    'business-os-docker',
    '--public-url',
    '--admin-url',
    '--output',
  ].forEach((token) => {
    if (!automation.includes(token)) failures.push(`Docker release automation is missing post-start diagnostics support: ${token}`)
  })
  ;[
    'function Copy-FileEnsuringParent',
    'Split-Path -Parent $destination',
    "Copy-FileEnsuringParent $ComposeFile (Join-Path $DockerKitDir 'ops\\docker\\compose.release.yml')",
    "Copy-FileEnsuringParent $Dockerfile (Join-Path $DockerKitDir 'ops\\docker\\Dockerfile.release')",
  ].forEach((token) => {
    if (!automation.includes(token)) failures.push(`Docker release kit copy must ensure parent directories before copying files: ${token}`)
  })
  ;[
    'function Remove-ReleaseDirectory',
    'Refusing to remove release output outside release folder',
    'Start-Sleep -Milliseconds 250',
    'Start-Sleep -Milliseconds 500',
    '$attempt -le 5',
    'Remove-ReleaseDirectory $DockerKitDir',
  ].forEach((token) => {
    if (!automation.includes(token)) failures.push(`Docker release kit cleanup must remove generated kit directories through the guarded retry helper: ${token}`)
  })

  const startRuntime = read(startRuntimePath)
  const verifyLocal = read(path.join(root, 'run', 'verify-local.bat'))
  ;[
    'post-start-diagnostics.ts',
    'post-start-diagnostics.json',
    'PostStartDiagnosticsReport',
    'Post-start diagnostics',
    '--public-url',
    '--admin-url',
    '--output',
  ].forEach((token) => {
    if (!startRuntime.includes(token)) failures.push(`Runtime starter is missing post-start diagnostics support: ${token}`)
  })
  ;[
    'post-start-diagnostics.ts',
    'verify-local-post-start-diagnostics.json',
    '--skip-if-unavailable',
  ].forEach((token) => {
    if (!verifyLocal.includes(token)) failures.push(`Local verifier is missing post-start diagnostics support: ${token}`)
  })

  const postStartDiagnostics = read(postStartDiagnosticsPath)
  ;[
    '/health',
    '/api/runtime/version',
    '/business-os-build.json',
    '/sw.js',
    'runtime version did not expose served frontend build metadata',
    'build manifest is missing concrete hash/revision metadata',
    'checklist',
  ].forEach((token) => requireToken(postStartDiagnostics, token, 'Post-start diagnostics smoke'))

  const postStartDiagnosticsCoverage = {
    scriptPresent: fs.existsSync(postStartDiagnosticsPath),
    releaseHealthCheck: automation.includes('post-start-diagnostics.ts') &&
      automation.includes('PostStartDiagnosticsReport') &&
      automation.includes('--public-url') &&
      automation.includes('--admin-url') &&
      automation.includes('--output'),
    startRuntimeCheck: startRuntime.includes('post-start-diagnostics.ts') &&
      startRuntime.includes('PostStartDiagnosticsReport') &&
      startRuntime.includes('--public-url') &&
      startRuntime.includes('--admin-url') &&
      startRuntime.includes('--output'),
    localVerifyCheck: verifyLocal.includes('post-start-diagnostics.ts') &&
      verifyLocal.includes('verify-local-post-start-diagnostics.json') &&
      verifyLocal.includes('--skip-if-unavailable'),
    localSkipIfUnavailable: postStartDiagnostics.includes('--skip-if-unavailable') &&
      postStartDiagnostics.includes("status: 'skipped'"),
    probes: {
      health: postStartDiagnostics.includes('/health'),
      runtimeVersion: postStartDiagnostics.includes('/api/runtime/version'),
      buildManifest: postStartDiagnostics.includes('/business-os-build.json'),
      serviceWorker: postStartDiagnostics.includes('/sw.js'),
    },
  }

  const rootLauncher = read(path.join(root, 'Start Business OS.bat'))
  if (rootLauncher.includes('run\\start-server.bat') || rootLauncher.includes('start-server.bat"')) {
    failures.push('Root launcher must use the final Docker release path, not the retired start-server path.')
  }
  const buildRelease = read(path.join(root, 'run', 'build-release.bat'))
  if (!buildRelease.includes('run\\docker\\release.bat')) {
    failures.push('run/build-release.bat must delegate to the final Docker release builder.')
  }

  const dockerignore = read(dockerignorePath)
  const dockerignoreRequiredEntries = [
    'node_modules',
    '**/node_modules',
    'frontend/dist',
    'backend/frontend-dist',
    'business-os-data',
    'ops/runtime',
    'runtime',
    'release',
    'output',
    '.playwright-cli',
    'ops/.playwright-cli',
    'run/cv-render-check-word',
  ]
  dockerignoreRequiredEntries.forEach((token) => requireToken(dockerignore, token, '.dockerignore'))

  const gitignore = read(gitignorePath)
  const gitignoreRequiredEntries = [
    '/run/cv-render-check-word/',
    '/ops/runtime/',
    '/release/',
    '/output/',
    'backend/.pkg-stage/',
  ]
  gitignoreRequiredEntries.forEach((token) => requireToken(gitignore, token, '.gitignore'))

  let backendPackage = null
  try {
    backendPackage = JSON.parse(read(backendPackagePath))
  } catch (error) {
    failures.push(`Backend package JSON is invalid: ${error.message}`)
  }

  const cloudflareStartupWarmup = read(cloudflareStartupWarmupPath)
  ;[
    'DEFAULT_DOCUMENT_ATTEMPTS',
    'DEFAULT_DOCUMENT_RETRY_DELAY_MS',
    'DEFAULT_ASSET_ATTEMPTS',
    'DEFAULT_ASSET_RETRY_DELAY_MS',
    'DEFAULT_ADMIN_ROUTE_PATHS',
    'DEFAULT_ASSET_GRAPH_DEPTH',
    'ADMIN_FIRST_WINDOW_DEPENDENCY_RE',
    'BOS_WARMUP_DOCUMENT_ATTEMPTS',
    'BOS_WARMUP_DOCUMENT_RETRY_DELAY_MS',
    'BOS_WARMUP_ASSET_ATTEMPTS',
    'BOS_WARMUP_ASSET_RETRY_DELAY_MS',
    'BOS_WARMUP_ADMIN_ROUTES',
    'BOS_WARMUP_ASSET_GRAPH_DEPTH',
    '--document-attempts',
    '--document-retry-delay-ms',
    '--asset-attempts',
    '--asset-retry-delay-ms',
    '--admin-route',
    '--admin-routes',
    '--asset-graph-depth',
    'function shouldRetryDocumentFetch',
    'async function fetchDocumentWithRetry',
    'function shouldRetryAssetFetch',
    'async function fetchAssetWithRetry',
    'function extractLinkHeaderAssets',
    'function extractFetchedChunkDependencies',
    'async function warmAssetsWithGraph',
    'linkHeader',
    'documentAttempts',
    'documentRetryDelayMs',
    'assetAttempts',
    'assetRetryDelayMs',
    'assetGraphDepth',
    'adminRoutes',
    'dependencyAssetCount',
    'attemptCount',
  ].forEach((token) => requireToken(cloudflareStartupWarmup, token, 'Cloudflare startup warmup retry'))

  const cloudflareStartupWarmupCoverage = {
    scriptPresent: fs.existsSync(cloudflareStartupWarmupPath),
    releaseStartCallsWarmup: automation.includes('warm-cloudflare-startup-assets.ts') &&
      automation.includes('CloudflareStartupWarmupReport') &&
      automation.includes('CloudflareStartupWarmupLog'),
    waitsForTunnelBeforeWarmup: automation.includes('function Wait-CloudflareStartupTunnel') &&
      automation.includes('Cloudflare tunnel answered before startup warmup') &&
      automation.includes('warmup will still try its own retries'),
    documentRetryConfigurable: cloudflareStartupWarmup.includes('BOS_WARMUP_DOCUMENT_ATTEMPTS') &&
      cloudflareStartupWarmup.includes('BOS_WARMUP_DOCUMENT_RETRY_DELAY_MS') &&
      cloudflareStartupWarmup.includes('--document-attempts') &&
      cloudflareStartupWarmup.includes('--document-retry-delay-ms'),
    assetRetryConfigurable: cloudflareStartupWarmup.includes('BOS_WARMUP_ASSET_ATTEMPTS') &&
      cloudflareStartupWarmup.includes('BOS_WARMUP_ASSET_RETRY_DELAY_MS') &&
      cloudflareStartupWarmup.includes('--asset-attempts') &&
      cloudflareStartupWarmup.includes('--asset-retry-delay-ms'),
    retriesTransientTunnelErrors: cloudflareStartupWarmup.includes('result.status === 0') &&
      cloudflareStartupWarmup.includes('result.status === 429') &&
      cloudflareStartupWarmup.includes('result.status >= 500'),
    retryLoopReportsAttempts: cloudflareStartupWarmup.includes('async function fetchDocumentWithRetry') &&
      cloudflareStartupWarmup.includes('attempts.push(result)') &&
      cloudflareStartupWarmup.includes('attemptCount: attempts.length'),
    retriesTransientAssetErrors: cloudflareStartupWarmup.includes('async function fetchAssetWithRetry') &&
      cloudflareStartupWarmup.includes('function shouldRetryAssetFetch') &&
      cloudflareStartupWarmup.includes('args.assetRetryDelayMs'),
    routeSpecificAdminWarmup: cloudflareStartupWarmup.includes("DEFAULT_ADMIN_ROUTE_PATHS = ['/', '/products', '/inventory', '/pos', '/branches', '/files', '/users', '/audit-log']") &&
      cloudflareStartupWarmup.includes('BOS_WARMUP_ADMIN_ROUTES') &&
      cloudflareStartupWarmup.includes('--admin-route') &&
      cloudflareStartupWarmup.includes('args.adminRoutes.map'),
    warmsHttpLinkHeaders: cloudflareStartupWarmup.includes('function extractLinkHeaderAssets') &&
      cloudflareStartupWarmup.includes("response.headers.get('link')") &&
      cloudflareStartupWarmup.includes('...extractLinkHeaderAssets(baseUrl, documentResult.linkHeader)'),
    warmsAdminChunkDependencies: cloudflareStartupWarmup.includes('function extractFetchedChunkDependencies') &&
      cloudflareStartupWarmup.includes('async function warmAssetsWithGraph') &&
      cloudflareStartupWarmup.includes("await warmAssetsWithGraph(baseUrl, documentAssets, args, name !== 'public')") &&
      cloudflareStartupWarmup.includes("new URL(match[1], assetUrl)") &&
      cloudflareStartupWarmup.includes('ADMIN_FIRST_WINDOW_DEPENDENCY_RE.test(asset)') &&
      cloudflareStartupWarmup.includes('BOS_WARMUP_ASSET_GRAPH_DEPTH') &&
      cloudflareStartupWarmup.includes('dependencyAssetCount'),
    parallelSurfaceWarmup: cloudflareStartupWarmup.includes('const results = await runLimited(') &&
      cloudflareStartupWarmup.includes('surfaces,') &&
      cloudflareStartupWarmup.includes('(surface) => warmSurface(surface.name, surface.baseUrl, surface.path, args)'),
  }
  const packageStageScript = read(buildPackageStagePath)
  const serverEntryScript = read(buildServerEntryPath)
  const packageStageCoverage = {
    serverEntryScriptPresent: fs.existsSync(buildServerEntryPath),
    serverEntrySourceOfTruth: serverEntryScript.includes("const SOURCE_PATH = path.join(BACKEND_ROOT, 'server.ts')") &&
      serverEntryScript.includes("const OUTPUT_PATH = path.join(BACKEND_ROOT, 'server.js')"),
    serverEntryBuildScript: backendPackage?.scripts?.['build:server-entry']?.includes('build-server-entry.ts') &&
      backendPackage?.scripts?.['verify:server-entry']?.includes('build-server-entry.ts --check') &&
      backendPackage?.scripts?.['test:utils']?.includes('verify:server-entry'),
    linuxBuildRegeneratesServerEntry: backendPackage?.scripts?.['build:linux']?.includes('build:server-entry') &&
      backendPackage?.scripts?.['build:linux']?.includes('build-package-stage.ts'),
    scriptPresent: fs.existsSync(buildPackageStagePath),
    buildScriptUsesStage: backendPackage?.scripts?.['build:linux']?.includes('build-package-stage.ts') &&
      backendPackage?.scripts?.['build:linux']?.includes('@yao-pkg/pkg .pkg-stage'),
    stageIgnored: gitignore.includes('backend/.pkg-stage/'),
    stageRewritesRuntimeRequires: packageStageScript.includes('rewriteRuntimeRequires') &&
      packageStageScript.includes("require($1$2.js$1)") &&
      packageStageScript.includes("\\.ts\\1"),
    stageRenamesTsToJs: packageStageScript.includes("if (ext === '.ts') pendingRenames.push(file)") &&
      packageStageScript.includes("source.slice(0, -3) + '.js'"),
    stageRejectsUnexpectedDeletes: packageStageScript.includes("path.basename(resolved) !== '.pkg-stage'") &&
      packageStageScript.includes('Refusing to remove unexpected package stage'),
    stagePackageScriptsAreJavaScript: packageStageScript.includes("'src/**/*.js'") &&
      !packageStageScript.includes("'src/**/*.ts'"),
  }
  assertBooleanCoverage(packageStageCoverage, 'packageStageCoverage')

  const pruneStorage = read(pruneStoragePath)
  const pruneRequiredEntries = [
    '--docker-safe-prune',
    "args: ['container', 'prune', '-f']",
    "args: ['builder', 'prune', '-f']",
    'Volumes and images are never pruned',
  ]
  pruneRequiredEntries.forEach((token) => requireToken(pruneStorage, token, 'Storage retention prune script'))
  const unsafeDockerPruneTokens = [
    "args: ['volume', 'prune'",
    "args: ['image', 'prune'",
    "args: ['system', 'prune'",
  ]
  unsafeDockerPruneTokens.forEach((token) => {
    if (pruneStorage.includes(token)) failures.push(`Storage retention prune script must not run unsafe Docker prune command: ${token}`)
  })

  const fullAutomation = read(fullAutomationPath)
  const cleanupTestData = read(cleanupTestDataPath)
  const actionHistoryCheck = read(actionHistoryCheckPath)
  const liveSmoke = read(liveSmokePath)
  const fullAppAudit = read(fullAppAuditPath)
  let opsPackage = null
  requireToken(fullAutomation, "'--policy', $PolicyPath", 'Full automation retention cleanup')
  let policy = null
  let dockerSafePrunePolicy = false
  let policyParseError = ''
  try {
    policy = JSON.parse(read(automationPolicyPath))
    dockerSafePrunePolicy = policy?.cleanup?.dockerSafePrune === true
    if (policy?.cleanup?.dockerSafePrune !== true) {
      failures.push('Automation policy must enable cleanup.dockerSafePrune for bounded release cleanup.')
    }
  } catch (error) {
    policyParseError = error.message
    failures.push(`Automation policy JSON is invalid: ${error.message}`)
  }

  try {
    opsPackage = JSON.parse(read(opsPackagePath))
  } catch (error) {
    failures.push(`Ops package JSON is invalid: ${error.message}`)
  }

  const cloudflareRuntimeCoverage = buildCloudflareRuntimeCoverage({
    policy,
    policyParseError,
    pruneStorage,
    gitignore,
    fullAutomation,
    opsPackage,
  })
  assertCloudflareRuntimeCoverage(cloudflareRuntimeCoverage)
  const testDataCleanupCoverage = buildTestDataCleanupCoverage({
    cleanupTestData,
    actionHistoryCheck,
    fullAppAudit,
    liveSmoke,
    fullAutomation,
    opsPackage,
  })
  assertBooleanCoverage(testDataCleanupCoverage, 'testDataCleanupCoverage')

  const summary = {
    summary: rel(summaryPath),
    status: failures.length ? 'failed' : 'passed',
    failures,
    requiredFiles: requiredFiles.length,
    missingRequiredFiles: requiredFiles.filter((file) => !fs.existsSync(file)).map(rel),
    releaseWrappers: wrappers.length,
    retiredArtifactsPresent: retiredReleaseFiles.filter((file) => fs.existsSync(file)).map(rel),
    dockerignoreRequiredEntries: dockerignoreRequiredEntries.length,
    dockerignoreCoverageMissing: dockerignoreRequiredEntries.filter((token) => !dockerignore.includes(token)),
    gitignoreRequiredEntries: gitignoreRequiredEntries.length,
    gitignoreCoverageMissing: gitignoreRequiredEntries.filter((token) => !gitignore.includes(token)),
    pruneRequiredEntries: pruneRequiredEntries.length,
    pruneCoverageMissing: pruneRequiredEntries.filter((token) => !pruneStorage.includes(token)),
    unsafeDockerPruneTokensPresent: unsafeDockerPruneTokens.filter((token) => pruneStorage.includes(token)),
    dockerSafePruneFlagInAutomation: pruneStorage.includes('--docker-safe-prune'),
    fullAutomationPolicyPrune: fullAutomation.includes("'--policy', $PolicyPath") &&
      !fullAutomation.includes('--docker-safe-prune'),
    dockerSafePrunePolicy,
    postStartDiagnosticsCoverage,
    cloudflareStartupWarmupCoverage,
    packageStageCoverage,
    cloudflareRuntimeCoverage,
    testDataCleanupCoverage,
    policyParseError,
  }
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true })
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)

  if (failures.length) {
    console.error('Docker release verification failed:')
    failures.forEach((failure) => console.error(`- ${failure}`))
    console.error(`Summary written to ${rel(summaryPath)}`)
    process.exit(1)
  }
  console.log('Docker release verification passed.')
  console.log(JSON.stringify(summary, null, 2))
}

main()
