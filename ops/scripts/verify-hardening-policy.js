#!/usr/bin/env node
/* eslint-disable no-console */
'use strict'

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const policyPath = path.join(root, 'ops', 'policies', 'hardening-policy.json')

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function normalizeRelativePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '')
}

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function listTrackedFiles() {
  return new Set(execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/)
    .map(normalizeRelativePath)
    .filter(Boolean))
}

function lineFor(text, needle) {
  const index = text.indexOf(needle)
  if (index < 0) return 0
  return text.slice(0, index).split(/\r?\n/).length
}

function assertContains(failures, relativePath, text, needle, ruleName) {
  if (!text.includes(needle)) {
    failures.push(`${ruleName}: ${relativePath} is missing required text: ${needle}`)
  }
}

function assertNotContains(failures, relativePath, text, needle, ruleName) {
  if (text.includes(needle)) {
    failures.push(`${ruleName}: ${relativePath}:${lineFor(text, needle)} contains forbidden text: ${needle}`)
  }
}

function assertNoApiCachingRegression(failures) {
  const swPath = 'frontend/public/sw.js'
  const sw = readText(swPath)
  const fetchHandler = sw.match(/self\.addEventListener\('fetch'[\s\S]*?\n}\)/)?.[0] || ''
  if (!fetchHandler.includes('isNeverCachedPath(url.pathname)')) {
    failures.push('Service worker fetch handler must bypass never-cached paths before cache handling.')
  }
  if (!fetchHandler.includes('request.mode === \'navigate\'')) {
    failures.push('Service worker fetch handler must keep navigation fallback explicit.')
  }
  if (!fetchHandler.includes('isCacheableStaticPath(url.pathname)')) {
    failures.push('Service worker fetch handler must restrict static cache eligibility.')
  }

  const cacheWrites = [...sw.matchAll(/cache\.put\(([^,\n]+)/g)].map((match) => match[1])
  const unsafeCacheWrite = cacheWrites.find((target) => !target.includes("'/index.html'") && !target.includes('request'))
  if (unsafeCacheWrite) {
    failures.push(`Service worker has an unexpected cache.put target: ${unsafeCacheWrite}`)
  }
}

function assertFullAutomationIncludesPolicy(failures) {
  const script = readText('ops/scripts/powershell/full-automation.ps1')
  const secretIndex = script.indexOf('Secret hygiene verification')
  const policyIndex = script.indexOf('Hardening policy verification')
  const r2Index = script.indexOf('Live R2 object write/read/delete verification')
  if (policyIndex < 0) {
    failures.push('Full automation must run Hardening policy verification.')
  }
  if (secretIndex >= 0 && policyIndex >= 0 && policyIndex < secretIndex) {
    failures.push('Hardening policy verification should run after secret hygiene verification.')
  }
  if (r2Index >= 0 && policyIndex >= 0 && policyIndex > r2Index) {
    failures.push('Hardening policy verification should run before live R2 checks so static regressions fail fast.')
  }
}

function main() {
  const policy = readJson(policyPath)
  const tracked = listTrackedFiles()
  const failures = []

  for (const rule of policy.rules || []) {
    const ruleName = rule.name || 'unnamed rule'
    for (const missingPath of rule.mustNotExist || []) {
      const relativePath = normalizeRelativePath(missingPath)
      if (tracked.has(relativePath) || fs.existsSync(path.join(root, relativePath))) {
        failures.push(`${ruleName}: ${relativePath} must not exist`)
      }
    }

    for (const fileRule of rule.files || []) {
      const relativePath = normalizeRelativePath(fileRule.path)
      if (!tracked.has(relativePath) && policy.trackedOnly !== false) {
        failures.push(`${ruleName}: ${relativePath} is not tracked by git`)
        continue
      }
      if (!fs.existsSync(path.join(root, relativePath))) {
        failures.push(`${ruleName}: ${relativePath} does not exist`)
        continue
      }
      const text = readText(relativePath)
      for (const needle of fileRule.mustContain || []) {
        assertContains(failures, relativePath, text, needle, ruleName)
      }
      for (const needle of fileRule.mustNotContain || []) {
        assertNotContains(failures, relativePath, text, needle, ruleName)
      }
    }
  }

  assertNoApiCachingRegression(failures)
  assertFullAutomationIncludesPolicy(failures)

  if (failures.length) {
    console.error('Hardening policy verification failed:')
    failures.forEach((failure) => console.error(`- ${failure}`))
    process.exit(1)
  }

  console.log(`Hardening policy verification passed: ${policy.rules.length} policy groups checked.`)
}

main()
