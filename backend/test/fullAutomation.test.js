'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function runTest(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    console.error(error)
    process.exitCode = 1
  }
}

runTest('full automation launcher and policy are present', () => {
  const launcher = read('run/full-automation.bat')
  const script = read('ops/scripts/powershell/full-automation.ps1')
  const secretHygieneVerify = read('ops/scripts/verification/verify-secret-hygiene.js')
  const policy = JSON.parse(read('ops/automation/business-os-automation.json'))

  assert.match(launcher, /full-automation\.ps1/)
  assert.doesNotMatch(script, /node @args/)
  assert.match(script, /node @cloudflareArgs/)
  assert.equal(policy.domains.admin, 'https://admin.leangcosmetics.dpdns.org')
  assert.equal(policy.domains.public, 'https://leangcosmetics.dpdns.org')
  assert.deepEqual(policy.cloudflare.allowedCountries, ['KH', 'HK', 'AU'])
  assert.equal(policy.cloudflare.rateLimitProfile, 'normal')
  assert.equal(policy.cloudflare.adminAccessMode, 'app-auth-only')
  assert.equal(policy.cloudflare.accessSessionDuration, '720h')
  assert.equal(policy.offline.pinLength, 6)
  assert.equal(policy.offline.autoEnable, true)
  assert.equal(policy.offline.scope, 'all_business_edits')
  assert.equal(policy.backups.retentionDays, 7)
  assert.equal(policy.backups.localKeepLatest, 3)
  assert.equal(policy.backups.cloudflareR2KeepLatest, 1)
  assert.equal(policy.backups.googleDrive, true)
  assert.equal(policy.backups.cloudflareR2, true)
  assert.equal(policy.cleanup.runtimeReportsKeepLatest, 20)
  assert.equal(policy.cleanup.recoveryReportsKeepLatest, 5)
  assert.equal(policy.cleanup.runtimeLogFileMaxBytes, 1048576)
  assert.equal(policy.cleanup.dockerSafePrune, true)
  assert.equal(policy.cleanup.generatedBulkCandidateMaxBytes, 536870912)
  assert.equal(policy.media.objectStorage, 'r2')

  ;[
    'npm.cmd --prefix frontend run test:utils',
    'npm.cmd --prefix backend run test:utils',
    'npm.cmd --prefix frontend run verify:i18n',
    'npm.cmd --prefix frontend run verify:ui',
    'npm.cmd --prefix frontend run verify:performance',
    'npm.cmd --prefix frontend run build',
    'phase29-audit.ts',
    'Phase 29 schema, organization, cleanup, language, and Docker guardrail audit',
    'verify-hardening-policy.js',
    'verify-backup-reliability.js',
    'verify-r2-object-store.ts',
    'Action history undo/redo live verification',
    'action-history-undo-redo-check.ts',
    'prune-storage.ts',
    "'--policy', $PolicyPath",
    "'--output', $StoragePruneReport",
    'prune-storage-latest.json',
    'Runtime report and backup retention cleanup',
    'Invoke-TestDataCleanupPostcheck',
    'test-data-cleanup-postcheck-latest.json',
    'live-smoke-cleanup-postcheck-latest.json',
    'action-history-cleanup-postcheck-latest.json',
    'docker-release.ps1',
    '/health',
    '/sw.js',
    'git commit',
    'git push origin main',
  ].forEach((token) => assert.match(script, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))))

  assert.match(secretHygieneVerify, /require\('\.\.\/lib\/fs-utils\.js'\)/)
  assert.match(secretHygieneVerify, /readUtf8/)
  assert.doesNotMatch(secretHygieneVerify, /fs\.readFileSync\(absolute, 'utf8'\)/)
})

runTest('cloudflare automation is explicit about account-level permissions', () => {
  const script = read('ops/scripts/runtime/cloudflare/verify-cloudflare-automation.ts')
  const r2Verifier = read('ops/scripts/runtime/cloudflare/verify-r2-object-store.ts')
  const oldWrapperPath = path.join(root, 'ops', 'scripts', 'runtime', 'verify-cloudflare-automation.ts')
  const readme = read('ops/automation/README.md')
  assert.match(script, /cloudflare-api-token\.txt/)
  assert.match(script, /require\('\.\.\/\.\.\/lib\/fs-utils\.js'\)/)
  assert.match(script, /readJson/)
  assert.match(script, /readUtf8/)
  assert.match(script, /access\/apps/)
  assert.match(script, /rulesets/)
  assert.match(script, /upsertAccessApp/)
  assert.match(script, /adminAccessMode/)
  assert.match(script, /Business OS Admin App Auth Bypass/)
  assert.match(script, /accessSessionDuration/)
  assert.match(script, /session_duration/)
  assert.match(script, /http_request_firewall_custom/)
  assert.match(script, /Business OS obvious injection block/)
  assert.doesNotMatch(script, /managed_challenge/)
  assert.match(script, /Account\.Cloudflare Access: Edit/)
  assert.match(script, /Zone\.Rulesets: Edit/)
  assert.match(script, /leangcosmetics\.dpdns\.org/)
  assert.doesNotMatch(script, /function readJson/)
  assert.equal(fs.existsSync(oldWrapperPath), false)
  assert.match(readme, /Access: Apps and Policies/)
  assert.match(readme, /Zone Rulesets/)
  assert.match(readme, /Workers R2 Storage/)
  assert.match(readme, /ops\/runtime\/secrets\/cloudflare-api-token\.txt/)
  assert.match(readme, /ops\/runtime\/automation\/access-emails\.txt/)
  assert.match(r2Verifier, /Cloudflare API fallback/)
  assert.match(r2Verifier, /testObjectStore/)
  assert.match(r2Verifier, /isAuthLikeError/)
})

