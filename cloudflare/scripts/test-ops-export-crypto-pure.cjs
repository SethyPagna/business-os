#!/usr/bin/env node
// Offline checks for the ops export encryption (ops/scripts/ops-crypto.mjs and
// the owner-side ops/scripts/ops-decrypt.mjs). No network. Throwaway keypairs
// are generated here; the committed public key is only parsed, and nothing
// in the repository may hold a private key.
'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..', '..')
const PUBLIC_KEY = path.join(ROOT, 'ops', 'keys', 'ops-export-public.pem')
const DECRYPT_CLI = path.join(ROOT, 'ops', 'scripts', 'ops-decrypt.mjs')
// The owner's committed key. Changing the keypair must be deliberate: update
// this fingerprint in the same commit as the new public key.
const REPO_KEY_FINGERPRINT = 'sha256:875239f7295fe3245ea1685bdb7e26bf21fedda150783fa69e902aff45980be1'

let passed = 0
async function check(name, fn) {
  try {
    await fn()
    passed += 1
  } catch (err) {
    console.error(`FAIL ${name}\n  ${err && err.message}`)
    process.exitCode = 1
  }
}

function keypair(bits = 2048, passphrase) {
  const options = {
    modulusLength: bits,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: passphrase
      ? { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase }
      : { type: 'pkcs8', format: 'pem' },
  }
  return crypto.generateKeyPairSync('rsa', options)
}

function flipBase64Byte(b64, index = 0) {
  const buf = Buffer.from(b64, 'base64')
  buf[index % buf.length] ^= 0x01
  return buf.toString('base64')
}

