/* eslint-disable no-console */
'use strict'

const fs = require('fs')
const path = require('path')

const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const FRONTEND_ROOT = path.join(PROJECT_ROOT, 'frontend')
const SRC_ROOT = path.join(FRONTEND_ROOT, 'src')
const COMPONENT_ROOT = path.join(SRC_ROOT, 'components')
const KM_PATH = path.join(SRC_ROOT, 'lang', 'km.json')
const PACKAGE_PATH = path.join(FRONTEND_ROOT, 'package.json')
const VERIFY_BAT_PATH = path.join(PROJECT_ROOT, 'run', 'verify-local.bat')
const MAIN_CSS_PATH = path.join(SRC_ROOT, 'styles', 'main.css')

const REQUIRED_KM_VALUES = {
  cogs: 'តម្លៃទំនិញដែលបានលក់',
  cogs_header: 'តម្លៃទំនិញដែលបានលក់',
  custom_role: 'កំណត់',
  range_custom: 'កំណត់',
  best_seller: 'លក់ដាច់បំផុត',
  top_seller: 'លក់ដាច់បំផុត',
  'common.invalidPublicPath': 'សូមប្រើផ្លូវស្អាតដូចជា /portal ឬ /customers។',
  'common.portalVisibilityRequired': 'សូមបើកយ៉ាងហោចណាស់ផ្នែកមួយដែលអតិថិជនអាចមើលបាន មុនពេលបោះផ្សាយ។',
  'common.restore': 'ស្តារឡើងវិញ',
}

const PORTAL_FILES = [
  path.join(COMPONENT_ROOT, 'catalog', 'CatalogPage.jsx'),
  path.join(COMPONENT_ROOT, 'catalog', 'CatalogProductsSection.jsx'),
  path.join(COMPONENT_ROOT, 'catalog', 'CatalogSecondaryTabs.jsx'),
  path.join(COMPONENT_ROOT, 'catalog', 'catalogUi.jsx'),
]

const INTENTIONAL_PUBLIC_TERMS = [
  /^SKU$/,
  /^API$/,
  /^USD$/,
  /^KHR$/,
  /^CSV$/,
  /^QR$/,
  /^WebSocket$/,
  /^OAuth/i,
  /^Google$/,
  /^Facebook$/,
  /^Google login$/,
  /^JPG, PNG, WEBP$/,
  /^Inter$/,
  /^Monospace$/,
  /^Open Sans$/,
  /^Outfit$/,
  /^Poppins$/,
  /^Roboto$/,
  /^Sans-serif$/,
  /^Serif$/,
  /^\/[A-Za-z0-9/_-]+$/,
  /^https?:\/\//,
  /^[A-Z_]+$/,
]

function readText(file) {
  return fs.readFileSync(file, 'utf8')
}

function readJson(file) {
  return JSON.parse(readText(file))
}