runTest('scaled runtime profile includes the cloudflare connector', () => {
  const compose = read('ops/docker/compose.scale.yml')
  const scaleVerify = read('ops/scripts/verification/verify-scale-services.js')
  assert.match(scaleVerify, /require\('\.\.\/lib\/fs-utils\.js'\)/)
  assert.match(scaleVerify, /readUtf8/)
  assert.doesNotMatch(scaleVerify, /fs\.readFileSync\(COMPOSE_FILE, 'utf8'\)/)
  assert.match(compose, /cloudflared:\s+image:\s+cloudflare\/cloudflared:latest/s)
  assert.match(compose, /profiles:\s*\["runtime",\s*"cloudflare-runtime"\]/)
  assert.match(compose, /--protocol",\s*"http2"/)
  assert.match(compose, /--token-file",\s*"\/run\/secrets\/cloudflare\.token"/)
  assert.match(compose, /--url",\s*"http:\/\/127\.0\.0\.1:4000"/)
  assert.match(compose, /S3_ENDPOINT:\s+"\$\{S3_ENDPOINT:-https:\/\/743e5b727d139e85ed11679097f6f99e\.r2\.cloudflarestorage\.com\}"/)
  assert.match(compose, /S3_ACCESS_KEY_ID:\s+"\$\{S3_ACCESS_KEY_ID:-businessos\}"/)
  assert.doesNotMatch(compose, /S3_ENDPOINT:\s+http:\/\/minio:9000/)
  const starter = read('ops/scripts/powershell/start-runtime.ps1')
  assert.match(starter, /docker-release\\docker-release\.env/)
  assert.match(starter, /S3_SECRET_ACCESS_KEY/)
  assert.match(starter, /CLOUDFLARE_API_TOKEN/)
})

runTest('scaled runtime app and workers self-heal backend dependencies', () => {
  const compose = read('ops/docker/compose.scale.yml')
  assert.match(compose, /node_modules\/bcryptjs\/package\.json/)
  assert.match(compose, /node_modules\/pg-native\/package\.json/)
  assert.match(compose, /node_modules\/libpq\/build\/Release\/addon\.node/)
  assert.match(compose, /npm ci --omit=dev --no-audit --prefer-offline --loglevel=warn; fi; npm run start/)
  assert.match(compose, /npm ci --omit=dev --no-audit --prefer-offline --loglevel=warn; fi; npm run worker:import/)
  assert.match(compose, /npm ci --omit=dev --no-audit --prefer-offline --loglevel=warn; fi; npm run worker:media/)
})

runTest('docker release verification protects generated cleanup boundaries', () => {
  const verifier = read('ops/scripts/verification/verify-docker-release.js')
  const cleanupTestData = read('ops/scripts/runtime/storage/cleanup-test-data.ts')
  const actionHistoryCheck = read('ops/scripts/runtime/audits/action-history-undo-redo-check.ts')
  const fullAppAudit = read('ops/scripts/runtime/audits/full-app-audit.ts')
  const liveSmoke = read('ops/scripts/runtime/smoke/live-smoke.ts')
  const opsPackage = JSON.parse(read('ops/package.json'))
  assert.equal(opsPackage.scripts['cleanup-test-data'], 'node scripts/runtime/storage/cleanup-test-data.ts')
  assert.equal(opsPackage.scripts['action-history:check'], 'node scripts/runtime/audits/action-history-undo-redo-check.ts')
  assert.equal(opsPackage.scripts['prune-storage:preview'], 'node scripts/runtime/storage/prune-storage.ts --dry-run --skip-remote --output ops/runtime/reports/prune-storage-preview-latest.json')
  assert.match(opsPackage.scripts['cleanup-test-data:check'], /--fail-on-match/)
  assert.match(opsPackage.scripts['cleanup-test-data:check-smoke'], /--fail-on-match/)
  assert.match(opsPackage.scripts['cleanup-test-data:check-action-history'], /--fail-on-match/)
  assert.match(verifier, /require\('\.\.\/lib\/fs-utils\.js'\)/)
  assert.match(verifier, /readUtf8/)
  assert.doesNotMatch(verifier, /fs\.readFileSync\(file, 'utf8'\)/)
  ;[
    '.dockerignore',
    '.gitignore',
    'prune-storage.ts',
    'business-os-automation.json',
    'node_modules',
    '**/node_modules',
    'frontend/dist',
    'backend/frontend-dist',
    'business-os-data',
    'ops/runtime',
    'release',
    'output',
    'ops/.playwright-cli',
    'run/cv-render-check-word',
    '--docker-safe-prune',
    "args: ['container', 'prune', '-f']",
    "args: ['builder', 'prune', '-f']",
    "args: ['volume', 'prune'",
    "args: ['image', 'prune'",
    "args: ['system', 'prune'",
    'dockerSafePrune',
    'DOCKER-RELEASE-GUARDRAIL.json',
    'unsafeDockerPruneTokensPresent',
    'dockerSafePrunePolicy',
    'dockerSafePruneFlagInAutomation',
    'postStartDiagnosticsCoverage',
    'cloudflareRuntimeCoverage',
    'testDataCleanupCoverage',
    'qa-smoke-test-data-cleanup-guardrail',
    'actionHistoryCheckPresent',
    'actionHistoryPackageScriptPresent',
    'liveSmokeScriptPresent',
    'packagePostcheckScriptsPresent',
    'dryRunDefault',
    'explicitApplyRequired',
    'failOnMatchPostcheckSupported',
    'qaSelectorBounded',
    'deletesDependentBusinessRows',
    'diskImportCleanupBounded',
    'prefixImportCleanupSupported',
    'lookupResiduePostcheck',
    'fullAppAuditFinallyCleanup',
    'fullAppAuditCleanupReport',
    'actionHistoryUndoRedoCheck',
    'fullAutomationActionHistoryCheck',
    'liveSmokeFinallyCleanup',
    'liveSmokeLookupPrefixScoped',
    'liveSmokeCleanupReport',
    'fullAutomationPostcheck',
    'local-runtime-and-cloudflare-retention-guardrail',
    'rotate-cloudflare-tunnel-token.ts',
    'update-cloudflare-tunnel-origin.ts',
    'verify-cloudflare-automation.ts',
    'verify-r2-object-store.ts',
    'wrapperPaths',
    'hostOriginWrapper: rel',
    'dockerRotateWrapper: rel',
    'hostOriginDelegatesToScript',
    'dockerRotateDelegatesToScript',
    'rotatesTunnelSecret',
    'disconnectsOldConnections',
    'supportsHostMode',
    'supportsDockerMode',
    'apiTokenFileRuntimeOnly',
    'longAccessSessionConfigured',
    'remoteBackupsKeepLatestOne',
    'remoteBackupPruneEnabled',
    'remoteR2BackupsPruned',
    'includeFiles: true',
    'runtimeLogsCompacted',
    'policyDefaultsLoadedByPruneStorage',
    'pruneStorageOutputFlagSupported',
    'latestCleanupReportWrittenByAutomation',
    'latestCleanupReportRuntimeOnly',
    'DEFAULT_POLICY_PATH',
    '--output',
    'outputPath',
    'prune-storage-latest.json',
    'prune-storage:preview',
    'previewScriptDryRun',
    'previewNameRequiresDryRun',
    'Refusing to write a preview-named prune report without --dry-run',
    'runtimeReportsKeepLatest',
    'recoveryReportsKeepLatest',
    'runtimeLogFileMaxBytes',
    'compactRuntimeLogs',
    '--log-file-max-bytes',
    'business-os log compacted',
    'tokenFileContentsNotRead',
    'releaseHealthCheck',
    'startRuntimeCheck',
    'localVerifyCheck',
    'localSkipIfUnavailable',
    'post-start-diagnostics.ts',
    'post-start-diagnostics.json',
    'Post-start diagnostics',
    '/api/runtime/version',
    '/business-os-build.json',
    '/sw.js',
    'verify-local-post-start-diagnostics.json',
    '--skip-if-unavailable',
  ].forEach((token) => assert.match(verifier, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))))

  ;[
    '--all-qa',
    '--prefix',
    '--apply',
    '--dry-run',
    '--fail-on-match',
    'countMatchedRows',
    'Refusing clean postcheck',
    'Refusing to scan without --all-qa or --prefix',
    'QA Audit %',
    'QA Smoke %',
    'QA Deep Audit %',
    'QA Action History %',
    'lookupNameWhere',
    'business-os-full-audit',
    'business-os-live-smoke',
    'fileMatchesGeneratedImport',
    'findGeneratedImportDirectories(args)',
    'f.original_name ILIKE',
    'return_item_batch_allocations',
    'sale_item_batch_allocations',
    'inventory_movements',
    'stock_transfers',
    'import_job_files',
    'action_history',
    'audit_logs',
    '_bos_test_categories',
    '_bos_test_units',
    'ROLLBACK',
    'COMMIT',
  ].forEach((token) => assert.match(cleanupTestData, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))))

  ;[
    'cleanup-test-data.ts',
    'BOS_AUDIT_CLEANUP',
    'test-data-cleanup.json',
    '--all-qa',
    '--apply',
    'finally',
    'cleanupAuditData',
  ].forEach((token) => assert.match(fullAppAudit, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))))

  ;[
    '/api/action-history',
    '/undo',
    '/redo',
    'payloadRoundTrip',
    'cleanupActionHistoryData',
    'action-history-undo-redo-latest.json',
    'action-history-undo-redo-cleanup-latest.json',
    'action-history-undo-redo-cleanup-postcheck-latest.json',
    '--fail-on-match',
    'BOS_ACTION_HISTORY_CLEANUP',
  ].forEach((token) => assert.match(actionHistoryCheck, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))))

  ;[
    'cleanupLiveSmokeData',
    'BOS_SMOKE_CLEANUP',
    'live-smoke-cleanup-latest.json',
    'cleanup-test-data.ts',
    '--prefix',
    '--apply',
    'finally',
  ].forEach((token) => assert.match(liveSmoke, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))))
})

