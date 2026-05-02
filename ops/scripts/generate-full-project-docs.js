#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { resolveProjectRoot } = require('./lib/fs-utils')

// Keep report generation stable even when the current working directory is not
// the repository root.
const ROOT = resolveProjectRoot(__dirname)
const DOCS_REF = path.join(ROOT, 'ops', 'docs', 'reference')
const TARGET_ROOTS = ['frontend', 'backend', 'ops/scripts', 'run']
const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  'frontend-dist',
  '.git',
  '.pm2',
  'release',
  'business-os-data',
  'docs',
])
const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs'])
const ROOT_INCLUDE_EXTENSIONS = new Set([
  '.bat',
  '.sh',
  '.ps1',
  '.js',
  '.mjs',
  '.json',
  '.md',
  '.nsi',
  '.html',
  '.yml',
  '.yaml',
  '.env',
  '.npmrc',
])
const ROOT_EXCLUDED_FILES = new Set([
  'business-os-server.exe',
  'build-release.log',
])

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function toPosix(p) {
  return p.replace(/\\/g, '/')
}

function rel(absPath) {
  return toPosix(path.relative(ROOT, absPath))
}

function shouldSkipDir(dirName) {
  return EXCLUDED_DIRS.has(dirName.toLowerCase())
}

function collectFilesAndFolders(rootDir) {
  const files = []
  const folders = []
  if (!fs.existsSync(rootDir)) return { files, folders }
  const stack = [rootDir]
  while (stack.length) {
    const current = stack.pop()
    folders.push(current)
    const entries = fs.readdirSync(current, { withFileTypes: true })
    entries.forEach((entry) => {
      const abs = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name)) stack.push(abs)
        return
      }
      files.push(abs)
    })
  }
  return { files, folders }
}

function getAllProjectFilesAndFolders() {
  const allFiles = []
  const allFolders = []
  allFolders.push(ROOT)
  TARGET_ROOTS.forEach((root) => {
    const abs = path.join(ROOT, root)
    const { files, folders } = collectFilesAndFolders(abs)
    allFiles.push(...files)
    allFolders.push(...folders)
  })
  const rootEntries = fs.readdirSync(ROOT, { withFileTypes: true })
  rootEntries.forEach((entry) => {
    if (!entry.isFile()) return
    if (ROOT_EXCLUDED_FILES.has(entry.name)) return
    const ext = path.extname(entry.name).toLowerCase()
    if (!ROOT_INCLUDE_EXTENSIONS.has(ext) && !ROOT_INCLUDE_EXTENSIONS.has(entry.name.toLowerCase())) return
    allFiles.push(path.join(ROOT, entry.name))
  })
  allFiles.sort((a, b) => rel(a).localeCompare(rel(b)))
  allFolders.sort((a, b) => rel(a).localeCompare(rel(b)))
  return { allFiles, allFolders }
}

function isProbablyText(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r')
    const size = Math.min(4096, fs.statSync(filePath).size)
    const buffer = Buffer.alloc(size)
    fs.readSync(fd, buffer, 0, size, 0)
    fs.closeSync(fd)
    return !buffer.includes(0)
  } catch (_) {
    return false
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch (_) {
    return ''
  }
}

function lineCount(text) {
  if (!text) return 0
  return text.split(/\r?\n/).length
}

function fileCategory(filePath) {
  const p = rel(filePath)
  if (!p.includes('/')) return 'project-root'
  if (p.startsWith('run/')) return 'project-scripts'
  if (p.startsWith('ops/scripts/')) return 'project-scripts'
  if (p.startsWith('frontend/src/components/')) return 'frontend-ui'
  if (p.startsWith('frontend/src/api/')) return 'frontend-api'
  if (p.startsWith('frontend/src/lang/')) return 'frontend-i18n'
  if (p.startsWith('frontend/src/utils/')) return 'frontend-utils'
  if (p.startsWith('frontend/src/styles/')) return 'frontend-style'
  if (p.startsWith('frontend/src/')) return 'frontend-core'
  if (p.startsWith('backend/src/routes/')) return 'backend-routes'
  if (p.startsWith('backend/src/services/')) return 'backend-services'
  if (p.startsWith('backend/src/')) return 'backend-core'
  if (p.startsWith('ops/scripts/backend/')) return 'backend-scripts'
  if (p.startsWith('backend/')) return 'backend-root'
  if (p.startsWith('ops/scripts/frontend/')) return 'frontend-scripts'
  if (p.startsWith('frontend/')) return 'frontend-root'
  return 'project'
}

