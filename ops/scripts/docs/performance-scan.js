#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const {
  resolveProjectRoot,
  relFrom,
  lineCount,
  mapLimit,
  walkFilesRecursive,
  collectRootFiles,
} = require('../lib/fs-utils')

// Resolve from the script location so metrics can be generated from any
// working directory.
const ROOT = resolveProjectRoot(__dirname)
const DOC_PATH = path.join(ROOT, 'ops', 'docs', 'reference', 'PERFORMANCE-SCAN.md')
const SUMMARY_PATH = path.join(ROOT, 'ops', 'docs', 'reference', 'PERFORMANCE-SCAN.json')
const SOURCE_READ_MODE = 'bounded-parallel'
const SOURCE_READ_CONCURRENCY = 24
const CHUNK_STAT_CONCURRENCY = 32
const MANUAL_NOTES_START = '<!-- phase29-manual-notes:start -->'
const MANUAL_NOTES_END = '<!-- phase29-manual-notes:end -->'
const DEFAULT_MANUAL_NOTES = `- Move 178 reduces \`writeSystemSettings()\` transaction-loop overhead by
  preparing the settings delete statement once beside the upsert statement.
- Move 179 leaves \`language-runtime-audit.ts\` in Node.js and rejects it from
  the SQL/DuckDB queue because the remaining signal was self-referential report
  metadata, not a runtime data-processing hot path.
- Move 180 removed the generated root \`output\` folder after exact-path
  reference checks, freeing 870,964 bytes without touching business data,
  uploads, secrets, dependencies, or source files.
- Move 181 ran local retention cleanup and removed four old Phase 8.4 report
  folders, freeing 817,705 bytes while skipping remote R2 pruning.
- Move 182 speeds up \`generated-bulk-audit.ts\` with a recursive directory
  read fast path and the previous stack walker as fallback, preserving exact
  byte/file counts while reducing repeated Phase 29 audit overhead.
- Move 183 reduces Phase 29 orchestration wall time by running independent
  reference-producing child checks in parallel, then running organization audit
  after the generated reports are complete.`
/**
 * 1. Scan Scope Configuration
 * 1.1 Exclude build/runtime folders that should not influence source metrics.
 * 1.2 Include root run/config files so deployment scripts are measured too.
 */
const EXCLUDED = new Set(['node_modules', 'dist', '.git', '.pm2', 'release'])
const ROOT_SCAN_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.json',
  '.css',
  '.md',
  '.bat',
  '.sh',
  '.ps1',
  '.nsi',
  '.html',
  '.env',
])
const ROOT_EXCLUDED_FILES = new Set(['business-os-server.exe', 'build-release.log'])

function kb(bytes) {
  // 2.1 Render human-readable file sizes.
  return (bytes / 1024).toFixed(1)
}

function topN(rows, n = 20, key = 'size') {
  // 2.2 Sort helper used by size/line/chunk sections.
  return rows
    .slice()
    .sort((a, b) => b[key] - a[key])
    .slice(0, n)
}

function compactRows(rows) {
  return rows.map((row) => ({
    file: row.file,
    size: row.size,
    lines: row.lines || 0,
  }))
}

async function readSourceRow(filePath) {
  const [stat, text] = await Promise.all([
    fs.promises.stat(filePath),
    fs.promises.readFile(filePath, 'utf8').catch(() => ''),
  ])
  return {
    file: relFrom(ROOT, filePath),
    size: stat.size,
    lines: lineCount(text),
  }
}

async function readChunkRow(filePath) {
  const stat = await fs.promises.stat(filePath)
  return { file: relFrom(ROOT, filePath), size: stat.size }
}

function readManualNotes() {
  if (!fs.existsSync(DOC_PATH)) return DEFAULT_MANUAL_NOTES

  const existing = fs.readFileSync(DOC_PATH, 'utf8')
  const start = existing.indexOf(MANUAL_NOTES_START)
  const end = existing.indexOf(MANUAL_NOTES_END)
  if (start !== -1 && end !== -1 && end > start) {
    return existing
      .slice(start + MANUAL_NOTES_START.length, end)
      .trim()
  }

  const firstMoveNote = existing.indexOf('- Move 178 ')
  if (firstMoveNote !== -1) {
    return existing.slice(firstMoveNote).trim()
  }

  return DEFAULT_MANUAL_NOTES
}

