#!/usr/bin/env node
// Loads cloudflare/.wrangler-auth.local (gitignored, never committed) and
// re-execs the rest of argv with CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
// set in the environment, so every `wrangler` call in package.json
// authenticates automatically -- no `wrangler login`, no manually exporting
// env vars in a shell first. Used by npm scripts like:
//   "deploy": "node scripts/with-wrangler-auth.cjs wrangler deploy"
//
// If .wrangler-auth.local doesn't exist, this is a silent no-op passthrough
// (wrangler falls back to its normal login flow / OAuth cache), so it's
// always safe to leave in package.json even on a machine that hasn't set
// this file up yet.
'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const AUTH_FILE = path.join(__dirname, '..', '.wrangler-auth.local')

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
    // strip matching surrounding quotes, same as most .env parsers
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

const loaded = parseEnvFile(AUTH_FILE)
const missing = !fs.existsSync(AUTH_FILE)

if (missing) {
  console.warn(
    `[with-wrangler-auth] No ${path.relative(process.cwd(), AUTH_FILE)} found -- ` +
    'falling back to wrangler\'s normal login/OAuth cache. ' +
    'See "One-time local setup" in cloudflare/README.md to create it and skip this every time.'
  )
}

const commandArgs = process.argv.slice(2)
if (commandArgs.length === 0) {
  console.error('[with-wrangler-auth] No command given. Usage: node with-wrangler-auth.cjs <command> [...args]')
  process.exit(1)
}

const env = { ...process.env, ...loaded }
let [cmd, ...args] = commandArgs

// Resolve `wrangler` to the project-installed CLI and run it through THIS
// node, instead of trusting the shell to find it on PATH. Under `npm run`,
// node_modules/.bin is on PATH so the bare name works -- but nested child
// processes on Windows can lose that transient entry (a real full-deploy
// once stopped after the build exactly this way; sync-secrets.cjs carries
// the same workaround), and running this script directly outside npm never
// had it. Resolving the .js bin also needs no shell on Windows, so the
// quoting path below is only kept for non-wrangler commands.
const WRANGLER_BIN = path.join(__dirname, '..', 'node_modules', 'wrangler', 'bin', 'wrangler.js')
if ((cmd === 'wrangler' || cmd === 'wrangler.cmd') && fs.existsSync(WRANGLER_BIN)) {
  args = [WRANGLER_BIN, ...args]
  cmd = process.execPath
}

function quoteForWindowsShell(arg) {
  return `"${String(arg).replace(/"/g, '""')}"`
}

const useShell = process.platform === 'win32' && cmd !== process.execPath
const result = useShell
  ? spawnSync([cmd, ...args].map(quoteForWindowsShell).join(' '), [], { stdio: 'inherit', env, shell: true })
  : spawnSync(cmd, args, { stdio: 'inherit', env, shell: false })
if (result.error) {
  console.error(`[with-wrangler-auth] Failed to run "${cmd}":`, result.error.message)
  process.exit(1)
}
process.exit(result.status == null ? 1 : result.status)
