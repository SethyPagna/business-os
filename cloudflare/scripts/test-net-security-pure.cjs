// F1 (whole-app security audit, 13 Oct 2026): assertSafeOutboundUrl did not
// recognise bracketed IPv6 literals. new URL('https://[::1]/').hostname is
// '[::1]' (brackets kept), so the IPv6 check never matched and loopback,
// unique-local and IPv4-mapped addresses were accepted as outbound targets.
//
// Pure: lib/netSecurity.ts has no imports. Each refusal below is asserted both
// through assertSafeOutboundUrl (what routes/ai.ts and lib/aiGateway.ts call)
// and through isBlockedHostname with the hostname exactly as URL reports it.
//
// Run (from cloudflare/): node scripts/test-net-security-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'netSecurity.ts')
const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: sourcePath,
})
const mod = { exports: {} }
new Function('exports', 'require', 'module', outputText)(mod.exports, require, mod)
const { assertSafeOutboundUrl, isBlockedHostname, isSafeExternalImageReference } = mod.exports

let failed = 0
function check(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const refused = [
  ['loopback', '[::1]'],
  ['loopback, long form', '[0:0:0:0:0:0:0:1]'],
  ['unspecified', '[::]'],
  ['IPv4-mapped loopback, dotted', '[::ffff:127.0.0.1]'],
  ['IPv4-mapped loopback, hex', '[::ffff:7f00:1]'],
  ['IPv4-mapped private 10/8', '[::ffff:10.1.2.3]'],
  ['IPv4-mapped private 192.168/16', '[::ffff:c0a8:1]'],
  ['IPv4-mapped link-local 169.254/16', '[::ffff:169.254.169.254]'],
  ['IPv4-mapped unspecified', '[::ffff:0.0.0.0]'],
  ['unique-local fd00::/8', '[fd00::1]'],
  ['unique-local fc00::/8', '[fc00::1]'],
  ['unique-local, upper edge', '[fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]'],
  ['link-local fe80::/10', '[fe80::1]'],
  ['link-local, upper edge febf', '[febf::1]'],
]

for (const [label, host] of refused) {
  check(`refuses ${label}: https://${host}/`, () => {
    assert.throws(() => assertSafeOutboundUrl(`https://${host}/v1/chat`), /Private, local, or internal network destinations are not allowed/)
    assert.throws(() => assertSafeOutboundUrl(`https://${host}:8443/`), /not allowed/)
    assert.equal(isBlockedHostname(new URL(`https://${host}/`).hostname), true)
    assert.equal(isBlockedHostname(host.slice(1, -1)), true, 'the bare literal is refused too')
  })
}

check('refuses the same literals when an http protocol is explicitly allowed', () => {
  assert.throws(() => assertSafeOutboundUrl('http://[::1]:11434/', { allowedProtocols: ['http:', 'https:'] }), /not allowed/)
})

check('refuses a malformed bracketed literal instead of treating it as a hostname', () => {
  for (const bad of ['[::1::2]', '[12345::1]', '[fe80:::1]', '[1:2:3:4:5:6:7]', '[g::1]']) {
    assert.equal(isBlockedHostname(bad), true, bad)
  }
})

const allowed = [
  'https://api.telegram.org/bot/sendMessage',
  'https://api.openai.com/v1/chat/completions',
  'https://[2606:4700:4700::1111]/v1',
  'https://[2001:4860:4860::8888]:443/',
  'https://[::ffff:8.8.8.8]/',
  'https://93.184.216.34/',
]
for (const url of allowed) {
  check(`allows ${url}`, () => {
    assert.equal(assertSafeOutboundUrl(url), new URL(url).toString())
  })
}

check('the existing IPv4, name and scheme rules still refuse', () => {
  for (const url of ['https://127.0.0.1/', 'https://10.0.0.5/', 'https://192.168.1.1/', 'https://172.16.0.1/', 'https://169.254.169.254/', 'https://100.64.0.1/',
    'https://localhost/', 'https://metadata.google.internal/', 'https://printer.local/', 'https://0/', 'https://2130706433/', 'https://0x7f.1/']) {
    assert.throws(() => assertSafeOutboundUrl(url), /not allowed/, url)
  }
  assert.throws(() => assertSafeOutboundUrl('http://api.openai.com/'), /Only https:/)
  assert.throws(() => assertSafeOutboundUrl('https://user:pass@api.openai.com/'), /Embedded credentials/)
  assert.throws(() => assertSafeOutboundUrl(''), /valid URL/)
})

check('image references: a private IPv6 literal is not a safe external image', () => {
  assert.equal(isSafeExternalImageReference('https://[::1]/a.png'), false)
  assert.equal(isSafeExternalImageReference('https://[::ffff:7f00:1]/a.png'), false)
  assert.equal(isSafeExternalImageReference('https://[fd00::1]/a.png'), false)
  assert.equal(isSafeExternalImageReference('https://[2606:4700:4700::1111]/a.png'), true)
  assert.equal(isSafeExternalImageReference('https://cdn.example.com/a.png'), true)
})

if (failed > 0) process.exitCode = 1
