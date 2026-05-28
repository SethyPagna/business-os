/* eslint-disable no-console */
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { mapLimit, pathExists, readJsonAsync, toPosix: normalizePath } = require('../lib/fs-utils.js')
const { markdownTable } = require('../lib/report-utils.js')
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const REPORT_PATH = path.join(ROOT_DIR, 'ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.md')
const SUMMARY_PATH = path.join(ROOT_DIR, 'ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.json')

const SCAN_ROOTS = ['frontend/src', 'frontend/tests', 'backend/src', 'backend/test', 'ops/scripts', 'run']
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'runtime', '.playwright-cli'])
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx', '.css', '.sql', '.ps1', '.bat', '.cmd', '.sh', '.yml', '.yaml', '.json'])
const FILE_READ_MODE = 'bounded-parallel'
const ROOT_WALK_CONCURRENCY = 3
const MATRIX_CHECK_CONCURRENCY = 8
const FILE_READ_CONCURRENCY = 24

const LANGUAGE_BY_EXTENSION = new Map([
  ['.js', 'JavaScript'],
  ['.jsx', 'React JSX'],
  ['.mjs', 'JavaScript modules'],
  ['.ts', 'TypeScript'],
  ['.tsx', 'React TSX'],
  ['.css', 'CSS'],
  ['.sql', 'SQL'],
  ['.ps1', 'PowerShell'],
  ['.bat', 'Windows batch'],
  ['.cmd', 'Windows command'],
  ['.sh', 'Shell'],
  ['.yml', 'YAML'],
  ['.yaml', 'YAML'],
  ['.json', 'JSON'],
])

async function walkFiles(root) {
  const absoluteRoot = path.join(ROOT_DIR, root)
  if (!(await pathExists(absoluteRoot))) return []
  const output = []
  const stack = [absoluteRoot]
  while (stack.length) {
    const current = stack.pop()
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (EXCLUDED_DIRS.has(entry.name)) continue
      const absolutePath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(absolutePath)
        continue
      }
      const extension = path.extname(entry.name)
      if (SOURCE_EXTENSIONS.has(extension)) output.push(absolutePath)
    }
  }
  return output.sort((left, right) => normalizePath(left).localeCompare(normalizePath(right)))
}

