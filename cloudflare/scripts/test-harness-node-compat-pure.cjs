// The deploy keeps node:* imports external and runs with nodejs_compat, and
// lib/auth.ts and lib/requestMetrics.ts import node:async_hooks. A harness that
// bundles Worker code for the browser platform must do the same, or the next
// node:* import breaks it (release-2 gate 38352516197 lost three that way).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const cloudflare = path.join(__dirname, '..')
const repo = path.join(cloudflare, '..')

const hasCompatFlag = (toml) => /^compatibility_flags\s*=\s*\[[^\]]*"nodejs_compat"/m.test(toml)

/** The option object around every `bundle: true` in a source: a file with two esbuild calls must have the externals on EACH (6.0.1048: returns-bulk-telegram-once had them on the first only). */
function bundleCalls(source) {
  const calls = []
  for (const match of source.matchAll(/bundle:\s*true/g)) {
    let start = match.index
    for (let depth = 0; start > 0; start -= 1) {
      const char = source[start]
      if (char === '}') depth += 1
      else if (char === '{') { if (depth === 0) break; depth -= 1 }
    }
    let end = start
    for (let depth = 0; end < source.length; end += 1) {
      const char = source[end]
      if (char === '{') depth += 1
      else if (char === '}') { depth -= 1; if (depth === 0) break }
    }
    calls.push(source.slice(start, end + 1))
  }
  return calls
}

/** null: not a browser-platform Worker bundle; '': deploy-identical; otherwise the gap. */
function harnessGap(source) {
  if (!/require\([^)]*esbuild[^)]*\)|from ['"]esbuild['"]/.test(source) || !/bundle:\s*true/.test(source)) return null
  const calls = bundleCalls(source).filter((call) => {
    const platform = /platform:\s*['"](\w+)['"]/.exec(call)
    return !platform || platform[1] === 'browser'
  })
  if (!calls.length) return null
  // An external list held in a variable (external: EXTERNALS) counts when the file spells node:* out.
  const wired = (call) => /['"]node:\*['"]/.test(call) || (/external:\s*[A-Za-z_]/.test(call) && /['"]node:\*['"]/.test(source))
  if (!calls.every(wired)) return "no external 'node:*'"
  if (/new Miniflare/.test(source) && !/nodejs_compat/.test(source)) return 'Miniflare without nodejs_compat'
  return ''
}

function scripts(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) scripts(file, out)
    else if (/\.(cjs|mjs|js)$/.test(entry.name) && file !== __filename) out.push(file)
  }
  return out
}

for (const name of ['wrangler.toml', 'wrangler.free.toml']) {
  assert.ok(hasCompatFlag(fs.readFileSync(path.join(cloudflare, name), 'utf8')), `${name} no longer sets compatibility_flags "nodejs_compat"`)
}

const checked = [...scripts(path.join(cloudflare, 'scripts')), ...scripts(path.join(repo, 'ops', 'scripts'))]
  .map((file) => [path.relative(repo, file).split(path.sep).join('/'), harnessGap(fs.readFileSync(file, 'utf8'))])
  .filter(([, gap]) => gap !== null)
assert.ok(checked.length >= 30, `expected the Worker harnesses, found ${checked.length}`)
const gaps = checked.filter(([, gap]) => gap)
assert.deepEqual(gaps, [], `bundle these like the deploy (external ['node:*', 'cloudflare:*'] + compatibilityFlags ['nodejs_compat']): ${JSON.stringify(gaps)}`)

// POSITIVE CONTROLS: each check can fail.
assert.equal(hasCompatFlag('compatibility_flags = []'), false)
assert.equal(harnessGap("require('esbuild'); build({ bundle: true, platform: 'browser' }); new Miniflare({})"), "no external 'node:*'")
assert.equal(harnessGap("require('esbuild'); build({ bundle: true, platform: 'browser', external: ['node:*'] }); new Miniflare({})"), 'Miniflare without nodejs_compat')
assert.equal(harnessGap("require('esbuild'); build({ bundle: true }); new Miniflare({})"), "no external 'node:*'")
assert.equal(harnessGap("require('esbuild'); build({ bundle: true, platform: 'node' }); new Miniflare({})"), null)
// Per call: the second bundle of a two-call file has no external (the shape of test-returns-bulk-telegram-once-native.cjs before 6.0.1048).
assert.equal(harnessGap("require('esbuild'); build({ bundle: true, platform: 'browser', external: ['node:*'] }); build({ bundle: true, platform: 'browser', format: 'esm' }); new Miniflare({ compatibilityFlags: ['nodejs_compat'] })"), "no external 'node:*'")
assert.equal(harnessGap("require('esbuild'); build({ bundle: true, platform: 'browser', external: ['node:*'] }); build({ bundle: true, platform: 'browser', external: ['node:*', 'cloudflare:*'] }); new Miniflare({ compatibilityFlags: ['nodejs_compat'] })"), '')
assert.equal(harnessGap("require('esbuild'); const EXTERNALS = ['node:*']; build({ bundle: true, external: EXTERNALS }); new Miniflare({ compatibilityFlags: ['nodejs_compat'] })"), '')

console.log(`PASS both wrangler configs set nodejs_compat; ${checked.length} browser-platform Worker harnesses bundle node:* external with nodejs_compat`)