runTest('generated bulk audit measures cleanup candidates without parsing them as source', () => {
  const opsPackage = JSON.parse(read('ops/package.json'))
  const audit = read('ops/scripts/architecture/generated-bulk-audit.ts')
  const cleanGenerated = read('ops/scripts/powershell/clean-generated.ps1')
  assert.equal(opsPackage.scripts['clean-generated:preview'], 'powershell -ExecutionPolicy Bypass -File scripts/powershell/clean-generated.ps1 -Preview')
  assert.equal(opsPackage.scripts['generated-bulk-audit'], 'node scripts/architecture/generated-bulk-audit.ts')
  ;[
    'business-os-data',
    'ops/runtime/secrets',
    'frontend/node_modules',
    'frontend/dist',
    'release',
    'output',
    'run/cv-render-check-word',
    'parseAsSource: false',
    'protected: true',
    'generatedBulkCandidateMaxBytes',
    'largestProtectedTargets',
    'largestCleanupTargets',
    'nestedTargetOverlaps',
    'adjustedTotalBytes',
    'adjustedCleanupCandidateBytes',
    'slowestTargetMeasurements',
    'summarizeByDisposition',
    'dispositionTotals',
    'Disposition Totals',
    'measureMs',
    'FILE_STAT_CONCURRENCY',
    'fileStatMode',
    'fileStatConcurrency',
    'measurementMode',
    'bounded-parallel-targets',
    'measuredTargetsInParallel',
    'targetMeasureConcurrency',
    'thresholdExceeded',
    'dependencyTopology',
    'separate-install-roots-with-orphan-root-cleanup',
    'rootNodeModulesSafeToDelete',
    'cleanGeneratedCovered',
    'cleanupCoverageGaps',
    'clean-generated.ps1',
    'GENERATED-BULK-AUDIT.json',
    'prune-storage --docker-safe-prune',
    'GENERATED-BULK-AUDIT.md',
  ].forEach((token) => assert.match(audit, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))))
  ;[
    'frontend\\node_modules',
    'frontend\\dist',
    'backend\\node_modules',
    'backend\\frontend-dist',
    'node_modules',
    'ops\\node_modules',
    'release',
    'output',
    '.playwright-cli',
    'ops\\.playwright-cli',
    'run\\cv-render-check-word',
    'Get-PathSizeBytes',
    'Format-Bytes',
    'Cleanup target summary',
    'Total bytes removed',
    'Total bytes that would be removed',
  ].forEach((token) => assert.match(cleanGenerated, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))))
})