function countBy(items, pickKey) {
  const map = new Map()
  for (const item of items) {
    const key = pickKey(item)
    map.set(key, (map.get(key) || 0) + 1)
  }
  return [...map.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
}

function hasReactOrDomBoundary(source) {
  return /\bReact\b|from ['"]react['"]|<[A-Z][A-Za-z0-9]*|document\.|window\.|navigator\.|localStorage|sessionStorage/.test(source)
}

function hasWorkerCandidateWork(source, relativePath) {
  return /Worker|postMessage|FileReader|Blob|ArrayBuffer|canvas|createImageBitmap|barcode|scanner|csv|parse|import/i.test(`${relativePath}\n${source}`)
}

function hasSqlOrAnalyticsWork(source, relativePath) {
  return /SELECT\s+|INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|CREATE\s+TABLE|JOIN\s+|GROUP BY|analytics|report|export|import/i.test(`${relativePath}\n${source}`)
}

function scoreTypeScriptCandidate(record) {
  if (!['.js', '.mjs'].includes(record.extension)) return 0
  if (!record.relativePath.startsWith('frontend/src/')) return 0
  if (/^\s*export\s+\*\s+from\s+['"].+\.ts['"]\s*;?\s*$/.test(record.source)) return 0
  if (/^\s*export\s+\{[\s\S]*?\}\s+from\s+['"].+\.ts['"]\s*;?\s*$/.test(record.source.trim())) return 0
  if (/^\s*import\s+['"].+\.ts['"]\s*;?\s*$/.test(record.source)) return 0
  if (hasReactOrDomBoundary(record.source)) return 0
  let score = 1
  if (/frontend\/src\/utils\//.test(record.relativePath)) score += 3
  if (/frontend\/src\/components\/products\/(?:helpers|config|import|history|scanning)\//.test(record.relativePath)) score += 2
  if (/export\s+function|export\s+const|export\s+\{/.test(record.source)) score += 1
  if (record.lineCount >= 80) score += 1
  return score
}

function scoreWorkerCandidate(record) {
  if (!record.relativePath.startsWith('frontend/src/')) return 0
  if (!hasWorkerCandidateWork(record.source, record.relativePath)) return 0
  let score = 1
  if (/import|csv|scanner|image|barcode|media/i.test(record.relativePath)) score += 3
  if (/for\s*\(|while\s*\(|\.map\(|\.reduce\(/.test(record.source)) score += 1
  if (record.lineCount >= 150) score += 1
  return score
}

function scoreSqlCandidate(record) {
  if (!hasSqlOrAnalyticsWork(record.source, record.relativePath)) return 0
  let score = 1
  if (/backend\/src\/routes\/|backend\/src\/services\/|ops\/scripts\//.test(record.relativePath)) score += 2
  if (/backup|schema|analytics|report|import|export/i.test(record.relativePath)) score += 2
  if (/JOIN\s+|GROUP BY|ORDER BY|CREATE\s+INDEX/i.test(record.source)) score += 1
  return score
}

function compactCandidates(records, scoreFn, limit = 12) {
  return records
    .map((record) => ({ file: record.relativePath, lines: record.lineCount, score: scoreFn(record) }))
    .filter((record) => record.score > 0)
    .sort((left, right) => right.score - left.score || right.lines - left.lines || left.file.localeCompare(right.file))
    .slice(0, limit)
}

function verificationMatrix() {
  return [
    {
      track: 'TypeScript utility conversion',
      requiredProof: [
        'npm.cmd --prefix frontend run typecheck',
        'npm.cmd --prefix frontend run test:utils',
        'npm.cmd --prefix frontend run build',
        'rg old import path after rename or extension change',
      ],
      rollback: 'Keep the original module path or add a temporary wrapper until every import and test is updated.',
      approval: 'Allowed only for pure helpers with no React render boundary and no packaging change.',
    },
    {
      track: 'Web Worker extraction',
      requiredProof: [
        'npm.cmd --prefix frontend run test:utils',
        'npm.cmd --prefix frontend run build',
        'focused Playwright flow for the affected import/scanner/media action',
        'fallback path when Worker construction fails',
      ],
      rollback: 'Keep the synchronous helper as a fallback until browser and worker tests pass.',
      approval: 'Allowed only for browser CPU, file parsing, scanner, image, or media preprocessing hot paths.',
    },
    {
      track: 'SQL/DuckDB/data-path optimization',
      requiredProof: [
        'npm.cmd --prefix backend run test:utils',
        'node ops\\scripts\\backend\\schema-audit.js',
        'backup/restore or count-diff rehearsal for changed data paths',
        'before/after timing on the same fixture',
      ],
      rollback: 'Keep the Node.js path as the correctness oracle until timing and data diffs agree.',
      approval: 'Allowed for import, reporting, analytics, backup, or verification work with measurable data volume.',
    },
  ]
}

function buildFirstExecutableSlices(candidates) {
  return verificationMatrix().map((matrix) => {
    const candidate = candidates.find((entry) => entry.track === matrix.track)
    return {
      track: matrix.track,
      firstCandidate: candidate?.file || '',
      score: candidate?.score || 0,
      lines: candidate?.lines || 0,
      requiredProof: matrix.requiredProof,
      rollback: matrix.rollback,
    }
  })
}

const FOCUSED_TEST_COVERAGE = [
  {
    track: 'Completed TypeScript utility conversion',
    candidate: 'frontend/src/utils/csvImport.ts',
    tests: [
      'frontend/tests/csvImport.test.ts',
      'frontend/tests/productImportPlanner.test.ts',
    ],
    command: 'npm.cmd --prefix frontend run test:utils',
    reason: 'CSV parser and product import planner exercise Khmer/number/header behavior before helper conversion.',
  },
  {
    track: 'Web Worker extraction',
    candidate: 'frontend/src/components/contacts/ContactImportModal.jsx',
    tests: [
      'frontend/tests/contactImportWorker.test.ts',
      'frontend/tests/actionStability.test.ts',
      'frontend/tests/performanceLoadingUx.test.ts',
    ],
    command: 'npm.cmd --prefix frontend run test:utils plus focused Playwright import flow',
    reason: 'Contact import upload, loader timeout, and action guard contracts must survive worker extraction.',
  },
  {
    track: 'Completed Web Worker extraction',
    candidate: 'frontend/src/components/inventory/InventoryImportModal.jsx',
    tests: [
      'frontend/tests/inventoryImportWorker.test.ts',
      'frontend/tests/actionStability.test.ts',
      'frontend/tests/performanceLoadingUx.test.ts',
    ],
    command: 'npm.cmd --prefix frontend run test:utils plus focused Playwright import flow',
    reason: 'Inventory import upload, loader timeout, row-count fallback, and action guard contracts must survive worker extraction.',
  },
  {
    track: 'Completed Web Worker extraction',
    candidate: 'frontend/src/components/sales/SalesImportModal.jsx',
    tests: [
      'frontend/tests/salesImportWorker.test.ts',
      'frontend/tests/actionStability.test.ts',
      'frontend/tests/performanceLoadingUx.test.ts',
    ],
    command: 'npm.cmd --prefix frontend run test:utils plus focused Playwright import flow',
    reason: 'Sales import upload, loader timeout, row-count fallback, and action guard contracts must survive worker extraction.',
  },
  {
    track: 'SQL/DuckDB/data-path optimization',
    candidate: 'backend/src/services/backupPackages.js',
    tests: [
      'backend/test/backupPerformanceHardening.test.js',
      'backend/test/backupRetention.test.js',
      'backend/test/backupSchema.test.js',
    ],
    command: 'npm.cmd --prefix backend run test:utils',
    reason: 'Backup package streaming, retention, and schema summaries protect data-path rewrites.',
  },
]

const CONVERTED_TYPESCRIPT_SLICES = [
  {
    implementation: 'frontend/src/app/appShellUtils.ts',
    compatibilityWrapper: '',
    wrapperStatus: 'retired after callers moved to TypeScript source',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\appShellUtils.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/runtime/runtimeErrorClassifier.ts',
    compatibilityWrapper: '',
    wrapperStatus: 'retired after callers moved to TypeScript source',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\runtimeErrorClassifier.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/components/catalog/portalCatalogDisplay.ts',
    compatibilityWrapper: 'frontend/src/components/catalog/portalCatalogDisplay.mjs',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\portalCatalogDisplay.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/components/catalog/portalContentI18n.ts',
    compatibilityWrapper: 'frontend/src/components/catalog/portalContentI18n.mjs',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\portalContentI18n.test.ts',
      'node frontend\\tests\\portalFaqVocabulary.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/components/catalog/portalEditorUtils.ts',
    compatibilityWrapper: 'frontend/src/components/catalog/portalEditorUtils.mjs',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\portalEditorUtils.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/components/catalog/portalLanguagePacks.ts',
    compatibilityWrapper: '',
    wrapperStatus: 'retired after catalog surfaces and tests moved to TypeScript source',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\portalLanguagePacks.test.ts',
      'node frontend\\tests\\portalFaqVocabulary.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/components/contacts/contactOptionUtils.ts',
    compatibilityWrapper: 'frontend/src/components/contacts/contactOptionUtils.js',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\pricingContacts.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/components/inventory/movementGroups.ts',
    compatibilityWrapper: 'frontend/src/components/inventory/movementGroups.js',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\inventoryMovementGroups.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/components/pos/posCore.ts',
    compatibilityWrapper: 'frontend/src/components/pos/posCore.ts',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\posCore.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/utils/csvImport.ts',
    compatibilityWrapper: 'frontend/src/utils/csvImport.js',
    declarationSupport: 'frontend/src/utils/pricing.d.ts',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\csvImport.test.ts',
      'node frontend\\tests\\productImportPlanner.test.ts',
    ],
  },
  {
    implementation: 'frontend/src/utils/csvRowCounter.ts',
    compatibilityWrapper: '',
    wrapperStatus: 'retired after import modals and workers moved to TypeScript source',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\inventoryImportWorker.test.ts',
      'node frontend\\tests\\salesImportWorker.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/utils/formatters.ts',
    compatibilityWrapper: 'frontend/src/utils/formatters.js',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\formatters.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/utils/groupedRecords.ts',
    compatibilityWrapper: '',
    wrapperStatus: 'retired after list surfaces and tests moved to TypeScript source',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\groupedRecords.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/utils/initials.ts',
    compatibilityWrapper: '',
    wrapperStatus: 'retired after product, inventory, POS, catalog, and tests moved to TypeScript source',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\initials.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/utils/mediaUpload.ts',
    compatibilityWrapper: 'frontend/src/utils/mediaUpload.js',
    declarationSupport: 'frontend/src/utils/publicAssetUrls.d.ts',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\mediaUploadHelpers.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/utils/pricing.ts',
    compatibilityWrapper: 'frontend/src/utils/pricing.js',
    declarationSupport: 'frontend/src/utils/pricing.d.ts',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\pricingContacts.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/utils/productGrouping.ts',
    compatibilityWrapper: '',
    wrapperStatus: 'retired after Products, Inventory, POS, and tests moved to TypeScript source',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\productGrouping.test.ts',
      'node frontend\\tests\\posCore.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/components/products/helpers/productDisplayHelpers.ts',
    compatibilityWrapper: 'frontend/src/components/products/helpers/productDisplayHelpers.ts',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\productDisplayHelpers.test.ts',
      'node frontend\\tests\\productPageHelpers.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/components/products/helpers/productFilterHelpers.ts',
    compatibilityWrapper: 'frontend/src/components/products/helpers/productFilterHelpers.ts',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\productFilterHelpers.test.ts',
      'node frontend\\tests\\productSearchPagination.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/components/products/helpers/productMenuHelpers.ts',
    compatibilityWrapper: 'frontend/src/components/products/helpers/productMenuHelpers.ts',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\productMenuHelpers.test.ts',
      'node frontend\\tests\\productSearchPagination.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/components/products/helpers/productWriteHelpers.ts',
    compatibilityWrapper: 'frontend/src/components/products/helpers/productWriteHelpers.ts',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\productWriteHelpers.test.ts',
      'node frontend\\tests\\actionStability.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/components/products/helpers/productGalleryHelpers.ts',
    compatibilityWrapper: '',
    wrapperStatus: 'retired after Products and focused tests moved to TypeScript source',
    declarationSupport: 'frontend/src/utils/publicAssetUrls.d.ts',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\productGalleryHelpers.test.ts',
      'node frontend\\tests\\productWriteHelpers.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/components/products/helpers/productGroupViewHelpers.ts',
    compatibilityWrapper: 'frontend/src/components/products/helpers/productGroupViewHelpers.ts',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\productGroupViewHelpers.test.ts',
      'node frontend\\tests\\productPageHelpers.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/components/products/helpers/productSelectionHelpers.ts',
    compatibilityWrapper: 'frontend/src/components/products/helpers/productSelectionHelpers.ts',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\productSelectionHelpers.test.ts',
      'node frontend\\tests\\productSearchPagination.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/components/products/history/productHistoryHelpers.ts',
    compatibilityWrapper: 'frontend/src/components/products/history/productHistoryHelpers.ts',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\productHistoryHelpers.test.ts',
      'node frontend\\tests\\historyHelpers.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/components/products/scanning/barcodeImageScanner.ts',
    compatibilityWrapper: 'frontend/src/components/products/scanning/barcodeImageScanner.ts',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\barcodeImageScanner.test.ts',
      'node frontend\\tests\\scanbotScanner.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/components/products/scanning/barcodeScannerState.ts',
    compatibilityWrapper: 'frontend/src/components/products/scanning/barcodeScannerState.ts',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\barcodeScannerState.test.ts',
      'node frontend\\tests\\scanbotScanner.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/utils/bulkOps.ts',
    compatibilityWrapper: 'frontend/src/utils/bulkOps.mjs',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\bulkOps.test.ts',
      'node frontend\\tests\\actionStability.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/components/products/import/productImportPlanner.ts',
    compatibilityWrapper: 'frontend/src/components/products/import/productImportPlanner.mjs',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\productImportPlanner.test.ts',
      'node frontend\\tests\\performanceLoadingUx.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/components/products/import/productImportWorker.ts',
    compatibilityWrapper: 'frontend/src/components/products/import/productImportWorker.mjs',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\productImportPlanner.test.ts',
      'node frontend\\tests\\performanceLoadingUx.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/components/receipt-settings/constants.ts',
    compatibilityWrapper: 'frontend/src/components/receipt-settings/constants.js',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\receiptTemplate.test.ts',
      'node frontend\\tests\\receiptSettingsSync.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/components/contacts/customerMembershipNumber.ts',
    compatibilityWrapper: 'frontend/src/components/contacts/customerMembershipNumber.js',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\pricingContacts.test.ts',
      'node frontend\\tests\\performanceLoadingUx.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/components/dashboard/charts/index.ts',
    compatibilityWrapper: 'frontend/src/components/dashboard/charts/index.js',
    declarationSupport: 'frontend/src/types/jsx-modules.d.ts',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\dashboardDataReliability.test.ts',
      'node frontend\\tests\\performanceLoadingUx.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/components/receipt-settings/template.ts',
    compatibilityWrapper: 'frontend/src/components/receipt-settings/template.js',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\receiptTemplate.test.ts',
      'node frontend\\tests\\receiptSettingsSync.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/components/shared/navigationConfig.ts',
    compatibilityWrapper: 'frontend/src/components/shared/navigationConfig.js',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\navigationConfig.test.ts',
      'node frontend\\tests\\sectionNavigation.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/components/utils-settings/index.ts',
    compatibilityWrapper: 'frontend/src/components/utils-settings/index.js',
    declarationSupport: 'frontend/src/types/jsx-modules.d.ts',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\utilsSettingsBarrel.test.ts',
      'node frontend\\tests\\sectionNavigation.test.ts',
      'node frontend\\tests\\settingsRefresh.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/components/utils-settings/settingsConflict.ts',
    compatibilityWrapper: 'frontend/src/components/utils-settings/settingsConflict.js',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\settingsConflictHelpers.test.ts',
      'node frontend\\tests\\settingsRefresh.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/platform/storage/storagePolicy.ts',
    compatibilityWrapper: 'frontend/src/platform/storage/storagePolicy.mjs',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\storagePolicy.test.ts',
      'node frontend\\tests\\apiHttp.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/utils/actionGuards.ts',
    compatibilityWrapper: 'frontend/src/utils/actionGuards.mjs',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\actionGuards.test.ts',
      'node frontend\\tests\\actionStability.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/utils/color.ts',
    compatibilityWrapper: 'frontend/src/utils/color.js',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\productPageHelpers.test.ts',
      'node frontend\\tests\\productSearchPagination.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/utils/dateHelpers.ts',
    compatibilityWrapper: 'frontend/src/utils/dateHelpers.js',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\dateHelpers.test.ts',
      'node frontend\\tests\\dashboardDataReliability.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/utils/deviceInfo.ts',
    compatibilityWrapper: 'frontend/src/utils/deviceInfo.js',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\deviceInfo.test.ts',
      'node frontend\\tests\\apiHttp.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/utils/exportPackage.ts',
    compatibilityWrapper: 'frontend/src/utils/exportPackage.js',
    declarationSupport: 'frontend/src/utils/csv.d.ts',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\exportPackages.test.ts',
      'node frontend\\tests\\dashboardDataReliability.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/utils/historyHelpers.ts',
    compatibilityWrapper: 'frontend/src/utils/historyHelpers.mjs',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\historyHelpers.test.ts',
      'node frontend\\tests\\productHistoryHelpers.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/utils/importJobRefresh.ts',
    compatibilityWrapper: 'frontend/src/utils/importJobRefresh.js',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\importJobRefresh.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/utils/index.ts',
    compatibilityWrapper: 'frontend/src/utils/index.js',
    declarationSupport: 'frontend/src/utils/csv.d.ts',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\formatters.test.ts',
      'node frontend\\tests\\dateHelpers.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/utils/permissions.ts',
    compatibilityWrapper: 'frontend/src/utils/permissions.js',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\permissions.test.ts',
      'node frontend\\tests\\permissionEditor.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/utils/productBatches.ts',
    compatibilityWrapper: 'frontend/src/utils/productBatches.mjs',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\productBatches.test.ts',
      'node frontend\\tests\\productPageHelpers.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/utils/scriptTypography.ts',
    compatibilityWrapper: 'frontend/src/utils/scriptTypography.js',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\scriptTypography.test.ts',
      'node frontend\\tests\\portalCatalogDisplay.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/utils/settingsRefresh.ts',
    compatibilityWrapper: 'frontend/src/utils/settingsRefresh.js',
    declarationSupport: 'frontend/src/utils/appRefresh.d.ts',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\settingsRefresh.test.ts',
      'node frontend\\tests\\appRefresh.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
  {
    implementation: 'frontend/src/components/products/config/productPageConfig.ts',
    compatibilityWrapper: 'frontend/src/components/products/config/productPageConfig.mjs',
    declarationSupport: '',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\actionStability.test.ts',
      'node frontend\\tests\\performanceLoadingUx.test.ts',
      'npm.cmd --prefix frontend run build',
    ],
  },
]

const COMPLETED_WEB_WORKER_SLICES = [
  {
    surface: 'frontend/src/components/products/import/BulkImportModal.jsx',
    worker: 'frontend/src/components/products/import/productImportWorker.ts',
    compatibilityWrapper: 'frontend/src/components/products/import/productImportWorker.mjs',
    fallback: 'frontend/src/components/products/import/productImportPlanner.ts',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\productImportWorkerFallback.test.ts',
      'node frontend\\tests\\productImportPlanner.test.ts',
      'node frontend\\tests\\performanceLoadingUx.test.ts',
      'npm.cmd --prefix frontend run build',
      'focused Playwright product import modal flow',
    ],
  },
  {
    surface: 'frontend/src/components/contacts/ContactImportModal.jsx',
    worker: 'frontend/src/components/contacts/contactImportWorker.ts',
    compatibilityWrapper: 'frontend/src/components/contacts/contactImportWorker.mjs',
    fallback: 'frontend/src/utils/csvRowCounter.ts',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\contactImportWorker.test.ts',
      'node frontend\\tests\\performanceLoadingUx.test.ts',
      'node frontend\\tests\\actionStability.test.ts',
      'npm.cmd --prefix frontend run build',
      'focused Playwright contact import modal flow',
    ],
  },
  {
    surface: 'frontend/src/components/inventory/InventoryImportModal.jsx',
    worker: 'frontend/src/components/inventory/inventoryImportWorker.ts',
    compatibilityWrapper: 'frontend/src/components/inventory/inventoryImportWorker.mjs',
    fallback: 'frontend/src/utils/csvRowCounter.ts',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\inventoryImportWorker.test.ts',
      'node frontend\\tests\\performanceLoadingUx.test.ts',
      'node frontend\\tests\\actionStability.test.ts',
      'npm.cmd --prefix frontend run build',
      'focused Playwright inventory import modal flow',
    ],
  },
  {
    surface: 'frontend/src/components/sales/SalesImportModal.jsx',
    worker: 'frontend/src/components/sales/salesImportWorker.ts',
    compatibilityWrapper: 'frontend/src/components/sales/salesImportWorker.mjs',
    fallback: 'frontend/src/utils/csvRowCounter.ts',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\salesImportWorker.test.ts',
      'node frontend\\tests\\performanceLoadingUx.test.ts',
      'node frontend\\tests\\actionStability.test.ts',
      'npm.cmd --prefix frontend run build',
      'focused Playwright sales import modal flow',
    ],
  },
  {
    surface: 'frontend/src/utils/csv.js',
    worker: 'frontend/src/utils/csvExportWorker.ts',
    compatibilityWrapper: 'frontend/src/utils/csvExportWorker.mjs',
    fallback: 'frontend/src/utils/csv.js',
    proof: [
      'npm.cmd --prefix frontend run typecheck',
      'node frontend\\tests\\exportPackages.test.ts',
      'node frontend\\tests\\performanceLoadingUx.test.ts',
      'npm.cmd --prefix frontend run build',
      'focused Playwright dashboard/inventory/contact export flow',
    ],
  },
]

const COMPLETED_WEB_WORKER_FILES = new Set(COMPLETED_WEB_WORKER_SLICES.flatMap((entry) => [
  entry.surface,
  entry.worker,
  entry.compatibilityWrapper,
  entry.fallback,
]))

const COMPLETED_DATA_PATH_SLICES = [
  {
    target: 'backend/src/services/backupPackages.js',
    optimization: 'Backup table streaming now prefers keyset pagination on id and keeps LIMIT/OFFSET as the compatibility fallback.',
    rollback: 'Revert readTableRows to OFFSET-only paging; streamed checksum/package format remains unchanged.',
    proof: [
      'npm.cmd --prefix backend run test:utils',
      'node ops\\scripts\\backend\\schema-audit.js',
      'backend/test/backupPerformanceHardening.test.js keyset guard',
    ],
    tests: [
      'backend/test/backupPerformanceHardening.test.js',
      'backend/test/backupRetention.test.js',
      'backend/test/backupSchema.test.js',
    ],
  },
  {
    target: 'backend/src/services/importJobs.js',
    optimization: 'Product import apply now caches same-name product lookups and supplier lookups per job, then updates the in-memory product cache when rows create or update products.',
    rollback: 'Remove getProductsByNameForImport, rememberProductForImport, supplierMap, and return to per-row database lookups; import job schema and row decisions remain unchanged.',
    proof: [
      'npm.cmd --prefix backend run test:utils',
      'node ops\\scripts\\backend\\schema-audit.js',
      'backend/test/importDecisionIntegrity.test.js cache guards',
    ],
    tests: [
      'backend/test/importDecisionIntegrity.test.js',
      'backend/test/importScaleSmoke.test.js',
      'backend/test/importCsv.test.js',
      'backend/test/productImportPolicies.test.js',
    ],
  },
  {
    target: 'ops/scripts/backend/schema-audit.js',
    optimization: 'Schema audit now parses ALTER TABLE primary-key constraints in a single pre-pass map before walking CREATE TABLE bodies, avoiding one whole-schema regex scan per table.',
    rollback: 'Restore parsePrimaryKey to run a table-specific ALTER TABLE regex against the full schema text for every parsed table; generated report fields remain unchanged.',
    proof: [
      'node ops\\scripts\\backend\\schema-audit.js',
      'Measure-Command { node ops\\scripts\\backend\\schema-audit.js | Out-Null }',
      'npm.cmd --prefix ops run phase29:audit:repeat',
    ],
    tests: [],
  },
  {
    target: 'ops/scripts/backend/schema-primary-key-preflight.mjs',
    optimization: 'Primary-key preflight now materializes table row/null metrics, duplicate-key counts, and unique-index names once in shared CTEs, then reuses those values in the read-only JSON report.',
    rollback: 'Restore the per-field COUNT and pg_index subqueries inside each json_build_object table block; the output schema remains unchanged.',
    proof: [
      'npm.cmd --prefix ops run schema-pk-preflight',
      'node ops\\scripts\\backend\\schema-audit.js',
      'npm.cmd --prefix backend run test:utils',
      'npm.cmd --prefix ops run phase29:audit:repeat',
    ],
    tests: [
      'backend/test/fullAutomation.test.js',
    ],
  },
  {
    target: 'backend/src/routes/importJobs.js',
    optimization: 'Import-job listing now derives permitted import types from the current user and passes them into listImportJobs so the service can filter by type in SQL before decoration.',
    rollback: 'Remove getPermittedImportTypes, call listImportJobs with only the limit, and restore the route-level JavaScript permission filter.',
    proof: [
      'npm.cmd --prefix backend run test:utils',
      'node backend\\test\\importDecisionIntegrity.test.js',
      'node ops\\scripts\\backend\\schema-audit.js',
    ],
    tests: [
      'backend/test/importDecisionIntegrity.test.js',
      'backend/test/routeContracts.test.js',
      'backend/test/importScaleSmoke.test.js',
    ],
  },
  {
    target: 'ops/scripts/verification/verify-backup-reliability.js',
    optimization: 'Backup reliability verification now uses a source manifest and grouped required/forbidden text checks, replacing repeated one-off assertions across the same backup, Drive, UI, offline, and automation files.',
    rollback: 'Inline the individual requireText/forbidText calls again; the checked guard strings and failure messages remain equivalent.',
    proof: [
      'node ops\\scripts\\verification\\verify-backup-reliability.js',
      'npm.cmd --prefix backend run test:utils',
      'npm.cmd --prefix ops run phase29:audit:repeat',
    ],
    tests: [
      'backend/test/fullAutomation.test.js',
      'backend/test/backupPerformanceHardening.test.js',
      'backend/test/backupRetention.test.js',
    ],
  },
  {
    target: 'backend/src/routes/inventory.js',
    optimization: 'RFID session apply now prepares branch, product, branch-stock, movement, product-summary, and session-finalization statements once per request instead of preparing lookups inside each confirmed product row.',
    rollback: 'Inline the RFID apply db.prepare calls inside the product loop again; RFID confirmed quantity, movement, audit, and session status behavior remain unchanged.',
    proof: [
      'npm.cmd --prefix backend run test:utils',
      'node backend\\test\\rfidRoutes.test.js',
      'node ops\\scripts\\backend\\schema-audit.js',
    ],
    tests: [
      'backend/test/rfidRoutes.test.js',
      'backend/test/routeContracts.test.js',
      'backend/test/productBatchHierarchy.test.js',
    ],
  },
  {
    target: 'backend/src/routes/portal.js',
    optimization: 'Portal catalog products now share one image and branch-stock materialization helper plus one payload decorator across full catalog and paged search responses.',
    rollback: 'Inline the image-map, branch-stock-map, gallery, and badge decoration blocks separately in getPortalProducts and getPortalCatalogProductPage again; public catalog response fields remain unchanged.',
    proof: [
      'npm.cmd --prefix backend run test:utils',
      'node backend\\test\\portalInventoryRegression.test.js',
      'node ops\\scripts\\backend\\schema-audit.js',
    ],
    tests: [
      'backend/test/portalInventoryRegression.test.js',
      'backend/test/portalUtils.test.js',
      'backend/test/routeContracts.test.js',
    ],
  },
  {
    target: 'backend/src/routes/products.js',
    optimization: 'Image-only bulk import now builds one normalized product-name map before processing uploaded image filenames, replacing a full active-product scan for every image.',
    rollback: 'Remove productsByImageBaseName and return to allProducts.find inside the image loop; image matching behavior remains name-based.',
    proof: [
      'npm.cmd --prefix backend run test:utils',
      'node backend\\test\\productSearchPagination.test.js',
      'node ops\\scripts\\backend\\schema-audit.js',
    ],
    tests: [
      'backend/test/productSearchPagination.test.js',
      'backend/test/importDecisionIntegrity.test.js',
      'backend/test/routeContracts.test.js',
    ],
  },
  {
    target: 'backend/src/routes/sales.js',
    optimization: 'Sale creation now prepares the inventory movement insert and optional movement timestamp update once per transaction instead of rebuilding those statements for every sold item.',
    rollback: 'Move insertSaleMovement and updateSaleMovementCreatedAt back into the per-item allocation block; sale item, batch allocation, movement, and imported timestamp behavior remain unchanged.',
    proof: [
      'npm.cmd --prefix backend run test:utils',
      'node backend\\test\\productBatchHierarchy.test.js',
      'node ops\\scripts\\backend\\schema-audit.js',
    ],
    tests: [
      'backend/test/productBatchHierarchy.test.js',
      'backend/test/routeContracts.test.js',
      'backend/test/portalInventoryRegression.test.js',
    ],
  },
  {
    target: 'backend/src/routes/system/index.js',
    optimization: 'System settings writes now prepare the delete statement once beside the upsert statement, avoiding repeated statement creation when null-valued settings are removed inside the transaction.',
    rollback: 'Remove deleteSetting and inline db.prepare("DELETE FROM settings WHERE key = ?") in the null-value branch; settings write behavior remains unchanged.',
    proof: [
      'npm.cmd --prefix backend run test:utils',
      'node backend\\test\\routeContracts.test.js',
      'node ops\\scripts\\backend\\schema-audit.js',
    ],
    tests: [
      'backend/test/routeContracts.test.js',
      'backend/test/systemJobs.test.js',
      'backend/test/fullAutomation.test.js',
    ],
  },
]

const COMPLETED_DATA_PATH_FILES = new Set(COMPLETED_DATA_PATH_SLICES.map((entry) => entry.target))

const REJECTED_DATA_PATH_CANDIDATES = [
  {
    file: 'backend/src/db/postgresSchema.sql',
    decision: 'keep under schema-migration protocol, not language/runtime conversion',
    reason: 'The canonical schema dump is the data contract, not an executable hot path. Index, primary-key, JSONB, and foreign-key changes need backup, restore rehearsal, orphan checks, rollback SQL, and schema-audit proof before they are applied.',
    evidence: 'Move 173 inspection found the file ranked because it contains DDL and indexes; ops/docs/SCHEMA-RELATIONSHIPS.md already tracks the safe DDL backlog and migration gates.',
  },
  {
    file: 'ops/scripts/architecture/language-runtime-audit.mjs',
    decision: 'keep as Node.js meta-audit and exclude from SQL/DuckDB conversion queue',
    reason: 'The script ranks itself because it contains report strings, SQL/data-path proof labels, and completed-slice metadata. It is a small deterministic report generator, not a runtime query or import hot path.',
    evidence: 'Move 179 inspection found the remaining SQL/DuckDB candidate was the audit script itself after backend routes and service data paths were optimized or governed by schema protocol.',
  },
  {
    file: 'ops/scripts/lib/report-utils.js',
    decision: 'keep as a shared Node.js report helper and exclude from SQL/DuckDB conversion queue',
    reason: 'The helper only formats Markdown tables, digests, output tails, and byte labels. It is flagged by path/text report keywords, not by query-heavy runtime behavior or data-volume processing.',
    evidence: 'Move 210 inspection found no database reads, joins, imports, exports, backup streaming, or analytics loops in the file; converting it would add churn without measurable speed, stability, or packaging benefit.',
  },
  {
    file: 'ops/scripts/backend/schema-primary-key-rollback.sql',
    decision: 'keep as rollback DDL under the schema safety protocol',
    reason: 'The file is intentionally SQL because it is a rollback artifact for guarded primary-key hardening, not an executable hot path or data-processing runtime.',
    evidence: 'Move 338 optimized the read-only preflight query and kept rollback SQL as the explicit recovery path required before any primary-key DDL is applied.',
  },
]

const REJECTED_DATA_PATH_FILES = new Set(REJECTED_DATA_PATH_CANDIDATES.map((entry) => entry.file))

const REJECTED_WEB_WORKER_CANDIDATES = [
  {
    file: 'frontend/src/utils/csvImport.ts',
    decision: 'keep as shared parser and fallback oracle',
    reason: 'The heavy product import analysis already runs in productImportWorker, contact/inventory/sales row checks already use focused workers, and the remaining generic parseCSV surface has no direct UI caller.',
    evidence: 'Move 167 inspection found parseCsvRows used by productImportPlanner inside a Worker and by an unused localDb.parseCSV compatibility helper.',
  },
  {
    file: 'frontend/src/components/products/scanning/barcodeImageScanner.ts',
    decision: 'keep on main browser path',
    reason: 'Photo barcode scanning depends on FileReader, Image elements, native BarcodeDetector, and zxing BrowserMultiFormatReader image-element decoding; broad Worker extraction would duplicate the path and lose browser compatibility.',
    evidence: 'Move 168 inspection found DOM image loading and browser detector/zxing boundaries rather than a pure CPU loop that can move safely to a Worker.',
  },
  {
    file: 'frontend/src/components/products/scanning/BarcodeScannerModal.jsx',
    decision: 'keep on React/browser camera path',
    reason: 'The modal owns camera permission state, media streams, video refs, requestAnimationFrame scanning, and manual-entry UI. These are DOM and user-permission workflows, not transferable Worker computation.',
    evidence: 'Move 168 inspection found getUserMedia, video element, permission watcher, BarcodeDetector, zxing controls, and React state tightly coupled to the UI lifecycle.',
  },
  {
    file: 'frontend/src/components/shared/ImageGalleryLightbox.jsx',
    decision: 'keep as React presentation component',
    reason: 'The lightbox filters a small image list, clamps an index, handles keyboard navigation, and renders images/thumbnails. It has no decoding, resizing, or heavy image processing loop to transfer.',
    evidence: 'Move 169 inspection found React state/control rendering and event handlers only; image loading remains normal browser rendering.',
  },
  {
    file: 'frontend/src/utils/importJobRefresh.ts',
    decision: 'keep as main-thread event dispatcher',
    reason: 'The helper maps completed import-job types to refresh channels and dispatches sync:update browser events. Moving it to a Worker would add message overhead and lose direct window event dispatch.',
    evidence: 'Move 169 inspection found small status/type normalization, Set dedupe, and CustomEvent dispatch only; Move 385 converted the helper to TypeScript but kept the same main-thread event boundary.',
  },
  {
    file: 'frontend/src/components/shared/BackgroundImportTracker.jsx',
    decision: 'keep on React main thread',
    reason: 'Polls import-job state, dedupes a bounded eight-row list, dispatches completion refreshes, and coordinates UI actions; it has no file parsing, media decoding, or CPU-heavy browser loop worth moving to a Worker.',
    evidence: 'Move 165 inspection of BackgroundImportTracker.jsx found API orchestration and tiny list transforms only.',
  },
]

const REJECTED_WEB_WORKER_FILES = new Set(REJECTED_WEB_WORKER_CANDIDATES.map((entry) => entry.file))

async function collectFocusedTestCoverage() {
  return mapLimit(FOCUSED_TEST_COVERAGE, MATRIX_CHECK_CONCURRENCY, async (entry) => {
    const testCoverage = await mapLimit(entry.tests, MATRIX_CHECK_CONCURRENCY, async (testPath) => ({
      path: testPath,
      exists: await pathExists(path.join(ROOT_DIR, testPath)),
    }))
    return {
      ...entry,
      candidateExists: await pathExists(path.join(ROOT_DIR, entry.candidate)),
      testCoverage,
      covered: testCoverage.every((test) => test.exists),
    }
  })
}

async function collectConvertedTypeScriptSlices() {
  return mapLimit(CONVERTED_TYPESCRIPT_SLICES, MATRIX_CHECK_CONCURRENCY, async (entry) => {
    const implementationExists = await pathExists(path.join(ROOT_DIR, entry.implementation))
    const wrapperRequired = Boolean(entry.compatibilityWrapper)
    const compatibilityWrapperExists = wrapperRequired
      ? await pathExists(path.join(ROOT_DIR, entry.compatibilityWrapper))
      : true
    const declarationSupportExists = entry.declarationSupport ? await pathExists(path.join(ROOT_DIR, entry.declarationSupport)) : true
    return {
      ...entry,
      implementationExists,
      wrapperRequired,
      compatibilityWrapperExists,
      declarationSupportExists,
      covered: implementationExists && compatibilityWrapperExists && declarationSupportExists,
    }
  })
}

async function collectCompletedWebWorkerSlices() {
  return mapLimit(COMPLETED_WEB_WORKER_SLICES, MATRIX_CHECK_CONCURRENCY, async (entry) => {
    const surfaceExists = await pathExists(path.join(ROOT_DIR, entry.surface))
    const workerExists = await pathExists(path.join(ROOT_DIR, entry.worker))
    const compatibilityWrapperExists = await pathExists(path.join(ROOT_DIR, entry.compatibilityWrapper))
    const fallbackExists = await pathExists(path.join(ROOT_DIR, entry.fallback))
    return {
      ...entry,
      surfaceExists,
      workerExists,
      compatibilityWrapperExists,
      fallbackExists,
      covered: surfaceExists && workerExists && compatibilityWrapperExists && fallbackExists,
    }
  })
}

async function collectCompletedDataPathSlices() {
  return mapLimit(COMPLETED_DATA_PATH_SLICES, MATRIX_CHECK_CONCURRENCY, async (entry) => {
    const testCoverage = await mapLimit(entry.tests || [], MATRIX_CHECK_CONCURRENCY, async (testPath) => ({
        path: testPath,
        exists: await pathExists(path.join(ROOT_DIR, testPath)),
      }))
    return {
      ...entry,
      targetExists: await pathExists(path.join(ROOT_DIR, entry.target)),
      testCoverage,
      covered: testCoverage.every((test) => test.exists),
    }
  })
}


async function collectProofCommandCoverage(matrix, packageManifests) {
  const coverage = []
  for (const entry of matrix) {
    for (const proof of entry.requiredProof) {
      const npmMatch = proof.match(/^npm\.cmd --prefix ([^ ]+) run ([^ ]+)/)
      if (npmMatch) {
        const [, packageName, scriptName] = npmMatch
        const manifest = packageManifests[packageName] || {}
        coverage.push({
          track: entry.track,
          proof,
          type: 'package-script',
          target: `${packageName}/package.json scripts.${scriptName}`,
          covered: Boolean(manifest.scripts?.[scriptName]),
        })
        continue
      }

      const nodeMatch = proof.match(/^node (.+)$/)
      if (nodeMatch) {
        const targetPath = normalizePath(nodeMatch[1].replace(/\\/g, '/'))
        coverage.push({
          track: entry.track,
          proof,
          type: 'local-script',
          target: targetPath,
          covered: await pathExists(path.join(ROOT_DIR, targetPath)),
        })
        continue
      }

      if (proof.startsWith('rg ')) {
        coverage.push({
          track: entry.track,
          proof,
          type: 'external-tool',
          target: 'ripgrep available in developer workflow',
          covered: true,
        })
        continue
      }

      coverage.push({
        track: entry.track,
        proof,
        type: 'manual-proof',
        target: 'manual verification evidence required in the implementing slice',
        covered: true,
      })
    }
  }
  return coverage
}

async function collectRecords() {
  const groups = await mapLimit(SCAN_ROOTS, ROOT_WALK_CONCURRENCY, (root) => walkFiles(root))
  const files = [...new Set(groups.flat())].sort((left, right) => normalizePath(left).localeCompare(normalizePath(right)))
  return mapLimit(files, FILE_READ_CONCURRENCY, async (absolutePath) => {
    const relativePath = normalizePath(path.relative(ROOT_DIR, absolutePath))
    const source = await fs.readFile(absolutePath, 'utf8')
    const extension = path.extname(relativePath) || '(none)'
    return {
      relativePath,
      extension,
      language: LANGUAGE_BY_EXTENSION.get(extension) || extension,
      lineCount: source.split(/\r?\n/).length,
      source,
    }
  })
}

function renderReport(summary) {
  const languageRows = summary.languageCounts.map(([language, count]) => [language, String(count)])
  const candidateRows = summary.conversionCandidates.map((candidate) => [
    candidate.track,
    candidate.file,
    String(candidate.lines),
    String(candidate.score),
    candidate.rule,
  ])
  const policyRows = summary.runtimePolicy.map((entry) => [entry.runtime, entry.decision, entry.evidenceRequired])
  const rejectedRows = summary.rejectedRuntimeFamilies.map((entry) => [entry.runtime, entry.reason])
  const rejectedDataPathRows = summary.rejectedDataPathCandidates.map((entry) => [
    `\`${entry.file}\``,
    entry.decision,
    entry.reason,
    entry.evidence,
  ])
  const rejectedWorkerRows = summary.rejectedWebWorkerCandidates.map((entry) => [
    `\`${entry.file}\``,
    entry.decision,
    entry.reason,
    entry.evidence,
  ])
  const proofRows = summary.verificationMatrix.map((entry) => [
    entry.track,
    entry.requiredProof.map((proof) => `\`${proof}\``).join('<br>'),
    entry.rollback,
    entry.approval,
  ])
  const proofCoverageRows = summary.proofCommandCoverage.map((entry) => [
    entry.track,
    `\`${entry.proof}\``,
    entry.type,
    entry.target,
    entry.covered ? 'yes' : 'no',
  ])
  const focusedRows = summary.focusedTestCoverage.map((entry) => [
    entry.track,
    `\`${entry.candidate}\``,
    entry.candidateExists ? 'yes' : 'no',
    entry.testCoverage.map((test) => `${test.exists ? 'yes' : 'no'} \`${test.path}\``).join('<br>'),
    entry.covered ? 'yes' : 'no',
    entry.command,
  ])
  const convertedRows = summary.convertedTypeScriptSlices.map((entry) => [
    `\`${entry.implementation}\``,
    entry.implementationExists ? 'yes' : 'no',
    entry.compatibilityWrapper ? `\`${entry.compatibilityWrapper}\`` : entry.wrapperStatus || 'none',
    entry.wrapperRequired ? (entry.compatibilityWrapperExists ? 'yes' : 'no') : 'n/a',
    entry.declarationSupport ? `\`${entry.declarationSupport}\`` : 'none',
    entry.declarationSupportExists ? 'yes' : 'no',
    entry.proof.map((proof) => `\`${proof}\``).join('<br>'),
  ])
  const workerRows = summary.completedWebWorkerSlices.map((entry) => [
    `\`${entry.surface}\``,
    entry.surfaceExists ? 'yes' : 'no',
    `\`${entry.worker}\``,
    entry.workerExists ? 'yes' : 'no',
    `\`${entry.fallback}\``,
    entry.fallbackExists ? 'yes' : 'no',
    entry.proof.map((proof) => `\`${proof}\``).join('<br>'),
  ])
  const dataPathRows = summary.completedDataPathSlices.map((entry) => [
    `\`${entry.target}\``,
    entry.targetExists ? 'yes' : 'no',
    entry.optimization,
    entry.rollback,
    entry.proof.map((proof) => `\`${proof}\``).join('<br>'),
  ])
  const sliceRows = summary.firstExecutableSlices.map((entry) => [
    entry.track,
    entry.firstCandidate ? `\`${entry.firstCandidate}\`` : 'none',
    String(entry.lines),
    String(entry.score),
    entry.requiredProof.map((proof) => `\`${proof}\``).join('<br>'),
  ])

  return `# Language Runtime Audit

Generated: ${summary.generatedAt}

## Summary

- Mode: non-mutating audit.
- Files scanned: ${summary.sourceFiles}
- Scan roots: ${summary.scanRoots.map((root) => `\`${root}\``).join(', ')}
- Default frontend runtime: ${summary.defaults.frontend}
- Default backend runtime: ${summary.defaults.backend}
- Preferred heavy-data path: ${summary.defaults.heavyData}
- Browser CPU path: ${summary.defaults.browserCpu}
- Packaging gate: ${summary.packagingGate}
- Missing proof commands: ${summary.missingProofCommands.length}
- Focused test coverage gaps: ${summary.focusedTestCoverageGaps.length}
- Converted TypeScript coverage gaps: ${summary.convertedTypeScriptCoverageGaps.length}
- Completed Web Worker coverage gaps: ${summary.completedWebWorkerCoverageGaps.length}
- Completed data-path coverage gaps: ${summary.completedDataPathCoverageGaps.length}

## Language Counts

${markdownTable(['Language', 'Files'], languageRows)}

## Conversion Candidates

${candidateRows.length ? markdownTable(['Track', 'File', 'Lines', 'Score', 'Rule'], candidateRows) : 'No conversion candidates detected.'}

## First Executable Slices

${markdownTable(['Track', 'First candidate', 'Lines', 'Score', 'Required proof'], sliceRows)}

## Verification Matrix

${markdownTable(['Track', 'Required proof', 'Rollback', 'Approval boundary'], proofRows)}

## Proof Command Coverage

${markdownTable(['Track', 'Proof', 'Type', 'Target', 'Covered'], proofCoverageRows)}

## Focused Test Coverage

${markdownTable(['Track', 'Candidate', 'Candidate exists', 'Tests', 'Covered', 'Command'], focusedRows)}

## Converted TypeScript Slices

${convertedRows.length ? markdownTable(['Implementation', 'Exists', 'Compatibility wrapper', 'Wrapper exists', 'Declaration support', 'Declarations exist', 'Proof'], convertedRows) : 'No completed TypeScript slices are recorded yet.'}

## Completed Web Worker Slices

${workerRows.length ? markdownTable(['Surface', 'Exists', 'Worker', 'Worker exists', 'Fallback', 'Fallback exists', 'Proof'], workerRows) : 'No completed Web Worker slices are recorded yet.'}

## Completed Data-Path Optimizations

${dataPathRows.length ? markdownTable(['Target', 'Exists', 'Optimization', 'Rollback', 'Proof'], dataPathRows) : 'No completed data-path optimizations are recorded yet.'}

## Runtime Policy

${markdownTable(['Runtime', 'Decision', 'Evidence required'], policyRows)}

## Rejected Runtime Families

${markdownTable(['Runtime', 'Reason'], rejectedRows)}

## Rejected Data-Path Candidates

${rejectedDataPathRows.length ? markdownTable(['File', 'Decision', 'Reason', 'Evidence'], rejectedDataPathRows) : 'No rejected data-path candidates are recorded yet.'}

## Rejected Web Worker Candidates

${rejectedWorkerRows.length ? markdownTable(['File', 'Decision', 'Reason', 'Evidence'], rejectedWorkerRows) : 'No rejected Web Worker candidates are recorded yet.'}

## Boundary

- This audit does not convert files, install runtimes, run migrations, move folders, or delete source.
- React/JavaScript and Node.js remain the default until typecheck, benchmark, packaging, and rollback evidence exists.
- SQL/DuckDB and Web Workers are preferred first for narrow hot paths before Rust, Go, Python, or WASM.
`
}

function buildSummary(records) {
  const tsCandidates = compactCandidates(records, scoreTypeScriptCandidate).map((candidate) => ({
    ...candidate,
    track: 'TypeScript utility conversion',
    rule: 'Pure frontend helper/module with limited React or DOM boundary.',
  }))
  const workerCandidates = compactCandidates(records, scoreWorkerCandidate)
    .filter((candidate) => !COMPLETED_WEB_WORKER_FILES.has(candidate.file))
    .filter((candidate) => !REJECTED_WEB_WORKER_FILES.has(candidate.file))
    .map((candidate) => ({
      ...candidate,
      track: 'Web Worker extraction',
      rule: 'Browser CPU/file parsing/media work candidate.',
    }))
  const sqlCandidates = compactCandidates(records, scoreSqlCandidate)
    .filter((candidate) => !COMPLETED_DATA_PATH_FILES.has(candidate.file))
    .filter((candidate) => !REJECTED_DATA_PATH_FILES.has(candidate.file))
    .map((candidate) => ({
      ...candidate,
      track: 'SQL/DuckDB/data-path optimization',
      rule: 'Query/report/import/backup-heavy logic candidate.',
    }))
  const conversionCandidates = [...tsCandidates, ...workerCandidates, ...sqlCandidates]
    .sort((left, right) => left.track.localeCompare(right.track) || right.score - left.score || left.file.localeCompare(right.file))
  const matrix = verificationMatrix()
  return {
    generatedAt: new Date().toISOString(),
    report: normalizePath(path.relative(ROOT_DIR, REPORT_PATH)),
    summary: normalizePath(path.relative(ROOT_DIR, SUMMARY_PATH)),
    mode: 'non-mutating',
    scanRoots: SCAN_ROOTS,
    sourceFiles: records.length,
    fileReadMode: FILE_READ_MODE,
    rootWalkMode: FILE_READ_MODE,
    rootWalkConcurrency: ROOT_WALK_CONCURRENCY,
    matrixCheckMode: FILE_READ_MODE,
    matrixCheckConcurrency: MATRIX_CHECK_CONCURRENCY,
    fileReadConcurrency: FILE_READ_CONCURRENCY,
    languageCounts: countBy(records, (record) => record.language),
    extensionCounts: countBy(records, (record) => record.extension),
    defaults: {
      frontend: 'React/JavaScript',
      backend: 'Node.js',
      heavyData: 'SQL/DuckDB before new general-purpose runtimes',
      browserCpu: 'Web Workers before server round-trips or WASM',
      orchestration: 'PowerShell for Windows runtime orchestration',
    },
    packagingGate: 'No backend language/runtime conversion without release packaging and rollback proof.',
    runtimePolicy: [
      { runtime: 'TypeScript', decision: 'target pure helpers first', evidenceRequired: 'typecheck, focused tests, build, and unchanged public API' },
      { runtime: 'SQL/DuckDB', decision: 'preferred for heavy reports/import verification', evidenceRequired: 'before/after timing and backup/restore-safe SQL path' },
      { runtime: 'Web Workers', decision: 'preferred for browser CPU/file/media work', evidenceRequired: 'UI responsiveness check plus worker fallback path' },
      { runtime: 'PowerShell', decision: 'keep for Windows orchestration', evidenceRequired: 'launcher compatibility and non-interactive execution' },
      { runtime: 'Rust/Go/Python/WASM', decision: 'defer by default', evidenceRequired: 'benchmark win, packaging proof, rollback path, and dependency-size review' },
    ],
    rejectedRuntimeFamilies: [
      { runtime: 'Rust', reason: 'No benchmark-backed hot path currently requires native compilation.' },
      { runtime: 'Go', reason: 'No standalone service boundary has packaging proof yet.' },
      { runtime: 'Python', reason: 'Would add runtime packaging complexity for current Node/SQL-owned flows.' },
      { runtime: 'WASM', reason: 'Use only after Web Worker and library options are measured.' },
    ],
    rejectedDataPathCandidates: REJECTED_DATA_PATH_CANDIDATES,
    rejectedWebWorkerCandidates: REJECTED_WEB_WORKER_CANDIDATES,
    verificationMatrix: matrix,
    firstExecutableSlices: buildFirstExecutableSlices(conversionCandidates),
    proofCommandCoverage: [],
    missingProofCommands: [],
    focusedTestCoverage: [],
    focusedTestCoverageGaps: [],
    convertedTypeScriptSlices: [],
    convertedTypeScriptCoverageGaps: [],
    completedWebWorkerSlices: [],
    completedWebWorkerCoverageGaps: [],
    completedDataPathSlices: [],
    completedDataPathCoverageGaps: [],
    conversionCandidates,
  }
}

async function main() {
  const records = await collectRecords()
  const packageManifests = {
    frontend: await readJsonAsync(path.join(ROOT_DIR, 'frontend/package.json')),
    backend: await readJsonAsync(path.join(ROOT_DIR, 'backend/package.json')),
    ops: await readJsonAsync(path.join(ROOT_DIR, 'ops/package.json')),
  }
  const summary = buildSummary(records)
  summary.proofCommandCoverage = await collectProofCommandCoverage(summary.verificationMatrix, packageManifests)
  summary.missingProofCommands = summary.proofCommandCoverage
    .filter((entry) => !entry.covered)
    .map((entry) => ({ track: entry.track, proof: entry.proof, target: entry.target }))
  summary.focusedTestCoverage = await collectFocusedTestCoverage()
  summary.focusedTestCoverageGaps = summary.focusedTestCoverage
    .filter((entry) => !entry.candidateExists || !entry.covered)
    .map((entry) => ({
      track: entry.track,
      candidate: entry.candidate,
      candidateExists: entry.candidateExists,
      missingTests: entry.testCoverage.filter((test) => !test.exists).map((test) => test.path),
    }))
  summary.convertedTypeScriptSlices = await collectConvertedTypeScriptSlices()
  summary.convertedTypeScriptCoverageGaps = summary.convertedTypeScriptSlices
    .filter((entry) => !entry.covered)
    .map((entry) => ({
      implementation: entry.implementation,
      implementationExists: entry.implementationExists,
      compatibilityWrapper: entry.compatibilityWrapper,
      wrapperStatus: entry.wrapperStatus,
      wrapperRequired: entry.wrapperRequired,
      compatibilityWrapperExists: entry.compatibilityWrapperExists,
      declarationSupport: entry.declarationSupport,
      declarationSupportExists: entry.declarationSupportExists,
    }))
  summary.completedWebWorkerSlices = await collectCompletedWebWorkerSlices()
  summary.completedWebWorkerCoverageGaps = summary.completedWebWorkerSlices
    .filter((entry) => !entry.covered)
    .map((entry) => ({
      surface: entry.surface,
      surfaceExists: entry.surfaceExists,
      worker: entry.worker,
      workerExists: entry.workerExists,
      compatibilityWrapper: entry.compatibilityWrapper,
      compatibilityWrapperExists: entry.compatibilityWrapperExists,
      fallback: entry.fallback,
      fallbackExists: entry.fallbackExists,
    }))
  summary.completedDataPathSlices = await collectCompletedDataPathSlices()
  summary.completedDataPathCoverageGaps = summary.completedDataPathSlices
    .filter((entry) => !entry.targetExists || !entry.covered)
    .map((entry) => ({
      target: entry.target,
      targetExists: entry.targetExists,
      missingTests: entry.testCoverage.filter((test) => !test.exists).map((test) => test.path),
    }))
  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true })
  await fs.writeFile(REPORT_PATH, renderReport(summary), 'utf8')
  await fs.writeFile(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(summary, null, 2))
  if (summary.missingProofCommands.length) {
    console.error(`Language runtime audit failed: ${summary.missingProofCommands.length} proof command(s) are missing.`)
    process.exitCode = 1
  }
  if (summary.focusedTestCoverageGaps.length) {
    console.error(`Language runtime audit failed: ${summary.focusedTestCoverageGaps.length} focused test coverage gap(s) detected.`)
    process.exitCode = 1
  }
  if (summary.convertedTypeScriptCoverageGaps.length) {
    console.error(`Language runtime audit failed: ${summary.convertedTypeScriptCoverageGaps.length} converted TypeScript coverage gap(s) detected.`)
    process.exitCode = 1
  }
  if (summary.completedWebWorkerCoverageGaps.length) {
    console.error(`Language runtime audit failed: ${summary.completedWebWorkerCoverageGaps.length} completed Web Worker coverage gap(s) detected.`)
    process.exitCode = 1
  }
  if (summary.completedDataPathCoverageGaps.length) {
    console.error(`Language runtime audit failed: ${summary.completedDataPathCoverageGaps.length} completed data-path coverage gap(s) detected.`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
})