function inferPurpose(filePath) {
  const p = rel(filePath)
  const base = path.basename(p)
  if (p === '.env') return 'Runtime environment configuration'
  if (p === 'build-release.bat' || p === 'run/build-release.bat') return 'Final Docker release build wrapper'
  if (p === 'setup.bat' || p === 'setup.sh') return 'Environment setup script'
  if (p.startsWith('start-server') || p.startsWith('stop-server')) return 'Server lifecycle launcher script'
  if (p === 'ecosystem.config.js' || p === 'ops/config/ecosystem.config.js') return 'PM2 ecosystem process configuration'
  if (p === 'README.md' || p === 'ops/readme/README.md') return 'Project documentation entrypoint'
  if (p.includes('/routes/')) return 'API route handler'
  if (p.includes('/services/')) return 'Integration/service layer'
  if (p.includes('/lang/')) return 'Localization dictionary'
  if (p.includes('/components/')) return 'UI component/page'
  if (p.includes('/api/')) return 'Frontend API/sync helper'
  if (p.includes('/utils/')) return 'Utility helper'
  if (p.endsWith('AppContext.jsx')) return 'Global app state/context provider'
  if (p.endsWith('App.jsx')) return 'Main app shell and page mounting'
  if (p.endsWith('database.js')) return 'Schema/migrations and DB bootstrap'
  if (p.endsWith('server.js')) return 'Backend server entrypoint'
  if (base.endsWith('.json')) return 'Configuration/data manifest'
  if (base.endsWith('.md')) return 'Documentation'
  return 'Project source/support file'
}

function markdownHeader(title, subtitle) {
  return `# ${title}\n\n${subtitle}\n\n`
}

function markdownSection(title) {
  return `## ${title}\n\n`
}

function extractImportsExports(text) {
  const imports = []
  const exports = []

  const importPatterns = [
    /^\s*import\s+.+?\s+from\s+['"]([^'"]+)['"]/gm,
    /^\s*import\s+['"]([^'"]+)['"]/gm,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/gm,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm,
  ]
  importPatterns.forEach((regex) => {
    let match = regex.exec(text)
    while (match) {
      imports.push(match[1])
      match = regex.exec(text)
    }
  })

  const exportPatterns = [
    /^\s*export\s+default\s+([A-Za-z0-9_$]+)/gm,
    /^\s*export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm,
    /^\s*export\s+const\s+([A-Za-z0-9_$]+)/gm,
    /^\s*export\s+class\s+([A-Za-z0-9_$]+)/gm,
    /^\s*module\.exports\s*=/gm,
    /^\s*exports\.([A-Za-z0-9_$]+)/gm,
  ]
  exportPatterns.forEach((regex) => {
    let match = regex.exec(text)
    while (match) {
      exports.push(match[1] || 'module.exports')
      match = regex.exec(text)
    }
  })

  return {
    imports: [...new Set(imports)].sort(),
    exports: [...new Set(exports)].sort(),
  }
}

