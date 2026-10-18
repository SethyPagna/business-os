import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { encryptEnvelope, loadPublicKey } from '../ops-crypto.mjs'

export const LIMITS = Object.freeze({ files: 256, directories: 256, depth: 16, bytes: 64 * 1024 * 1024 })
const same = (a, b) => path.relative(a, b) === ''
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

function exists(file) {
  try { fs.lstatSync(file); return true } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

function directory(dir) {
  const full = path.resolve(dir)
  const parent = path.dirname(full)
  if (parent !== full) directory(parent)
  const stat = fs.lstatSync(full)
  if (!stat.isDirectory() || stat.isSymbolicLink() || !same(fs.realpathSync(full), full)) throw Error('Unsafe directory')
}

function regular(file) {
  const full = path.resolve(file)
  directory(path.dirname(full))
  const stat = fs.lstatSync(full)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !same(fs.realpathSync(full), full)) throw Error('Unsafe file')
  return stat
}

function read(file, maximum) {
  const expected = regular(file)
  if (expected.size > maximum) throw Error('File limit')
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
  try {
    const before = fs.fstatSync(descriptor)
    if (!before.isFile() || before.nlink !== 1 || before.dev !== expected.dev || before.ino !== expected.ino || before.size !== expected.size) throw Error('File changed')
    const bytes = Buffer.alloc(before.size)
    let offset = 0
    while (offset < bytes.length) {
      const length = fs.readSync(descriptor, bytes, offset, bytes.length - offset, null)
      if (!length) throw Error('File changed')
      offset += length
    }
    if (fs.readSync(descriptor, Buffer.alloc(1), 0, 1, null) !== 0) throw Error('File changed')
    const after = fs.fstatSync(descriptor)
    if (bytes.length > maximum || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw Error('File changed')
    regular(file)
    return bytes
  } finally { fs.closeSync(descriptor) }
}

export function precheck(options, { existingRecords = false } = {}) {
  const { runId, attempt, commit, kitCommit } = options
  if (!/^[1-9]\d*$/.test(runId || '') || !/^[1-9]\d*$/.test(attempt || '') || !/^[a-f0-9]{40}$/.test(commit || '') || !/^[a-f0-9]{40}$/.test(kitCommit || '')) throw Error('Invalid identity')
  const records = path.resolve(options.records)
  const output = path.resolve(options.output)
  const key = path.resolve(options.key)
  if (path.basename(records) !== `records-${runId}-${attempt}` || path.basename(output) !== `release-records-${runId}-${attempt}.enc.json`) throw Error('Invalid paths')
  if (same(records, output) || same(key, output) || !path.relative(records, output).startsWith('..' + path.sep)) throw Error('Output overlaps records')
  directory(path.dirname(records))
  directory(path.dirname(output))
  if (exists(records)) {
    if (!existingRecords) throw Error('Records root already exists')
    directory(records)
  }
  if (exists(output)) throw Error('Output exists')
  const publicKey = read(key, 16 * 1024).toString('utf8')
  loadPublicKey(publicKey)
  return { records, output, publicKey, identity: { runId, attempt, commit, kitCommit } }
}

export function exportRecords(options) {
  const checked = precheck(options, { existingRecords: true })
  directory(checked.records)
  const files = []
  const directories = []
  let total = 0
  function walk(dir, depth) {
    if (depth > LIMITS.depth || directories.length >= LIMITS.directories) throw Error('Directory limit')
    directory(dir)
    directories.push(path.relative(checked.records, dir).split(path.sep).join('/'))
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name)
      const relative = path.relative(checked.records, file)
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw Error('Outside records')
      const stat = fs.lstatSync(file)
      if (stat.isSymbolicLink()) throw Error('Alias refused')
      if (stat.isDirectory()) walk(file, depth + 1)
      else {
        if (files.length >= LIMITS.files) throw Error('File limit')
        const bytes = read(file, LIMITS.bytes - total)
        total += bytes.length
        files.push({ path: relative.split(path.sep).join('/'), bytes: bytes.length, sha256: digest(bytes), contentBase64: bytes.toString('base64') })
      }
    }
  }
  walk(checked.records, 0)
  if (!files.length) throw Error('Expected records absent')
  const manifest = { kind: 'release-records', version: 1, ...checked.identity, capturedAt: new Date().toISOString(), qualification: 'Observed records only; may be partial and do not certify release completion or rollback.', directories, files }
  const envelope = encryptEnvelope(Buffer.from(JSON.stringify(manifest)), checked.publicKey, { kind: 'release-records', runId: checked.identity.runId, commit: checked.identity.commit })
  directory(path.dirname(checked.output))
  const descriptor = fs.openSync(checked.output, 'wx', 0o600)
  try { fs.writeFileSync(descriptor, JSON.stringify(envelope) + '\n') } finally { fs.closeSync(descriptor) }
}

function argumentsFor(argv) {
  const [mode, ...args] = argv
  if (!['precheck', 'export'].includes(mode) || args.length !== 14) throw Error('Invalid arguments')
  const names = { '--key': 'key', '--records': 'records', '--output': 'output', '--run-id': 'runId', '--attempt': 'attempt', '--commit': 'commit', '--kit-commit': 'kitCommit' }
  const options = {}
  for (let index = 0; index < args.length; index += 2) {
    const name = names[args[index]]
    if (!name || Object.hasOwn(options, name) || !args[index + 1]) throw Error('Invalid arguments')
    options[name] = args[index + 1]
  }
  return { mode, options }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { mode, options } = argumentsFor(process.argv.slice(2))
    if (mode === 'precheck') precheck(options)
    else exportRecords(options)
    process.stdout.write('Release records protection verified.\n')
  } catch {
    process.stderr.write('Release records protection failed.\n')
    process.exitCode = 1
  }
}
