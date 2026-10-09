import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createHarness, propsOf } from './mountedComponentHarness.ts'
import { uploadAndAttachAvatar } from '../src/components/users/avatarFlow.ts'

const nativeFetch = globalThis.fetch
const server = createServer((req,res) => { res.statusCode = req.url?.startsWith('/uploads/') ? 200 : 404; res.end('photo') })
await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve))
const address = server.address() as { port: number }
const remote = 'http://127.0.0.1:'+address.port
const harness = await createHarness()
let authority = remote
let saved = await uploadAndAttachAvatar({ uploadUserAvatar: async () => ({path:'/uploads/owner photo.png'}), setUserAvatar: async () => ({success:true,avatar_path:'/uploads/owner photo.png',updated_at:'photo-1'}) },42,'data:image/png;base64,AA',{noPath:'missing',attachFailed:'failed'})
const app: Record<string,unknown> = { page:'products',user:{id:42,name:'Owner A',role_name:'Owner',...saved},settings:{language:'en'},t:(key:string)=>({account:'Account',profile:'Profile',no_role:'No role'}[key]||key),navigateTo:()=>{},logout:()=>{},notify:()=>{},hasPermission:()=>false,getPermissionTier:()=> 'none',can:()=>false,canAccessPage:()=>false,syncUrl:remote }
;(window as unknown as {api:unknown}).api = {getSyncServerUrl:()=>authority,getUserProfile:async()=>app.user,otpStatus:async()=>({otpEnabled:false}),getVerificationCapabilities:async()=>({}),getUserAuthMethods:async()=>({methods:[]}),debugLog:()=>{}}
const sidebar = await harness.mount({component:'components/navigation/Sidebar.tsx',props:{showQuickPreferences:false},app,doubles:{}})
try {
 const image = sidebar.find(node=>node.tagName==='IMG' && propsOf(node).alt==='Owner A','saved account photo')
 const src=String(propsOf(image).src)
 console.log('MEASURE saved relative account photo src='+src)
 assert.equal(new URL(src,window.location.origin).origin,remote,'relative saved profile photo must use configured server authority')
 assert.equal((await nativeFetch(src)).status,200)
 await sidebar.call(image,'onError',[])
 assert.ok(!sidebar.findAll(node=>node.tagName==='IMG').includes(image),'failed instance shows fallback')
 for (const sibling of sidebar.findAll(node=>node.tagName==='IMG'&&propsOf(node).alt==='Owner A')) await sidebar.call(sibling,'onError',[])
 assert.equal(sidebar.findAll(node=>node.tagName==='IMG'&&propsOf(node).alt==='Owner A').length,0,'broken photo instances fall back')
 saved={...saved,updated_at:'photo-2'}
 app.user={id:42,name:'Owner A',role_name:'Owner',...saved}
 await sidebar.render({showQuickPreferences:false})
 assert.ok(sidebar.find(node=>node.tagName==='IMG'&&propsOf(node).alt==='Owner A','new profile revision retries photo'))
 authority=window.location.origin
 app.user={id:43,name:'Owner B',avatar_path:'/uploads/b.png',updated_at:'b-1'}
 await sidebar.render({showQuickPreferences:false})
 const b=sidebar.find(node=>node.tagName==='IMG'&&propsOf(node).alt==='Owner B','switched account photo')
 assert.equal(new URL(String(propsOf(b).src),window.location.origin).origin,window.location.origin)
 app.user={id:43,name:'Owner B',avatar_path:'https://images.example.test/b.png',updated_at:'b-2'}
 await sidebar.render({showQuickPreferences:false})
 assert.equal(String(propsOf(sidebar.find(node=>node.tagName==='IMG'&&propsOf(node).alt==='Owner B','absolute account photo')).src),'https://images.example.test/b.png?v=b-2')
 await sidebar.click(sidebar.button('Account'))
 const profileButtons=sidebar.findAll(node=>node.tagName==='BUTTON'&&propsOf(node)['data-bos-profile-action']==='true')
 assert.equal(profileButtons.length,2,'desktop and mobile menu identity are profile buttons')
 assert.ok(profileButtons.every(node=>node.textContent.includes('Owner B')))
 assert.equal(sidebar.findAll(node=>node.tagName==='BUTTON'&&node.textContent.trim()==='Profile').length,0,'no duplicate Profile action')
 profileButtons[0].focus()
 assert.equal(document.activeElement,profileButtons[0], 'native profile button accepts keyboard focus')
 assert.equal(propsOf(profileButtons[0]).type,'button')
 await sidebar.click(profileButtons[0])
 assert.equal(propsOf(sidebar.button('Account'))['aria-expanded'],false,'opening profile closes account menu')
 await sidebar.waitFor(()=>sidebar.findAll(node=>propsOf(node).role==='dialog').length>0,'actual profile modal')
 assert.ok(sidebar.find(node=>propsOf(node).role==='dialog','actual profile modal'))
 assert.equal(propsOf(sidebar.field('profile-name')).value,'Owner B','actual modal loads the current actor profile')
 await sidebar.click(sidebar.button('Close'))
 assert.equal(sidebar.findAll(node=>propsOf(node).role==='dialog').length,0,'profile closes through existing close guard')
 for (const language of ['en','km']) {
  const pack = JSON.parse(readFileSync(new URL('../src/lang/'+language+'.json',import.meta.url),'utf8'))
  app.settings={language}; app.t=(key:string)=>pack[key]||key
  await sidebar.render({showQuickPreferences:false})
  await sidebar.click(sidebar.button(pack.account))
  const identity = sidebar.find(node=>propsOf(node)['data-bos-profile-action']==='true','localized profile identity')
  assert.equal(propsOf(identity)['aria-label'],pack.profile)
  await sidebar.click(identity)
  assert.equal(propsOf(sidebar.button(pack.account))['aria-expanded'],false)
  await sidebar.click(sidebar.button(pack.close))
 }
 console.log('PASS mounted profile-save media authority, fallback/new revision, account switch and menu identity controls')
} finally { await harness.close(); await new Promise<void>(resolve=>server.close(()=>resolve())) }