runTest('run files share npm install freshness helper', () => {
  const setup = read('run/setup.bat')
  const verifyLocal = read('run/verify-local.bat')
  const helper = read('ops/scripts/powershell/npm-install-mode.ps1')

  ;[
    'node_modules/.package-lock.json',
    'package-lock.json',
    'package.json',
    "Write-Output 'skip'",
    "Write-Output 'install'",
  ].forEach((token) => assert.match(helper, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))))

  ;[
    setup,
    verifyLocal,
  ].forEach((source) => {
    assert.match(source, /npm-install-mode\.ps1/)
    assert.doesNotMatch(source, /LastWriteTimeUtc/)
    assert.doesNotMatch(source, /node_modules\/\.package-lock\.json/)
  })
})

runTest('phase 29 audit orchestrates non-mutating sweep gates', () => {
  const opsPackage = JSON.parse(read('ops/package.json'))
  const audit = read('ops/scripts/architecture/phase29-audit.ts')
  assert.equal(opsPackage.scripts['phase29:audit'], 'node scripts/architecture/phase29-audit.ts')
  assert.equal(opsPackage.scripts['phase29:audit:repeat'], 'node scripts/architecture/phase29-audit.ts --repeat 3')
  assert.equal(opsPackage.scripts['language-runtime-audit'], 'node scripts/architecture/language-runtime-audit.ts')
  ;[
    '--repeat',
    '--verbose',
    'parseArgs',
    'parseLastJsonObject',
    'buildDurationSummary',
    'buildRepeatConsistency',
    'summarizeReportValue',
    'outputTail',
    'verboseChildOutput',
    'Full repeat values are retained',
    'Console output is concise by default',
    'generated-bulk-audit.ts',
    'organization-audit.ts',
    'ORGANIZATION-AUDIT.json',
    'fileReadMode',
    'rootWalkMode',
    'rootWalkConcurrency',
    'fileReadConcurrency',
    'schema-audit.js',
    'performance-scan.js',
    'language-runtime-audit.ts',
    'verify-docker-release.js',
    'PHASE29-AUDIT.md',
    'PHASE29-AUDIT.json',
    'ORGANIZATION-AUDIT.json',
    'SCHEMA-AUDIT.json',
    'PERFORMANCE-SCAN.json',
    'LANGUAGE-RUNTIME-AUDIT.md',
    'LANGUAGE-RUNTIME-AUDIT.json',
    'DOCKER-RELEASE-GUARDRAIL.json',
    'RUNTIME-DEPS-GUARDRAIL.json',
    'buildSummary',
    'durationSummary',
    'executionMode',
    'contention-safe-reference-writers-then-bounded-guardrails',
    'REFERENCE_WRITER_CONCURRENCY',
    'referenceWriterConcurrency',
    'PARALLEL_CHECK_CONCURRENCY',
    'parallelCheckConcurrency',
    'runCheckGroup',
    'slowestRuns',
    'Duration Summary',
    'repeat',
    'cycles',
    'repeatConsistency',
    'relationshipDocMissingEntities',
    'backupActionNeededGaps',
    'staticPrimaryKeyGaps',
    'staticPrimaryKeyGapTables',
    'staticPrimaryKeyGapDetails',
    'measuredTargetsInParallel',
    'targetMeasureConcurrency',
    'fileStatMode',
    'nestedTargetOverlaps',
    'largestCleanupTargets',
    'dependencyTopology',
    'largeFilePaths',
    'largestAreas',
    'wrapperFiles',
    'topSourceBySize',
    'topSourceByLines',
    'topBuiltChunks',
    'manualNotesPreserved',
    'manualNotesLines',
    'sourceReadMode',
    'sourceReadConcurrency',
    'chunkStatConcurrency',
    'Performance/code-flow scan',
    'Language/runtime audit',
    'fileReadMode',
    'rootWalkMode',
    'rootWalkConcurrency',
    'matrixCheckMode',
    'matrixCheckConcurrency',
    'fileReadConcurrency',
    'runtimePolicy',
    'verificationMatrix',
    'firstExecutableSlices',
    'proofCommandCoverage',
    'missingProofCommands',
    'focusedTestCoverage',
    'focusedTestCoverageGaps',
    'convertedTypeScriptSlices',
    'convertedTypeScriptCoverageGaps',
    'conversionCandidates',
    'rejectedRuntimeFamilies',
    'Docker release guardrail',
    'Runtime dependency guardrail',
    'versionConsistency',
    'unsafeDockerPruneTokensPresent',
    'dockerSafePrunePolicy',
    'postStartDiagnosticsCoverage',
    'cloudflareRuntimeCoverage',
    'fullAutomationPolicyPrune',
    'runtimeVersionGuardCoverage',
    'localVerificationCoverage',
    'Repeat drift',
    'non-mutating audit',
    'does not delete files',
    'does not delete files, move folders, run migrations, or prune remote storage',
  ].forEach((token) => assert.match(audit, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))))
  assert.match(audit, /mapLimit\(checks, concurrency/)
  assert.doesNotMatch(audit, /Promise\.all\(checks\.map/)
  assert.doesNotMatch(audit, /Remove-Item|rm\s+-rf|docker\s+volume\s+prune|deleteObjects\(/)
})

runTest('performance scan preserves phase 29 manual notes', () => {
  const script = read('ops/scripts/docs/performance-scan.js')

  ;[
    'MANUAL_NOTES_START',
    'MANUAL_NOTES_END',
    'readManualNotes',
    'manualNotesPreserved',
    'manualNotesLines',
    'SOURCE_READ_MODE',
    'SOURCE_READ_CONCURRENCY',
    'mapLimit',
    'readSourceRow',
    '- Move 178 reduces',
    'phase29-manual-notes:start',
  ].forEach((token) => assert.match(script, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))))

  const fsUtils = read('ops/scripts/lib/fs-utils.js')
  ;[
    'async function mapLimit',
    'async function pathExists',
    'async function readUtf8Async',
    'async function readJsonAsync',
    'fs.promises.access',
    'fs.promises.readFile',
    'Promise.all(workers)',
    'module.exports',
  ].forEach((token) => assert.match(fsUtils, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))))
})

