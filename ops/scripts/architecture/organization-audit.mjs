/* eslint-disable no-console */
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { mapLimit, pathExists, toPosix: normalizePath } = require('../lib/fs-utils.js')
const { markdownTable } = require('../lib/report-utils.js')
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const REPORT_PATH = path.join(ROOT_DIR, 'ops/docs/reference/ORGANIZATION-AUDIT.md')
const SUMMARY_PATH = path.join(ROOT_DIR, 'ops/docs/reference/ORGANIZATION-AUDIT.json')
const SCAN_ROOTS = ['frontend/src', 'frontend/tests', 'backend/src', 'backend/test', 'ops/scripts', 'ops/docs', 'run']
const SCAN_FILES = [
  'package.json',
  'backend/package.json',
  'frontend/package.json',
  'ops/package.json',
  'docker-compose.yml',
  'Dockerfile',
]
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx', '.css', '.json', '.md', '.sql', '.ps1', '.bat', '.cmd', '.sh', '.yml', '.yaml'])
const LARGE_FILE_LINE_THRESHOLD = 700
const ROOT_WALK_CONCURRENCY = 3
const FILE_READ_CONCURRENCY = 24

async function walkFiles(root) {
  const absoluteRoot = path.join(ROOT_DIR, root)
  if (!(await pathExists(absoluteRoot))) return []
  const output = []
  const stack = [absoluteRoot]
  while (stack.length) {
    const current = stack.pop()
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      const absolutePath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(absolutePath)
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        output.push(absolutePath)
      }
    }
  }
  return output.sort((left, right) => normalizePath(left).localeCompare(normalizePath(right)))
}

function getArea(relativePath) {
  const parts = relativePath.split('/')
  if (relativePath === 'package.json') return 'root/config'
  if (relativePath === 'docker-compose.yml' || relativePath === 'Dockerfile') return 'root/config'
  if (/^[^/]+\/package\.json$/.test(relativePath)) return `${parts[0]}/config`
  if (relativePath.startsWith('run/docker/')) return 'run/docker'
  if (relativePath.startsWith('run/sh/')) return 'run/sh'
  if (relativePath.startsWith('run/')) return 'run'
  if (relativePath.startsWith('frontend/src/components/')) return `frontend/components/${parts[3] || '(root)'}`
  if (relativePath.startsWith('frontend/src/utils/')) return 'frontend/utils'
  if (relativePath.startsWith('frontend/src/api/')) return 'frontend/api'
  if (relativePath.startsWith('frontend/src/app/')) return 'frontend/app'
  if (relativePath.startsWith('backend/src/routes/')) return 'backend/routes'
  if (relativePath.startsWith('backend/src/services/')) return 'backend/services'
  if (relativePath.startsWith('backend/src/db/')) return 'backend/db'
  if (relativePath.startsWith('backend/src/workers/')) return 'backend/workers'
  if (relativePath.startsWith('ops/scripts/runtime/live-checks/')) return 'ops/scripts/runtime/live-checks'
  if (relativePath.startsWith('ops/scripts/runtime/audits/')) return 'ops/scripts/runtime/audits'
  if (relativePath.startsWith('ops/scripts/runtime/cloudflare/')) return 'ops/scripts/runtime/cloudflare'
  if (relativePath.startsWith('ops/scripts/runtime/storage/')) return 'ops/scripts/runtime/storage'
  if (relativePath.startsWith('ops/scripts/runtime/smoke/')) return 'ops/scripts/runtime/smoke'
  if (relativePath.startsWith('ops/scripts/runtime/')) return 'ops/scripts/runtime'
  if (relativePath.startsWith('ops/scripts/verification/')) return 'ops/scripts/verification'
  if (relativePath.startsWith('ops/scripts/docs/')) return 'ops/scripts/docs'
  if (relativePath.startsWith('ops/scripts/backend/')) return 'ops/scripts/backend'
  if (relativePath.startsWith('ops/scripts/frontend/')) return 'ops/scripts/frontend'
  if (relativePath.startsWith('ops/docs/reference/')) return 'ops/docs/reference'
  if (relativePath.startsWith('ops/docs/')) return 'ops/docs'
  return parts.slice(0, 3).join('/')
}

