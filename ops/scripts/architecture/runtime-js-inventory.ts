/* eslint-disable no-console */
const fs = require('node:fs/promises')
const path = require('node:path')
const { pathExists, toPosix: normalizePath } = require('../lib/fs-utils.ts')
const { markdownTable } = require('../lib/report-utils.ts')

type RuntimeJsRecord = {
  path: string
  category: string
  source: string
  proof: string
  allowed: boolean
}

type RuntimeJsRule = {
  match: (relativePath: string) => boolean
  category: string
  source: string
  proof: string
}

const ROOT_DIR = path.resolve(__dirname, '../../..')
const REPORT_PATH = path.join(ROOT_DIR, 'ops/docs/reference/RUNTIME-JS-INVENTORY.md')
const SUMMARY_PATH = path.join(ROOT_DIR, 'ops/docs/reference/RUNTIME-JS-INVENTORY.json')
const JS_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs'])
const EXCLUDED_DIRS = new Set([
  '.git',
  '.playwright-cli',
  'node_modules',
  'dist',
  'dist-bin',
  '.pkg-stage',
  'business-os-data',
  'runtime',
  'release',
  'output',
])

const EXACT_RUNTIME_RULES: Record<string, Omit<RuntimeJsRule, 'match'>> = {
  'backend/server.js': {
    category: 'generated backend runtime entry',
    source: 'backend/server.ts',
    proof: 'npm.cmd --prefix backend run verify:server-entry',
  },
  'frontend/public/runtime-noise-guard.js': {
    category: 'generated browser runtime asset',
    source: 'frontend/src/public-runtime/runtime-noise-guard.ts',
    proof: 'npm.cmd --prefix frontend run verify:public-runtime',
  },
  'frontend/public/theme-bootstrap.js': {
    category: 'generated browser runtime asset',
    source: 'frontend/src/public-runtime/theme-bootstrap.ts',
    proof: 'npm.cmd --prefix frontend run verify:public-runtime',
  },
  'frontend/public/sw.js': {
    category: 'generated service worker asset',
    source: 'frontend/src/public-runtime/service-worker.ts',
    proof: 'npm.cmd --prefix frontend run verify:public-runtime',
  },
  'ops/config/ecosystem.config.js': {
    category: 'generated PM2 runtime config',
    source: 'ops/config/ecosystem.config.ts',
    proof: 'npm.cmd --prefix ops run verify:ecosystem-config',
  },
}

const RUNTIME_JS_RULES: RuntimeJsRule[] = [
  ...Object.entries(EXACT_RUNTIME_RULES).map(([exactPath, metadata]) => ({
    match: (relativePath: string): boolean => relativePath === exactPath,
    ...metadata,
  })),
  {
    match: (relativePath: string): boolean => relativePath.startsWith('frontend/public/scanbot-web-sdk/'),
    category: 'tracked vendor scanner bundle',
    source: 'frontend/public/scanbot-web-sdk',
    proof: 'Scanner replacement must be proven before deleting or converting vendor files.',
  },
]

function shouldSkipDirectory(entryName: string, absolutePath: string): boolean {
  if (EXCLUDED_DIRS.has(entryName)) return true
  const relativePath = normalizePath(path.relative(ROOT_DIR, absolutePath))
  if (relativePath === 'frontend/public/scanbot-web-sdk') return false
  return relativePath.startsWith('frontend/public/scanbot-web-sdk/bundle/bin') ? false : EXCLUDED_DIRS.has(entryName)
}

async function collectRuntimeJsFiles(): Promise<string[]> {
  const output: string[] = []
  const stack = [ROOT_DIR]
  while (stack.length) {
    const current = stack.pop()
    if (!current) continue
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (!shouldSkipDirectory(entry.name, absolutePath)) stack.push(absolutePath)
        continue
      }
      if (!JS_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
      output.push(normalizePath(path.relative(ROOT_DIR, absolutePath)))
    }
  }
  return output.sort((left, right) => left.localeCompare(right))
}