runTest('architecture audits share bounded worker helper', () => {
  const generatedBulkAudit = read('ops/scripts/architecture/generated-bulk-audit.ts')
  const organizationAudit = read('ops/scripts/architecture/organization-audit.ts')
  const phase29Audit = read('ops/scripts/architecture/phase29-audit.ts')
  const languageRuntimeAudit = read('ops/scripts/architecture/language-runtime-audit.ts')
  const hardeningPolicyVerify = read('ops/scripts/verification/verify-hardening-policy.js')
  const runtimeDepsVerify = read('ops/scripts/verification/verify-runtime-deps.js')
  const backupReliabilityVerify = read('ops/scripts/verification/verify-backup-reliability.js')
  const frontendVerifyUi = read('ops/scripts/frontend/verify-ui.js')
  const auditReportHtml = read('ops/scripts/runtime/audits/audit-report-html.ts')
  const reportUtils = read('ops/scripts/lib/report-utils.js')

  ;[
    generatedBulkAudit,
    organizationAudit,
    phase29Audit,
    languageRuntimeAudit,
  ].forEach((source) => {
    assert.match(source, /require\('node:/)
    assert.match(source, /require\('\.\.\/lib\/fs-utils\.js'\)/)
    assert.match(source, /require\('\.\.\/lib\/report-utils\.js'\)/)
    assert.match(source, /toPosix: normalizePath/)
    assert.doesNotMatch(source, /function normalizePath/)
    assert.doesNotMatch(source, /function markdownTable/)
  })

  ;[
    'function markdownTable',
    'function summarizeReportValue',
    'function outputTail',
    'function formatBytes',
    'stableDigest',
    'sha256',
    'module.exports',
  ].forEach((token) => assert.match(reportUtils, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))))

  assert.match(languageRuntimeAudit, /mapLimit/)
  assert.match(languageRuntimeAudit, /readJsonAsync/)
  assert.match(languageRuntimeAudit, /FILE_READ_MODE/)
  assert.match(languageRuntimeAudit, /ROOT_WALK_CONCURRENCY/)
  assert.match(languageRuntimeAudit, /MATRIX_CHECK_CONCURRENCY/)
  assert.match(languageRuntimeAudit, /rootWalkMode/)
  assert.match(languageRuntimeAudit, /matrixCheckMode/)
  assert.match(languageRuntimeAudit, /FILE_READ_CONCURRENCY/)
  assert.match(languageRuntimeAudit, /pathExists/)
  assert.match(organizationAudit, /pathExists/)
  assert.match(organizationAudit, /ROOT_WALK_CONCURRENCY/)
  assert.match(organizationAudit, /rootWalkMode/)
  assert.match(organizationAudit, /rootWalkConcurrency/)
  assert.doesNotMatch(organizationAudit, /Promise\.all\(SCAN_ROOTS\.map/)
  assert.doesNotMatch(organizationAudit, /Promise\.all\(SCAN_FILES\.map/)
  assert.match(phase29Audit, /pathExists: filePathExists/)
  ;[
    organizationAudit,
    languageRuntimeAudit,
    phase29Audit,
  ].forEach((source) => {
    assert.doesNotMatch(source, /async function pathExists/)
  })
  assert.doesNotMatch(languageRuntimeAudit, /Promise\.all\(files\.map/)
  assert.doesNotMatch(languageRuntimeAudit, /Promise\.all\(SCAN_ROOTS\.map/)
  assert.doesNotMatch(languageRuntimeAudit, /Promise\.all\(FOCUSED_TEST_COVERAGE\.map/)
  assert.doesNotMatch(languageRuntimeAudit, /Promise\.all\(CONVERTED_TYPESCRIPT_SLICES\.map/)
  assert.doesNotMatch(languageRuntimeAudit, /Promise\.all\(COMPLETED_WEB_WORKER_SLICES\.map/)
  assert.doesNotMatch(languageRuntimeAudit, /Promise\.all\(COMPLETED_DATA_PATH_SLICES\.map/)
  assert.doesNotMatch(languageRuntimeAudit, /async function readJson/)

  ;[
    generatedBulkAudit,
    organizationAudit,
  ].forEach((source) => {
    assert.match(source, /mapLimit/)
    assert.doesNotMatch(source, /async function mapLimit/)
  })
  assert.match(generatedBulkAudit, /TARGET_MEASURE_CONCURRENCY/)
  assert.match(generatedBulkAudit, /formatBytes/)
  assert.match(generatedBulkAudit, /readUtf8Async/)
  assert.match(generatedBulkAudit, /readJsonAsync/)
  assert.doesNotMatch(generatedBulkAudit, /function formatBytes/)
  assert.doesNotMatch(generatedBulkAudit, /async function readText/)
  assert.doesNotMatch(generatedBulkAudit, /async function readJsonFile/)
  assert.doesNotMatch(generatedBulkAudit, /Promise\.all\(TARGETS\.map/)

  assert.match(hardeningPolicyVerify, /require\('\.\.\/lib\/fs-utils\.js'\)/)
  assert.match(hardeningPolicyVerify, /readJson/)
  assert.match(hardeningPolicyVerify, /readUtf8/)
  assert.match(hardeningPolicyVerify, /--exclude-standard/)
  assert.doesNotMatch(hardeningPolicyVerify, /function readText/)
  assert.doesNotMatch(hardeningPolicyVerify, /function readJson/)

  assert.match(runtimeDepsVerify, /require\('\.\.\/lib\/fs-utils\.js'\)/)
  assert.match(runtimeDepsVerify, /readJson/)
  assert.match(runtimeDepsVerify, /readUtf8/)
  ;[
    'RUNTIME-DEPS-GUARDRAIL.json',
    'assertCoverageComplete',
    'is missing coverage',
    'buildVersionConsistency',
    'assertVersionConsistency',
    'versionConsistency',
    'appVersion',
    'opsVersion',
    'backendLock',
    'frontendLock',
    'opsLock',
    'runtimeVersionGuardCoverage',
    'localVerificationCoverage',
    'progressLabelCoverage',
    'staleFractionLabelsAbsent',
    '[preflight 1/6]',
    '[frontend 6/6]',
    '[backend 3/3]',
    'verify-local.bat',
    'npm-install-mode.ps1',
    'sharedNpmInstallModeHelper',
    'runtimeDepsGuard',
    'dockerReleaseGuard',
    'secretHygieneGuard',
    'dockerDoctor',
    'routeContractSmoke',
    'postStartDiagnostics',
    'frontendDependencyInstall',
    'frontendBuild',
    'frontendUtils',
    'frontendI18n',
    'frontendUiCoverage',
    'frontendPerformance',
    'backendDependencyInstall',
    'backendUtils',
    'backendIntegrity',
    'viteBuildManifest',
    'serviceWorkerBuildHash',
    'frontendMismatchDispatch',
    'appContextMismatchListener',
    'backendRuntimeVersionRoute',
    'backendFrontendBuildReader',
    'performanceBuildMetadataGuard',
    'assertRuntimeVersionGuardWiring',
    'assertBuildManifestShapeWhenPresent',
    'business-os-build.json',
    'business-os-build-manifest',
    '__FRONTEND_BUILD_HASH__',
    '__FRONTEND_BUILD_REVISION__',
    'runtime:version-mismatch',
    'shouldCompareRuntimeVersions',
    'checkRuntimeVersionFromHealth',
    'readFrontendBuildInfoFromRoot',
    "router.get('/version'",
    'APP_SHELL_VERSION',
    'STATIC_CACHE',
  ].forEach((token) => assert.match(runtimeDepsVerify, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))))
  assert.doesNotMatch(runtimeDepsVerify, /function readJson/)

  assert.match(backupReliabilityVerify, /require\('\.\.\/lib\/fs-utils\.js'\)/)
  assert.match(backupReliabilityVerify, /readUtf8/)
  assert.doesNotMatch(backupReliabilityVerify, /fs\.readFileSync\(path\.join\(root, relativePath\)/)

  assert.match(frontendVerifyUi, /require\('\.\.\/lib\/fs-utils\.js'\)/)
  assert.match(frontendVerifyUi, /readJson/)
  assert.match(frontendVerifyUi, /readUtf8/)
  assert.doesNotMatch(frontendVerifyUi, /function readText/)
  assert.doesNotMatch(frontendVerifyUi, /function readJson/)

  assert.match(auditReportHtml, /createRequire/)
  assert.match(auditReportHtml, /require\('\.\.\/\.\.\/lib\/report-utils\.js'\)/)
  assert.match(auditReportHtml, /formatBytes/)
  assert.doesNotMatch(auditReportHtml, /function formatBytes/)
})

runTest('backend data integrity verifier reports FK candidate orphans', () => {
  const verifier = read('ops/scripts/backend/verify-data-integrity.js')
  const backendPackage = JSON.parse(read('backend/package.json'))
  assert.equal(backendPackage.scripts['verify:integrity:comprehensive'], 'node ../ops/scripts/backend/verify-data-integrity.js --comprehensive --output ../ops/runtime/reports/data-integrity-comprehensive-latest.json')
  ;[
    '--comprehensive',
    '--output',
    '--sample-limit',
    'checkRelationshipOrphans',
    'overReturned',
    'relationshipOrphans',
    'cleanupClassification',
    'datasetSummary',
    'checkDatasetReadiness',
    'Runtime dataset is empty',
    'restore or import verified business data before production use',
    'queryScalarList',
    'sqlIdentifier',
    'orphanCountSql',
    'UNION ALL',
    'candidateIds',
    'addCleanupCandidateIds',
    'generatedTextMatch',
    'generatedLike',
    'unclassified',
    'classifyIntegrityBacklog',
    'sampleLimit',
    'samples',
    'Relationship orphan checks passed',
    'Found relationship orphan rows',
    "'user_sessions', 'user_id'",
    "'branch_stock', 'product_id'",
    "'sale_items', 'sale_id'",
    "'return_items', 'return_id'",
    "'rfid_events', 'session_id'",
    'Refusing integrity report outside workspace',
  ].forEach((token) => assert.match(verifier, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))))
})

runTest('generated integrity backlog cleanup is guarded and dry-run first', () => {
  const cleanup = read('ops/scripts/runtime/storage/cleanup-integrity-backlog.ts')
  const opsPackage = JSON.parse(read('ops/package.json'))
  assert.equal(
    opsPackage.scripts['cleanup-integrity-backlog'],
    'node scripts/runtime/storage/cleanup-integrity-backlog.ts --dry-run --output ops/runtime/reports/cleanup-integrity-backlog-preview-latest.json',
  )
  assert.equal(
    opsPackage.scripts['cleanup-integrity-backlog:apply'],
    'node scripts/runtime/storage/cleanup-integrity-backlog.ts --apply --output ops/runtime/reports/cleanup-integrity-backlog-apply-latest.json',
  )
  ;[
    'generated-like-integrity-backlog',
    '_bos_integrity_over_return_items',
    '_bos_integrity_orphan_batches',
    '_bos_integrity_branch_batch_stock',
    '_bos_integrity_orphan_return_items',
    '_bos_integrity_inventory_movements',
    '_bos_integrity_stock_transfers',
    'ROLLBACK',
    'COMMIT',
    'Refusing output outside workspace',
  ].forEach((token) => assert.match(cleanup, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))))
})

runTest('dataset readiness has a standalone ops check', () => {
  const readiness = read('ops/scripts/runtime/storage/dataset-readiness.ts')
  const opsPackage = JSON.parse(read('ops/package.json'))
  assert.equal(
    opsPackage.scripts['dataset-readiness'],
    'node scripts/runtime/storage/dataset-readiness.ts --output ops/runtime/reports/dataset-readiness-latest.json',
  )
  assert.equal(
    opsPackage.scripts['dataset-readiness:loaded'],
    'node scripts/runtime/storage/dataset-readiness.ts --fail-if-empty --output ops/runtime/reports/dataset-readiness-latest.json',
  )
  ;[
    '--fail-if-empty',
    'summarizeDataset',
    'loadedTables',
    'Transactional business tables are empty',
    'restore or import verified business data before production use',
    'Refusing output outside workspace',
  ].forEach((token) => assert.match(readiness, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))))
})

runTest('post-live hygiene gate fails on residue or empty datasets', () => {
  const hygiene = read('ops/scripts/runtime/storage/post-live-hygiene.ts')
  const opsPackage = JSON.parse(read('ops/package.json'))
  assert.equal(
    opsPackage.scripts['post-live-hygiene'],
    'node scripts/runtime/storage/post-live-hygiene.ts',
  )
  assert.equal(
    opsPackage.scripts['live-hygiene:check'],
    'node scripts/runtime/storage/post-live-hygiene.ts',
  )
  ;[
    'cleanup-test-data.ts',
    '--all-qa',
    '--fail-on-match',
    'cleanup-integrity-backlog.ts',
    'sumMatchedCounts',
    'Generated integrity cleanup preview still matches',
    'dataset-readiness.ts',
    '--fail-if-empty',
    'Dataset readiness is',
    'verify-data-integrity.js',
    'buildCheckPlan',
    'runChecks',
    "executionMode: 'contention-safe-sequential-checks'",
    'Refusing output outside workspace',
  ].forEach((token) => assert.match(hygiene, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))))
})

