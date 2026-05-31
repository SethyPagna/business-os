#!/usr/bin/env node
/* eslint-disable no-console */
'use strict'

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { readUtf8 } = require('../lib/fs-utils.ts')

const root = path.resolve(__dirname, '../../..')
type SecretAssignmentMatch = RegExpMatchArray & {
  1: string
  2: string
}
type LeakedTokenPattern = {
  name: string
  pattern: RegExp
}

const tracked: string[] = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((file) => !/^(frontend|backend)\/package-lock\.json$/i.test(file))

const secretAssignment = /^\s*["']?(?:set\s+"|echo\s+)?(S3_SECRET_ACCESS_KEY|GOOGLE_DRIVE_CLIENT_SECRET|GOOGLE_LOGIN_CLIENT_SECRET|CLOUDFLARE_TUNNEL_TOKEN|CLOUDFLARE_API_TOKEN)\s*=\s*["']?([^"'\s#]+)["']?/i
const leakedTokenPatterns: LeakedTokenPattern[] = [
  { name: 'Cloudflare API token', pattern: /cfut_[A-Za-z0-9_-]{20,}/ },
  { name: 'Google OAuth secret', pattern: /GOCSPX-[A-Za-z0-9_-]{10,}/ },
]
const safeValuePattern = /^(|<.*>|your[_-].*|paste[_-].*|replace.*|changeme|redacted|\[redacted\]|if|Get-EnvValue|New-Secret|\$\{.*\}|\$\(.*\)|%.*%|!.*!)$/i

const failures: string[] = []

function isUnsafeSecretAssignment(line: string): SecretAssignmentMatch | null {
  const assignment = line.match(secretAssignment) as SecretAssignmentMatch | null
  if (!assignment) return null
  return safeValuePattern.test(String(assignment[2] || '').trim()) ? null : assignment
}

for (const relative of tracked) {
  const absolute = path.join(root, relative)
  let text = ''
  try {
    const stat = fs.statSync(absolute)
    if (stat.size > 2 * 1024 * 1024) continue
    text = readUtf8(absolute)
  } catch (_) {
    continue
  }

  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    const assignment = isUnsafeSecretAssignment(line)
    if (assignment) {
      failures.push(`${relative}:${index + 1} contains a tracked ${assignment[1]} value`)
    }
    leakedTokenPatterns.forEach(({ name, pattern }) => {
      if (pattern.test(line)) failures.push(`${relative}:${index + 1} contains a tracked ${name}`)
    })
  })
}

if (failures.length) {
  console.error('Secret hygiene verification failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('Secret hygiene verification passed.')
