// Real mounted Contacts route and native FTS/D1. Only session authentication
// is a fixture; authorization, search composition and response projection run.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {build}=require('esbuild'),{Miniflare}=require('miniflare'),Database=require('better-sqlite3')
async function main(){
  const root=path.join(__dirname,'..')
  const bundled=await build({stdin:{contents:"import contacts from './src/routes/contacts';export default contacts",resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',plugins:[{name:'fixture-auth',setup(b){
    b.onResolve({filter:/lib\/auth$/},()=>({path:'auth',namespace:'fixture'}))
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:"export const requireAuth=async(c,next)=>{const permissions=c.req.header('x-test-permissions');if(!permissions)return c.json({error:'Unauthorized'},401);c.set('user',{id:7,username:'employee',role_code:'employee',permissions});return next()};",loader:'ts'}))
  }}]})
  const schema=new Database(':memory:')
  for(const file of fs.readdirSync(path.join(root,'migrations')).filter(f=>f.endsWith('.sql')).sort())schema.exec(fs.readFileSync(path.join(root,'migrations',file),'utf8'))
  const mf=new Miniflare({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-08-01',d1Databases:['DB']})
  try{
    const db=await mf.getD1Database('DB')
    await db.prepare(schema.prepare("SELECT sql FROM sqlite_master WHERE name='customers'").get().sql).run()
    for(const name of ['customers_fts','customers_fts_phone'])await db.prepare(schema.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(name).sql).run()
    for(const row of schema.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND tbl_name='customers' AND sql LIKE '%customers_fts%'").all())await db.prepare(row.sql).run()
    const fixtures=[
      [1,'Dara','012 345 678','012345678',0],
      [2,'Sok','+855 (12) 345-679',null,0],
      [3,'Other','099 888 777','099888777',0],
      [4,'General','012 345 678','012345678',1],
      [5,'Alternate','012.345.680',null,0],
    ]
    for(const row of fixtures)await db.prepare("INSERT INTO customers(id,name,phone,phone_normalized,is_anonymous,notes) VALUES(?,?,?,?,?,'private note')").bind(...row).run()
    const call=async(search,permissions={pos:true},suffix='')=>{
      const r=await mf.dispatchFetch('http://local/customers?fields=sales_picker&search='+encodeURIComponent(search)+suffix,{headers:{'x-test-permissions':JSON.stringify(permissions)}})
      return {status:r.status,body:await r.json()}
    }
    for(const [search,expected]of [['012 345 678',[1]],['012345678',[1]],['+85512345678',[1]],['855 12 345 678',[1]],['012345679',[2]],['+85512345679',[2]],['012345680',[5]],['Dara',[1]],['099888777',[3]],['345678',[1]]]){
      for(const permissions of [{pos:true},{sales:true},{all:true}]){
        const result=await call(search,permissions);assert.equal(result.status,200,JSON.stringify(result));assert.deepEqual(result.body.items.map(r=>r.id),expected,search)
        for(const item of result.body.items)assert.deepEqual(Object.keys(item).sort(),['id','name','phone','email','address','membership_number','updated_at','is_anonymous'].sort())
      }
    }
    assert.equal((await call('012345678',{})).status,403)
    assert.equal((await call('012345678',{customer_portal:true})).status,403)
    const bounded=await call('',{pos:true},'&limit=2');assert.equal(bounded.body.items.length,2)
    assert.deepEqual((await call('012345678',{pos:true},'&ids=2')).body.items,[])
    const directory=await mf.dispatchFetch('http://local/customers?search=012345678',{headers:{'x-test-permissions':JSON.stringify({pos:true})}});assert.equal(directory.status,403)
    // The same stored formatted number still does not match the original
    // FTS-only unformatted phrase: the compatibility union is picker-only.
    const raw=(await db.prepare("SELECT rowid FROM customers_fts_phone WHERE customers_fts_phone MATCH '012345678'").all()).results
    assert.deepEqual(raw,[])
    console.log('PASS native Sales/POS picker finds formatted/local/+855 phones and names, including missing normalized cache; permissions/projection/ID filtering/limits/General exclusion unchanged')
  }finally{schema.close();await mf.dispose()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
