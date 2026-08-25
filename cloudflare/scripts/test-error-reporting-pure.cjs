// Sentry error reporting -- above all, the PII scrubbing.
//
// This app's error payloads routinely carry customer names, phone numbers,
// membership numbers and addresses, because those are exactly the values a
// failing query was operating on. Sending them to a third party would be a
// real privacy incident, and it is the kind that fails silently: nothing
// breaks, nobody notices, the data is just gone.
//
// So these assertions are the point of the file. The transport is trivial;
// the redaction is what must never regress.
//
// Run: node scripts/test-error-reporting-pure.cjs
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
const repoRoot = path.join(cloudflareRoot, '..')
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'error-reporting-'))
const tsPath = path.join(tmpDir, 'errorReporting.ts')
fs.writeFileSync(tsPath, fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'errorReporting.ts'), 'utf8'))
const tscBin = path.join(cloudflareRoot, 'node_modules', 'typescript', 'bin', 'tsc')
execSync(`node ${tscBin} --module commonjs --target es2020 --outDir ${tmpDir} ${tsPath}`, { cwd: tmpDir, stdio: 'inherit' })
const { scrubValue, parseSentryDsn, reportError } = require(path.join(tmpDir, 'errorReporting.js'))

let passed = 0
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { console.log('PASS', name); passed++ })
    .catch((e) => { console.log('FAIL', name, '-', e.message); process.exitCode = 1 })
}

const json = (value) => JSON.stringify(scrubValue(value))