function findSymbols(text) {
  const lines = text.split(/\r?\n/)
  const symbols = []
  const patterns = [
    { regex: /^\s*async\s+function\s+([A-Za-z0-9_$]+)\s*\(/, kind: 'function' },
    { regex: /^\s*function\s+([A-Za-z0-9_$]+)\s*\(/, kind: 'function' },
    { regex: /^\s*export\s+default\s+function\s+([A-Za-z0-9_$]+)\s*\(/, kind: 'export default function' },
    { regex: /^\s*export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/, kind: 'export function' },
    { regex: /^\s*(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/, kind: 'const arrow' },
    { regex: /^\s*(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?function\b/, kind: 'const function' },
    { regex: /^\s*class\s+([A-Za-z0-9_$]+)\b/, kind: 'class' },
  ]
  lines.forEach((line, index) => {
    patterns.forEach((pattern) => {
      const match = line.match(pattern.regex)
      if (!match) return
      symbols.push({
        line: index + 1,
        name: match[1],
        kind: pattern.kind,
      })
    })
  })
  return symbols
}

function writeAllFunctionReference(allFiles) {
  const codeFiles = allFiles.filter((filePath) => CODE_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
  let md = markdownHeader(
    'All Function Reference (Project First-Party Code)',
    'Auto-generated function/class symbol commentary for all first-party code files (frontend, backend, root scripts/config code).'
  )
  md += '## 1. Coverage Summary\n\n'
  md += `Code files scanned: **${codeFiles.length}**\n\n`
  md += '## 2. Symbol Count by File\n\n'
  md += '| No. | File | Symbols |\n|---:|---|---:|\n'

  const symbolByFile = new Map()
  codeFiles.forEach((filePath, index) => {
    const symbols = findSymbols(readText(filePath))
    symbolByFile.set(filePath, symbols)
    md += `| ${index + 1} | \`${rel(filePath)}\` | ${symbols.length} |\n`
  })
  md += '\n'
  md += '## 3. Detailed Function Commentary\n\n'

  codeFiles.forEach((filePath, fileIndex) => {
    const p = rel(filePath)
    const symbols = symbolByFile.get(filePath) || []
    md += `### 3.${fileIndex + 1} \`${p}\`\n\n`
    if (!symbols.length) {
      md += '- No top-level named symbols detected.\n\n'
      return
    }
    md += '| No. | Symbol | Kind | Line |\n|---:|---|---|---:|\n'
    symbols.forEach((symbol, symbolIndex) => {
      md += `| ${symbolIndex + 1} | \`${symbol.name}\` | ${symbol.kind} | ${symbol.line} |\n`
    })
    md += '\n'
  })

  fs.writeFileSync(path.join(DOCS_REF, 'ALL-FUNCTION-REFERENCE.md'), md)
}

function resolveInternalImport(fromFile, spec) {
  if (!spec || !spec.startsWith('.')) return null
  const base = path.resolve(path.dirname(fromFile), spec)
  const candidates = [
    base,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mjs`,
    `${base}.json`,
    path.join(base, 'index.js'),
    path.join(base, 'index.jsx'),
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.mjs'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}

function writeAllFileInventory(allFiles) {
  let md = markdownHeader(
    'All File Inventory (Project First-Party Files)',
    'Auto-generated file-level commentary for all first-party project files (frontend, backend, scripts, and root run/config files; excluding dependencies/build artifacts).'
  )

  md += '## 1. Coverage Summary\n\n'
  md += `Total files documented: **${allFiles.length}**\n\n`
  md += '## 2. File Commentary Matrix\n\n'
  md += '| No. | File | Category | Lines | Size (KB) | Purpose |\n|---:|---|---|---:|---:|---|\n'
  allFiles.forEach((filePath, index) => {
    const p = rel(filePath)
    const stat = fs.statSync(filePath)
    const text = isProbablyText(filePath) ? readText(filePath) : ''
    const lines = text ? lineCount(text) : 0
    const kb = (stat.size / 1024).toFixed(1)
    md += `| ${index + 1} | \`${p}\` | ${fileCategory(filePath)} | ${lines} | ${kb} | ${inferPurpose(filePath)} |\n`
  })

  fs.writeFileSync(path.join(DOCS_REF, 'ALL-FILE-INVENTORY.md'), md)
}

function folderPurpose(folderPath) {
  const p = rel(folderPath)
  if (p === '') return 'Project root (run files, setup, packaging, top-level config)'
  if (p === 'frontend') return 'Frontend project root'
  if (p === 'backend') return 'Backend project root'
  if (p === 'scripts' || p === 'ops/scripts') return 'Project-level automation scripts'
  if (p === 'run') return 'Project run-script home for bat and sh launchers'
  if (p === 'run/sh') return 'POSIX run/setup/stop scripts'
  if (p.startsWith('frontend/src/components')) return 'UI pages/components domain'
  if (p.startsWith('frontend/src/api')) return 'Frontend API and sync transport'
  if (p.startsWith('frontend/src/lang')) return 'Localization resources'
  if (p.startsWith('backend/src/routes')) return 'HTTP route modules'
  if (p.startsWith('backend/src/services')) return 'Provider/service integrations'
  if (p.startsWith('backend/src')) return 'Backend runtime core'
  return 'Project folder'
}

function writeFolderCoverage(allFolders, allFiles) {
  const filesByDir = new Map()
  allFiles.forEach((filePath) => {
    const dir = path.dirname(filePath)
    if (!filesByDir.has(dir)) filesByDir.set(dir, [])
    filesByDir.get(dir).push(filePath)
  })

  let md = markdownHeader(
    'Folder Coverage and Commentary',
    'Auto-generated folder-level documentation coverage for all first-party project folders.'
  )
  md += '## 1. Coverage Summary\n\n'
  md += `Total folders documented: **${allFolders.length}**\n\n`
  md += '## 2. Folder Matrix\n\n'
  md += '| No. | Folder | Purpose | Direct files | Direct subfolders |\n|---:|---|---|---:|---:|\n'
  allFolders.forEach((folder, index) => {
    const directFiles = (filesByDir.get(folder) || [])
    const subDirs = fs.readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !shouldSkipDir(entry.name))
      .map((entry) => entry.name)
    md += `| ${index + 1} | \`${rel(folder) || '.'}\` | ${folderPurpose(folder)} | ${directFiles.length} | ${subDirs.length} |\n`
  })
  md += '\n'
  md += '## 3. Detailed Folder Commentary\n\n'

  allFolders.forEach((folder, folderIndex) => {
    const folderRel = rel(folder)
    const directFiles = (filesByDir.get(folder) || []).slice().sort((a, b) => rel(a).localeCompare(rel(b)))
    const subDirs = fs.readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !shouldSkipDir(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))

    md += `### 3.${folderIndex + 1} Folder: \`${folderRel || '.'}\`\n\n`
    md += `- Purpose: ${folderPurpose(folder)}\n`
    md += `- Direct files: **${directFiles.length}**\n`
    md += `- Direct subfolders: **${subDirs.length}**\n\n`

    if (subDirs.length) {
      md += `#### 3.${folderIndex + 1}.1 Subfolders\n\n`
      md += '| No. | Name |\n|---:|---|\n'
      subDirs.forEach((name, subIndex) => { md += `| ${subIndex + 1} | \`${name}\` |\n` })
      md += '\n'
    }
    if (directFiles.length) {
      md += `#### 3.${folderIndex + 1}.2 Files\n\n`
      md += '| No. | File | Purpose |\n|---:|---|---|\n'
      directFiles.forEach((filePath, fileIndex) => {
        md += `| ${fileIndex + 1} | \`${path.basename(filePath)}\` | ${inferPurpose(filePath)} |\n`
      })
      md += '\n'
    }
    md += '\n'
  })

  fs.writeFileSync(path.join(DOCS_REF, 'FOLDER-COVERAGE.md'), md)
}

function writeImportExportReference(allFiles) {
  const codeFiles = allFiles.filter((filePath) => CODE_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
  const fileMeta = new Map()
  const inbound = new Map()

  codeFiles.forEach((filePath) => {
    const text = readText(filePath)
    const parsed = extractImportsExports(text)
    const resolvedInternal = parsed.imports
      .map((spec) => resolveInternalImport(filePath, spec))
      .filter(Boolean)
      .map((abs) => rel(abs))
    fileMeta.set(filePath, {
      imports: parsed.imports,
      exports: parsed.exports,
      resolvedInternal: [...new Set(resolvedInternal)].sort(),
    })
  })

  codeFiles.forEach((filePath) => {
    const meta = fileMeta.get(filePath)
    meta.resolvedInternal.forEach((target) => {
      if (!inbound.has(target)) inbound.set(target, new Set())
      inbound.get(target).add(rel(filePath))
    })
  })

  let md = markdownHeader(
    'Import / Export Reference',
    'Auto-generated import/export and dependency-link coverage for frontend/backend code files.'
  )
  md += '## 1. Coverage Summary\n\n'
  md += `Code files documented: **${codeFiles.length}**\n\n`
  md += '## 2. Dependency Matrix\n\n'
  md += '| No. | File | Imports | Exports | Internal deps | Referenced by |\n|---:|---|---:|---:|---:|---:|\n'
  codeFiles.forEach((filePath, index) => {
    const p = rel(filePath)
    const meta = fileMeta.get(filePath)
    const refs = inbound.get(p)
    md += `| ${index + 1} | \`${p}\` | ${meta.imports.length} | ${meta.exports.length} | ${meta.resolvedInternal.length} | ${refs ? refs.size : 0} |\n`
  })
  md += '\n'
  md += '## 3. Detailed File Dependency Commentary\n\n'

  codeFiles.forEach((filePath, fileIndex) => {
    const p = rel(filePath)
    const meta = fileMeta.get(filePath)
    const refs = [...(inbound.get(p) || new Set())].sort((a, b) => a.localeCompare(b))
    md += `### 3.${fileIndex + 1} \`${p}\`\n\n`
    md += `- Declared exports: ${meta.exports.length ? meta.exports.map((e) => `\`${e}\``).join(', ') : 'none detected'}\n`
    md += `- Imports (${meta.imports.length})\n`
    if (!meta.imports.length) {
      md += '  - none\n'
    } else {
      meta.imports.forEach((i) => { md += `  - \`${i}\`\n` })
    }
    md += `- Internal dependencies (${meta.resolvedInternal.length})\n`
    if (!meta.resolvedInternal.length) {
      md += '  - none\n'
    } else {
      meta.resolvedInternal.forEach((i) => { md += `  - \`${i}\`\n` })
    }
    md += `- Referenced by (${refs.length})\n`
    if (!refs.length) {
      md += '  - none\n'
    } else {
      refs.forEach((i) => { md += `  - \`${i}\`\n` })
    }
    md += '\n'
  })

  fs.writeFileSync(path.join(DOCS_REF, 'IMPORT-EXPORT-REFERENCE.md'), md)
}

