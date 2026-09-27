// Keyset backup paging on local workerd D1 + R2 (every migration applied).
// No remote access.
//
// The writer used to page each table with LIMIT/OFFSET: every page re-walked
// all earlier rows (quadratic in table size) and a row deleted from an
// already-written page shifted the next page so one LIVE row was silently
// skipped. It now captures every table's MAX(rowid) in one batch before the
// first row and pages with a rowid cursor up to that bound.
//
// This proves, against the real createSectionBackup:
//   1. byte-identity: each table's serialized rows equal what the old
//      OFFSET algorithm emits for the same data (rowid gaps, >2 pages,
//      a TEXT-primary-key table, an empty table);
//   2. a row deleted mid-dump costs only that row -- every other row is kept
//      (positive control: the OFFSET algorithm under the same delete loses a
//      live row, so the fixture can tell the two apart);
//   3. a row inserted mid-dump beyond the captured bound is not included;
//   4. the r2.bucket label comes from ASSETS_BUCKET_NAME, which equals the
//      ASSETS bucket_name in BOTH wrangler files;
//   5. no BACKUP_TABLES entry is WITHOUT ROWID (the cursor needs a rowid).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')
const root = path.resolve(__dirname, '..')

const PAGE = 500 // lib/backup.ts TABLE_PAGE_SIZE
const TABLES = ['settings', 'units', 'audit_logs']