function countBy(items, pickKey) {
  const map = new Map()
  for (const item of items) {
    const key = pickKey(item)
    map.set(key, (map.get(key) || 0) + 1)
  }
  return [...map.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
}

function extractRelativeImports(source) {
  const imports = []
  const patterns = [
    /from\s+['"](\.{1,2}\/[^'"]+)['"]/g,
    /import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
    /require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      imports.push(match[1])
    }
  }
  return imports
}

async function collectFileRecords() {
  const files = new Set()
  const rootFileGroups = await mapLimit(SCAN_ROOTS, ROOT_WALK_CONCURRENCY, (root) => walkFiles(root))
  for (const group of rootFileGroups) {
    for (const file of group) {
      files.add(file)
    }
  }
  const rootFiles = await mapLimit(SCAN_FILES, ROOT_WALK_CONCURRENCY, async (file) => {
    const absolutePath = path.join(ROOT_DIR, file)
    return (await pathExists(absolutePath)) ? absolutePath : null
  })
  for (const absolutePath of rootFiles.filter(Boolean)) {
    files.add(absolutePath)
  }
  const sortedFiles = [...files].sort((left, right) => normalizePath(left).localeCompare(normalizePath(right)))
  const records = await mapLimit(sortedFiles, FILE_READ_CONCURRENCY, async (absolutePath) => {
    const relativePath = normalizePath(path.relative(ROOT_DIR, absolutePath))
    const source = await fs.readFile(absolutePath, 'utf8')
    const lineCount = source.split(/\r?\n/).length
    const relativeImports = extractRelativeImports(source)
    return {
      absolutePath,
      relativePath,
      extension: path.extname(relativePath) || '(none)',
      area: getArea(relativePath),
      lineCount,
      relativeImportCount: relativeImports.length,
      source,
    }
  })
  return records
}

