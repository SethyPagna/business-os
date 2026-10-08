import assert from 'node:assert/strict'
const data = new Map([['businessos_public_asset_base_url', 'https://stale.fixture']])
let failWrites = false
let authority = 'https://current.fixture'
const storage = { getItem: (k: string) => data.get(k) || null, setItem: (k: string,v: string) => { if (failWrites) throw new Error('blocked'); data.set(k,v) }, removeItem: (k: string) => { if (failWrites) throw new Error('blocked'); data.delete(k) } }
Object.assign(globalThis,{localStorage:storage,window:{addEventListener() {},sessionStorage:{getItem:()=>null},localStorage:storage,location:{origin:'https://admin.fixture',hostname:'admin.fixture',pathname:'/'},api:{getSyncServerUrl:()=>authority}}})
const {resolvePublicAssetUrl} = await import('../src/utils/publicAssetUrls.ts')
assert.equal(new URL(resolvePublicAssetUrl('/uploads/ordinary.png')).origin, authority, 'cold legacy unscoped base cannot redirect current uploads')
const kernel = await import('../src/utils/uploadUrlKernel.ts')
const {resolveCatalogAssetUrl} = await import('../src/components/catalog/catalogAssetUrls.ts')
kernel.replaceAssetBaseFromBootstrap({system:{runtime:{platform:'cloudflare'}}})
assert.equal(data.has('businessos_public_asset_base_url'), false)
assert.equal(new URL(resolvePublicAssetUrl('/uploads/ordinary.png')).origin, authority)
assert.equal(new URL(resolveCatalogAssetUrl('/uploads/ordinary.png')).origin, authority)
kernel.replaceAssetBaseFromBootstrap({system:{publicAssetBaseUrl:'https://explicit.fixture/'}})
assert.equal(new URL(resolvePublicAssetUrl('/uploads/ordinary.png')).origin,'https://explicit.fixture')
kernel.replaceAssetBaseFromBootstrap({offline:true,system:null})
kernel.replaceAssetBaseFromBootstrap({unauthorized:true,system:{}})
kernel.replaceAssetBaseFromBootstrap({settings:{}})
assert.equal(kernel.getCurrentAssetBase(),'https://explicit.fixture','partial/failed bootstraps preserve current explicit base')
failWrites=true
kernel.replaceAssetBaseFromBootstrap({system:{}})
assert.equal(data.get('businessos_public_asset_base_url'),'https://explicit.fixture','control: old durable value remains when removal throws')
assert.equal(new URL(resolvePublicAssetUrl('/uploads/ordinary.png')).origin,authority,'runtime clear wins despite failed storage remove')
assert.equal(new URL(resolveCatalogAssetUrl('/uploads/ordinary.png')).origin,authority)
kernel.replaceAssetBaseFromBootstrap({system:{publicAssetBaseUrl:'https://new.fixture'}})
assert.equal(kernel.getCurrentAssetBase(),'https://new.fixture','runtime set wins despite failed persistence')
authority='https://other.fixture'
assert.equal(kernel.getCurrentAssetBase(),'','changed authority cannot reuse previous explicit base')
assert.equal(new URL(resolvePublicAssetUrl('/uploads/ordinary.png')).origin,authority)
assert.equal(new URL(resolveCatalogAssetUrl('/uploads/A#shade.png')).pathname,'/uploads/A%23shade.png')
console.log('PASS current-authority bootstrap base replacement; failed storage, partial bootstrap and server switch isolation')

const {readFileSync} = await import('node:fs')
const ts = (await import('typescript')).default
const webSource = readFileSync(new URL('../src/web-api.ts', import.meta.url),'utf8')
const start = webSource.indexOf('  setPublicAssetBaseUrl(url: unknown) {')
const end = webSource.indexOf('  async getAppBootstrap()',start)
assert.ok(start >= 0 && end > start)
const actualMethods = ts.transpileModule(`return ({${webSource.slice(start,end)}})`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
const api = new Function('getSyncServerUrl','currentUploadAuthority','getCurrentAssetBase','setCurrentAssetBase',actualMethods)(()=>authority,kernel.currentUploadAuthority,kernel.getCurrentAssetBase,kernel.setCurrentAssetBase)
api.setPublicAssetBaseUrl('https://actual.fixture')
assert.equal(api.getPublicAssetBaseUrl(),'https://actual.fixture','real web API setter/getter share authority state even with blocked storage')
api.setPublicAssetBaseUrl('')
assert.equal(api.getPublicAssetBaseUrl(),'','real getter cannot resurrect stale durable value')
const appSource = readFileSync(new URL('../src/AppContext.tsx',import.meta.url),'utf8')
assert.match(appSource,/replaceAssetBaseFromBootstrap\(safePayload\)/,'successful actual bootstrap applies authority replacement')
assert.doesNotMatch(appSource,/if \(safePayload\?\.system\?\.publicAssetBaseUrl\)/,'missing current field must not skip replacement')
console.log('PASS actual web API setter/getter wiring and authoritative bootstrap integration')
