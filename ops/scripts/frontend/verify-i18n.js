/* eslint-disable no-console */
'use strict'

const path = require('path')
const {
  readJson,
  readUtf8,
  walkFilesRecursive,
} = require('../lib/fs-utils')

/**
 * 1. Script Configuration
 * 1.1 Resolve project paths from `ops/scripts/frontend`.
 * 1.2 Keep all i18n sources local to `frontend/src/lang`.
 */
const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const FRONTEND_ROOT = path.join(PROJECT_ROOT, 'frontend')
const SRC_DIR = path.join(FRONTEND_ROOT, 'src')
const EN_PATH = path.join(SRC_DIR, 'lang', 'en.json')
const KM_PATH = path.join(SRC_DIR, 'lang', 'km.json')

/**
 * 1. i18n Verification Script
 * 1.1 Purpose
 * - Validate translation key coverage between `en.json` and `km.json`.
 * - Detect missing, extra, and empty translation values.
 */

function collectUsedKeys(files) {
  /**
   * 2.1 Collect translation keys from runtime helper calls.
   * Supports:
   * - `t('key')`
   * - `translateOr('key', ...)`
   * - `useT(['k1', 'k2'])`
   */
  const keys = new Set()
  const patterns = [
    /\bt\(\s*['"`]([^'"`]+)['"`]/g,
    /\btranslateOr\(\s*['"`]([^'"`]+)['"`]/g,
  ]

  for (const file of files) {
    const content = readUtf8(file)
    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(content))) {
        keys.add(match[1])
      }
    }

    const useTArrayPattern = /\buseT\(\s*\[([\s\S]*?)\]\s*\)/g
    let groupMatch
    while ((groupMatch = useTArrayPattern.exec(content))) {
      const group = groupMatch[1]
      const keyPattern = /['"`]([^'"`]+)['"`]/g
      let keyMatch
      while ((keyMatch = keyPattern.exec(group))) {
        keys.add(keyMatch[1])
      }
    }
  }

  return [...keys]
    .filter((key) => key && !key.endsWith('_'))
    .sort()
}

function listMissing(sourceKeys, targetMap) {
  // 3.1 Return keys required by source usage but missing from a translation map.
  return sourceKeys.filter((key) => !(key in targetMap))
}

function listEmptyValues(map) {
  // 3.2 Reject empty/non-string values so every key has usable text.
  return Object.entries(map)
    .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
    .map(([key]) => key)
}

function printList(title, items) {
  // 4.1 Consistent grouped error output for CI and local runs.
  if (!items.length) return
  console.error(`\n${title} (${items.length})`)
  for (const item of items) console.error(`- ${item}`)
}

function main() {
  // 5.1 Load dictionaries + source files, then compute coverage differences.
  const en = readJson(EN_PATH, {})
  const km = readJson(KM_PATH, {})
  const files = walkFilesRecursive(SRC_DIR, {
    excludeDirs: new Set(['node_modules', 'dist', 'release']),
    extensions: new Set(['.js', '.jsx', '.ts', '.tsx']),
  })
  const usedKeys = collectUsedKeys(files)

  const missingInEn = listMissing(usedKeys, en)
  const missingInKm = listMissing(usedKeys, km)
  const onlyInEn = Object.keys(en).filter((key) => !(key in km)).sort()
  const onlyInKm = Object.keys(km).filter((key) => !(key in en)).sort()
  const emptyEn = listEmptyValues(en)
  const emptyKm = listEmptyValues(km)

  printList('Missing translation keys in en.json', missingInEn)
  printList('Missing translation keys in km.json', missingInKm)
  printList('Keys only in en.json', onlyInEn)
  printList('Keys only in km.json', onlyInKm)
  printList('Empty/non-string values in en.json', emptyEn)
  printList('Empty/non-string values in km.json', emptyKm)

  const hasIssues = [
    missingInEn.length,
    missingInKm.length,
    onlyInEn.length,
    onlyInKm.length,
    emptyEn.length,
    emptyKm.length,
  ].some((count) => count > 0)

  if (hasIssues) {
    // 5.2 Non-zero exit enables CI/build guards for missing translations.
    process.exitCode = 1
    return
  }

  console.log(`i18n verification passed: ${usedKeys.length} keys checked across ${files.length} source files.`)
}

main()
