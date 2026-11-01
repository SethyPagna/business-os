'use strict'
// Cloudflare Workers Caching (`cache.enabled` in the wrangler config) keys a response by path, not host, and a request
// Cookie does not bypass it. Every /api/* body here is per-account, and most routes name no Cache-Control of their
// own, so switching it on would serve one account's answer to another. Neither wrangler config may declare it.
//
// Run (from cloudflare/): node scripts/test-api-cache-config-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Table headers `[cache]`, `[env.free.cache]`, `[[cache.x]]`; keys `cache = {...}` and dotted `cache.enabled = ...`.
function declaresWorkersCaching(toml) {
  const lines = toml.split(/\r?\n/).map((line) => line.replace(/\s+#.*$/, '').replace(/^\s*#.*$/, '').trim())
  return lines.filter((line) => /^\[\[?\s*(?:[\w-]+\.)*cache(?:\.[\w."-]+)?\s*\]\]?$/.test(line) || /^cache(?:\.[\w-]+)?\s*=/.test(line))
}

const configs = fs.readdirSync(path.join(__dirname, '..')).filter((name) => /^wrangler(?:\.[\w-]+)?\.toml$/.test(name)).sort()

assert.deepEqual(configs, ['wrangler.free.toml', 'wrangler.toml'], 'both Worker configs are checked, and any new wrangler*.toml joins them')

for (const name of configs) {
  const toml = fs.readFileSync(path.join(__dirname, '..', name), 'utf8')
  assert.match(toml, /^name\s*=/m, `${name} was read`)
  assert.deepEqual(declaresWorkersCaching(toml), [], `${name} must not declare Workers Caching ([cache] or cache.enabled)`)
  console.log(`PASS ${name} does not enable Workers Caching`)
}

const positives = [
  '[cache]\nenabled = true',
  'cache.enabled = true',
  'cache = { enabled = true }',
  '[env.free.cache]\nenabled = true',
  '[[cache.rules]]',
  '  [ cache ]  # on',
]
for (const sample of positives) assert.notDeepEqual(declaresWorkersCaching(`name = "x"\n${sample}\n`), [], `the detector must catch: ${JSON.stringify(sample)}`)
const negatives = ['# [cache]\n# cache.enabled = true', 'compatibility_date = "2026-07-01"\nname = "cache-worker"', '[[kv_namespaces]]\nbinding = "CACHE"', '[vars]\nPAGE_CACHE_TTL = "5"']
for (const sample of negatives) assert.deepEqual(declaresWorkersCaching(`name = "x"\n${sample}\n`), [], `the detector must not flag: ${JSON.stringify(sample)}`)
console.log('PASS the detector catches every spelling of the setting and ignores comments, KV bindings and look-alikes')
