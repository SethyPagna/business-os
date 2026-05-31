#!/usr/bin/env node
/* eslint-disable no-console */
'use strict'

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { readJson, readUtf8 } = require('../lib/fs-utils.ts')

const root = path.resolve(__dirname, '..', '..', '..')
const policyPath = path.join(root, 'ops', 'policies', 'hardening-policy.json')

type FilePolicyRule = {
  path: string
  mustContain?: string[]
  mustNotContain?: string[]
}
type HardeningRule = {
  name?: string
  mustNotExist?: string[]
  files?: FilePolicyRule[]
}
type HardeningPolicy = {
  version?: number
  name?: string
  trackedOnly?: boolean
  rules: HardeningRule[]
}

function normalizeRelativePath(value: unknown): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '')
}

function readPolicy(): HardeningPolicy {
  const policy = readJson(policyPath) as HardeningPolicy
  if (!policy || !Array.isArray(policy.rules)) {
    throw new Error(`${normalizeRelativePath(path.relative(root, policyPath))} must define a rules array`)
  }
  return policy
}

function readWithLocalImports(relativePath: string): string {
  const text = readUtf8(path.join(root, relativePath))
  const baseDir = path.dirname(relativePath)
  const importedTexts: string[] = []
  const importPattern = /import\s+['"](\.\/[^'"]+)['"]/g
  for (const match of text.matchAll(importPattern)) {
    const importedRelativePath = normalizeRelativePath(path.join(baseDir, match[1]))
    if (fs.existsSync(path.join(root, importedRelativePath))) {
      importedTexts.push(readUtf8(path.join(root, importedRelativePath)))
    }
  }
  return [text, ...importedTexts].join('\n')
}

function listTrackedOrPendingFiles(): Set<string> {
  return new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/)
    .map(normalizeRelativePath)
    .filter(Boolean))
}

function lineFor(text: string, needle: string): number {
  const index = text.indexOf(needle)
  if (index < 0) return 0
  return text.slice(0, index).split(/\r?\n/).length
}

function assertContains(failures: string[], relativePath: string, text: string, needle: string, ruleName: string): void {
  if (!text.includes(needle)) {
    failures.push(`${ruleName}: ${relativePath} is missing required text: ${needle}`)
  }
}

function assertNotContains(failures: string[], relativePath: string, text: string, needle: string, ruleName: string): void {
  if (text.includes(needle)) {
    failures.push(`${ruleName}: ${relativePath}:${lineFor(text, needle)} contains forbidden text: ${needle}`)
  }
}

function assertNoApiCachingRegression(failures: string[]): void {
  const swPath = 'frontend/public/sw.js'
  const sw = readUtf8(path.join(root, swPath))
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

function assertFullAutomationIncludesPolicy(failures: string[]): void {
  const script = readUtf8(path.join(root, 'ops/scripts/powershell/full-automation.ps1'))
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

function main(): void {
  const policy = readPolicy()
  const tracked = listTrackedOrPendingFiles()
  const failures: string[] = []

  for (const rule of policy.rules) {
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
        failures.push(`${ruleName}: ${relativePath} is not tracked by git or pending as a non-ignored source file`)
        continue
      }
      if (!fs.existsSync(path.join(root, relativePath))) {
        failures.push(`${ruleName}: ${relativePath} does not exist`)
        continue
      }
      const text = readWithLocalImports(relativePath)
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