function flatten(input, prefix = '', target = {}) {
  if (!input || typeof input !== 'object') return target
  for (const [key, value] of Object.entries(input)) {
    const nextKey = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') {
      target[nextKey] = value
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value, nextKey, target)
    }
  }
  return target
}

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkFiles(full, out)
    } else if (/\.(jsx|js|mjs|ts|tsx)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

function isIntentionalLatin(value, key = '') {
  const trimmed = String(value || '').trim()
  if (!trimmed) return true
  if (/^\{[a-z]+\}\/\{[a-z]+\}$/i.test(trimmed)) return true
  if (key === 'factory_reset_confirm_word') return true
  return INTENTIONAL_PUBLIC_TERMS.some((pattern) => pattern.test(trimmed))
}

function report(title, items) {
  if (!items.length) return
  console.error(`\n${title} (${items.length})`)
  for (const item of items) console.error(`- ${item}`)
}

function checkKhmerQuality() {
  const flatKm = flatten(readJson(KM_PATH))
  const issues = []

  for (const [key, expected] of Object.entries(REQUIRED_KM_VALUES)) {
    if (flatKm[key] !== expected) {
      issues.push(`Expected km.${key} = ${JSON.stringify(expected)}, got ${JSON.stringify(flatKm[key])}`)
    }
  }

  for (const [key, value] of Object.entries(flatKm)) {
    if (/\?{4,}/.test(value)) {
      issues.push(`km.${key} contains replacement question marks: ${JSON.stringify(value)}`)
    }
  }

  const latinOnly = Object.entries(flatKm)
    .filter(([, value]) => /[A-Za-z]/.test(value) && !/[\u1780-\u17FF]/.test(value))
    .filter(([key, value]) => !isIntentionalLatin(value, key))
    .map(([key, value]) => `km.${key} is still Latin-only: ${JSON.stringify(value)}`)

  return { issues, latinOnly }
}

function checkPortalDarkModeContracts() {
  const css = readText(MAIN_CSS_PATH)
  const catalogPage = readText(path.join(COMPONENT_ROOT, 'catalog', 'CatalogPage.jsx'))
  const requiredCssTokens = [
    "[data-portal-root='true'].dark .bg-white",
    ".dark [data-portal-root='true'] .bg-white",
    '.portal-image-checker',
    "body[data-public-portal='true'] .portal-tools-bar",
  ]
  const issues = requiredCssTokens
    .filter((token) => !css.includes(token))
    .map((token) => `Missing portal dark-mode CSS token: ${token}`)

  if (!catalogPage.includes('data-portal-root="true"')) {
    issues.push('CatalogPage root is missing data-portal-root="true".')
  }
  if (/backgroundColor:\s*['"]#fff(?:fff)?['"]/i.test(catalogPage)) {
    issues.push('CatalogPage still contains an inline white backgroundColor that dark mode cannot override.')
  }
  return issues
}

function checkPortalVisibleStrings() {
  const issues = []
  const literalPatterns = [
    { pattern: /aria-label="Close"/, message: 'Use translated close aria-label in portal.' },
    { pattern: /placeholder="Daily use/i, message: 'Use translated AI goal placeholder.' },
    { pattern: /placeholder="Acne,/i, message: 'Use translated AI concerns placeholder.' },
    { pattern: />\s*AI query\s*</, message: 'Use translated AI query badge text.' },
    { pattern: />\s*No brand\s*</, message: 'Use translated no-brand text.' },
    { pattern: />\s*No category\s*</, message: 'Use translated no-category text.' },
  ]

  for (const file of PORTAL_FILES) {
    const text = readText(file)
    for (const { pattern, message } of literalPatterns) {
      if (pattern.test(text)) {
        issues.push(`${path.relative(PROJECT_ROOT, file)}: ${message}`)
      }
    }
  }
  return issues
}

function checkFormControlLabels() {
  const issues = []
  for (const file of PORTAL_FILES) {
    const text = readText(file)
    const lines = text.split(/\r?\n/)
    lines.forEach((line, index) => {
      if (!/<label\b/.test(line) || /htmlFor=/.test(line)) return
      const labelSlice = []
      for (let i = index; i < Math.min(lines.length, index + 16); i += 1) {
        labelSlice.push(lines[i])
        if (/<\/label>/.test(lines[i])) break
      }
      if (!/<(input|select|textarea)\b/.test(labelSlice.join('\n'))) {
        issues.push(`${path.relative(PROJECT_ROOT, file)}:${index + 1} label is not associated with a form field.`)
      }
    })
  }
  return issues
}

function checkVerificationWiring() {
  const pkg = readJson(PACKAGE_PATH)
  const verifyBat = readText(VERIFY_BAT_PATH)
  const issues = []
  if (pkg.scripts?.['verify:ui'] !== 'node ../ops/scripts/frontend/verify-ui.js') {
    issues.push('frontend/package.json must expose verify:ui.')
  }
  if (!verifyBat.includes('npm.cmd run verify:ui')) {
    issues.push('verify-local.bat must run frontend verify:ui.')
  }
  return issues
}

function printAuditSummary() {
  const sourceFiles = walkFiles(COMPONENT_ROOT)
  const rawFallbacks = []
  const lightOnlyClasses = []
  for (const file of sourceFiles) {
    const text = readText(file)
    const fallbackCount = (text.match(/\|\|\s*['"`][^'"`]*[A-Za-z]/g) || []).length
    const lightOnlyCount = (text.match(/\b(bg-white|bg-slate-50|bg-slate-100|text-slate-[0-9]{3})\b/g) || []).length
    if (fallbackCount) rawFallbacks.push([file, fallbackCount])
    if (lightOnlyCount) lightOnlyClasses.push([file, lightOnlyCount])
  }
  rawFallbacks.sort((a, b) => b[1] - a[1])
  lightOnlyClasses.sort((a, b) => b[1] - a[1])
  console.log(`UI audit scanned ${sourceFiles.length} component/runtime files.`)
  console.log(`Top fallback-string files: ${rawFallbacks.slice(0, 5).map(([file, count]) => `${path.relative(PROJECT_ROOT, file)}=${count}`).join(', ') || 'none'}`)
  console.log(`Top light/dark review files: ${lightOnlyClasses.slice(0, 5).map(([file, count]) => `${path.relative(PROJECT_ROOT, file)}=${count}`).join(', ') || 'none'}`)
}

function main() {
  const { issues: khmerIssues, latinOnly } = checkKhmerQuality()
  const issues = [
    ...khmerIssues,
    ...checkPortalDarkModeContracts(),
    ...checkPortalVisibleStrings(),
    ...checkFormControlLabels(),
    ...checkVerificationWiring(),
  ]

  printAuditSummary()
  report('Blocking UI coverage issues', issues)
  report('Khmer values requiring curated review', latinOnly)

  if (issues.length || latinOnly.length) {
    process.exitCode = 1
    return
  }

  console.log('UI verification passed: portal dark-mode, curated Khmer, visible strings, labels, and wiring checks are clean.')
}

main()