function buildPerformanceSummary(sourceRows, chunkRows, largeSourceBySize, largeSourceByLines, largeChunks) {
  const oversizedSourceFiles = sourceRows
    .filter((row) => row.size >= 80 * 1024 || row.lines >= 1500)
    .map((row) => row.file)
    .sort()
  const oversizedBuiltChunks = chunkRows
    .filter((row) => row.size >= 150 * 1024)
    .map((row) => row.file)
    .sort()

  return {
    report: relFrom(ROOT, DOC_PATH),
    summary: relFrom(ROOT, SUMMARY_PATH),
    sourceFiles: sourceRows.length,
    distAssets: chunkRows.length,
    totalSourceBytes: sourceRows.reduce((sum, row) => sum + row.size, 0),
    totalSourceLines: sourceRows.reduce((sum, row) => sum + row.lines, 0),
    largestSourceFile: largeSourceBySize[0]?.file || null,
    largestSourceFileBytes: largeSourceBySize[0]?.size || 0,
    largestSourceLinesFile: largeSourceByLines[0]?.file || null,
    largestSourceLines: largeSourceByLines[0]?.lines || 0,
    largestBuiltChunk: largeChunks[0]?.file || null,
    largestBuiltChunkBytes: largeChunks[0]?.size || 0,
    oversizedSourceFiles,
    oversizedBuiltChunks,
    topSourceBySize: compactRows(largeSourceBySize),
    topSourceByLines: compactRows(largeSourceByLines),
    topBuiltChunks: compactRows(largeChunks),
    sourceReadMode: SOURCE_READ_MODE,
    sourceReadConcurrency: SOURCE_READ_CONCURRENCY,
    chunkStatConcurrency: CHUNK_STAT_CONCURRENCY,
  }
}

async function main() {
  /**
   * 3. Scan Inputs
   * - Frontend source, backend source, and unified ops scripts.
   * - Root files used by setup/run/release workflows.
   * - Built frontend chunks for output-size monitoring.
   */
  const frontendSrcFiles = walkFilesRecursive(path.join(ROOT, 'frontend', 'src'), { excludeDirs: EXCLUDED })
  const backendSrcFiles = walkFilesRecursive(path.join(ROOT, 'backend', 'src'), { excludeDirs: EXCLUDED })
  const projectScriptFiles = walkFilesRecursive(path.join(ROOT, 'ops', 'scripts'), { excludeDirs: EXCLUDED })
  const rootFiles = collectRootFiles(ROOT, { extensions: ROOT_SCAN_EXTENSIONS, excludedFiles: ROOT_EXCLUDED_FILES })
  const distAssetFiles = walkFilesRecursive(path.join(ROOT, 'frontend', 'dist', 'assets'), { excludeDirs: EXCLUDED })
    .filter((f) => /\.(js|css)$/i.test(f))

  const sourceFiles = [...frontendSrcFiles, ...backendSrcFiles, ...projectScriptFiles, ...rootFiles]
    .filter((f) => /\.(js|jsx|ts|tsx|json|css|md|bat|sh|ps1|nsi|html|env)$/i.test(f))
  const sourceRows = await mapLimit(sourceFiles, SOURCE_READ_CONCURRENCY, readSourceRow)

  const chunkRows = await mapLimit(distAssetFiles, CHUNK_STAT_CONCURRENCY, readChunkRow)

  const largeSourceBySize = topN(sourceRows, 25, 'size')
  const largeSourceByLines = topN(sourceRows, 25, 'lines')
  const largeChunks = topN(chunkRows, 25, 'size')
  const summary = buildPerformanceSummary(sourceRows, chunkRows, largeSourceBySize, largeSourceByLines, largeChunks)
  const manualNotes = readManualNotes()
  summary.manualNotesPreserved = Boolean(manualNotes)
  summary.manualNotesLines = manualNotes ? manualNotes.split(/\r?\n/).length : 0

  const report =
`# Performance Scan

Auto-generated performance scan for source size/complexity and built frontend chunks.

## 1. Scope

- Frontend source: \`frontend/src\`
- Backend source: \`backend/src\`
- Project scripts: \`ops/scripts\`
- Project root run/config files
- Built chunks: \`frontend/dist/assets\` (if present)

## 2. Largest Source Files (by size)

| File | Size (KB) | Lines |
|---|---:|---:|
${largeSourceBySize.map((r) => `| \`${r.file}\` | ${kb(r.size)} | ${r.lines} |`).join('\n')}

## 3. Largest Source Files (by lines)

| File | Lines | Size (KB) |
|---|---:|---:|
${largeSourceByLines.map((r) => `| \`${r.file}\` | ${r.lines} | ${kb(r.size)} |`).join('\n')}

## 4. Largest Built Chunks

| Asset | Size (KB) |
|---|---:|
${largeChunks.length ? largeChunks.map((r) => `| \`${r.file}\` | ${kb(r.size)} |`).join('\n') : '| _No build output found_ | - |'}

## 5. Notes

- Large source files are candidates for modular split by domain responsibility.
- Large JS chunks are candidates for lazy-loading or manual chunk strategy refinement.
- Maintain functional parity first; apply incremental performance changes with build validation.
${MANUAL_NOTES_START}
${manualNotes}
${MANUAL_NOTES_END}
`

  fs.mkdirSync(path.dirname(DOC_PATH), { recursive: true })
  fs.writeFileSync(DOC_PATH, report)
  fs.writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`)
  process.stdout.write(`Performance scan written to ${relFrom(ROOT, DOC_PATH)}\n`)
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