runTest('phase 8.4 live suite runs UI, public portal, then hygiene', () => {
  const suite = read('ops/scripts/runtime/live-checks/phase84-live-suite.ts')
  const publicPortal = read('ops/scripts/runtime/live-checks/phase84-public-portal-cloudflare-check.ts')
  const opsPackage = JSON.parse(read('ops/package.json'))
  assert.equal(
    opsPackage.scripts['phase84:live-suite'],
    'node scripts/runtime/live-checks/phase84-live-suite.ts',
  )
  ;[
    'phase84-ui-live-check.ts',
    'phase84-public-portal-cloudflare-check.ts',
    'post-live-hygiene.ts',
    '--skip-ui',
    '--skip-public',
    '--skip-hygiene',
    '--keep-going',
    'reportSummary',
    'latestReportPathForPrefix',
    'generatedIntegrityMatches',
    'stdoutTail: tail(result.stdout)',
    'Refusing output outside workspace',
    'phase84-live-suite-latest.json',
  ].forEach((token) => assert.match(suite, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))))
  ;[
    'isCloudflareScriptMonitorReportOnlyCsp',
    'csp-reporting\\.cloudflare\\.com\\/cdn-cgi\\/script_monitor\\/report',
    'toleratedCloudflareScriptMonitorReportOnlyCsp',
    'app-origin report-only CSP header',
  ].forEach((token) => assert.match(publicPortal, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))))
})

