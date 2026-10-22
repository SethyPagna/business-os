// Reads a wrangler config the way the pure tests need it: [vars] as a plain
// object, the routes' patterns and run_worker_first as string lists. Line
// based on purpose (no TOML parser is a dependency of this package); every
// key these tests read is a one-line `KEY = "value"` or a string array.
//
// The identity tests take Leang Cosmetics' values from wrangler.toml through
// this instead of copying them, so the config stays the one place they live.
const fs = require('fs')
const path = require('path')

const CLOUDFLARE_ROOT = path.join(__dirname, '..', '..')

function readConfig(file = 'wrangler.toml') {
  return fs.readFileSync(path.join(CLOUDFLARE_ROOT, file), 'utf8').replace(/\r\n/g, '\n')
}

function unescapeBasicString(raw) {
  return raw.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, code) => {
    if (code[0] === 'u' && code.length === 5) return String.fromCharCode(parseInt(code.slice(1), 16))
    return { n: '\n', t: '\t', '"': '"', '\\': '\\' }[code] ?? code
  })
}

/** The [vars] table: every `KEY = "string"` line up to the next table header. */
function wranglerVars(file = 'wrangler.toml') {
  const text = readConfig(file)
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

/** The string entries of `key = [ ... ]`, comments inside the array ignored. */
function wranglerStringArray(key, file = 'wrangler.toml') {
  const text = readConfig(file)
  const start = text.indexOf(`${key} = [`)
  if (start < 0) throw new Error(`${file} declares no ${key}`)
  const end = text.indexOf('\n]', start)
  const body = text.slice(start, end).split('\n').map((line) => line.replace(/^\s*#.*$/, '')).join('\n')
  return [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1])
}

/** Hostnames of the `routes = [ { pattern = "host", ... } ]` entries. */
function wranglerRoutePatterns(file = 'wrangler.toml') {
  const text = readConfig(file)
  const start = text.indexOf('routes = [')
  if (start < 0) throw new Error(`${file} declares no routes`)
  const end = text.indexOf('\n]', start)
  return [...text.slice(start, end).matchAll(/pattern = "([^"]+)"/g)].map((match) => match[1])
}

module.exports = { CLOUDFLARE_ROOT, readConfig, wranglerVars, wranglerStringArray, wranglerRoutePatterns }
