const assert=require('node:assert/strict'),path=require('node:path');
const {build}=require('esbuild');const {Miniflare,Log,LogLevel}=require('miniflare');
const PNG=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jTfoAAAAASUVORK5CYII=','base64'));
async function main() {
  const root = path.resolve(__dirname, '..')
  const stubs = {
    auth: `export const requireAuth=async(c,next)=>{c.set('user',{id:1,username:'admin',name:'Admin',role_code:'admin'});return next()};export const revokeUserSessions=async()=>{}`,
    audit: `export const audit=async()=>{};export const changedFields=()=>[];export const auditChangeColumns=()=>[]`,
    imageAudit: `export const enqueueImageNormalization=async(env,key)=>{await env.DB.prepare('INSERT INTO enqueue_probe(key) VALUES(?)').bind(key).run()}`,
    broadcastHub: `export const broadcast=async()=>{}`,
    rateLimit: `export const checkRateLimit=async()=>({allowed:true});export const getClientIp=()=>'127.0.0.1'`,
  }
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
    import { Hono } from 'hono';
    import importJobs from './src/routes/importJobs.ts';
    import products from './src/routes/products.ts';
    import users from './src/routes/users.ts';
    import { serveUpload } from './src/lib/imageVariants.ts';
    const app = new Hono();
    app.route('/api/import-jobs', importJobs);
    app.route('/api/products', products);
    app.route('/api', users);
    app.get('/uploads/*', c => serveUpload(c.env,c.req.path,c.req.raw,c.executionCtx));
    export default { fetch(request, env, ctx) { return app.fetch(request, env, ctx); } };
  ` }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent',
  external: ['node:*', 'cloudflare:*'],
  plugins: [{ name: 'route-stubs', setup(b) {
    b.onResolve({ filter: /\/(lib\/(auth|audit|imageAudit|rateLimit)|durable-objects\/broadcastHub)$/ }, (args) => ({ path: args.path.split('/').pop(), namespace: 'stub' }))
    // Each stub re-exports the real module and overrides only the named
    // side-effect functions (a local export wins over export *).
    const real = { auth: 'src/lib/auth.ts', audit: 'src/lib/audit.ts', imageAudit: 'src/lib/imageAudit.ts', rateLimit: 'src/lib/rateLimit.ts', broadcastHub: 'src/durable-objects/broadcastHub.ts' }
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
      contents: `export * from ${JSON.stringify(path.join(root, real[args.path]).split(path.sep).join('/'))};
${stubs[args.path]}`,
      loader: 'ts', resolveDir: root,
    }))
  } }] })

  const mf = new Miniflare({
    modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB', 'IMPORT_DB'], r2Buckets: ['ASSETS'], log: new Log(LogLevel.ERROR),
  })
  try {
    const db = await mf.getD1Database('DB')
    const r2 = await mf.getR2Bucket('ASSETS')
    for (const sql of [
      'CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)',
      `CREATE TABLE import_jobs(id TEXT PRIMARY KEY,type TEXT,status TEXT,phase TEXT,queue_driver TEXT,policy_json TEXT,summary_json TEXT,
        cancel_requested INTEGER DEFAULT 0,created_by_id INTEGER,created_by_name TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,processed_rows INTEGER DEFAULT 0,failed_rows INTEGER DEFAULT 0,last_error TEXT,details_pruned_at TEXT,
        failed_images INTEGER DEFAULT 0)`,
      // The upload routes report the files they refuse here (S-uploads2b).
      `CREATE TABLE import_job_errors(id INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT NOT NULL,batch_id INTEGER,row_number INTEGER,
        file_name TEXT,code TEXT,message TEXT NOT NULL,raw_json TEXT DEFAULT '{}',created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE import_job_files(id INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT NOT NULL,kind TEXT NOT NULL,original_name TEXT,
        stored_path TEXT NOT NULL,relative_path TEXT,mime_type TEXT,byte_size INTEGER DEFAULT 0,status TEXT DEFAULT 'stored',error_message TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,file_asset_id INTEGER)`,
      `CREATE TABLE file_assets(id INTEGER PRIMARY KEY AUTOINCREMENT,original_name TEXT NOT NULL,stored_name TEXT NOT NULL,public_path TEXT NOT NULL,
        mime_type TEXT,media_type TEXT DEFAULT 'image',byte_size INTEGER,source TEXT DEFAULT 'upload',created_by_id INTEGER,created_by_name TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,optimization_status TEXT)`,
      'CREATE TABLE enqueue_probe(key TEXT)',
      "INSERT INTO import_jobs(id,type,status,phase,policy_json,summary_json) VALUES('job1','products','pending','created','{}','{}')",
    ]) await db.prepare(sql).run()

    const keys = async () => (await r2.list()).objects.map((o) => o.key).sort()
    const typeOf = async (key) => (await r2.head(key))?.httpMetadata?.contentType
    const post = async (url, form) => {
      // Encode the multipart body in Node and hand Miniflare plain bytes.
      const encoded = new Request('http://encode.local/', { method: 'POST', body: form })
      const body = Buffer.from(await encoded.arrayBuffer())
      const response = await mf.dispatchFetch(`http://local.test${url}`, { method: 'POST', body, headers: { 'content-type': encoded.headers.get('content-type') } })
      const text = await response.text()
      let json = null
      try { json = JSON.parse(text) } catch { /* not json */ }
      return { status: response.status, json, text }
    }
    const formWith = (field, data, name, type) => {
      const form = new FormData()
      form.append(field, new File([data], name, { type }))
      return form
    }


    for (const name of ['camera.jpg','photo#1.png','photo%20.png','photo 1.png','រូបថត.png']) {
      const result=await post('/api/products/upload-image',formWith('image',PNG,name,'image/webp'));
      assert.equal(result.status,200,result.text);
      assert.equal(result.json.asset.mime_type,'image/png','actual bytes override claimed WebP');
      assert.equal(result.json.asset.original_name,name,'display original name preserved');
      const stored=result.json.asset.stored_name;
      assert.ok(!/[#%]/.test(stored),'new stored filename never introduces URL fragment/ambiguous escape');
      const response=await mf.dispatchFetch('http://local.test'+result.json.path);
      assert.equal(response.status,200,name);assert.equal(response.headers.get('content-type'),'image/png');
      assert.equal(response.headers.get('content-disposition'),null);
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()),PNG,'original bytes roundtrip');
    }
    for (const name of ['old#name.png','old%20.png','old name.png','រូបថត.png','literal%2f.png','literal%2e%2e.png']) {
      await r2.put('uploads/'+name,PNG,{httpMetadata:{contentType:'image/png'}});
      const response=await mf.dispatchFetch('http://local.test/uploads/'+encodeURIComponent(name));
      assert.equal(response.status,200,'existing raw identity '+name);
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()),PNG);
      const variant=await mf.dispatchFetch('http://local.test/uploads/_v/w320/'+encodeURIComponent(name),{redirect:'manual'});
      assert.equal(variant.status,302,'existing variant fallback '+name);
      assert.equal(variant.headers.get('location'),'/uploads/'+encodeURIComponent(name));
    }
    await r2.put('uploads/only%20literal.png',PNG);
    assert.equal((await mf.dispatchFetch('http://local.test/uploads/only%20literal.png')).status,404,'decoded miss cannot alias literal percent object');
    const percentBytes=new Uint8Array([...PNG,1]);
    await r2.put('uploads/collision name.png',PNG);
    await r2.put('uploads/collision%20name.png',percentBytes);
    const spaceResponse=await mf.dispatchFetch('http://local.test/uploads/collision%20name.png');
    const percentResponse=await mf.dispatchFetch('http://local.test/uploads/collision%2520name.png');
    assert.deepEqual(new Uint8Array(await spaceResponse.arrayBuffer()),PNG,'space identity stays distinct');
    assert.deepEqual(new Uint8Array(await percentResponse.arrayBuffer()),percentBytes,'literal percent identity stays distinct');
    for (const encoded of ['bad%2fname.png','bad%5cname.png','bad%00name.png','bad%0aname.png','bad%ZZ.png','_v/w320/%2e%2e%2fsecret.png']) {
      const response=await mf.dispatchFetch('http://local.test/uploads/'+encoded);
      assert.equal(response.status,404,'unsafe encoded identity '+encoded);
    }
    console.log('PASS actual product upload/storage/serve roundtrip; reserved names, legacy identities, once decode and no aliases');
  } finally { await mf.dispose() }
}
main().catch(error=>{console.error(error);process.exitCode=1});
