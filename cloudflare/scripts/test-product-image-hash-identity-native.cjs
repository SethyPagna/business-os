'use strict'
const assert = require('node:assert/strict')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')
const ADMIN = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: '{"all":true}' }
async function main() {
  const h = createProductsRouteHarness({ user: ADMIN })
  const prepare = h.raw.prepare.bind(h.raw)
  h.raw.prepare = sql => {
    const statement = prepare(sql)
    const bind = statement.bind.bind(statement)
    statement.bind = (...values) => bind(values)
    return statement
  }
  const batch = h.raw.batch.bind(h.raw)
  h.raw.batch = items => batch(items.map(item => item._params === undefined ? item : {sql:item.sql,params:item._params}))
  const media = h.load('lib/media.ts')
  h.raw.db.exec("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Synthetic',1,1); INSERT INTO products(id,name,stock_quantity,is_active) VALUES(10,'Existing synthetic',0,1)")
  const names = ['old#shade.png','literal%20shade.png','literal shade.png','រូបថត.png','literal%2fshade.png']
  for (const name of names) h.raw.prepare('INSERT INTO file_assets(original_name,stored_name,public_path,mime_type,media_type,byte_size) VALUES(?,?,?,?,?,?)').run([name,name,'/uploads/'+name,'image/png','image',10])
  const signed = 'https://cdn.fixture/photo.png?sig=kept%20exact#anchor'
  assert.equal(media.sanitizeMediaPath(signed),signed)
  for (const name of names) {
    const identity = '/uploads/'+name
    const update = await h.request('PUT','/10',{image_path:identity,image_gallery:[identity]})
    assert.equal(update.status,200,JSON.stringify(update.json))
    assert.equal(h.raw.prepare('SELECT image_path FROM products WHERE id=10').get().image_path,identity)
    assert.equal(h.raw.prepare('SELECT image_path FROM product_images WHERE product_id=10').get().image_path,identity)
  }
  const created = await h.request('POST','/',{name:'Created synthetic',branch_id:1,image_path:'/uploads/old#shade.png',image_gallery:['/uploads/old#shade.png']})
  assert.equal(created.status,200,JSON.stringify(created.json))
  assert.equal(h.raw.prepare("SELECT image_path FROM products WHERE name='Created synthetic'").get().image_path,'/uploads/old#shade.png')
  const wired = await h.request('POST','/wire-images',{changes:[{productId:10,imagePaths:['/uploads/old#shade.png']}]})
  assert.equal(wired.status,200,JSON.stringify(wired.json))
  assert.equal(h.raw.prepare('SELECT image_path FROM products WHERE id=10').get().image_path,'/uploads/old#shade.png')
  const files = h.load('routes/files.ts').default
  const libraryRequest = (method,url,body) => files.request('http://local'+url, {
    method, headers:{'content-type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {}),
  }, {DB:h.raw}, {waitUntil(promise){promise?.catch?.(()=>{})}})
  const references = await libraryRequest('GET','/1/usage')
  assert.equal(references.status,200)
  assert.equal((await references.json()).public_path,'/uploads/old#shade.png')
  const renamed = await libraryRequest('PATCH','/1',{original_name:'Friendly library name.png'})
  assert.equal(renamed.status,200)
  const asset = await renamed.json()
  assert.equal(asset.public_path,'/uploads/old#shade.png')
  assert.equal(asset.stored_name,'old#shade.png')
  const referencedDelete = await libraryRequest('DELETE','/1')
  assert.equal(referencedDelete.status,409,'Library still protects referenced exact identity')
  const before = JSON.stringify(h.raw.prepare('SELECT * FROM products WHERE id=10').get())
  for (const invalid of ['/uploads/unknown#shade.png','/uploads/../private.png','/uploads/x%2fy.png','/uploads/x%5cy.png','/uploads/%2e%2e/private.png']) {
    const response=await h.request('PUT','/10',{image_path:invalid,image_gallery:[invalid]})
    assert.equal(response.status,409,invalid+' '+JSON.stringify(response.json))
    assert.equal(JSON.stringify(h.raw.prepare('SELECT * FROM products WHERE id=10').get()),before)
  }
  assert.equal(media.sanitizeMediaPath('/uploads/old#shade.png?v=1#preview'),'/uploads/old#shade.png')
  const permission=h.load('lib/productImagePermission.ts')
  const both={image_path:'/uploads/literal%20shade.png',image_gallery:['/uploads/literal%20shade.png','/uploads/literal shade.png']}
  await permission.resolveProductImageFields(h.db,both)
  assert.deepEqual(both.image_gallery,['/uploads/literal%20shade.png','/uploads/literal shade.png'])
  console.log('PASS real product create/update/attach preserve legacy hash identities, literal percent nonaliases and signed URLs; unknown/traversal no effects')
}
main().catch(error=>{console.error(error);process.exitCode=1})