async function main() {
  const lib = await import(pathToFileURL(path.join(ROOT, 'ops', 'scripts', 'ops-crypto.mjs')).href)
  const a = keypair(2048)
  const b = keypair(2048)
  const marker = 'ROW-MARKER-5d1c'
  const plaintext = JSON.stringify({ rows: [{ id: 1, name: `${marker} សាប៊ូ` }], blob: 'x'.repeat(5000) })

  await check('round trip returns the exact bytes (UTF-8 Khmer included)', () => {
    const env = lib.encryptEnvelope(plaintext, a.publicKey, { kind: 'd1-export', name: 'product-names' })
    const { plaintext: out, header } = lib.decryptEnvelope(env, a.privateKey)
    assert.strictEqual(out.toString('utf8'), plaintext)
    assert.strictEqual(header.meta.kind, 'd1-export')
    const bin = crypto.randomBytes(70000)
    const env2 = lib.encryptEnvelope(bin, a.publicKey)
    assert.ok(lib.decryptEnvelope(env2, a.privateKey).plaintext.equals(bin))
    const empty = lib.encryptEnvelope('', a.publicKey)
    assert.strictEqual(lib.decryptEnvelope(empty, a.privateKey).plaintext.length, 0)
  })

  await check('the envelope never contains the plaintext, and every file gets a fresh key and iv', () => {
    const env1 = lib.encryptEnvelope(plaintext, a.publicKey)
    const env2 = lib.encryptEnvelope(plaintext, a.publicKey)
    const text = JSON.stringify(env1)
    assert.ok(!text.includes(marker))
    assert.ok(!text.includes(Buffer.from(marker).toString('base64').slice(0, 12)))
    assert.notStrictEqual(env1.iv, env2.iv)
    assert.notStrictEqual(env1.wrappedKey, env2.wrappedKey)
    assert.notStrictEqual(env1.ciphertext, env2.ciphertext)
    assert.strictEqual(Buffer.from(env1.iv, 'base64').length, 12)
    assert.strictEqual(Buffer.from(env1.tag, 'base64').length, 16)
    // the wrapped key is one RSA block: 2048-bit key -> 256 bytes
    assert.strictEqual(Buffer.from(env1.wrappedKey, 'base64').length, 256)
  })

  await check('any modification is rejected: ciphertext, tag, iv, wrapped key, header, truncation', () => {
    const env = lib.encryptEnvelope(plaintext, a.publicKey, { kind: 'd1-export' })
    const variants = {
      ciphertext: { ...env, ciphertext: flipBase64Byte(env.ciphertext, 17) },
      tag: { ...env, tag: flipBase64Byte(env.tag, 3) },
      iv: { ...env, iv: flipBase64Byte(env.iv, 5) },
      wrappedKey: { ...env, wrappedKey: flipBase64Byte(env.wrappedKey, 40) },
      header: { ...env, header: env.header.replace('"d1-export"', '"d1-exporT"') },
      truncated: { ...env, ciphertext: Buffer.from(env.ciphertext, 'base64').subarray(0, 100).toString('base64') },
      format: { ...env, format: 'business-os-ops-envelope/0' },
    }
    for (const [name, bad] of Object.entries(variants)) {
      assert.throws(() => lib.decryptEnvelope(bad, a.privateKey), Error, `tampered ${name} was accepted`)
    }
    // positive control: the untouched envelope still opens
    assert.strictEqual(lib.decryptEnvelope(env, a.privateKey).plaintext.toString('utf8'), plaintext)
  })

  await check('a different private key cannot open the file, even with a forged fingerprint', () => {
    const env = lib.encryptEnvelope(plaintext, a.publicKey)
    assert.throws(() => lib.decryptEnvelope(env, b.privateKey), /encrypted for key/)
    const header = JSON.parse(env.header)
    header.keyFingerprint = lib.publicKeyFingerprint(crypto.createPublicKey(b.publicKey))
    const forged = { ...env, header: JSON.stringify(header) }
    assert.throws(() => lib.decryptEnvelope(forged, b.privateKey), /unwrap|Integrity/)
  })

  await check('weak or wrong key types are refused; a private key is never accepted as the export key', () => {
    const small = crypto.generateKeyPairSync('rsa', { modulusLength: 1024, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
    assert.throws(() => lib.encryptEnvelope('x', small.publicKey), /at least 2048/)
    const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256', publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
    assert.throws(() => lib.encryptEnvelope('x', ec.publicKey), /RSA/)
    assert.throws(() => lib.encryptEnvelope('x', a.privateKey), /PUBLIC key/)
  })

  await check('envelope meta only carries short plain values (it is readable by anyone)', () => {
    assert.throws(() => lib.encryptEnvelope('x', a.publicKey, { rows: [1, 2] }), /meta values/)
    assert.throws(() => lib.encryptEnvelope('x', a.publicKey, { 'bad name': 1 }), /meta names/)
    assert.throws(() => lib.encryptEnvelope('x', a.publicKey, { note: 'y'.repeat(200) }), /meta values/)
  })

  await check('the committed public key is an RSA-4096 PUBLIC key with the recorded fingerprint', () => {
    const pem = fs.readFileSync(PUBLIC_KEY, 'utf8')
    assert.ok(/^-----BEGIN PUBLIC KEY-----\n/.test(pem.replace(/\r\n/g, '\n')))
    assert.ok(!/PRIVATE/.test(pem))
    const key = lib.loadPublicKey(pem)
    assert.strictEqual(key.asymmetricKeyDetails.modulusLength, 4096)
    assert.strictEqual(lib.publicKeyFingerprint(key), REPO_KEY_FINGERPRINT)
    const env = lib.encryptEnvelope('probe', pem)
    assert.strictEqual(JSON.parse(env.header).keyFingerprint, REPO_KEY_FINGERPRINT)
    assert.strictEqual(Buffer.from(env.wrappedKey, 'base64').length, 512)
  })

  await check('no private key is stored anywhere under ops/ or .github/', () => {
    const offenders = []
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.isFile() && fs.statSync(full).size < 2_000_000) {
          const text = fs.readFileSync(full, 'latin1')
          if (/-----BEGIN (?:RSA |EC |ENCRYPTED |OPENSSH )?PRIVATE KEY-----/.test(text)) offenders.push(path.relative(ROOT, full))
        }
      }
    }
    walk(path.join(ROOT, 'ops'))
    walk(path.join(ROOT, '.github'))
    assert.deepStrictEqual(offenders, [])
  })

  // ------------------------------------------------------ ops-decrypt CLI
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-crypto-test-'))
  try {
    const run = (args, env = {}) => spawnSync(process.execPath, [DECRYPT_CLI, ...args], {
      encoding: 'utf8',
      env: { ...process.env, OPS_KEY_PASSPHRASE: '', ...env },
    })
    const enc = path.join(tmp, 'd1-export-product-names-1.enc.json')
    const keyFile = path.join(tmp, 'owner.pem')
    const out = path.join(tmp, 'out.json')
    fs.writeFileSync(enc, JSON.stringify(lib.encryptEnvelope(plaintext, a.publicKey, { kind: 'd1-export', name: 'product-names', commit: 'abc1234' })))
    fs.writeFileSync(keyFile, a.privateKey)

    await check('ops-decrypt writes the exact plaintext and prints only the header meta', () => {
      const r = run([enc, keyFile, out])
      assert.strictEqual(r.status, 0, r.stderr)
      assert.strictEqual(fs.readFileSync(out, 'utf8'), plaintext)
      assert.ok(r.stdout.includes('kind=d1-export'))
      assert.ok(!r.stdout.includes(marker) && !r.stderr.includes(marker))
    })

    await check('ops-decrypt never overwrites without --force, and never writes over its inputs', () => {
      const before = fs.readFileSync(out, 'utf8')
      fs.writeFileSync(out, 'keep me')
      const r = run([enc, keyFile, out])
      assert.strictEqual(r.status, 2)
      assert.strictEqual(fs.readFileSync(out, 'utf8'), 'keep me')
      const forced = run([enc, keyFile, out, '--force'])
      assert.strictEqual(forced.status, 0, forced.stderr)
      assert.strictEqual(fs.readFileSync(out, 'utf8'), before)
      assert.strictEqual(run([enc, keyFile, keyFile, '--force']).status, 2)
      assert.strictEqual(run([enc, keyFile, enc, '--force']).status, 2)
      assert.strictEqual(run([enc, keyFile]).status, 2)
    })

    await check('ops-decrypt explains a zip, rejects a wrong key and a tampered file', () => {
      const zip = path.join(tmp, 'artifact.zip')
      fs.writeFileSync(zip, Buffer.concat([Buffer.from('PK\u0003\u0004'), crypto.randomBytes(64)]))
      const z = run([zip, keyFile, path.join(tmp, 'z.json')])
      assert.strictEqual(z.status, 1)
      assert.ok(/zip/.test(z.stderr))
      const other = path.join(tmp, 'other.pem')
      fs.writeFileSync(other, b.privateKey)
      const w = run([enc, other, path.join(tmp, 'w.json')])
      assert.strictEqual(w.status, 1)
      assert.ok(!fs.existsSync(path.join(tmp, 'w.json')))
      const env = JSON.parse(fs.readFileSync(enc, 'utf8'))
      const bad = path.join(tmp, 'bad.enc.json')
      fs.writeFileSync(bad, JSON.stringify({ ...env, ciphertext: flipBase64Byte(env.ciphertext, 9) }))
      const t = run([bad, keyFile, path.join(tmp, 't.json')])
      assert.strictEqual(t.status, 1)
      assert.ok(/Integrity/.test(t.stderr))
      assert.ok(!fs.existsSync(path.join(tmp, 't.json')))
    })

    await check('ops-decrypt reads a passphrase-protected key from OPS_KEY_PASSPHRASE', () => {
      const p = keypair(2048, 'correct horse')
      const pEnc = path.join(tmp, 'p.enc.json')
      const pKey = path.join(tmp, 'p.pem')
      fs.writeFileSync(pEnc, JSON.stringify(lib.encryptEnvelope('secret rows', p.publicKey)))
      fs.writeFileSync(pKey, p.privateKey)
      const missing = run([pEnc, pKey, path.join(tmp, 'p1.json')])
      assert.strictEqual(missing.status, 1)
      assert.ok(/OPS_KEY_PASSPHRASE/.test(missing.stderr))
      const ok = run([pEnc, pKey, path.join(tmp, 'p2.json')], { OPS_KEY_PASSPHRASE: 'correct horse' })
      assert.strictEqual(ok.status, 0, ok.stderr)
      assert.strictEqual(fs.readFileSync(path.join(tmp, 'p2.json'), 'utf8'), 'secret rows')
    })
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }

  if (process.exitCode) console.error(`test-ops-export-crypto-pure: FAILED (${passed} passed)`)
  else console.log(`test-ops-export-crypto-pure: ${passed} checks passed`)
}

main().catch((err) => {
  console.error(`test-ops-export-crypto-pure: crashed: ${err && err.stack}`)
  process.exitCode = 1
})
