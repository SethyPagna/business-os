const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

// Execute the actual restore and scanner, sharing the existing binding fixture.
function fixture(sourceOverride) {
  const file = path.join(__dirname, 'test-backup-pure.cjs')
  const source = fs.readFileSync(file, 'utf8')
  const load = name => name === 'fs' && sourceOverride ? {
    ...fs,
    readFileSync: (file, ...args) => String(file).replaceAll('\\', '/').endsWith('/src/lib/backup.ts')
      ? sourceOverride : fs.readFileSync(file, ...args),
  } : require(name)
  return new Function('require', '__dirname', source.slice(0, source.indexOf('let passed = 0'))
    + '\nreturn {backup:backupModuleObj.exports,makeFakeD1,makeFakeR2,makeFakeKV}')(load, __dirname)
}
const current = fixture()
const key = 'backups/cloudflare/source-pinning.json'
const document = value => JSON.stringify({
  format: 'business-os-cloudflare-backup', formatVersion: 1, createdAt: '2026-09-20T00:00:00Z',
  source: 'manual', runtime: 'cloudflare-workers',
  tables: { settings: { columns: ['key', 'value'], rows: [{ key: 'proof', value }] } },
  r2: { assets: [], copiedKeys: [] }, summary: { tableCount: 1, rowCount: 1, assetCount: 0, assetsBackedUp: 0 },
})
async function run(options = {}, implementation = current) {
  const schema = { settings: { columns: ['key', 'value'], rows: [{ key: 'proof', value: 'LIVE' }] } }
  const env = { DB: implementation.makeFakeD1(schema), ASSETS: implementation.makeFakeR2({
    [key]: { body: options.truncated ? document('VALIDATED').slice(0, -3) : document('VALIDATED') },
  }), CACHE: implementation.makeFakeKV() }
  let reads = 0, deletes = 0, cancelled = 0
  const progress = [], calls = []
  const prepare = env.DB.prepare.bind(env.DB)
  env.DB.prepare = sql => {
    const stmt = prepare(sql)
    if (sql.startsWith('DELETE ')) { const exec = stmt.run; stmt.run = async () => { deletes++; return exec() } }
    return stmt
  }
  const get = env.ASSETS.get.bind(env.ASSETS)
  env.ASSETS.get = async (requested, params) => {
    if (requested !== key) return get(requested, params)
    reads++; calls.push(params)
    if (reads === 2) {
      if (options.replace) await env.ASSETS.put(key, document(options.replace === 'same' ? 'VALIDATED' : 'REPLACEMENT'))
      if (options.deleted) await env.ASSETS.delete(key)
    }
    const response = await get(requested, params)
    if (!response) return response
    if (options.metadata && reads === (options.pass || 2)) Object.assign(response, options.metadata)
    if (options.noBody && reads === 2) delete response.body
    if (response.body) {
      const reader = response.body.getReader()
      response.body = new ReadableStream({
        async pull(controller) {
          if (options.readError && reads === 2) { controller.error(new Error('stream failed')); return }
          const part = await reader.read()
          if (part.done) controller.close(); else controller.enqueue(part.value)
        },
        async cancel(reason) { cancelled++; await reader.cancel(reason) },
      }, { highWaterMark: 0 })
    }
    return response
  }
  let error
  try {
    await implementation.backup.restoreCloudflareBackup(env, key, async event => {
      progress.push(event.phase)
      if (event.phase === 'deleting') {
        if (options.heldOverwrite) await env.ASSETS.put(key, document('REPLACEMENT'))
        if (options.callbackError) throw new Error('admission failed')
      }
    })
  } catch (caught) { error = caught }
  return { schema, reads, deletes, cancelled, progress, calls, error }
}
async function main() {
  const oldSource = execFileSync('git', ['show', '3a71661f:cloudflare/src/lib/backup.ts'], { cwd: path.join(__dirname, '../..'), encoding: 'utf8' })
  const negative = await run({ replace: 'changed' }, fixture(oldSource))
  assert.equal(negative.error, undefined)
  assert.equal(negative.schema.settings.rows[0].value, 'REPLACEMENT', 'old actual implementation must reproduce substitution')
  let cases = 0
  for (const options of [
    { replace: 'changed' }, { replace: 'same' }, { deleted: true }, { noBody: true },
    ...[{ key: 'other' }, { etag: '' }, { version: '' }, { version: 'new-version' }, { size: 1 }, { size: NaN }, { size: Number.MAX_SAFE_INTEGER + 1 }].map(metadata => ({ metadata })),
    ...[{ etag: '' }, { version: '' }, { size: 0 }, { key: 'other' }].map(metadata => ({ metadata, pass: 1 })),
    { truncated: true },
  ]) {
    const result = await run(options)
    assert(result.error, JSON.stringify(options))
    assert.equal(result.deletes, 0, 'mismatch must precede all DELETEs')
    assert.deepEqual(result.progress, [], 'mismatch must precede destructive callbacks')
    assert.equal(result.schema.settings.rows[0].value, 'LIVE')
    assert(result.reads <= 2, 'never retry without a source pin')
    cases++
  }
  for (const options of [{}, { heldOverwrite: true }]) {
    const result = await run(options)
    assert.equal(result.error, undefined)
    assert.equal(result.schema.settings.rows[0].value, 'VALIDATED')
    assert.equal(result.reads, 2)
    assert.equal(typeof result.calls[1].onlyIf.etagMatches, 'string')
    cases++
  }
  const stopped = await run({ callbackError: true })
  assert.match(stopped.error.message, /admission failed/)
  assert.equal(stopped.deletes, 0)
  assert(stopped.cancelled > 0, 'held response must be cancelled on callback failure')
  const broken = await run({ readError: true })
  assert.match(broken.error.message, /stream failed/)
  assert.equal(broken.deletes, 1, 'mid-stream failures propagate after destructive work; route retains maintenance')
  console.log(`PASS backup source pin: ${cases + 2} cases and actual old-source negative control`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
