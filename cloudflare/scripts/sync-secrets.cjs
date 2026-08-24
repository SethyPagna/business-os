#!/usr/bin/env node
// Pushes secrets from .dev.vars up to the real Cloudflare Worker so
// production has them too, without you ever typing `wrangler secret put`
// by hand. Run automatically by `npm run deploy:full` / full-automation.ps1
// before `wrangler deploy`; safe to run on its own too (`npm run secrets:sync`).
//
// Only the keys listed in SECRET_KEYS get pushed -- everything else in
// .dev.vars is treated as local-dev-only and ignored here (e.g. anything
// that's meant to stay a plain [vars] entry in wrangler.toml instead).
// Blank values are skipped (nothing to push, and `wrangler secret put`
// with an empty value is not what you want).
'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const CLOUDFLARE_DIR = path.join(__dirname, '..')
const DEV_VARS_FILE = path.join(CLOUDFLARE_DIR, '.dev.vars')
const AUTH_FILE = path.join(CLOUDFLARE_DIR, '.wrangler-auth.local')
const WRANGLER_BIN = path.join(CLOUDFLARE_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js')

const SECRET_KEYS = [
  'GOOGLE_LOGIN_CLIENT_SECRET',
  'GOOGLE_DRIVE_CLIENT_SECRET',
  'RESEND_API_KEY',
]

function parseEnvFile(filePath) {
  const out = {}
  if (!fs.existsSync(filePath)) return out
  const raw = fs.readFileSync(filePath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

if (!fs.existsSync(DEV_VARS_FILE)) {
  console.warn(`[sync-secrets] No ${path.relative(process.cwd(), DEV_VARS_FILE)} found -- nothing to sync. Skipping.`)
  process.exit(0)
}

const devVars = parseEnvFile(DEV_VARS_FILE)
const authEnv = parseEnvFile(AUTH_FILE)
const env = { ...process.env, ...authEnv }

let failures = 0
for (const key of SECRET_KEYS) {
  const value = devVars[key]
  if (!value) {
    console.log(`[sync-secrets] Skipping ${key} (blank in .dev.vars).`)
    continue
  }
  console.log(`[sync-secrets] Pushing ${key} to Cloudflare...`)
  const argv = ['secret', 'put', key]
  // Do not rely on npm's transient PATH entry for `wrangler`. In particular,
  // Windows nested child processes can lose that entry and make a full
  // deploy stop after the build. Running the project-installed CLI through
  // Node is portable and keeps the secret value on stdin, never in argv.
  const result = spawnSync(process.execPath, [WRANGLER_BIN, ...argv], {
    input: value,
    env,
    shell: false,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    failures += 1
    console.error(`[sync-secrets] FAILED to push ${key}:`)
    console.error(result.stderr || result.stdout || `(exit code ${result.status})`)
  } else {
    console.log(`[sync-secrets] OK: ${key}`)
  }
}

if (failures > 0) {
  console.error(`[sync-secrets] ${failures} secret(s) failed to push.`)
  process.exit(1)
}
console.log('[sync-secrets] Done.')