async function main() {
  const backupSource = fs.readFileSync(path.join(root, 'src', 'lib', 'backup.ts'), 'utf8')
  assert.match(backupSource, /const TABLE_PAGE_SIZE = 500\b/, 'fixture sizes assume a 500-row page')

  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
    import { createSectionBackup } from './src/lib/backup.ts';
    function wrapStatement(statement, onAll) {
      return {
        bind(...args) { return wrapStatement(statement.bind(...args), onAll) },
        async all() { const result = await statement.all(); await onAll(); return result },
        first(...a) { return statement.first(...a) },
        run() { return statement.run() },
        raw(...a) { return statement.raw(...a) },
        get inner() { return statement },
      };
    }
    export default { async fetch(request, bindings) {
      const input = await request.json();
      const raw = bindings.DB;
      let pageReads = 0, fired = false;
      const onAll = async (sql) => {
        if (!/SELECT rowid AS "__bos_rowid", \\* FROM "audit_logs"/.test(sql)) return;
        pageReads++;
        if (pageReads === 1 && input.mutate && !fired) {
          fired = true;
          for (const s of input.mutate) await raw.prepare(s).run();
        }
      };
      const env = { ...bindings, ASSETS_BUCKET_NAME: input.label, BACKUP_QUEUE: undefined,
        DB: { prepare(sql) { const st = raw.prepare(sql); return wrapStatement(st, () => onAll(sql)) },
              batch(items) { return raw.batch(items.map((i) => i.inner || i)) } } };
      const result = await createSectionBackup(env, input.tables);
      const object = await bindings.ASSETS.get(result.key);
      const text = await object.text();
      await bindings.ASSETS.delete(result.key);
      return Response.json({ text, pageReads });
    }}
  ` }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022' })
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01',
    d1Databases: ['DB'], r2Buckets: ['ASSETS'], log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    const migrationDir = path.join(root, 'migrations')
    for (const name of fs.readdirSync(migrationDir).filter((n) => n.endsWith('.sql')).sort()) {
      for (const sql of split(fs.readFileSync(path.join(migrationDir, name), 'utf8'))) {
        if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim())) continue
        try { await db.prepare(sql).run() } catch (error) { throw new Error(name + ': ' + error.message) }
      }
    }

    // --- 5. no backed-up table is WITHOUT ROWID
    const listMatch = backupSource.match(/export const BACKUP_TABLES = \[([\s\S]*?)\] as const/)
    const backupTables = [...listMatch[1].replace(/\/\/.*$/gm, '').matchAll(/'([^']+)'/g)].map((m) => m[1])
    const withoutRowid = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE '%WITHOUT ROWID%'").all()).results.map((r) => r.name)
    assert.deepEqual(backupTables.filter((t) => withoutRowid.includes(t)), [], 'a WITHOUT ROWID table cannot use the rowid cursor')
    assert.ok(withoutRowid.length > 0, 'positive control: the schema does contain WITHOUT ROWID tables (FTS shadows), so the probe can see one')
    console.log(`PASS no BACKUP_TABLES entry is WITHOUT ROWID (${withoutRowid.length} exist, all FTS shadow tables)`)

    // --- fixture: audit_logs with 1300 rows then gaps (every 7th and a block), settings (TEXT PK)
    const inserts = []
    for (let i = 1; i <= 1300; i++) {
      inserts.push(db.prepare("INSERT INTO audit_logs (id, user_name, action, entity, entity_id, details, created_at) VALUES (?, ?, 'act', 'ent', ?, ?, '2026-09-01 00:00:00')")
        .bind(i, `user ${i} ផលិតផល`, String(i), i % 3 ? null : JSON.stringify({ n: i, text: 'line "one"\nline two' })))
    }
    for (let i = 0; i < inserts.length; i += 100) await db.batch(inserts.slice(i, i + 100))
    await db.prepare('DELETE FROM audit_logs WHERE id % 7 = 0 OR id BETWEEN 480 AND 530').run()
    await db.prepare("INSERT INTO settings (key, value) VALUES ('zeta', 'z'), ('alpha', 'a'), ('mid', 'm')").run()
    await db.prepare('DELETE FROM settings WHERE key = \'alpha\'').run()
    await db.prepare('DELETE FROM units').run()
    const liveCount = (await db.prepare('SELECT COUNT(*) AS n FROM audit_logs').first()).n
    assert.ok(liveCount > 2 * PAGE, 'fixture spans more than two pages')

    // The old algorithm, verbatim in shape: SELECT * ... ORDER BY rowid LIMIT ? OFFSET ?
    const offsetDump = async (table, mutateAfterFirstPage) => {
      const out = []
      let offset = 0, first = true
      for (;;) {
        const rows = (await db.prepare(`SELECT * FROM "${table}" ORDER BY rowid LIMIT ? OFFSET ?`).bind(PAGE, offset).all()).results
        if (first && mutateAfterFirstPage) { for (const s of mutateAfterFirstPage) await db.prepare(s).run(); first = false }
        if (!rows.length) break
        out.push(...rows.map((row) => JSON.stringify(row)))
        if (rows.length < PAGE) break
        offset += PAGE
      }
      return out
    }
    const tableSection = (text, table) => {
      const doc = JSON.parse(text)
      return (doc.tables[table]?.rows || []).map((row) => JSON.stringify(row))
    }
    const rowsText = (text, table) => {
      // Exact bytes of the "rows":[...] array as written by the stream.
      const start = text.indexOf(`${JSON.stringify(table)}:{"columns":`)
      const rowsAt = text.indexOf('"rows":[', start) + '"rows":['.length
      const end = text.indexOf(']}', rowsAt)
      // ']}' can occur inside a string; walk forward until the prefix parses.
      for (let e = end; e !== -1; e = text.indexOf(']}', e + 1)) {
        try { JSON.parse('[' + text.slice(rowsAt, e) + ']'); return text.slice(rowsAt, e) } catch {}
      }
      throw new Error('rows array not found for ' + table)
    }
    const run = async (input) => {
      const response = await mf.dispatchFetch('http://local.test/', { method: 'POST', body: JSON.stringify({ label: 'business-os-assets-apac', tables: TABLES, ...input }) })
      assert.equal(response.status, 200, await response.clone().text())
      return response.json()
    }

    // --- 1. byte identity with the OFFSET algorithm on a quiet database
    const quiet = await run({})
    for (const table of TABLES) {
      const expected = (await offsetDump(table)).join(',')
      assert.equal(rowsText(quiet.text, table), expected, `${table}: keyset rows are byte-identical to OFFSET rows`)
    }
    assert.equal(tableSection(quiet.text, 'audit_logs').length, liveCount)
    assert.equal(tableSection(quiet.text, 'units').length, 0, 'empty table written with no rows')
    assert.ok(!quiet.text.includes('__bos_rowid'), 'the cursor alias never reaches the document')
    assert.ok(quiet.pageReads >= 3, 'audit_logs was read in more than two pages')
    console.log(`PASS byte-identical rows vs OFFSET paging (${liveCount} audit rows with gaps over ${quiet.pageReads} pages, TEXT-PK settings, empty units)`)

    // --- 4. bucket label
    const doc = JSON.parse(quiet.text)
    assert.equal(doc.r2.bucket, 'business-os-assets-apac')
    for (const file of ['wrangler.toml', 'wrangler.free.toml']) {
      const text = fs.readFileSync(path.join(root, file), 'utf8')
      const bucket = text.match(/\[\[r2_buckets\]\]\s*\r?\nbinding = "ASSETS"\r?\nbucket_name = "([^"]+)"/)
      const label = text.match(/^ASSETS_BUCKET_NAME = "([^"]+)"/m)
      assert.ok(bucket && label, `${file}: ASSETS binding and ASSETS_BUCKET_NAME both present`)
      assert.equal(label[1], bucket[1], `${file}: ASSETS_BUCKET_NAME must equal the ASSETS bucket_name`)
    }
    assert.ok(!/'business-os-assets'/.test(backupSource), 'no hard-coded bucket label left in backup.ts')
    assert.ok(!/business-os-assets/.test(fs.readFileSync(path.join(root, 'src', 'routes', 'backups.ts'), 'utf8')), 'no hard-coded bucket label left in routes/backups.ts')
    console.log('PASS r2.bucket label comes from ASSETS_BUCKET_NAME, equal to the ASSETS bucket_name in both wrangler files')

    // --- 2 + 3. delete an already-written row and insert past the bound mid-dump
    const before = new Set(tableSection(quiet.text, 'audit_logs').map((row) => JSON.parse(row).id))
    const victim = 10 // inside the first page, already written when the delete lands
    assert.ok(before.has(victim))
    const mutate = [`DELETE FROM audit_logs WHERE id = ${victim}`,
      "INSERT INTO audit_logs (id, user_name, action, entity, created_at) VALUES (5000, 'late', 'act', 'ent', '2026-09-01 00:00:00')"]
    const busy = await run({ mutate })
    assert.equal(busy.pageReads >= 3, true)
    const after = tableSection(busy.text, 'audit_logs').map((row) => JSON.parse(row).id)
    assert.deepEqual(after, [...before].sort((a, b) => a - b), 'every row live at the start is kept (the victim was already written)')
    assert.ok(!after.includes(5000), 'a row inserted past the captured bound is not included')
    console.log('PASS mid-dump delete loses no other row; mid-dump insert past the bound is excluded')

    // Positive control: the OFFSET algorithm under the same mid-dump delete.
    await db.prepare('DELETE FROM audit_logs WHERE id = 5000').run()
    await db.prepare(`INSERT INTO audit_logs (id, user_name, action, entity, created_at) VALUES (${victim}, 'restored', 'act', 'ent', '2026-09-01 00:00:00')`).run()
    const offsetIds = (await offsetDump('audit_logs', [`DELETE FROM audit_logs WHERE id = ${victim}`])).map((row) => JSON.parse(row).id)
    const skipped = [...before].filter((id) => id !== victim && !offsetIds.includes(id))
    assert.equal(skipped.length, 1, 'OFFSET paging silently skips exactly one live row under the same delete')
    console.log(`PASS positive control: OFFSET paging skips live row ${skipped[0]} under the same delete`)
  } finally {
    await mf.dispose()
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
