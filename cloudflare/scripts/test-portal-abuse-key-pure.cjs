const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const file = path.join(__dirname, '..', 'src', 'lib', 'portalAbuseKey.ts')
const source = fs.readFileSync(file, 'utf8')
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const moduleObject = { exports: {} }
new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
  moduleObject.exports,
  require,
  moduleObject,
  file,
  path.dirname(file),
)

const { portalAbuseKey } = moduleObject.exports

async function run() {
  assert.strictEqual(await portalAbuseKey({}, 'signin', '017611168'), null)
  assert.strictEqual(await portalAbuseKey({ PORTAL_ABUSE_HMAC_SECRET: 'short' }, 'signin', '017611168'), null)
  assert.strictEqual(await portalAbuseKey({ PORTAL_ABUSE_HMAC_SECRET: 'x'.repeat(32) }, '', '017611168'), null)

  const env = { PORTAL_ABUSE_HMAC_SECRET: 'portal-test-secret-that-is-at-least-32-chars' }
  const first = await portalAbuseKey(env, 'signin', '017611168')
  const same = await portalAbuseKey(env, 'signin', '017611168')
  const otherScope = await portalAbuseKey(env, 'signup', '017611168')
  assert.match(first, /^hmac-v1:[0-9a-f]{64}$/)
  assert.strictEqual(first, same, 'the same scoped value must produce a stable limiter key')
  assert.notStrictEqual(first, otherScope, 'scopes must not share limiter keys')
  assert.ok(!first.includes('017611168'), 'the raw identifier reached persistent key material')
  assert.match(source, /\{ name: 'HMAC', hash: 'SHA-256' \}/)
  assert.doesNotMatch(source, /subtle\.digest\(/, 'an unsalted digest fallback would be enumerable')
  console.log('PASS portal abuse keys require a strong secret and use scoped HMAC-SHA256')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