runTest('schema primary-key preflight is read-only and blocker aware', () => {
  const preflight = read('ops/scripts/backend/schema-primary-key-preflight.ts')
  const opsPackage = JSON.parse(read('ops/package.json'))
  assert.equal(
    opsPackage.scripts['schema-pk-preflight'],
    'node scripts/backend/schema-primary-key-preflight.ts',
  )
  assert.equal(
    opsPackage.scripts['schema-pk-preflight:strict'],
    'node scripts/backend/schema-primary-key-preflight.ts --fail-on-blocker',
  )
  ;[
    'schema-primary-key-preflight-latest.json',
    '--fail-on-blocker',
    "mode: 'read-only'",
    'import_jobs',
    'settings',
    'nullKeys',
    'duplicateKeyGroups',
    'readyForPrimaryKey',
    'information_schema.table_constraints',
    'pg_index',
    'Refusing output outside workspace',
    'Create a backup and rollback SQL before applying primary-key DDL',
  ].forEach((token) => assert.match(preflight, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))))
  assert.doesNotMatch(preflight, /\bALTER TABLE\b/)
  assert.doesNotMatch(preflight, /\bCREATE UNIQUE INDEX\b/)
})

runTest('restore candidate scan is non-mutating and file based', () => {
  const restoreCandidates = read('ops/scripts/runtime/storage/restore-candidates.ts')
  const opsPackage = JSON.parse(read('ops/package.json'))
  assert.equal(
    opsPackage.scripts['restore-candidates'],
    'node scripts/runtime/storage/restore-candidates.ts --output ops/runtime/reports/restore-candidates-latest.json',
  )
  assert.equal(
    opsPackage.scripts['restore-candidates:loaded'],
    'node scripts/runtime/storage/restore-candidates.ts --fail-if-no-loaded --output ops/runtime/reports/restore-candidates-latest.json',
  )
  ;[
    'countSqlCopyRows',
    'COPY public',
    'restore-candidate-found',
    'no-loaded-backup-candidate',
    'largest-valid-loaded-backup',
    'latest-valid-loaded-backup',
    'recommended',
    'run/docker/restore.bat -BackupPath',
    'Refusing path outside workspace',
    'manifest.json',
    'postgres.sql',
    'objects-manifest.jsonl',
  ].forEach((token) => assert.match(restoreCandidates, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))))
  assert.doesNotMatch(restoreCandidates, /spawnSync\('docker'/)
})

