// What the pure tests read from a Worker config: [vars] as a plain object, the routes' patterns, run_worker_first and
// the consumer queues as string lists. Line based on purpose (no TOML parser is a dependency of this package); every
// key these tests read is a one-line `KEY = "value"` or a string array.
//
// cloudflare/wrangler.toml and wrangler.free.toml are generated per client and untracked: a fresh checkout, CI
// included, has neither, so nothing here reads them. The text is the committed template, rendered:
//
//   client 'example' (the default)  clients/example.env with the neutral shop identity of rendered_wrangler.cjs
//                                   (Example Shop). Runs everywhere; this is what the structural checks read.
//   client 'leang'                  the private Records/Clients/leang.env of this machine, when it has it. It is the
//                                   only source of that client's real values, so a Leang parity pin reads it and
//                                   SKIPs (skipLeang) where it is absent.
//
// `file` keeps the two names 'wrangler.toml' (the paid render) and 'wrangler.free.toml' (the free render), so a test
// says which of the two it means.
'use strict'

const wrangler = require('./rendered_wrangler.cjs')

const CLOUDFLARE_ROOT = require('path').join(__dirname, '..', '..')
const PLAN_OF = { 'wrangler.toml': 'paid', 'wrangler.free.toml': 'free' }

/** True where this machine has the private Leang values (Records/Clients/leang.env). */
const hasLeang = () => wrangler.clientEnvFile() !== null

/** The rendered config text of `file` for `client`; throws for 'leang' where the private file is absent. */
function readConfig(file = 'wrangler.toml', client = 'example') {
  const plan = PLAN_OF[file]
  if (!plan) throw new Error(`${file} is not a config the tests know (wrangler.toml or wrangler.free.toml)`)
  if (client === 'leang') {
    const text = wrangler.clientRender(plan)
    if (text === null) throw new Error('no Records/Clients/leang.env on this machine: guard a Leang pin with hasLeang() and skipLeang()')
    return text.replace(/\r\n/g, '\n')
  }
  if (client !== 'example') throw new Error(`unknown client ${client}`)
  return wrangler[plan](wrangler.identity).replace(/\r\n/g, '\n')
}

function unescapeBasicString(raw) {
  return raw.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, code) => {
    if (code[0] === 'u' && code.length === 5) return String.fromCharCode(parseInt(code.slice(1), 16))
    return { n: '\n', t: '\t', '"': '"', '\\': '\\' }[code] ?? code
  })
}

/** The [vars] table: every `KEY = "string"` line up to the next table header. */
function wranglerVars(file = 'wrangler.toml', client = 'example') {
  const text = readConfig(file, client)
  const start = text.search(/^\[vars\]\s*$/m)
  if (start < 0) throw new Error(`${file} has no [vars] table`)
  const body = text.slice(start).split('\n').slice(1)
  const vars = {}
  for (const line of body) {
    if (/^\[/.test(line)) break
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/.exec(line)
    if (match) vars[match[1]] = unescapeBasicString(match[2])
  }
  return vars
}

/** Leang's [vars] from the private render, or null where this machine does not have them. */
const leangVars = (file = 'wrangler.toml') => (hasLeang() ? wranglerVars(file, 'leang') : null)

/** The string entries of `key = [ ... ]`, comments inside the array ignored. */
function wranglerStringArray(key, file = 'wrangler.toml', client = 'example') {
  const text = readConfig(file, client)
  const start = text.indexOf(`${key} = [`)
  if (start < 0) throw new Error(`${file} declares no ${key}`)
  const end = text.indexOf('\n]', start)
  const body = text.slice(start, end).split('\n').map((line) => line.replace(/^\s*#.*$/, '')).join('\n')
  return [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1])
}

/** Hostnames of the `routes = [ { pattern = "host", ... } ]` entries. */
function wranglerRoutePatterns(file = 'wrangler.toml', client = 'example') {
  const text = readConfig(file, client)
  const start = text.indexOf('routes = [')
  if (start < 0) throw new Error(`${file} declares no routes`)
  const end = text.indexOf('\n]', start)
  return [...text.slice(start, end).matchAll(/pattern = "([^"]+)"/g)].map((match) => match[1])
}

/** Prints the one line a Leang pin leaves where this machine lacks the private values (CI), and tells the caller to move on. */
function skipLeang(testName, what) {
  console.log(`${testName}: SKIP ${what} (no Records/Clients/leang.env on this machine; those pins run where it exists)`)
}

module.exports = {
  CLOUDFLARE_ROOT, EXAMPLE_IDENTITY: wrangler.identity,
  hasLeang, skipLeang, readConfig, wranglerVars, leangVars, wranglerStringArray, wranglerRoutePatterns,
}