function readJsonObject(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (_) {
    return {}
  }
}

function translationSectionForKey(key) {
  const k = String(key || '').toLowerCase()
  const p = k.includes('_') ? k.split('_')[0] : ''
  const prefixMap = {
    dashboard: 'Dashboard',
    pos: 'Point of Sale',
    product: 'Products',
    products: 'Products',
    inventory: 'Inventory',
    branch: 'Branch',
    branches: 'Branch',
    sale: 'Sales',
    sales: 'Sales',
    return: 'Returns',
    returns: 'Returns',
    contact: 'Contacts',
    customer: 'Contacts',
    supplier: 'Contacts',
    delivery: 'Contacts',
    user: 'Users',
    users: 'Users',
    role: 'Users',
    audit: 'Audit Log',
    backup: 'Backup',
    setting: 'Settings',
    settings: 'Settings',
    receipt: 'Receipt',
    portal: 'Customer Portal',
    loyalty: 'Loyalty Points',
    membership: 'Loyalty Points',
    auth: 'Authentication',
    login: 'Authentication',
    otp: 'Authentication',
    sync: 'Sync',
    server: 'Sync',
  }
  if (prefixMap[p]) return prefixMap[p]
  if (k.includes('portal')) return 'Customer Portal'
  if (k.includes('inventory') || k.includes('stock')) return 'Inventory'
  if (k.includes('receipt')) return 'Receipt'
  if (k.includes('user') || k.includes('role')) return 'Users'
  if (k.includes('sale')) return 'Sales'
  if (k.includes('return')) return 'Returns'
  if (k.includes('product') || k.includes('brand') || k.includes('category')) return 'Products'
  if (k.includes('contact') || k.includes('supplier') || k.includes('customer')) return 'Contacts'
  if (k.includes('point') || k.includes('loyalty') || k.includes('membership')) return 'Loyalty Points'
  if (k.includes('backup') || k.includes('export') || k.includes('import')) return 'Backup'
  if (k.includes('auth') || k.includes('password') || k.includes('verify') || k.includes('otp')) return 'Authentication'
  return 'Shared / Misc'
}

