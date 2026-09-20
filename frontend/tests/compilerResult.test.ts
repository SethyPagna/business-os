import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'

const { unusedCompilerDiagnostics } = createRequire(import.meta.url)('../../ops/scripts/lib/compiler-result.cjs')
const clean = { status: 0, signal: null, stdout: '', stderr: '' }
assert.deepEqual(unusedCompilerDiagnostics(clean), [])
for (const code of [6133, 6138, 6192, 6196, 6198, 6199]) {
  const line = `src/example.ts(2,3): error TS${code}: Unused declaration.`
  assert.deepEqual(unusedCompilerDiagnostics({ ...clean, status: 1, stdout: line + '\r\n' }), [line])
  assert.deepEqual(unusedCompilerDiagnostics({ ...clean, status: 2, stdout: line + '\n' }), [line])
  assert.throws(() => unusedCompilerDiagnostics({ ...clean, stdout: line }), /Inconsistent/)
}
for (const result of [
  { ...clean, error: new Error('spawn ENOENT') },
  { ...clean, error: new Error('output maxBuffer exceeded'), status: 1 },
  { ...clean, signal: 'SIGTERM' },
  { ...clean, status: null },
  { ...clean, status: 2 },
  { ...clean, status: 3 },
  { ...clean, status: 1 },
  { ...clean, stdout: null },
  { ...clean, stderr: 'compiler startup failure' },
  { ...clean, status: 1, stdout: 'src/a.ts(1,1): error TS2322: Type mismatch.' },
  { ...clean, status: 1, stdout: 'src/a.ts(1,1): error TS6133: Unused.\nerror TS5023: Unknown option.' },
  { ...clean, status: 1, stdout: 'could not launch compiler' },
]) assert.throws(() => unusedCompilerDiagnostics(result))

// Real child-process negative controls: the old count-only gate accepted both
// as zero unused diagnostics. Neither may become a successful budget scan.
const missing = spawnSync(path.join(os.tmpdir(), `missing-tsc-${randomUUID()}`), [], { encoding: 'utf8' })
assert.ok(missing.error)
assert.throws(() => unusedCompilerDiagnostics(missing), /failed to start or complete/)
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const unexpected = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--pretty', 'false', '--not-a-real-compiler-option'], { cwd: root, encoding: 'utf8' })
assert.equal(unexpected.error, undefined)
assert.match(unexpected.stdout, /error TS5023:/)
assert.throws(() => unusedCompilerDiagnostics(unexpected), /Unexpected compiler/)
const missingScript = spawnSync(process.execPath, [path.join(os.tmpdir(), `missing-tsc-${randomUUID()}.js`)], { encoding: 'utf8' })
assert.throws(() => unusedCompilerDiagnostics(missingScript), /Unexpected compiler stderr/)
console.log('PASS strict compiler results: allowed unused diagnostics, exit/output parity, missing executable/script, unexpected TS error, startup failure and signals')