async function main() {
  await check('keys that name personal data are redacted, whatever they hold', async () => {
    const out = json({
      customerName: 'Belie Bee',
      phone: '0965196900',
      email: 'a@b.com',
      address: 'Phnom Penh',
      membership_number: 'M-4471',
      sessionToken: 'abc',
      password: 'hunter2',
    })
    for (const leaked of ['Belie Bee', '0965196900', 'a@b.com', 'Phnom Penh', 'M-4471', 'hunter2']) {
      assert.ok(!out.includes(leaked), `"${leaked}" must not survive scrubbing`)
    }
  })

  await check('personal data inside a free-text MESSAGE is scrubbed too, not just under a key', async () => {
    // This is the case a key-based blocklist alone would miss, and it is the
    // common one: the value arrives interpolated into an error string.
    const out = json({ detail: 'no customer found for 012221112 (ung@example.com)' })
    assert.ok(!out.includes('012221112'), 'a phone number in prose must be redacted')
    assert.ok(!out.includes('ung@example.com'), 'an email in prose must be redacted')
    assert.ok(out.includes('[number]') && out.includes('[email]'), 'and replaced with a marker, so the shape is still readable')
  })

  await check('ordinary values a developer actually needs are preserved', async () => {
    const out = scrubValue({ productId: 42, branchId: 3, ok: false, step: 'materialize' })
    assert.equal(out.productId, 42, 'a short id is not a phone number')
    assert.equal(out.branchId, 3)
    assert.equal(out.ok, false)
    assert.equal(out.step, 'materialize')
  })

  await check('a cyclic object cannot hang the reporter', async () => {
    const cyclic = { name: 'root' }
    cyclic.self = cyclic
    assert.doesNotThrow(() => scrubValue(cyclic))
  })

  await check('depth and breadth are capped so an enormous payload cannot burn the CPU budget', async () => {
    let deep = { leaf: 'x' }
    for (let i = 0; i < 50; i += 1) deep = { nested: deep }
    assert.ok(json(deep).includes('[deep]'), 'deep nesting is truncated')
    const wide = {}
    for (let i = 0; i < 200; i += 1) wide[`k${i}`] = i
    assert.ok(Object.keys(scrubValue(wide)).length <= 30, 'wide objects are capped')
    const longArray = Array.from({ length: 500 }, (_, i) => i)
    assert.ok(scrubValue(longArray).length <= 20, 'long arrays are capped')
  })

  await check('a long string is truncated rather than sent whole', async () => {
    const out = scrubValue('y'.repeat(5000))
    assert.ok(out.length <= 500)
  })

  // ---- DSN parsing ----
  await check('a valid DSN resolves to the envelope endpoint', async () => {
    const parsed = parseSentryDsn('https://abc123@o111.ingest.us.sentry.io/222')
    assert.ok(parsed)
    assert.ok(parsed.envelopeUrl.startsWith('https://o111.ingest.us.sentry.io/api/222/envelope/'))
    assert.ok(parsed.envelopeUrl.includes('sentry_key=abc123'))
  })

  await check('an absent or malformed DSN disables reporting instead of throwing', async () => {
    for (const dsn of [undefined, null, '', '   ', 'not-a-url', 'https://nokey.example.com/', 'https://key@host/']) {
      assert.equal(parseSentryDsn(dsn), null, `${JSON.stringify(dsn)} should disable reporting`)
    }
    assert.equal(await reportError('', new Error('x'), { source: 'worker' }), false, 'no DSN means skipped, not thrown')
  })

  await check('reportError never throws even when the network fails', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = () => Promise.reject(new Error('network down'))
    try {
      const result = await reportError('https://abc@o1.ingest.us.sentry.io/2', new Error('boom'), { source: 'worker' })
      assert.equal(result, false, 'a failed send reports false rather than rejecting')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  await check('the envelope carries no user identity block', async () => {
    const originalFetch = globalThis.fetch
    let captured = ''
    globalThis.fetch = (_url, init) => {
      captured = String(init.body)
      return Promise.resolve({ body: null })
    }
    try {
      await reportError('https://abc@o1.ingest.us.sentry.io/2', new Error('failed for Belie Bee on 0965196900'), {
        source: 'worker',
        location: '/api/sales',
        role: 'cashier',
      })
    } finally {
      globalThis.fetch = originalFetch
    }
    assert.ok(captured, 'an envelope was sent')
    assert.ok(!captured.includes('0965196900'), 'a phone number in the error message must not reach Sentry')
    // NOT asserted: that the NAME is gone. A person's name in free text is
    // genuinely indistinguishable from ordinary words -- "failed for Belie
    // Bee" and "failed for Blue Widget" are the same shape, and any regex
    // aggressive enough to catch the first would destroy every useful
    // message. Asserting it here would be asserting something impossible,
    // which is worse than no test: it would pass only until someone wrote a
    // message containing a real name.
    //
    // What actually contains the risk is the convention that error messages
    // do not interpolate customer names in the first place -- enforced by
    // the check below, not by the scrubber.
    assert.ok(!/"user"\s*:/.test(captured), 'no user block: no id, username, email or IP')
    assert.ok(captured.includes('cashier'), 'a coarse role IS sent -- enough to say "only cashiers hit this"')
  })

  // ---- wiring ----
  await check('the app does not interpolate customer names into error messages', async () => {
    // The scrubber cannot catch a name in free text (see above), so the real
    // guard is that nothing constructs such a message. This greps the actual
    // source for the pattern rather than trusting the convention.
    const routesDir = path.join(cloudflareRoot, 'src', 'routes')
    const offenders = []
    for (const file of fs.readdirSync(routesDir)) {
      if (!file.endsWith('.ts')) continue
      const content = fs.readFileSync(path.join(routesDir, file), 'utf8')
      // A thrown/returned error string interpolating something name-shaped.
      const re = /(?:new Error\(|error:\s*)`[^`]*\$\{[^}]*(?:customer|contact|user)[^}]*\.name[^}]*\}/gi
      if (re.test(content)) offenders.push(file)
    }
    assert.deepEqual(offenders, [], `these routes interpolate a person's name into an error message: ${offenders.join(', ')}`)
  })

  await check('the Worker error handler reports without blocking the response', async () => {
    const index = fs.readFileSync(path.join(cloudflareRoot, 'src', 'index.ts'), 'utf8')
    assert.match(index, /waitUntil\(reportError\(/, 'reporting must go through waitUntil, never the response path')
    assert.match(index, /location: c\.req\.path/, 'report the path, not the full URL -- a URL carries the query string')
  })

  await check('the browser never holds the DSN and never calls Sentry directly', async () => {
    const appSrc = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'App.tsx'), 'utf8')
    assert.match(appSrc, /\/api\/system\/client-error/, 'the browser reports through our own Worker')
    for (const file of ['App.tsx']) {
      const content = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', file), 'utf8')
      assert.ok(!/ingest\.us\.sentry\.io/.test(content), `${file} must not embed the Sentry ingest host`)
    }
  })

  await check('the client-error endpoint is rate limited and never answers with an error', async () => {
    const system = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'system.ts'), 'utf8')
    assert.match(system, /checkRateLimit\(c\.env, 'client_error'/, 'a crash loop must not burn the Sentry quota')
    assert.match(
      system,
      /if \(!limit\.allowed\) return c\.json\(\{ success: true, reported: false, reason: 'rate_limited' \}\)/,
      'rate limiting must answer 200 -- handing an error to a crash reporter gives its error handler an error to handle',
    )
  })

  fs.rmSync(tmpDir, { recursive: true, force: true })
  console.log(`\n${passed} check(s) passed.`)
  if (process.exitCode) console.log('SOME CHECKS FAILED')
}

void main()
