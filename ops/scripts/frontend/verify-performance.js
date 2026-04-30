/* eslint-disable no-console */
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const FRONTEND_ROOT = path.join(PROJECT_ROOT, 'frontend')
const SRC_ROOT = path.join(FRONTEND_ROOT, 'src')
const DIST_ROOT = path.join(FRONTEND_ROOT, 'dist')

const failures = []

function read(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
}

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if ([
      'node_modules',
      'dist',
      'output',
      'release',
      'business-os-data',
      'frontend-dist',
    ].includes(entry.name)) continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(fullPath, files)
    else files.push(fullPath)
  }
  return files
}

function trackedFiles() {
  try {
    return execFileSync('git', ['ls-files'], { cwd: PROJECT_ROOT, encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(Boolean)
  } catch (_) {
    return walk(PROJECT_ROOT).map((filePath) => path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/'))
  }
}

function assert(condition, message) {
  if (!condition) failures.push(message)
}

const tracked = trackedFiles()
assert(!tracked.some((file) => file.toLowerCase().endsWith('.cjs')), 'Tracked .cjs files are not allowed; use .js or .mjs.')

const sourceFiles = walk(SRC_ROOT).filter((filePath) => /\.(js|jsx|mjs)$/.test(filePath))
for (const filePath of sourceFiles) {
  const source = read(filePath)
  const relative = path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/')
  assert(!/from\s+['"]lodash['"]/.test(source), `${relative}: import lodash subpaths instead of the whole package.`)
  assert(!/from\s+['"]lucide-react\/dist\/cjs/.test(source), `${relative}: do not import CommonJS lucide bundles.`)
  if (source.includes('<svg') && source.length > 2048 && !relative.includes('tests') && !relative.includes('dashboard/charts')) {
    const svgBlocks = source.match(/<svg[\s\S]*?<\/svg>/g) || []
    svgBlocks.forEach((block, index) => {
      assert(Buffer.byteLength(block, 'utf8') <= 2048, `${relative}: inline SVG #${index + 1} exceeds 2KB; move it to an asset or icon component.`)
    })
  }
}

const bulkImportPath = path.join(SRC_ROOT, 'components', 'products', 'BulkImportModal.jsx')
const bulkImport = read(bulkImportPath)
assert(fs.existsSync(path.join(SRC_ROOT, 'components', 'products', 'productImportWorker.mjs')), 'Product import worker is missing.')
assert(bulkImport.includes('new Worker(new URL'), 'Product import analysis must use a Vite module worker.')
assert(bulkImport.includes('visibleConflicts'), 'Product import preview must keep conflict rendering bounded.')
assert(!/Promise\.all\(files\.map/.test(bulkImport), 'Image directory selection must not eagerly base64-read every file.')

const indexHtml = read(path.join(FRONTEND_ROOT, 'index.html'))
const preconnectCount = (indexHtml.match(/rel=["']preconnect["']/g) || []).length
assert(preconnectCount <= 3, `Too many preconnect hints (${preconnectCount}); keep the connection pool bounded.`)

if (fs.existsSync(DIST_ROOT)) {
  const assets = walk(DIST_ROOT).filter((filePath) => /\.(js|css)$/.test(filePath))
  const totalBytes = assets.reduce((sum, filePath) => sum + fs.statSync(filePath).size, 0)
  const largest = assets.reduce((max, filePath) => Math.max(max, fs.statSync(filePath).size), 0)
  assert(totalBytes <= 8 * 1024 * 1024, `Built JS/CSS assets are too large (${Math.round(totalBytes / 1024)}KB > 8192KB).`)
  assert(largest <= 3 * 1024 * 1024, `Largest built asset is too large (${Math.round(largest / 1024)}KB > 3072KB).`)
}

if (failures.length) {
  console.error('Performance verification failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('Performance verification passed.')