function nonEmptyLines(source) {
  return String(source || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function extractWrapperTarget(source) {
  const patterns = [
    /import\s+['"](\.\/[^'"]+)['"]/,
    /export\s+\*\s+from\s+['"](\.\/[^'"]+)['"]/,
    /require\(\s*['"](\.\/[^'"]+)['"]\s*\)/,
  ]
  for (const pattern of patterns) {
    const match = String(source || '').match(pattern)
    if (match) return match[1]
  }
  return ''
}

function collectCompatibilityWrappers(records) {
  const paths = new Set(records.map((record) => record.relativePath))
  return records
    .map((record) => {
      const target = extractWrapperTarget(record.source)
      const lines = nonEmptyLines(record.source)
      const isScriptRootWrapper =
        /^ops\/scripts\/[^/]+\.(?:js|mjs)$/.test(record.relativePath)
        || /^ops\/scripts\/runtime\/[^/]+\.(?:js|mjs)$/.test(record.relativePath)
      const isThinWrapper = target && lines.length <= 3 && isScriptRootWrapper
      if (!isThinWrapper) return null
      const targetPath = normalizePath(path.join(path.dirname(record.relativePath), target))
      return {
        file: record.relativePath,
        target: targetPath,
        lineCount: record.lineCount,
        targetPresent: paths.has(targetPath),
      }
    })
    .filter(Boolean)
    .sort((left, right) => left.file.localeCompare(right.file))
}

function countOccurrences(source, needle) {
  if (!needle) return 0
  let count = 0
  let index = String(source || '').indexOf(needle)
  while (index !== -1) {
    count += 1
    index = String(source || '').indexOf(needle, index + needle.length)
  }
  return count
}

function wrapperReferenceCandidates(wrapperPath, fromPath) {
  const candidates = new Set([wrapperPath, wrapperPath.replace(/\//g, '\\')])
  const recordDir = path.dirname(fromPath)
  const relativePath = normalizePath(path.relative(recordDir === '.' ? ROOT_DIR : path.join(ROOT_DIR, recordDir), path.join(ROOT_DIR, wrapperPath)))
  if (relativePath && relativePath !== '.') {
    candidates.add(relativePath)
    candidates.add(relativePath.replace(/\//g, '\\'))
    if (!relativePath.startsWith('.')) {
      candidates.add(`./${relativePath}`)
      candidates.add(`.\\${relativePath.replace(/\//g, '\\')}`)
    }
  }
  if (wrapperPath.startsWith('ops/')) {
    const withoutOps = wrapperPath.slice('ops/'.length)
    candidates.add(withoutOps)
    candidates.add(withoutOps.replace(/\//g, '\\'))
  }
  return [...candidates].filter(Boolean)
}

function collectWrapperReferenceDetails(records, wrappers) {
  const reportRelativePath = normalizePath(path.relative(ROOT_DIR, REPORT_PATH))
  const sourceRecords = records.filter((record) => record.relativePath !== reportRelativePath)
  return wrappers.map((wrapper) => {
    const references = sourceRecords
      .filter((record) => record.relativePath !== wrapper.file)
      .map((record) => {
        const candidates = wrapperReferenceCandidates(wrapper.file, record.relativePath)
        const count = candidates.reduce((total, candidate) => total + countOccurrences(record.source, candidate), 0)
        return count ? { file: record.relativePath, count } : null
      })
      .filter(Boolean)
      .sort((left, right) => right.count - left.count || left.file.localeCompare(right.file))
    const activeReferences = references.filter((reference) => !reference.file.startsWith('ops/docs/reference/'))
    const generatedReferences = references.filter((reference) => reference.file.startsWith('ops/docs/reference/'))
    return {
      ...wrapper,
      referenceCount: references.reduce((total, reference) => total + reference.count, 0),
      activeReferenceCount: activeReferences.reduce((total, reference) => total + reference.count, 0),
      generatedReferenceCount: generatedReferences.reduce((total, reference) => total + reference.count, 0),
      referenceFiles: references,
      activeReferenceFiles: activeReferences,
      generatedReferenceFiles: generatedReferences,
    }
  })
}

function renderReferenceFiles(references) {
  if (!references.length) return 'none'
  const visible = references.slice(0, 5)
    .map((reference) => `${reference.file} (${reference.count})`)
  const remaining = references.length - visible.length
  return remaining > 0 ? `${visible.join('<br>')}<br>+${remaining} more` : visible.join('<br>')
}

function renderReport(records) {
  const generatedAt = new Date().toISOString()
  const extensionRows = countBy(records, (record) => record.extension)
    .map(([extension, count]) => [extension, String(count)])
  const areaRows = countBy(records, (record) => record.area)
    .slice(0, 30)
    .map(([area, count]) => [area, String(count)])
  const largeFileRows = records
    .filter((record) => record.lineCount >= LARGE_FILE_LINE_THRESHOLD)
    .sort((left, right) => right.lineCount - left.lineCount)
    .slice(0, 30)
    .map((record) => [record.relativePath, String(record.lineCount), record.area])
  const importHeavyRows = records
    .filter((record) => record.relativeImportCount >= 10)
    .sort((left, right) => right.relativeImportCount - left.relativeImportCount)
    .slice(0, 30)
    .map((record) => [record.relativePath, String(record.relativeImportCount), record.area])
  const wrapperRows = collectWrapperReferenceDetails(records, collectCompatibilityWrappers(records))
  const brokenWrapperRows = wrapperRows.filter((wrapper) => !wrapper.targetPresent)
  const removableWrapperRows = wrapperRows.filter((wrapper) => wrapper.targetPresent && wrapper.activeReferenceCount === 0)

  return `# Organization Audit

Generated: ${generatedAt}

## Summary

- Scanned roots: ${SCAN_ROOTS.map((root) => `\`${root}\``).join(', ')}
- Scanned root files: ${SCAN_FILES.filter((file) => records.some((record) => record.relativePath === file)).map((file) => `\`${file}\``).join(', ') || 'none'}
- Files scanned: ${records.length}
- Large file threshold: ${LARGE_FILE_LINE_THRESHOLD} lines
- File read mode: bounded parallel (${FILE_READ_CONCURRENCY})

## File Extensions

${markdownTable(['Extension', 'Files'], extensionRows)}

## Largest Areas

${markdownTable(['Area', 'Files'], areaRows)}

## Large Files

${largeFileRows.length ? markdownTable(['File', 'Lines', 'Area'], largeFileRows) : 'No files exceeded the large-file threshold.'}

## Relative Import Hotspots

${importHeavyRows.length ? markdownTable(['File', 'Relative imports', 'Area'], importHeavyRows) : 'No files exceeded the relative-import hotspot threshold.'}

## Compatibility Wrappers

These root entrypoints are intentionally thin wrappers around grouped
implementations. Keep them small until all old paths are gone.

${wrapperRows.length ? markdownTable(['Wrapper', 'Target', 'Lines', 'Target present', 'Active refs', 'Generated refs', 'Active reference files'], wrapperRows.map((wrapper) => [
    wrapper.file,
    wrapper.target,
    String(wrapper.lineCount),
    wrapper.targetPresent ? 'yes' : 'no',
    String(wrapper.activeReferenceCount),
    String(wrapper.generatedReferenceCount),
    renderReferenceFiles(wrapper.activeReferenceFiles),
  ])) : 'No compatibility wrappers detected.'}

## Broken Wrapper Targets

${brokenWrapperRows.length ? markdownTable(['Wrapper', 'Missing target'], brokenWrapperRows.map((wrapper) => [
    wrapper.file,
    wrapper.target,
  ])) : 'No broken compatibility wrapper targets detected.'}

## Wrapper Removal Candidates

${removableWrapperRows.length ? markdownTable(['Wrapper', 'Current target', 'Generated reference refs to refresh'], removableWrapperRows.map((wrapper) => [
    wrapper.file,
    wrapper.target,
    String(wrapper.generatedReferenceCount),
  ])) : 'No wrapper removal candidates detected. Every wrapper is still referenced by active first-party files.'}

## Recommended First Moves

1. Keep Phase 8.4 action stability work moving while organizing nearby product files.
2. Split \`frontend/src/components/products\` internally only after a passing Products Playwright check is available for each move.
3. Move ops runtime scripts into grouped subfolders with compatibility wrappers before touching high-traffic app source paths.
4. Convert pure frontend utility modules to TypeScript before React components.
5. Delay backend TypeScript conversion until release packaging has a compiled-output story.
`
}

function buildSummary({ records, wrappers, brokenWrappers, activeRemovalCandidates, generatedOnlyWrappers }) {
  return {
    report: normalizePath(path.relative(ROOT_DIR, REPORT_PATH)),
    summary: normalizePath(path.relative(ROOT_DIR, SUMMARY_PATH)),
    filesScanned: records.length,
    largeFiles: records.filter((record) => record.lineCount >= LARGE_FILE_LINE_THRESHOLD).length,
    compatibilityWrappers: wrappers.length,
    brokenCompatibilityWrappers: brokenWrappers.length,
    wrapperRemovalCandidates: activeRemovalCandidates.length,
    generatedOnlyWrapperReferences: generatedOnlyWrappers.length,
    scanRoots: SCAN_ROOTS,
    scanFiles: SCAN_FILES,
    fileReadMode: 'bounded-parallel',
    rootWalkMode: 'bounded-parallel',
    rootWalkConcurrency: ROOT_WALK_CONCURRENCY,
    fileReadConcurrency: FILE_READ_CONCURRENCY,
    largeFileThreshold: LARGE_FILE_LINE_THRESHOLD,
    largestAreas: countBy(records, (record) => record.area).slice(0, 30),
    largeFilePaths: records
      .filter((record) => record.lineCount >= LARGE_FILE_LINE_THRESHOLD)
      .map((record) => record.relativePath)
      .sort(),
    wrapperFiles: wrappers.map((wrapper) => wrapper.file).sort(),
    brokenWrapperFiles: brokenWrappers.map((wrapper) => wrapper.file).sort(),
    removableWrapperFiles: activeRemovalCandidates.map((wrapper) => wrapper.file).sort(),
  }
}

async function main() {
  const records = await collectFileRecords()
  const wrappers = collectWrapperReferenceDetails(records, collectCompatibilityWrappers(records))
  const brokenWrappers = wrappers.filter((wrapper) => !wrapper.targetPresent)
  const activeRemovalCandidates = wrappers.filter((wrapper) => wrapper.targetPresent && wrapper.activeReferenceCount === 0)
  const generatedOnlyWrappers = activeRemovalCandidates.filter((wrapper) => wrapper.generatedReferenceCount > 0)
  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true })
  const report = renderReport(records)
  const summary = buildSummary({ records, wrappers, brokenWrappers, activeRemovalCandidates, generatedOnlyWrappers })
  await fs.writeFile(REPORT_PATH, report, 'utf8')
  await fs.writeFile(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(summary, null, 2))
  if (brokenWrappers.length) {
    console.error(`Organization audit failed: ${brokenWrappers.length} compatibility wrapper target(s) are missing.`)
    for (const wrapper of brokenWrappers) {
      console.error(`- ${wrapper.file} -> ${wrapper.target}`)
    }
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
})
