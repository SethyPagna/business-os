const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const Database = require('better-sqlite3')
const { build } = require('esbuild')
const root = path.resolve(__dirname, '..')

async function main() {
  const stubs = {
    auth: `export const requireAuth=async(c,next)=>{c.set('user',{id:1,username:'admin'});return next()}`,
    audit: `export const audit=async(env,...args)=>{env.events.push({kind:'audit',args})}`,
    permissions: `export const hasPermission=()=>true`,
    acquisitionCostAccess: `export const canViewAcquisitionCosts=()=>true;export const canEditAcquisitionCosts=()=>true`,
    backup: `export const CLOUDFLARE_BACKUP_KEEP=1;export const createCloudflareBackup=()=>{};export const getSystemJob=()=>{};export const linkCloudflareBackupJob=()=>{};export const listCloudflareBackups=()=>{};export const pruneCloudflareBackups=()=>{};export const validateCloudflareBackup=()=>{};
      export const storeSystemJob=async(env,job)=>{env.events.push({kind:'job',job});return job};
      export const restoreCloudflareBackup=async(env,key,progress)=>{env.restoreCalls++;await progress({phase:'assets'});if(env.replaceAfterRestore)env.replace();return {key}};`,
  }
  const bundle = await build({ entryPoints: [path.join(root, 'src/routes/backups.ts')], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['hono'], plugins: [{ name: 'route-boundaries', setup(b) {
    b.onResolve({ filter: /\/lib\/(auth|audit|permissions|acquisitionCostAccess|backup)$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'stub' }))
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }))
  } }] })
  const mod = new Module(path.join(root, 'maintenance-route-test.cjs')); mod.filename = mod.id; mod.paths = Module._nodeModulePaths(root)
  mod._compile(bundle.outputFiles[0].text, mod.filename)
  const app = mod.exports.default
  for (const scenario of ['clear-ok', 'clear-replaced', 'corrupt-clear-replaced', 'restore-ok', 'restore-release-failed',
    'restore-import-error', 'restore-import-missing', 'restore-import-negative', 'restore-import-fractional', 'restore-import-string', 'restore-import-active']) {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);CREATE TABLE import_jobs(status TEXT)')
    const state = { mode: 'restore', token: 'original', phase: 'failed', backupKey: 'backup', startedBy: 'admin', startedAt: '2026-09-21T00:00:00Z', updatedAt: '2026-09-21T00:00:00Z' }
    const original = JSON.stringify(state)
    if (scenario.startsWith('clear') || scenario.startsWith('corrupt')) db.prepare('INSERT INTO system_flags(key,value) VALUES(?,?)').run('maintenance', scenario.startsWith('corrupt') ? '{broken' : original)
    let reads = 0
    const replacement = JSON.stringify({ ...state, token: 'replacement', phase: 'deleting' })
    const env = { events: [], restoreCalls: 0, replaceAfterRestore: scenario === 'restore-release-failed', replace() { db.prepare('UPDATE system_flags SET value=?').run(replacement) }, DB: { prepare(sql) {
      const bind = params => ({ first: async () => {
        if (sql.includes('FROM import_jobs')) {
          if (scenario === 'restore-import-error') throw new Error('D1 unavailable')
          if (scenario === 'restore-import-missing') return null
          if (scenario === 'restore-import-negative') return { n: -1 }
          if (scenario === 'restore-import-fractional') return { n: 0.5 }
          if (scenario === 'restore-import-string') return { n: '0' }
          if (scenario === 'restore-import-active') return { n: 1 }
        }
        const row = db.prepare(sql).get(...params) || null
        if (sql.startsWith('SELECT value') && ++reads === 1 && scenario.endsWith('replaced')) env.replace()
        return row
      }, run: async () => ({ meta: { changes: db.prepare(sql).run(...params).changes } }) })
      return { ...bind([]), bind: (...params) => bind(params) }
    } } }
    const restore = scenario.startsWith('restore')
    const response = await app.request(restore ? '/' : '/maintenance/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(restore ? { type: 'import-folder', sourceDir: 'backups/cloudflare/test.json' } : { force: true }) }, env)
    const result = await response.json()
    if (scenario.startsWith('restore-import-')) {
      assert.equal(response.status, scenario === 'restore-import-active' ? 409 : 503)
      if (scenario !== 'restore-import-active') assert.equal(result.code, 'import_status_unavailable')
      assert.equal(env.restoreCalls, 0, 'uncertain or active imports must never enter restore')
      assert.equal(env.events.length, 0, 'rejected admission must not create a success job/audit')
      assert.equal(db.prepare('SELECT * FROM system_flags').get(), undefined, 'rejected admission must not acquire maintenance')
    } else if (scenario.endsWith('replaced')) {
      assert.equal(response.status, 409); assert.equal(result.cleared, false)
      assert.equal(env.events.length, 0, 'failed clear must not claim success in audit')
      assert.equal(db.prepare('SELECT value FROM system_flags').get().value, replacement)
    } else if (scenario === 'restore-release-failed') {
      assert.equal(response.status, 409); assert.equal(result.data_restored, true)
      assert.equal(result.code, 'maintenance_not_released'); assert.equal(result.item.status, 'failed')
      assert.equal(env.events.find(e => e.kind === 'audit').args.at(-1).maintenance_released, false)
      assert.equal(db.prepare('SELECT value FROM system_flags').get().value, replacement)
    } else {
      assert.equal(response.status, 200); assert.equal(db.prepare('SELECT * FROM system_flags').get(), undefined)
      assert.equal(env.events.filter(e => e.kind === 'audit').length, 1)
    }
    db.close(); console.log('PASS actual backup route', scenario)
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