runTest('restore rehearsal uses a temporary database', () => {
  const rehearsal = read('ops/scripts/runtime/storage/restore-rehearsal.ts')
  const opsPackage = JSON.parse(read('ops/package.json'))
  assert.equal(
    opsPackage.scripts['restore-rehearsal'],
    'node scripts/runtime/storage/restore-rehearsal.ts --output ops/runtime/reports/restore-rehearsal-latest.json',
  )
  ;[
    'business_os_restore_rehearsal_',
    'createdb',
    'dropdb',
    '--keep-db',
    'countRestoredTables',
    'compareCounts',
    'No restore-candidates report found',
    'Refusing path outside workspace',
  ].forEach((token) => assert.match(rehearsal, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))))
  assert.doesNotMatch(rehearsal, /run\/docker\/restore\.bat/)
})

runTest('scaled runtime app and workers self-heal backend dependencies', () => {
  const compose = read('ops/docker/compose.scale.yml')
  assert.match(compose, /node_modules\/bcryptjs\/package\.json/)
  assert.match(compose, /node_modules\/pg-native\/package\.json/)
  assert.match(compose, /node_modules\/libpq\/build\/Release\/addon\.node/)
  assert.match(compose, /npm ci --omit=dev --no-audit --prefer-offline --loglevel=warn; fi; npm run start/)
  assert.match(compose, /npm ci --omit=dev --no-audit --prefer-offline --loglevel=warn; fi; npm run worker:import/)
  assert.match(compose, /npm ci --omit=dev --no-audit --prefer-offline --loglevel=warn; fi; npm run worker:media/)
})
