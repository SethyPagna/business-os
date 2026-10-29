'use strict'
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { createHash } = require('node:crypto'), { createRequire } = require('node:module')
const cf = path.resolve(__dirname, '..'), ANALYTICS = 'src/lib/salesAnalytics.ts'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n/g, '\n')
const workerFile = path.join(__dirname, 'harness/report-scalar-bound-worker.ts')
const workerBytes = fs.readFileSync(workerFile), workerSource = decode(workerBytes)
const controlGolden = [
  'function reportSqlScalarUpper(expression: string): string {',
  '  return `CASE typeof(${expression}) WHEN \'null\' THEN 4 WHEN \'integer\' THEN 32 WHEN \'real\' THEN 32',
  '    WHEN \'text\' THEN 2+6*length(CAST(${expression} AS BLOB)) WHEN \'blob\' THEN 2+4*length(${expression})',
  '    ELSE json_extract(\'[1]\',\'$[report_totals_storage]\') END`',
  '}'
].join('\n')
const local = createRequire(path.join(cf, 'package.json')), { build } = local('esbuild'), { Miniflare, Log, LogLevel } = local('miniflare')
const loaded = new Map(), missing = new Set(), sourceHashes = {}, observations = [], receipts = [], issues = [], kills = {}, supported = [], unsupported = []
const exportOnly = '\nexport const __reportScalarForNative: (expression: string, rowKind?: "data" | "control") => string = reportSqlScalarUpper\n'
function shown(relative) {
  if (missing.has(relative)) return null
  if (!loaded.has(relative)) {
    const file = path.resolve(cf, relative)
    if (!file.startsWith(cf + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { missing.add(relative); return null }
    const bytes = fs.readFileSync(file), body = decode(bytes)
    loaded.set(relative, { file, bytes, body }); sourceHashes[relative] = { raw: sha(bytes), lf: sha(Buffer.from(body)) }
  }
  return loaded.get(relative).body
}
const plugin = { name: 'actual-source-scalar-exports-only', setup(builder) {
  builder.onResolve({ filter: /^scalar:old$/ }, () => ({ path: 'control-golden', namespace: 'control-golden' }))
  builder.onLoad({ filter: /.*/, namespace: 'control-golden' }, () => ({ contents: controlGolden + exportOnly, loader: 'ts' }))
  builder.onResolve({ filter: /^scalar:candidate$/ }, () => ({ path: 'src/lib/salesAnalytics', namespace: 'current-source' }))
  builder.onResolve({ filter: /^\.\.?\//, namespace: 'current-source' }, args => ({ path: path.posix.normalize(path.posix.join(path.posix.dirname(args.importer), args.path)), namespace: 'current-source' }))
  builder.onLoad({ filter: /.*/, namespace: 'current-source' }, args => {
    for (const suffix of ['.ts', '/index.ts', '.json', '']) {
      const relative = args.path + suffix, body = shown(relative)
      if (body === null) continue
      return { contents: body + (relative === ANALYTICS ? exportOnly : ''), loader: relative.endsWith('.json') ? 'json' : 'ts', resolveDir: cf }
    }
    throw new Error('Missing current source ' + args.path)
  })
} }
const cases = []
const sqlCase = (name, sql, kind, observation = false) => cases.push({ name, sql, kind, observation })
const textCase = (name, text) => cases.push({ name, text, kind: 'text', observation: false })
sqlCase('null', 'NULL', 'null')
const integers = new Set(['0', '1', '-1', '9223372036854775807', '-9223372036854775808', '9007199254740991', '9007199254740992', '9007199254740993', '-9007199254740991', '-9007199254740992', '-9007199254740993'])
for (let power = 0; power <= 18; power++) { const digits = '1' + '0'.repeat(power); integers.add(digits); integers.add('-' + digits) }
for (const value of integers) sqlCase('integer:' + value, `CAST('${value}' AS INTEGER)`, 'integer')
for (const value of ['0.0', '-0.0', '0.1', '-0.1', '1.5', '-1.5', '1e20', '-1e20', '1e21', '-1e21', '1e-24', '5e-324', '1.7976931348623157e308', '-1.7976931348623157e308']) sqlCase('real:' + value, `CAST('${value}' AS REAL)`, 'real')
for (const value of ['1e999', '-1e999']) sqlCase('real-observation:' + value, `CAST('${value}' AS REAL)`, 'real', true)
for (const hex of ['', '00', 'ff', '00225c7f80ff', Array.from({ length: 256 }, (_, n) => n.toString(16).padStart(2, '0')).join(''), '00ff'.repeat(1024)]) cases.push({ name: 'blob:' + hex.length / 2, sql: `X'${hex}'`, kind: 'blob', expectedHex: hex, observation: false })
textCase('printable:empty', '')
for (let code = 32; code <= 126; code++) textCase('printable:' + code.toString(16), String.fromCharCode(code))
textCase('printable:all', Array.from({ length: 95 }, (_, index) => String.fromCharCode(index + 32)).join(''))
textCase('printable:mixed-escapes', 'plain "quoted" \\ path \\" more')
for (let code = 0; code <= 31; code++) textCase('control:' + code.toString(16), String.fromCharCode(code))
textCase('control:7f', '\x7f')
textCase('control:all', Array.from({ length: 32 }, (_, index) => String.fromCharCode(index)).join(''))
textCase('nul:long-hidden-controls', 'prefix\0' + '\x01'.repeat(4096))
textCase('nul:long-hidden-quotes', 'prefix\0' + '"\\'.repeat(4096))
textCase('nul:trailing', 'ordinary-tail\0')
for (const [name, value] of Object.entries({ khmer: '\u1781\u17d2\u1798\u17c2\u179a', cjk: '\u4e2d\u6587\u6f22\u5b57', emoji: String.fromCodePoint(0x1f600, 0x1f469, 0x200d, 0x1f4bb), separators: '\u2028\u2029', combining: 'e\u0301', unicodeAndEscapes: '\u1781"\\\u4e2d\n' })) textCase('unicode:' + name, value)
for (const hex of ['c0af', 'c080', 'c0a0', 'e282', 'f09f98', 'eda080', 'f4908080', '6100ff0101']) sqlCase('invalid-utf8:' + hex, `CAST(X'${hex}' AS TEXT)`, 'text', true)
for (let byte = 0x80; byte <= 0xff; byte++) { const hex = byte.toString(16); sqlCase('invalid-utf8:standalone:' + hex, `CAST(X'${hex}' AS TEXT)`, 'text', true) }
function issue(name, detail) { issues.push({ name, detail }) }
let mf, final, bundleHash, stage = 'source-bundle', disposed = false
async function main() {
  const bundle = await build({ stdin: { contents: workerSource, resolveDir: cf, loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'], plugins: [plugin], logLevel: 'error' })
  const bundleText = bundle.outputFiles[0].text
  bundleHash = sha(Buffer.from(bundleText))
  assert.ok(sourceHashes[ANALYTICS], 'The actual current scalar helper must be loaded')
  stage = 'native-open'
  mf = new Miniflare({ modules: true, script: bundleText, compatibilityDate: '2026-07-01', compatibilityFlags: ['nodejs_compat'], host: '127.0.0.1', port: 0, d1Databases: ['DB'], d1Persist: false, cachePersist: false, outboundService: () => new Response('No external network', { status: 503 }), log: new Log(LogLevel.ERROR) })
  await mf.ready
  const db = await mf.getD1Database('DB')
  stage = 'schema'
  assert.equal((await db.prepare('CREATE TABLE scalar_values(id INTEGER PRIMARY KEY,v)').run()).success, true)
  for (let index = 0; index < cases.length; index++) {
    const item = cases[index], id = index + 1
    stage = 'setup:' + item.name
    let setup
    try { setup = await db.prepare(`INSERT INTO scalar_values(id,v) VALUES(?,${Object.hasOwn(item, 'text') ? '?' : item.sql})`).bind(...(Object.hasOwn(item, 'text') ? [id, item.text] : [id])).run() }
    catch (error) { unsupported.push({ id, name: item.name, stage: 'setup', error: String(error?.stack || error), native_meta: null, observation: item.observation }); continue }
    receipts.push({ stage: 'setup', id, name: item.name, setup })
    if (setup.success !== true) { issue('setup-native-success', { id, setup }); continue }
    for (let expression = 0; expression < 3; expression++) {
      stage = 'select:' + item.name + ':' + expression
      const response = await mf.dispatchFetch('http://scalar.local/probe', { method: 'POST', body: JSON.stringify({ id, expression }) })
      const raw = await response.text()
      receipts.push({ stage: 'select', id, name: item.name, expression, response_status: response.status, raw })
      assert.equal(response.status, 200, raw)
      const result = JSON.parse(raw)
      if (result.generated) for (const mode of ['oldExtraData', 'default', 'control']) if (result.generated[mode] !== result.generated.old) issue('control-sql-changed', { id, expression, mode })
      if (!result.ok) { unsupported.push({ id, name: item.name, expression, observation: item.observation, result }); continue }
      supported.push({ id, name: item.name, expression, observation: item.observation })
      if (result.storage_type !== item.kind) issue('storage-kind', { id, expression, actual: result.storage_type, expected: item.kind })
      if (Object.hasOwn(item, 'text') && JSON.parse(result.actual.json) !== item.text) issue('text-roundtrip', { id, expression })
      if (item.kind === 'blob' && result.actual.binary_hex !== item.expectedHex) issue('blob-roundtrip', { id, expression, actual: result.actual.binary_hex })
      const bytes = result.actual.utf8_bytes
      for (const mode of ['old', 'oldExtraData', 'default', 'control', 'data']) {
        const bound = result.bounds[mode]
        if (!Number.isSafeInteger(bound) || bound < bytes) issue('unsafe-' + mode, { id, expression, bytes, bound })
      }
      if (result.bounds.data > result.bounds.old) issue('data-not-refinement', { id, expression })
      if (item.name.startsWith('printable:') && bytes !== result.bounds.data) issue('ascii-not-exact', { id, expression, bytes, bound: result.bounds.data })
      for (const mode of ['noNul', 'text2', 'integer19', 'ascii1', 'noQuote', 'noSlash']) {
        const bound = result.bounds[mode]
        if (!Number.isSafeInteger(bound)) issue('wrong-bound-protocol', { id, expression, mode, bound })
        else if (bound < bytes) (kills[mode] ??= []).push({ id, name: item.name, expression, bytes, bound, observation: item.observation })
      }
      observations.push({ id, expression, name: item.name, storage_type: result.storage_type, actual: result.actual, bounds: result.bounds, native_meta: result.native_meta, observation: item.observation })
    }
  }
  const requiredKill = (mode, predicate) => { if (!(kills[mode] || []).some(row => !row.observation && predicate(row))) issue('control-not-killed', { mode }) }
  requiredKill('noNul', row => row.name.startsWith('nul:') || row.name === 'control:0')
  requiredKill('text2', row => row.name.startsWith('control:'))
  requiredKill('integer19', row => row.name.startsWith('integer:'))
  for (const mode of ['ascii1', 'noQuote']) requiredKill(mode, row => row.name === 'printable:22')
  for (const mode of ['ascii1', 'noSlash']) requiredKill(mode, row => row.name === 'printable:5c')
  for (const mode of ['ascii1', 'noQuote', 'noSlash']) requiredKill(mode, row => row.name === 'printable:mixed-escapes')
  const plain = observations.find(row => row.name === 'printable:41' && row.expression === 0)
  if (!plain || ['noNul', 'text2', 'integer19', 'ascii1', 'noQuote', 'noSlash'].some(mode => plain.bounds[mode] < plain.actual.utf8_bytes)) issue('plain-ascii-positive-control', { plain })
  const ordinaryUnsupported = unsupported.filter(row => !row.observation)
  const expectedOrdinary = cases.filter(row => !row.observation).length * 3
  if (supported.filter(row => !row.observation).length !== expectedOrdinary) issue('ordinary-coverage-incomplete', { expectedOrdinary, ordinaryUnsupported })
  for (const [relative, source] of loaded) assert.ok(source.bytes.equals(fs.readFileSync(source.file)), 'Source changed during scalar test: ' + relative)
  assert.ok(workerBytes.equals(fs.readFileSync(workerFile)), 'Worker source changed during scalar test')
  final = { status: issues.length ? (ordinaryUnsupported.length ? 'INCOMPLETE_UNSUPPORTED_REQUIRED_CASES' : 'FAIL_SCALAR_OR_CONTROL_PROOF') : unsupported.length ? 'PASS_ORDINARY_WITH_UNSUPPORTED_OBSERVATIONS' : 'PASS_NATIVE_SCALAR_BOUND_PROOF', cases: cases.length, expressions: 3, supported: supported.length, expectedOrdinary, unsupported: unsupported.length, issues: issues.length, controls: Object.fromEntries(Object.entries(kills).map(([mode, rows]) => [mode, { count: rows.length, representative: rows[0] }])), representativeIssues: issues.slice(0, 8), representativeUnsupported: unsupported.slice(0, 4), scope: 'Actual native scalar value JSON only; no financial,32MiB/coherence/CPU/peak/provider/Free readiness claim.' }
}
main().catch(error => { final = { status: 'HARNESS_FAILURE', stage, error: String(error?.stack || error), supported: supported.length, unsupported: unsupported.length, issues: issues.length, representativeIssues: issues.slice(0, 8), representativeUnsupported: unsupported.slice(0, 4) }; process.exitCode = 1 }).finally(async () => {
  try { if (mf) { stage = 'dispose'; await mf.dispose(); disposed = true } }
  catch (error) { final = { status: 'DISPOSAL_FAILURE', error: String(error?.stack || error) }; process.exitCode = 1 }
  if (final && !final.status.startsWith('PASS')) process.exitCode = 1
  console.log(JSON.stringify({ ...final, disposed, node: process.version, source: sourceHashes[ANALYTICS], loadedSources: loaded.size, sourceBindingsSha256: sha(Buffer.from(JSON.stringify(sourceHashes))), controlGoldenSha256: sha(Buffer.from(controlGolden)), workerRawSha256: sha(workerBytes), workerLfSha256: sha(Buffer.from(workerSource)), bundleSha256: bundleHash, observationsSha256: sha(Buffer.from(JSON.stringify(observations))), receiptsSha256: sha(Buffer.from(JSON.stringify(receipts))) }))
})
