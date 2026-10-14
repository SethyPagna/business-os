// lib/aiGateway.ts: every outbound AI request refuses redirects.
// netSecurity judges the URL before the request, so a provider endpoint that
// answers 3xx must not be followed to a host the guard would have refused
// (a 307/308 keeps the POST body and the key header). The three fetch sites
// (chat for groq/mistral/cerebras, google, and the cohere embedding test) must
// all pass redirect: 'error', as lib/googleDrive.ts does.
//
// Drives the REAL aiGateway.ts and netSecurity.ts with a stub fetch that
// follows a redirect unless the caller asked for 'error'.
// Run: node scripts/test-ai-gateway-redirect-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

let failed = 0
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const overrides = { './secretCrypto': { decryptSecret: async (value) => value, maskApiKey: (value) => value } }
const cache = new Map()
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const sourcePath = path.join(__dirname, '..', 'src', rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: sourcePath,
  }).outputText
  const mod = { exports: {} }
  cache.set(rel, mod)
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}

const gateway = load('lib/aiGateway.ts')
const SECRET = 'sk-test-secret-key'
const seen = []
globalThis.fetch = async (url, init = {}) => {
  seen.push({ url: String(url), redirect: init.redirect, headers: init.headers || {} })
  if (String(url).startsWith('https://redirector.example/')) {
    if (init.redirect === 'error') throw new TypeError('redirect mode is set to error')
    seen.push({ url: 'http://169.254.169.254/latest/meta-data', redirect: 'followed', headers: init.headers || {} })
  }
  return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }], candidates: [{ content: { parts: [{ text: 'OK' }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
}

const chat = (provider, endpoint) => gateway.callChatProvider(
  { provider, api_key_encrypted: SECRET, default_model: 'm', endpoint_override: endpoint }, [{ role: 'user', content: 'hi' }], {}, 'k')

async function main() {
  for (const provider of ['groq', 'mistral', 'cerebras']) {
    await check(`${provider} chat passes redirect: 'error'`, async () => {
      seen.length = 0
      await chat(provider, '')
      assert.equal(seen.length, 1)
      assert.equal(seen[0].redirect, 'error')
    })
  }
  await check("google generateContent passes redirect: 'error'", async () => {
    seen.length = 0
    await chat('google', '')
    assert.equal(seen.length, 1)
    assert.equal(seen[0].redirect, 'error')
  })
  await check("the cohere embedding test passes redirect: 'error'", async () => {
    seen.length = 0
    await gateway.testProviderConfig({ provider: 'cohere', provider_type: 'embed', api_key_encrypted: SECRET, default_model: 'embed-v3' }, 'k')
    assert.equal(seen.length, 1)
    assert.equal(seen[0].redirect, 'error')
  })
  await check('a provider endpoint that redirects never reaches the redirect target, and the key is not forwarded', async () => {
    seen.length = 0
    await assert.rejects(() => chat('groq', 'https://redirector.example/v1/chat/completions'), /redirect/)
    assert.equal(seen.filter((entry) => entry.url.includes('169.254.169.254')).length, 0)
    await assert.rejects(() => gateway.testProviderConfig({ provider: 'cohere', provider_type: 'embed', api_key_encrypted: SECRET, default_model: 'e', endpoint_override: 'https://redirector.example/embed' }, 'k'), /redirect/)
    assert.equal(seen.filter((entry) => entry.url.includes('169.254.169.254')).length, 0)
  })
  await check('control: the stub does follow a redirect when the caller does not refuse it', async () => {
    seen.length = 0
    await globalThis.fetch('https://redirector.example/x', {})
    assert.equal(seen.filter((entry) => entry.redirect === 'followed').length, 1)
  })
  await check('every fetch( in aiGateway.ts is followed by redirect: error', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'aiGateway.ts'), 'utf8')
    const sites = [...source.matchAll(/\bfetch\(endpoint, \{[\s\S]*?\n\s*\}\)/g)]
    assert.equal(sites.length, 3)
    for (const site of sites) assert.match(site[0], /redirect: 'error'/)
  })
  if (failed) { console.error(`\n${failed} check(s) failed`); process.exitCode = 1 } else console.log('\nAll AI gateway redirect checks passed')
}
main()
