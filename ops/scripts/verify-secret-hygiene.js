#!/usr/bin/env node
/* eslint-disable no-console */
'use strict'

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '../..')
const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((file) => !/^(frontend|backend)\/package-lock\.json$/i.test(file))

const secretAssignment = /^\s*["']?(?:set\s+"|echo\s+)?(S3_SECRET_ACCESS_KEY|GOOGLE_DRIVE_CLIENT_SECRET|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_JWT_SECRET|CLOUDFLARE_TUNNEL_TOKEN|CLOUDFLARE_API_TOKEN)\s*=\s*["']?([^"'\s#]+)["']?/i
const leakedTokenPatterns = [
  { name: 'Cloudflare API token', pattern: /cfut_[A-Za-z0-9_-]{20,}/ },
  { name: 'Supabase secret key', pattern: /sb_secret_[A-Za-z0-9_-]{10,}/ },
  { name: 'Google OAuth secret', pattern: /GOCSPX-[A-Za-z0-9_-]{10,}/ },
]
const safeValuePattern = /^(|<.*>|your[_-].*|paste[_-].*|replace.*|changeme|redacted|\[redacted\]|if|Get-EnvValue|New-Secret|\$\{.*\}|\$\(.*\)|%.*%|!.*!)$/i

const failures = []

for (const relative of tracked) {
  const absolute = path.join(root, relative)
  let text = ''
  try {
    const stat = fs.statSync(absolute)
    if (stat.size > 2 * 1024 * 1024) continue
    text = fs.readFileSync(absolute, 'utf8')
  } catch (_) {
    continue
  }

  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    const assignment = line.match(secretAssignment)
    if (assignment && !safeValuePattern.test(String(assignment[2] || '').trim())) {
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