function classifyRuntimeJs(relativePath: string): RuntimeJsRecord {
  const rule = RUNTIME_JS_RULES.find((candidate) => candidate.match(relativePath))
  if (!rule) {
    return {
      path: relativePath,
      category: 'unclassified first-party JavaScript',
      source: '',
      proof: 'Convert to TypeScript, mark generated with a drift check, or document a vendor/runtime exception.',
      allowed: false,
    }
  }
  return {
    path: relativePath,
    category: rule.category,
    source: rule.source,
    proof: rule.proof,
    allowed: true,
  }
}

async function verifyRuntimeSources(records: RuntimeJsRecord[]): Promise<RuntimeJsRecord[]> {
  const missingSources = []
  for (const record of records) {
    if (!record.allowed || !record.source || record.category.includes('vendor')) continue
    if (!(await pathExists(path.join(ROOT_DIR, record.source)))) {
      missingSources.push({
        ...record,
        category: `${record.category} with missing TypeScript source`,
        allowed: false,
      })
    }
  }
  return missingSources
}

function renderReport(records: RuntimeJsRecord[], missingSources: RuntimeJsRecord[]): string {
  const generatedAt = new Date().toISOString()
  const rows = records.map((record) => [
    record.path,
    record.category,
    record.source || 'n/a',
    record.allowed ? 'yes' : 'no',
    record.proof,
  ])
  const categoryRows = Object.entries(
    records.reduce((totals: Record<string, number>, record) => {
      totals[record.category] = (totals[record.category] || 0) + 1
      return totals
    }, {}),
  )
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([category, count]) => [category, String(count)])
  const unclassified = records.filter((record) => !record.allowed)

  return `# Runtime JavaScript Inventory

Generated: ${generatedAt}

## Summary

- Runtime JavaScript files: ${records.length}
- Allowed generated/vendor files: ${records.length - unclassified.length}
- Unclassified files: ${unclassified.length}
- Missing TypeScript sources for generated files: ${missingSources.length}
- Mode: fail if any unclassified first-party JavaScript, JSX, MJS, or CJS file is found outside dependency/generated bulk folders.

## Category Totals

${markdownTable(['Category', 'Files'], categoryRows)}

## Files

${markdownTable(['Path', 'Category', 'Source / Owner', 'Allowed', 'Proof'], rows)}
`
}

async function main(): Promise<void> {
  const files = await collectRuntimeJsFiles()
  const records = files.map(classifyRuntimeJs)
  const missingSources = await verifyRuntimeSources(records)
  const failures = [...records.filter((record) => !record.allowed), ...missingSources]
  const report = renderReport(records, missingSources)
  const summary = {
    generatedAt: new Date().toISOString(),
    report: normalizePath(path.relative(ROOT_DIR, REPORT_PATH)),
    summary: normalizePath(path.relative(ROOT_DIR, SUMMARY_PATH)),
    runtimeJsFiles: records.length,
    allowedFiles: records.length - records.filter((record) => !record.allowed).length,
    unclassifiedFiles: records.filter((record) => !record.allowed).map((record) => record.path),
    missingSources: missingSources.map((record) => ({ path: record.path, source: record.source })),
    records,
  }

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true })
  await fs.writeFile(REPORT_PATH, report, 'utf8')
  await fs.writeFile(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')

  if (failures.length) {
    console.error('Runtime JavaScript inventory found unapproved files:')
    for (const failure of failures) console.error(`- ${failure.path}: ${failure.proof}`)
    process.exit(1)
  }

  console.log(JSON.stringify({
    report: summary.report,
    summary: summary.summary,
    runtimeJsFiles: summary.runtimeJsFiles,
    unclassifiedFiles: summary.unclassifiedFiles.length,
    missingSources: summary.missingSources.length,
  }, null, 2))
}

main()
