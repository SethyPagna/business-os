// A wrong browser flag must never block a write the server would accept (navigator.onLine is only a hint), and a real outage
// must still block. This sweeps every navigator.onLine read in frontend/src:
//   - a read that can REFUSE a write must also ask confirmServerReachable() (or sit behind the server-health flag);
//   - the rest are named here with why they are not write refusals, so a new refusal cannot slip in unnoticed.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('../src', import.meta.url))
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

// File -> why its navigator.onLine reads are not write refusals.
const NOT_A_WRITE_REFUSAL: Record<string, string> = {
  'api/websocket.ts': 'the socket does not connect while the browser says offline; the HTTP probe is what decides saving',
  'index.tsx': 'skips a service-worker update check',
  'utils/lazyImport.ts': 'skips a chunk retry',
  'App.tsx': 'skips a chunk-recovery reload',
  'AppContext.tsx': 'the flag reader: it only seeds the probe in watchConnection',
  'utils/connectionWatch.ts': 'comment',
  'public-runtime/service-worker.ts': 'comment',
  'api/http.ts': 'server-health guards (need _serverOnline false as well, which a good probe clears), read fallbacks, the confirmServerReachable doc',
}

const reads: Array<{ file: string; line: string }> = []
for (const path of walk(src)) {
  const file = relative(src, path).replace(/\\/g, '/')
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (/\bnavigator\??\.onLine\b/.test(line)) reads.push({ file, line: line.trim() })
  }
}

const results: Array<[string, () => void]> = [
  ['every navigator.onLine read that can refuse a write also asks the server', () => {
    const offenders = reads.filter(({ file, line }) => !(file in NOT_A_WRITE_REFUSAL) && !/confirmServerReachable|api\.confirmServerReachable/.test(line))
    assert.deepEqual(offenders, [], 'a write must ask confirmServerReachable() before refusing on the browser flag')
  }],
  ['the writes that used to refuse on the flag alone are all still guarded, and by the server ask', () => {
    for (const file of ['api/returnsTransport.ts', 'api/salesTransport.ts', 'api/saleWriteTransport.ts', 'utils/actionHistory.ts']) {
      const own = reads.filter((read) => read.file === file)
      assert.ok(own.length >= 1, `${file} still guards its writes`)
      assert.ok(own.every((read) => /confirmServerReachable/.test(read.line)), `${file}: every read asks the server`)
    }
    assert.equal(reads.filter((read) => read.file === 'api/returnsTransport.ts').length, 3)
    assert.equal(reads.filter((read) => read.file === 'api/salesTransport.ts').length, 2)
  }],
  ['the UI no longer decides on the browser flag: ActionHistoryBar and ResolveModal read nothing from navigator', () => {
    assert.deepEqual(reads.filter((read) => ['components/shared/ActionHistoryBar.tsx', 'components/shared/ResolveModal.tsx'].includes(read.file)), [])
  }],
  ['the server-health guards in http.ts only refuse when the server is marked down too', () => {
    const guards = reads.filter((read) => read.file === 'api/http.ts' && /if \(/.test(read.line) && /onLine === false\) \{/.test(read.line))
    assert.ok(guards.length >= 2)
    assert.ok(guards.every((read) => /!_serverOnline &&/.test(read.line)), 'a good /health probe (which marks the server up) clears them')
  }],
]

let failed = 0
for (const [name, run] of results) {
  try { run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}
if (failed) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nnoBrowserFlagWriteRefusal: all checks passed')
