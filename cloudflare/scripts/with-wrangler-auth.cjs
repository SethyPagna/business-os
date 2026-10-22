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

if (missing && process.env.CLOUDFLARE_API_TOKEN) {
  // CI (GitHub Actions secret) or an outer wrapper already set the token:
  // it is passed through unchanged below. Never print its value.
  console.warn('[with-wrangler-auth] No saved token file -- using CLOUDFLARE_API_TOKEN from the environment.')
} else if (missing) {
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

// The Worker config is generated for ONE client (ops/scripts/client/render-wrangler.mjs)
// and names that client's Cloudflare account. The account the token runs with
// must be that account. A saved token file of one client next to the rendered
// config of another would otherwise let `wrangler deploy` or a migration act in
// the wrong account: wrangler prefers CLOUDFLARE_ACCOUNT_ID over the config's
// account_id. Nothing is run on a mismatch, and no id is printed.
function refuseWrongAccount() {
  // `wrangler ...` from an npm script, or node running wrangler's own bin (what the release kit does).
  const isWrangler = cmd === 'wrangler' || cmd === 'wrangler.cmd' || (/node(?:\.exe)?$/i.test(cmd) && /wrangler[\\/]bin[\\/]wrangler\.js$/.test(String(args[0] || '')))
  if (!isWrangler) return
  const given = args.findIndex((a) => a === '--config' || a === '-c')
  const inline = args.find((a) => a.startsWith('--config='))
  // Every wrangler command names the client's rendered config. Without --config wrangler takes whatever
  // wrangler.toml is in the working folder, and that file (another client's, or a stale one) then wins over
  // CLOUDFLARE_ACCOUNT_ID: a BM command once reached Leang's account that way. Commands that read no config
  // are the only ones allowed without it.
  const sub = String((/node(?:\.exe)?$/i.test(cmd) ? args[1] : args[0]) || '')
  const READS_NO_CONFIG = new Set(['--version', '-v', '--help', '-h', 'help', 'whoami', 'login', 'logout', 'docs', 'telemetry'])
  if (given < 0 && !inline && !READS_NO_CONFIG.has(sub)) {
    console.error('[with-wrangler-auth] REFUSED: no --config. Name the client\'s rendered config on every wrangler command (for example --config wrangler.toml); a wrangler.toml found in the working folder is never picked up silently. Nothing was run.')
    process.exit(1)
  }
  const configPath = path.resolve(process.cwd(), given >= 0 && args[given + 1] ? args[given + 1] : inline ? inline.slice('--config='.length) : 'wrangler.toml')
  const wanted = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim()
  if (!wanted || !fs.existsSync(configPath)) return
  const configured = /^account_id\s*=\s*"([^"]+)"\s*$/m.exec(fs.readFileSync(configPath, 'utf8'))
  if (configured && configured[1] !== wanted) {
    console.error(`[with-wrangler-auth] REFUSED: the Worker config ${path.basename(configPath)} is for a different Cloudflare account than CLOUDFLARE_ACCOUNT_ID (${AUTH_FILE_NOTE}). Nothing was run. Render the config for the client you mean, or use that client's token.`)
    process.exit(1)
  }
}
const AUTH_FILE_NOTE = missing ? 'from the environment' : 'from .wrangler-auth.local or the environment'
refuseWrongAccount()

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
