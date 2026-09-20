// Actual schema discovery and restore on local workerd D1. No remote access.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')
const root = path.resolve(__dirname, '..')

async function main() {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
    import { discoverRestoreSchema, restoreDependencyError, BACKUP_TABLES, SALE_REPLAY_RESTORE_BUNDLE, restoreCloudflareBackup } from './src/lib/backup.ts';
    export default { async fetch(request, bindings) {
      const input = await request.json();
      if(input.mode === 'overflow') {
        let error=null,query='',names=[];
        const rows=Array.from({length:10001},()=>({table_name:'settings',parent_table:null,fk_id:null,fk_seq:null}));
        const statement={bind(value){names=JSON.parse(value);return statement},all:async()=>({results:rows})};
        try { await discoverRestoreSchema({DB:{prepare(sql){query=sql;return statement}}}) } catch(e){error=e.message}
        return Response.json({error,query,names});
      }
      const raw = input.mode === 'graph' ? bindings.DB : bindings.SMALL;
      const calls = [], events = [];
      const env = {DB:{prepare(sql){calls.push(sql);events.push(sql);return raw.prepare(sql)},batch:items=>raw.batch(items)}};
      if(input.mode === 'graph') {
        const schema = await discoverRestoreSchema(env);
        return Response.json({tables:[...schema.tables],references:schema.references,calls,backupTables:BACKUP_TABLES,bundle:SALE_REPLAY_RESTORE_BUNDLE,
          decisions:input.documents.map(names=>restoreDependencyError(schema,new Set(names)))});
      }
      const key='backups/cloudflare/probe.json';
      let document=JSON.stringify({format:'business-os-cloudflare-backup',formatVersion:1,
        createdAt:'2026-09-20T00:00:00Z',source:'manual',runtime:'cloudflare-workers',tables:input.tables,
        r2:{assets:[],copiedKeys:[]},summary:{schemaMigration:input.migration||null}});
      if(input.mode==='duplicate')document=document.replace('"tables":{','"tables":{"settings":{"columns":["key","value"],"rows":[]},');
      await bindings.ASSETS.put(key,document);
      let reads=0;
      env.ASSETS={get:async(k,options)=>{
        const object=await bindings.ASSETS.get(k,options);
        if(k!==key||!object||!('body' in object))return object;
        reads++;events.push('source-read-'+reads);
        if(reads!==1)return object;
        const body=object.body.pipeThrough(new TransformStream({
          transform(chunk,controller){controller.enqueue(chunk)},
          async flush(){
            if(input.mode==='late-child')await raw.prepare('CREATE TABLE fees(id INTEGER PRIMARY KEY, setting_key TEXT REFERENCES settings(key))').run();
            events.push('pass-one-end');
          }
        }));
        return {key:object.key,etag:object.etag,version:object.version,size:object.size,customMetadata:object.customMetadata,body};
      }};
      let error=null,result=null;
      try { result=await restoreCloudflareBackup(env,key,async p=>events.push('progress-'+p.phase)) } catch(e){error=e.message}
      return Response.json({calls,events,reads,error,result});
    }}
  ` }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', plugins: [{ name: 'private-discovery-test-access', setup(b) {
    b.onLoad({ filter: /[/\\]src[/\\]lib[/\\]backup\.ts$/ }, args => ({ contents: fs.readFileSync(args.path, 'utf8')
      + '\nexport { discoverRestoreSchema, restoreDependencyError };', loader: 'ts' }))
  } }] })
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01',
    d1Databases: ['DB', 'SMALL'], r2Buckets: ['ASSETS'], log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB'), small = await mf.getD1Database('SMALL')
    const migrationDir = path.join(root, 'migrations')
    const migrations = fs.readdirSync(migrationDir).filter(name => name.endsWith('.sql')).sort()
    for (const name of migrations) {
      for (const sql of split(fs.readFileSync(path.join(migrationDir, name), 'utf8'))) {
        // Existing native fixture exception: empty user_alias seed is a no-op,
        // but its compound SELECT exceeds this workerd fixture's term limit.
        if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim())) continue
        try { await db.prepare(sql).run() } catch (error) { throw new Error(name + ': ' + error.message) }
      }
    }
    await db.prepare('CREATE TABLE ct_parent(a TEXT,b TEXT,PRIMARY KEY(a,b))').run()
    await db.prepare('CREATE TABLE ct_child(a TEXT,b TEXT,FOREIGN KEY(a,b) REFERENCES ct_parent(a,b))').run()
    await db.prepare('CREATE TABLE ct_standalone(id INTEGER)').run()
    const request = async input => {
      const response = await mf.dispatchFetch('http://local.test/', { method: 'POST', body: JSON.stringify(input) })
      assert.equal(response.status, 200, await response.clone().text())
      return response.json()
    }
    const initial = await request({ mode: 'graph', documents: [] })
    const names = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()).results.map(r => r.name)
      .filter(name => initial.backupTables.includes(name) || name === 'd1_migrations')
    const oldRows = []
    for (const name of names) {
      const foreign = (await db.prepare('PRAGMA foreign_key_list("' + name.replaceAll('"', '""') + '")').all()).results
      if (!foreign.length) oldRows.push({ table_name: name, parent_table: null, fk_id: null, fk_seq: null })
      for (const row of foreign) oldRows.push({ table_name: name, parent_table: row.table, fk_id: row.id, fk_seq: row.seq })
    }
    const sort = rows => rows.slice().sort((a,b) => a.table_name.localeCompare(b.table_name) || (a.fk_id ?? -1)-(b.fk_id ?? -1) || (a.fk_seq ?? -1)-(b.fk_seq ?? -1))
    const documents = [[], ['settings'], ['customers'], ['fees'], ['products'], names]
    const graph = await request({ mode: 'graph', documents })
    assert.deepEqual(graph.tables.slice().sort(), names.slice().sort(), 'complete relevant live set, including no-FK and custom_tables metadata')
    assert.deepEqual(sort(graph.references), sort(oldRows), 'exact old per-table graph including composite FK components')
    assert(graph.references.some(r => r.fk_seq > 0), 'fully migrated schema exercises a real composite FK')
    assert(!graph.tables.includes('ct_child'), 'custom namespace and internal tables are never restore targets')
    assert.equal(graph.calls.length, 1)
    const oldDecision = document => {
      const live = new Set(graph.backupTables.filter(t => names.includes(t)))
      const restored = new Set([...live].filter(t => document.includes(t))), missing = new Set()
      if (restored.size === live.size) return null
      if (graph.bundle.some(t => restored.has(t))) for (const t of graph.bundle) if (live.has(t) && !restored.has(t)) missing.add(t)
      for (const row of oldRows) if (live.has(row.table_name) && live.has(row.parent_table) && restored.has(row.table_name) !== restored.has(row.parent_table)) missing.add(restored.has(row.table_name) ? row.parent_table : row.table_name)
      return missing.size ? 'Cannot restore this backup: missing dependency tables: ' + [...missing].sort().join(', ') + '. Choose a complete backup containing the related sales, stock and replay history, or recover this older backup in a separate compatible database. No database rows have been changed; unbacked live history will not be discarded.' : null
    }
    assert.deepEqual(graph.decisions, documents.map(oldDecision))
    const overflow = await request({ mode: 'overflow' })
    assert.match(overflow.error, /safe discovery limit/)
    assert.match(overflow.query, /LIMIT 10001/)
    assert.deepEqual(overflow.names, [...graph.backupTables, 'd1_migrations'])
    for (const mode of ['settings', 'duplicate', 'unknown', 'migration', 'missing-parent', 'missing-child', 'late-child', 'custom-invalid']) {
      for (const name of ['fees','custom_tables','settings','d1_migrations','ct_ignore']) await small.prepare('DROP TABLE IF EXISTS "' + name + '"').run()
      await small.prepare('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)').run()
      await small.prepare("INSERT INTO settings VALUES('proof','LIVE')").run()
      let tables = { settings: { columns: ['key','value'], rows: [{ key: 'proof', value: 'RESTORED' }] } }
      if (mode === 'unknown') {
        await small.prepare('CREATE TABLE ct_ignore(id INTEGER PRIMARY KEY)').run()
        await small.prepare('INSERT INTO ct_ignore VALUES(7)').run()
        tables.ct_ignore = { columns: ['id'], rows: [{ id: 999 }] }
      }
      if (mode.startsWith('missing-')) {
        await small.prepare('CREATE TABLE fees(id INTEGER PRIMARY KEY,setting_key TEXT REFERENCES settings(key))').run()
        if (mode === 'missing-parent') tables = { fees: { columns: ['id','setting_key'], rows: [] } }
      }
      if (mode === 'migration') {
        await small.prepare('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT)').run()
        await small.prepare("INSERT INTO d1_migrations VALUES(1,'0001_test.sql')").run()
      }
      if (mode === 'custom-invalid') {
        await small.prepare('CREATE TABLE custom_tables(id INTEGER PRIMARY KEY,name TEXT)').run()
        tables = { custom_tables: { columns: ['id','name'], rows: [{ id: 1, name: 'system_flags' }] } }
      }
      const output = await request({ mode, tables, migration: mode === 'migration' ? '9999_newer.sql' : null })
      const discoveries = output.calls.filter(sql => sql.includes('pragma_foreign_key_list(m.name)'))
      assert.equal(discoveries.length, mode === 'custom-invalid' ? 0 : 1, mode)
      assert(!output.calls.some(sql => sql === 'SELECT name FROM sqlite_master WHERE type = ? AND name = ?'), 'no per-table existence queries')
      assert.equal(output.calls.filter(sql => sql.includes('FROM d1_migrations')).length, mode === 'migration' ? 1 : 0)
      if (mode !== 'custom-invalid') assert(output.events.indexOf('pass-one-end') < output.events.indexOf(discoveries[0]), 'discover only after full pass one')
      if (['settings', 'duplicate', 'unknown'].includes(mode)) {
        assert.equal(output.error, null)
        assert.equal((await small.prepare("SELECT value FROM settings WHERE key='proof'").first()).value, 'RESTORED')
        assert(output.events.indexOf(discoveries[0]) < output.events.indexOf('progress-deleting'))
        assert(output.events.indexOf('source-read-2') < output.events.indexOf('progress-deleting'), 'source pin preserved')
        assert.equal(output.result.tables, 1, 'unknown and duplicate headers must not expand restore targets')
        assert.equal(output.calls.filter(sql => sql.startsWith('DELETE')).length, 1)
        if (mode === 'unknown') assert.equal((await small.prepare('SELECT id FROM ct_ignore').first()).id, 7)
      } else {
        assert.match(output.error, mode === 'migration' ? /newer database schema/ : mode === 'custom-invalid' ? /Invalid custom table metadata/ : /missing dependency/)
        assert(!output.calls.some(sql => /^(DELETE|INSERT)/.test(sql)), 'refusal before destructive writes')
        assert.equal((await small.prepare("SELECT value FROM settings WHERE key='proof'").first()).value, 'LIVE')
      }
    }
    console.log('PASS native D1 full migrated graph equivalence (' + migrations.length + ' migrations, ' + names.length + ' tables, ' + oldRows.length + ' graph rows); 8 actual restore snapshot cases; bounded overflow refusal')
  } finally { await mf.dispose() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