function writeTranslationSectionReference() {
  const enPath = path.join(ROOT, 'frontend', 'src', 'lang', 'en.json')
  const kmPath = path.join(ROOT, 'frontend', 'src', 'lang', 'km.json')
  const en = readJsonObject(enPath)
  const km = readJsonObject(kmPath)
  const enKeys = Object.keys(en).sort()
  const kmKeys = Object.keys(km).sort()
  const allKeys = [...new Set([...enKeys, ...kmKeys])].sort()
  const sectionMap = new Map()

  allKeys.forEach((key) => {
    const section = translationSectionForKey(key)
    if (!sectionMap.has(section)) sectionMap.set(section, [])
    sectionMap.get(section).push(key)
  })

  const sections = [...sectionMap.keys()].sort((a, b) => a.localeCompare(b))
  let md = markdownHeader(
    'Translation Section Reference',
    'Auto-generated key grouping for translation modular structure across `frontend/src/lang/en.json` and `frontend/src/lang/km.json`.'
  )
  md += '## 1. Coverage Summary\n\n'
  md += `- Total unique keys: **${allKeys.length}**\n`
  md += `- English keys: **${enKeys.length}**\n`
  md += `- Khmer keys: **${kmKeys.length}**\n\n`
  md += '## 2. Domain Group Matrix\n\n'
  md += '| No. | Section | Keys |\n|---:|---|---:|\n'
  sections.forEach((section) => {
    const index = sections.indexOf(section) + 1
    md += `| ${index} | ${section} | ${sectionMap.get(section).length} |\n`
  })
  md += '\n'
  md += '## 3. Detailed Key Commentary by Section\n\n'

  sections.forEach((section, sectionIndex) => {
    const keys = sectionMap.get(section).sort((a, b) => a.localeCompare(b))
    md += `### 3.${sectionIndex + 1} ${section}\n\n`
    md += '| No. | Key | EN | KM |\n|---:|---|---|---|\n'
    keys.forEach((key, keyIndex) => {
      const enMark = Object.prototype.hasOwnProperty.call(en, key) ? 'YES' : 'NO'
      const kmMark = Object.prototype.hasOwnProperty.call(km, key) ? 'YES' : 'NO'
      md += `| ${keyIndex + 1} | \`${key}\` | ${enMark} | ${kmMark} |\n`
    })
    md += '\n'
  })

  fs.writeFileSync(path.join(DOCS_REF, 'TRANSLATION-SECTION-REFERENCE.md'), md)
}

