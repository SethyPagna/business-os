#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const {
  resolveProjectRoot,
  relFrom,
  readUtf8,
  lineCount,
  walkFilesRecursive,
  collectRootFiles,
} = require('./lib/fs-utils')

// Resolve from the script location so metrics can be generated from any
// working directory.
const ROOT = resolveProjectRoot(__dirname)
const DOC_PATH = path.join(ROOT, 'ops', 'docs', 'reference', 'PERFORMANCE-SCAN.md')
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

function main() {
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

  const sourceRows = [...frontendSrcFiles, ...backendSrcFiles, ...projectScriptFiles, ...rootFiles]
    .filter((f) => /\.(js|jsx|ts|tsx|json|css|md|bat|sh|ps1|nsi|html|env)$/i.test(f))
    .map((f) => {
      const stat = fs.statSync(f)
      const text = readUtf8(f)
      return {
        file: relFrom(ROOT, f),
        size: stat.size,
        lines: lineCount(text),
      }
    })

  const chunkRows = distAssetFiles.map((f) => {
    const stat = fs.statSync(f)
    return { file: relFrom(ROOT, f), size: stat.size }
  })

  const largeSourceBySize = topN(sourceRows, 25, 'size')
  const largeSourceByLines = topN(sourceRows, 25, 'lines')
  const largeChunks = topN(chunkRows, 25, 'size')

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
`

  fs.mkdirSync(path.dirname(DOC_PATH), { recursive: true })
  fs.writeFileSync(DOC_PATH, report)
  process.stdout.write(`Performance scan written to ${relFrom(ROOT, DOC_PATH)}\n`)
}

main()
