// Local workerd D1 read accounting and the actual streaming backup writer.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')
const root = path.resolve(__dirname, '..')
const PAGE = 500
const TABLES = ['settings', 'units', 'import_stock_action_commits', 'audit_logs']

async function main() {
  const source = fs.readFileSync(path.join(root, 'src/lib/backup.ts'), 'utf8')
  assert.match(source, /const TABLE_PAGE_SIZE = 500\b/)
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
    import { createSectionBackup, createCloudflareBackup } from './src/lib/backup.ts';
    export default { async fetch(request, bindings) {
      const input = await request.json(), raw = bindings.DB;
      let reads = 0, writes = 0, pages = 0;
      function measure(result) {
        reads += result.meta?.rows_read || 0;
        writes += result.meta?.rows_written || 0;
        return result;
      }
      function wrap(sql, statement) {
        return {
          bind(...values) { return wrap(sql, statement.bind(...values)); },
          async all() {
            const result = measure(await statement.all());
            if (/FROM "audit_logs".*ORDER BY rowid LIMIT/.test(sql)) {
              pages++;
              if (pages === 1) for (const mutation of input.mutate || []) await raw.prepare(mutation).run();
            }
            return result;
          },
          async first(column) {
            const result = measure(await statement.all());
            return column ? result.results[0]?.[column] ?? null : result.results[0] ?? null;
          },
          async run() { return measure(await statement.run()); },
          inner: statement,
        };
      }
      const env = { ...bindings, BACKUP_QUEUE: undefined,
        DB: { prepare(sql) { return wrap(sql, raw.prepare(sql)); },
          async batch(items) { return (await raw.batch(items.map(i => i.inner))).map(measure); } } };
      const result = input.full
        ? await createCloudflareBackup(env, 'scheduled')
        : await createSectionBackup(env, input.tables || ${JSON.stringify(TABLES)});
      const text = await (await bindings.ASSETS.get(result.key)).text();
      return Response.json({ text, reads, writes, pages });
    }}
  ` }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022' })
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01',
    d1Databases: ['DB'], r2Buckets: ['ASSETS'], kvNamespaces: ['CACHE'], log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    const migrationDir = path.join(root, 'migrations')
    for (const name of fs.readdirSync(migrationDir).filter(n => n.endsWith('.sql')).sort()) {
      for (const sql of split(fs.readFileSync(path.join(migrationDir, name), 'utf8'))) {
        if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim())) continue
        try { await db.prepare(sql).run() } catch (error) { throw new Error(name + ': ' + error.message) }
      }
    }
    const tableNames = [...source.match(/export const BACKUP_TABLES = \[([\s\S]*?)\] as const/)[1]
      .replace(/\/\/.*$/gm, '').matchAll(/'([^']+)'/g)].map(m => m[1])
    const withoutRowid = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE '%WITHOUT ROWID%'").all()).results.map(r => r.name)
    assert.deepEqual(tableNames.filter(t => withoutRowid.includes(t)), [])
    assert.ok(withoutRowid.length > 0, 'schema probe sees the WITHOUT ROWID FTS shadow tables')
    for (const table of tableNames) {
      const columns = (await db.prepare(`PRAGMA table_info("${table}")`).all()).results.map(r => r.name)
      assert.ok(!columns.includes('rowid'), `${table}: rowid must refer to the SQLite cursor`)
    }
    console.log('PASS every backed-up table supports the rowid cursor')

    const seedAudit = async count => {
      await db.prepare('DELETE FROM audit_logs').run()
      await db.prepare(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?)
        INSERT INTO audit_logs(id, user_name, action, entity, entity_id, details, created_at)
        SELECT n, 'user ផលិតផល', 'act', 'ent', CAST(n AS TEXT),
          CASE WHEN n % 3 = 0 THEN 'line "one"' || char(10) || 'line two' ELSE NULL END,
          '2026-09-01 00:00:00' FROM seq`).bind(count).run()
    }
    const offsetDump = async (table, mutate = []) => {
      const rows = []
      let reads = 0
      for (let offset = 0; ; offset += PAGE) {
        const page = await db.prepare(`SELECT * FROM "${table}" ORDER BY rowid LIMIT ? OFFSET ?`).bind(PAGE, offset).all()
        reads += page.meta.rows_read
        rows.push(...page.results)
        if (offset === 0) for (const sql of mutate) await db.prepare(sql).run()
        if (page.results.length < PAGE) break
      }
      return { rows, reads }
    }
    const run = async (input = {}) => {
      const response = await mf.dispatchFetch('http://local.test/', { method: 'POST', body: JSON.stringify(input) })
      assert.equal(response.status, 200, await response.clone().text())
      return response.json()
    }
    const costs = []
    for (const count of [5000, 10000]) {
      await seedAudit(count)
      const old = await offsetDump('audit_logs')
      const current = await run({ tables: ['audit_logs'] })
      assert.deepEqual(JSON.parse(current.text).tables.audit_logs.rows, old.rows)
      assert.equal(current.writes, 0, 'backup performs no D1 writes')
      costs.push({ count, offsetReads: old.reads, backupReads: current.reads })
    }
    console.log('Local D1 measured rows_read:', JSON.stringify(costs))
    assert.ok(costs[1].offsetReads > 3 * costs[0].offsetReads, 'OFFSET positive control grows faster than the data')
    assert.ok(costs[1].backupReads <= 2.1 * costs[0].backupReads, 'backup reads must grow linearly when rows double')
    assert.ok(costs[1].backupReads < 2 * costs[1].count, 'backup must not re-read all prior pages')
    console.log('PASS backup read cost grows linearly; OFFSET control grows quadratically')

    await seedAudit(1300)
    await db.prepare('DELETE FROM audit_logs WHERE id % 7 = 0 OR id BETWEEN 480 AND 530').run()
    await db.prepare("INSERT INTO audit_logs(id, action, entity) VALUES (-2, 'negative', 'ent'), (0, 'zero', 'ent')").run()
    await db.prepare("INSERT INTO settings(key, value) VALUES ('zeta', 'z'), ('alpha', 'a'), ('mid', 'm')").run()
    await db.prepare("DELETE FROM settings WHERE key = 'alpha'").run()
    await db.prepare('ALTER TABLE settings ADD COLUMN "__bos_rowid" TEXT').run()
    await db.prepare("UPDATE settings SET __bos_rowid = 'keep this value' WHERE key = 'zeta'").run()
    await db.prepare('DELETE FROM units').run()
    await db.prepare("INSERT INTO import_stock_action_commits(job_id, action_key, action_kind) VALUES ('z', 'a', 'test'), ('a', 'z', 'test')").run()
    const quiet = await run()
    const doc = JSON.parse(quiet.text)
    for (const table of TABLES) {
      const old = await offsetDump(table)
      assert.deepEqual(doc.tables[table].rows, old.rows, `${table}: exact data and order`)
      assert.ok(quiet.text.includes('"rows":[' + old.rows.map(row => JSON.stringify(row)).join(',') + ']'), `${table}: identical serialized row bytes`)
      const columns = (await db.prepare(`PRAGMA table_info("${table}")`).all()).results.map(r => r.name)
      assert.deepEqual(doc.tables[table].columns, columns)
    }
    assert.equal(doc.tables.units.rows.length, 0)
    assert.equal(doc.tables.audit_logs.rows[0].id, -2)
    assert.ok(doc.tables.audit_logs.rows.every(row => !Object.hasOwn(row, '__bos_rowid')))
    assert.equal(doc.tables.settings.rows.find(row => row.key === 'zeta').__bos_rowid, 'keep this value')
    assert.ok(doc.tables.settings.rows.every(row => !Object.hasOwn(row, '__bos_rowid_')))
    const full = JSON.parse((await run({ full: true })).text)
    for (const table of TABLES) assert.deepEqual(full.tables[table], doc.tables[table], `full scheduled backup preserves ${table}`)
    console.log('PASS full/scoped exact contents, columns and order: gaps, negative/zero rowid, TEXT/composite keys, empty table')

    const before = doc.tables.audit_logs.rows.map(row => row.id)
    const mutation = ["DELETE FROM audit_logs WHERE id = 10", "INSERT INTO audit_logs(id, action, entity) VALUES (5000, 'late', 'ent')"]
    const busy = await run({ mutate: mutation })
    assert.deepEqual(JSON.parse(busy.text).tables.audit_logs.rows.map(row => row.id), before)
    await db.prepare('DELETE FROM audit_logs WHERE id = 5000').run()
    await db.prepare("INSERT INTO audit_logs(id, action, entity) VALUES (10, 'restored', 'ent')").run()
    const old = await offsetDump('audit_logs', [mutation[0]])
    assert.equal(before.filter(id => !old.rows.some(row => row.id === id)).length, 1, 'OFFSET skips one live row under the same deletion')
    console.log('PASS deletion cannot shift the next page; inserts beyond captured bound excluded; OFFSET loses one live row')
  } finally {
    await mf.dispose()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
