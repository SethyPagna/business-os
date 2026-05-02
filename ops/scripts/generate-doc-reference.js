#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { resolveProjectRoot } = require('./lib/fs-utils')

// Resolve the repo root from the script path so this command still works when
// launched from backend/, frontend/, or another subfolder.
const ROOT = resolveProjectRoot(__dirname)
const DOCS_DIR = path.join(ROOT, 'ops', 'docs', 'reference')

const FRONTEND_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx'])
const BACKEND_EXTENSIONS = new Set(['.js'])
const ROOT_CODE_EXTENSIONS = new Set(['.js', '.mjs', '.ps1'])

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function normalizePath(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/')
}

function getFilesRecursive(startDir, extensions) {
  const out = []
  if (!fs.existsSync(startDir)) return out
  const stack = [startDir]
  while (stack.length) {
    const current = stack.pop()
    const entries = fs.readdirSync(current, { withFileTypes: true })
    entries.forEach((entry) => {
      const resolved = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(resolved)
        return
      }
      const ext = path.extname(entry.name).toLowerCase()
      if (extensions.has(ext)) out.push(resolved)
    })
  }
  return out.sort((a, b) => normalizePath(a).localeCompare(normalizePath(b)))
}

function getRootCodeFiles() {
  const entries = fs.readdirSync(ROOT, { withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(ROOT, entry.name))
    .filter((filePath) => ROOT_CODE_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
  return files.sort((a, b) => normalizePath(a).localeCompare(normalizePath(b)))
}

function findSymbols(text) {
  const lines = text.split(/\r?\n/)
  const symbols = []

  const patterns = [
    { regex: /^\s*async\s+function\s+([A-Za-z0-9_$]+)\s*\(/, kind: 'function' },
    { regex: /^\s*function\s+([A-Za-z0-9_$]+)\s*\(/, kind: 'function' },
    { regex: /^\s*export\s+default\s+function\s+([A-Za-z0-9_$]+)\s*\(/, kind: 'component/function' },
    { regex: /^\s*export\s+default\s+function\s*\(/, kind: 'default function (anonymous)', anonymous: true },
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
        kind: pattern.kind,
        name: pattern.anonymous ? '(anonymous default)' : match[1],
      })
    })
  })

  return symbols
}

function findRouteHandlers(text) {
  const lines = text.split(/\r?\n/)
  const routes = []
  const routeRegex = /^\s*router\.(get|post|put|patch|delete|options)\(\s*['"`]([^'"`]+)['"`]/
  lines.forEach((line, index) => {
    const match = line.match(routeRegex)
    if (!match) return
    routes.push({
      line: index + 1,
      method: match[1].toUpperCase(),
      path: match[2],
    })
  })
  return routes
}

function collectScriptMetadata(filePath) {
  const text = fs.readFileSync(filePath, 'utf8')
  const lines = text.split(/\r?\n/)
  const labels = []
  const steps = []

  lines.forEach((line, index) => {
    const labelMatch = line.match(/^\s*:([A-Za-z0-9_]+)/)
    if (labelMatch) labels.push({ line: index + 1, label: labelMatch[1] })

    const stepMatch = line.match(/^\s*echo\s+\[(STEP\s*[^\]]+)\]\s*(.*)$/i)
    if (stepMatch) {
      steps.push({
        line: index + 1,
        step: stepMatch[1].trim(),
        detail: stepMatch[2].trim(),
      })
    }
  })

  return { labels, steps }
}

function markdownHeader(title, subtitle) {
  return `# ${title}\n\n${subtitle}\n\n`
}

function markdownSection(title) {
  return `## ${title}\n\n`
}

function writeBackendReference() {
  const backendFiles = [
    path.join(ROOT, 'backend', 'server.js'),
    ...getFilesRecursive(path.join(ROOT, 'backend', 'src'), BACKEND_EXTENSIONS),
    ...getFilesRecursive(path.join(ROOT, 'ops', 'scripts', 'backend'), BACKEND_EXTENSIONS),
  ].filter((filePath) => fs.existsSync(filePath))

  let md = markdownHeader(
    'Backend Function Reference',
    'Auto-generated symbol and route inventory for backend files. Regenerate with `node ops/scripts/generate-doc-reference.js`.'
  )
  md += '## 1. Coverage Summary\n\n'
  md += `Total files documented: **${backendFiles.length}**\n\n`
  md += '## 2. Symbol Count by File\n\n'
  md += '| No. | File | Symbols | Route handlers |\n|---:|---|---:|---:|\n'
  backendFiles.forEach((filePath, index) => {
    const rel = normalizePath(filePath)
    const text = fs.readFileSync(filePath, 'utf8')
    const symbols = findSymbols(text)
    const routes = rel.includes('/routes/') ? findRouteHandlers(text) : []
    md += `| ${index + 1} | \`${rel}\` | ${symbols.length} | ${routes.length} |\n`
  })
  md += '\n'
  md += '## 3. Detailed Function Commentary\n\n'

  backendFiles.forEach((filePath, fileIndex) => {
    const rel = normalizePath(filePath)
    const text = fs.readFileSync(filePath, 'utf8')
    const symbols = findSymbols(text)
    const routes = rel.includes('/routes/') ? findRouteHandlers(text) : []

    md += `### 3.${fileIndex + 1} \`${rel}\`\n\n`
    if (!symbols.length) {
      md += '- No top-level named function/class symbols detected.\n\n'
    } else {
      md += '| No. | Symbol | Kind | Line |\n|---:|---|---:|---:|\n'
      symbols.forEach((symbol, symbolIndex) => {
        md += `| ${symbolIndex + 1} | \`${symbol.name}\` | ${symbol.kind} | ${symbol.line} |\n`
      })
      md += '\n'
    }

    if (routes.length) {
      md += `#### 3.${fileIndex + 1}.1 Route Handlers\n\n`
      md += '| No. | Method | Path | Line |\n|---:|---|---|---:|\n'
      routes.forEach((route, routeIndex) => {
        md += `| ${routeIndex + 1} | ${route.method} | \`${route.path}\` | ${route.line} |\n`
      })
      md += '\n'
    }
  })

  fs.writeFileSync(path.join(DOCS_DIR, 'BACKEND-FUNCTION-REFERENCE.md'), md)
}

function writeFrontendReference() {
  const frontendFiles = [
    ...getFilesRecursive(path.join(ROOT, 'frontend', 'src'), FRONTEND_EXTENSIONS),
    ...getFilesRecursive(path.join(ROOT, 'ops', 'scripts', 'frontend'), FRONTEND_EXTENSIONS),
    path.join(ROOT, 'frontend', 'vite.config.mjs'),
    path.join(ROOT, 'frontend', 'postcss.config.mjs'),
    path.join(ROOT, 'frontend', 'tailwind.config.mjs'),
  ].filter((filePath) => fs.existsSync(filePath))
  let md = markdownHeader(
    'Frontend Function Reference',
    'Auto-generated symbol inventory for frontend files. Regenerate with `node ops/scripts/generate-doc-reference.js`.'
  )
  md += '## 1. Coverage Summary\n\n'
  md += `Total files documented: **${frontendFiles.length}**\n\n`
  md += '## 2. Symbol Count by File\n\n'
  md += '| No. | File | Symbols |\n|---:|---|---:|\n'
  frontendFiles.forEach((filePath, index) => {
    const symbols = findSymbols(fs.readFileSync(filePath, 'utf8'))
    md += `| ${index + 1} | \`${normalizePath(filePath)}\` | ${symbols.length} |\n`
  })
  md += '\n'
  md += '## 3. Detailed Function Commentary\n\n'

  frontendFiles.forEach((filePath, fileIndex) => {
    const rel = normalizePath(filePath)
    const text = fs.readFileSync(filePath, 'utf8')
    const symbols = findSymbols(text)

    md += `### 3.${fileIndex + 1} \`${rel}\`\n\n`
    if (!symbols.length) {
      md += '- No top-level named function/class symbols detected.\n\n'
      return
    }
    md += '| No. | Symbol | Kind | Line |\n|---:|---|---:|---:|\n'
    symbols.forEach((symbol, symbolIndex) => {
      md += `| ${symbolIndex + 1} | \`${symbol.name}\` | ${symbol.kind} | ${symbol.line} |\n`
    })
    md += '\n'
  })

  fs.writeFileSync(path.join(DOCS_DIR, 'FRONTEND-FUNCTION-REFERENCE.md'), md)
}

function readJsonObject(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const raw = fs.readFileSync(filePath, 'utf8')
  return JSON.parse(raw)
}

function groupByPrefix(keys) {
  const groups = new Map()
  keys.forEach((key) => {
    const prefix = key.includes('_') ? key.split('_')[0] : '(misc)'
    groups.set(prefix, (groups.get(prefix) || 0) + 1)
  })
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}

function writeTranslationReference() {
  const enPath = path.join(ROOT, 'frontend', 'src', 'lang', 'en.json')
  const kmPath = path.join(ROOT, 'frontend', 'src', 'lang', 'km.json')
  const en = readJsonObject(enPath)
  const km = readJsonObject(kmPath)
  const enKeys = Object.keys(en).sort()
  const kmKeys = Object.keys(km).sort()
  const enSet = new Set(enKeys)
  const kmSet = new Set(kmKeys)

  const missingInKm = enKeys.filter((key) => !kmSet.has(key))
  const missingInEn = kmKeys.filter((key) => !enSet.has(key))

  let md = markdownHeader(
    'Translation Reference',
    'Auto-generated i18n key inventory and key-diff report for `frontend/src/lang/*.json`.'
  )
  md += '## 1. Coverage Summary\n\n'
  md += `- English keys: **${enKeys.length}**\n`
  md += `- Khmer keys: **${kmKeys.length}**\n`
  md += `- Missing in Khmer: **${missingInKm.length}**\n`
  md += `- Missing in English: **${missingInEn.length}**\n\n`

  md += '## 2. English Key Groups (by prefix)\n\n'
  md += '| No. | Prefix | Key Count |\n|---:|---|---:|\n'
  groupByPrefix(enKeys).forEach(([prefix, count], index) => {
    md += `| ${index + 1} | \`${prefix}\` | ${count} |\n`
  })
  md += '\n'

  md += '## 3. Khmer Key Groups (by prefix)\n\n'
  md += '| No. | Prefix | Key Count |\n|---:|---|---:|\n'
  groupByPrefix(kmKeys).forEach(([prefix, count], index) => {
    md += `| ${index + 1} | \`${prefix}\` | ${count} |\n`
  })
  md += '\n'

  md += '## 4. Missing in Khmer\n\n'
  if (!missingInKm.length) {
    md += '- None\n\n'
  } else {
    missingInKm.forEach((key, index) => { md += `${index + 1}. \`${key}\`\n` })
    md += '\n'
  }

  md += '## 5. Missing in English\n\n'
  if (!missingInEn.length) {
    md += '- None\n\n'
  } else {
    missingInEn.forEach((key, index) => { md += `${index + 1}. \`${key}\`\n` })
    md += '\n'
  }

  fs.writeFileSync(path.join(DOCS_DIR, 'TRANSLATION-REFERENCE.md'), md)
}

function writeRunReleaseReference() {
  const scriptPaths = [
    'Start Business OS.bat',
    'run/setup.bat',
    'run/start-server.bat',
    'run/stop-server.bat',
    'run/verify-local.bat',
    'run/build-release.bat',
    'run/clean-generated.bat',
    'run/docker/release.bat',
    'run/docker/publish-release.bat',
    'run/docker/install.bat',
    'run/docker/start.bat',
    'run/docker/update.bat',
    'run/docker/backup.bat',
    'run/docker/restore.bat',
    'run/docker/doctor.bat',
    'run/docker/rotate-cloudflare.bat',
    'run/sh/setup.sh',
    'run/sh/start-server.sh',
    'run/sh/stop-server.sh',
    'ops/scripts/frontend/verify-i18n.js',
    'ops/scripts/backend/verify-data-integrity.js',
    'ops/scripts/generate-doc-reference.js',
    'ops/scripts/generate-full-project-docs.js',
    'ops/scripts/performance-scan.js',
  ]
    .map((rel) => path.join(ROOT, rel))
    .filter((filePath) => fs.existsSync(filePath))

  let md = markdownHeader(
    'Run and Release Script Reference',
    'Auto-generated script inventory for startup, shutdown, setup, and release workflows.'
  )
  md += `Total scripts documented: **${scriptPaths.length}**\n\n`

  scriptPaths.forEach((filePath) => {
    const rel = normalizePath(filePath)
    const ext = path.extname(filePath).toLowerCase()
    const text = fs.readFileSync(filePath, 'utf8')
    const lineCount = text.split(/\r?\n/).length

    md += markdownSection(rel)
    md += `- File type: \`${ext || 'none'}\`\n`
    md += `- Total lines: **${lineCount}**\n`

    if (ext === '.bat') {
      const metadata = collectScriptMetadata(filePath)
      md += `- Labels: **${metadata.labels.length}**\n`
      md += `- Step markers: **${metadata.steps.length}**\n\n`

      if (metadata.labels.length) {
        md += '**Labels**\n\n'
        md += '| Label | Line |\n|---|---:|\n'
        metadata.labels.forEach((label) => {
          md += `| \`${label.label}\` | ${label.line} |\n`
        })
        md += '\n'
      }
      if (metadata.steps.length) {
        md += '**Step markers**\n\n'
        md += '| Step | Detail | Line |\n|---|---|---:|\n'
        metadata.steps.forEach((step) => {
          md += `| ${step.step} | ${step.detail || '-'} | ${step.line} |\n`
        })
        md += '\n'
      }
    } else {
      md += '\n'
    }
  })

  fs.writeFileSync(path.join(DOCS_DIR, 'RUN-RELEASE-REFERENCE.md'), md)
}

function writeModuleNamingGuide() {
  const md =
`# Module Naming Guide

This guide standardizes module naming without breaking existing imports immediately.

## Goals

- Keep current runtime behavior stable.
- Make ownership clearer for future refactors.
- Reduce ambiguity between similarly named files across domains.

## Backend Naming Pattern

- Route files: \`<domain>Routes.js\`
  - Example: current \`backend/src/routes/returns.js\` -> target alias name \`returnsRoutes.js\`
- Service files: \`<domain>Service.js\`
  - Example: \`verification.js\` -> target alias \`verificationService.js\`
- Utility files: \`<domain>Utils.js\` or \`<domain>Helpers.js\`

## Frontend Naming Pattern

- Page-level components: \`<Domain>Page.jsx\`
- Domain subcomponents: \`<Domain><Responsibility>.jsx\`
- Shared primitives: \`<PrimitiveName>.jsx\` in \`components/shared/\`
- Hook files: \`use<Domain><Feature>.js\`

## Translation Key Grouping Pattern

- Prefix keys with domain to improve discoverability:
  - \`dashboard_*\`
  - \`inventory_*\`
  - \`products_*\`
  - \`portal_*\`
  - \`users_*\`
  - \`auth_*\`
  - \`backup_*\`
  - \`settings_*\`

## Migration Recommendation

1. Introduce alias exports or index barrels first.
2. Migrate imports incrementally by domain.
3. Rename physical files only when import graph is fully updated and tested.
`
  fs.writeFileSync(path.join(DOCS_DIR, 'MODULE-NAMING-GUIDE.md'), md)
}

function writeProjectCodeReference() {
  const projectFiles = [
    ...getRootCodeFiles(),
    ...getFilesRecursive(path.join(ROOT, 'ops', 'scripts'), new Set(['.js', '.ps1'])),
  ].filter((filePath, index, arr) => arr.indexOf(filePath) === index)

  let md = markdownHeader(
    'Project Script and Root Code Reference',
    'Auto-generated symbol inventory for root-level code files and project scripts.'
  )
  md += '## 1. Coverage Summary\n\n'
  md += `Total files documented: **${projectFiles.length}**\n\n`
  md += '## 2. Symbol Count by File\n\n'
  md += '| No. | File | Symbols |\n|---:|---|---:|\n'
  projectFiles.forEach((filePath, index) => {
    const symbols = findSymbols(fs.readFileSync(filePath, 'utf8'))
    md += `| ${index + 1} | \`${normalizePath(filePath)}\` | ${symbols.length} |\n`
  })
  md += '\n'
  md += '## 3. Detailed Function Commentary\n\n'

  projectFiles.forEach((filePath, fileIndex) => {
    const rel = normalizePath(filePath)
    const text = fs.readFileSync(filePath, 'utf8')
    const symbols = findSymbols(text)

    md += `### 3.${fileIndex + 1} \`${rel}\`\n\n`
    if (!symbols.length) {
      md += '- No top-level named function/class symbols detected.\n\n'
      return
    }
    md += '| No. | Symbol | Kind | Line |\n|---:|---|---:|---:|\n'
    symbols.forEach((symbol, symbolIndex) => {
      md += `| ${symbolIndex + 1} | \`${symbol.name}\` | ${symbol.kind} | ${symbol.line} |\n`
    })
    md += '\n'
  })

  fs.writeFileSync(path.join(DOCS_DIR, 'PROJECT-CODE-REFERENCE.md'), md)
}

function main() {
  ensureDir(DOCS_DIR)
  writeBackendReference()
  writeFrontendReference()
  writeProjectCodeReference()
  writeTranslationReference()
  writeRunReleaseReference()
  writeModuleNamingGuide()
  process.stdout.write('Generated ops/docs/reference/*.md\n')
}

main()