function writeMainCoverageSummary(allFiles, allFolders) {
  const byCategory = new Map()
  allFiles.forEach((filePath) => {
    const category = fileCategory(filePath)
    byCategory.set(category, (byCategory.get(category) || 0) + 1)
  })
  const categoryRows = [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]))

  let md = markdownHeader(
    'Project Documentation Coverage Summary',
    'Auto-generated high-level coverage summary for first-party frontend/backend files and folders.'
  )
  md += `- Total files: **${allFiles.length}**\n`
  md += `- Total folders: **${allFolders.length}**\n\n`
  md += '| Category | File Count |\n|---|---:|\n'
  categoryRows.forEach(([category, count]) => {
    md += `| ${category} | ${count} |\n`
  })
  md += '\n'
  md += 'Generated from:\n'
  md += '- `ops/docs/reference/ALL-FILE-INVENTORY.md`\n'
  md += '- `ops/docs/reference/FOLDER-COVERAGE.md`\n'
  md += '- `ops/docs/reference/IMPORT-EXPORT-REFERENCE.md`\n'
  md += '- `ops/docs/reference/ALL-FUNCTION-REFERENCE.md`\n'
  md += '- `ops/docs/reference/TRANSLATION-SECTION-REFERENCE.md`\n'

  fs.writeFileSync(path.join(DOCS_REF, 'PROJECT-COVERAGE-SUMMARY.md'), md)
}

function main() {
  ensureDir(DOCS_REF)
  const { allFiles, allFolders } = getAllProjectFilesAndFolders()
  writeAllFileInventory(allFiles)
  writeFolderCoverage(allFolders, allFiles)
  writeImportExportReference(allFiles)
  writeAllFunctionReference(allFiles)
  writeTranslationSectionReference()
  writeMainCoverageSummary(allFiles, allFolders)
  process.stdout.write('Generated ops/docs/reference full-project coverage docs.\n')
}

main()
