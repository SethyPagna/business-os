#!/usr/bin/env node
// Decrypts an ops export downloaded from a .github/workflows/ops.yml run.
// Runs on the owner's machine only; the private key never enters the repo.
//
//   gh run download <run-id> -n <artifact-name> -D <folder>
//   node ops/scripts/ops-decrypt.mjs <folder>/<file>.enc.json <private-key.pem> <out.json>
//
// A passphrase-protected private key reads its passphrase from the
// OPS_KEY_PASSPHRASE environment variable. The output file is never
// overwritten unless --force is given.

import fs from 'node:fs'
import path from 'node:path'
import { decryptEnvelope, loadPrivateKey, parseHeader } from './ops-crypto.mjs'

const USAGE = 'Usage: node ops/scripts/ops-decrypt.mjs <artifact-file.enc.json> <private-key-path> <out.json> [--force]'

function fail(message, code = 1) {
  process.stderr.write(`ops-decrypt: ${message}\n`)
  process.exit(code)
}

function same(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
}

function main(argv) {
  const force = argv.includes('--force')
  const args = argv.filter((a) => a !== '--force')
  if (args.length !== 3 || args.some((a) => a.startsWith('--'))) fail(USAGE, 2)
  const [inputPath, keyPath, outPath] = args

  if (same(outPath, inputPath) || same(outPath, keyPath)) fail('The output path must differ from the artifact and the key.', 2)
  if (fs.existsSync(outPath) && !force) fail(`${outPath} already exists; pass --force to replace it.`, 2)

  let raw
  try {
    raw = fs.readFileSync(inputPath)
  } catch (err) {
    fail(`Cannot read ${inputPath}: ${err.code || err.message}`)
  }
  if (raw.subarray(0, 2).toString('latin1') === 'PK') {
    fail('That is a zip archive. Unzip it first (gh run download unzips for you) and pass the .enc.json file inside.')
  }
  let envelope
  try {
    envelope = JSON.parse(raw.toString('utf8'))
  } catch {
    fail('The artifact file is not JSON; pass the .enc.json file from the artifact.')
  }
  let header
  try {
    header = parseHeader(envelope)
  } catch (err) {
    fail(err.message)
  }

  let keyText
  try {
    keyText = fs.readFileSync(keyPath, 'utf8')
  } catch (err) {
    fail(`Cannot read the private key: ${err.code || err.message}`)
  }
  let key
  try {
    key = loadPrivateKey(keyText, process.env.OPS_KEY_PASSPHRASE || undefined)
  } catch (err) {
    const hint = /ENCRYPTED/.test(keyText) || /passphrase|bad decrypt/i.test(err.message)
      ? ' The key is passphrase-protected: set OPS_KEY_PASSPHRASE to its passphrase.'
      : ''
    fail(`Cannot load the private key: ${err.message}.${hint}`)
  }

  let plaintext
  try {
    ;({ plaintext } = decryptEnvelope(envelope, key))
  } catch (err) {
    fail(err.message)
  }
  try {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
    fs.writeFileSync(outPath, plaintext, { flag: force ? 'w' : 'wx' })
  } catch (err) {
    fail(`Cannot write ${outPath}: ${err.code || err.message}`)
  }

  const meta = header.meta || {}
  const described = Object.entries(meta).map(([k, v]) => `${k}=${v}`).join(' ')
  process.stdout.write(`Decrypted ${plaintext.length} bytes -> ${outPath}\n`)
  if (described) process.stdout.write(`  ${described}\n`)
}

main(process.argv.slice(2))
