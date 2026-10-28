import { expect, test, type Page } from '@playwright/test'
import { E2E_ACCOUNTS, gotoAdminPage, signIn } from './support/session'
import fs from 'node:fs'

test.use({ serviceWorkers:'block' })
const account=E2E_ACCOUNTS.cashierA
const en=JSON.parse(fs.readFileSync(new URL('../src/lang/en.json',import.meta.url),'utf8')) as Record<string,string>
type Draft={id:string;cart:Array<{id:number;quantity:number}>;paidUsd?:string;paymentDetails?:unknown;checkoutRequestId?:string;checkoutPayload?:Record<string,unknown>}

async function draft(page:Page):Promise<Draft|undefined>{
  return page.evaluate(id=>{
    const read=(key:string)=>localStorage.getItem(key)||sessionStorage.getItem(key)
    const orders=JSON.parse(read(`businessos_pos_orders_${id}`)||'[]') as Draft[]
    const active=read(`businessos_pos_active_${id}`)
    return orders.find(order=>order.id===active)||orders.find(order=>order.cart?.length>0)
  },account.id)
}

async function ringOne(page:Page){
  await page.route(/\/api\/auth\/(bootstrap|login|me)(\?|$)/,async route=>{
    const response=await route.fetch()
    const body=await response.json()
    if(body?.user&&body.user.organization_id===undefined)body.user.organization_id=body.user.organizationId??null
    await route.fulfill({response,json:body})
  })
  await signIn(page,account)
  expect(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('businessos_user')||localStorage.getItem('businessos_user')||'{}').organization_id)).toBe(1)
  await gotoAdminPage(page,'/pos')
  await page.getByText('E2E Product 002 Belle Roux',{exact:true}).first().click()
  const cart=page.getByRole('button',{name:'Cart',exact:true})
  if(await cart.count())await cart.first().click()
  await expect.poll(async()=>(await draft(page))?.cart?.length).toBe(1)
  await page.getByRole('button',{name:'Exact $',exact:true}).click()
  const usd=page.getByRole('spinbutton',{name:'Amount Paid USD 1',exact:true})
  await expect.poll(async()=>Number(await usd.inputValue())).toBeGreaterThan(0)
  await expect.poll(async()=>Number((await draft(page))?.paidUsd)).toBeGreaterThan(0)
  return {before:(await draft(page))!,usd}
}

async function submit(page:Page){
  const response=page.waitForResponse(result=>new URL(result.url()).pathname==='/api/sales'&&result.request().method()==='POST')
  await page.getByRole('button',{name:'Complete Sale',exact:true}).click()
  await page.locator('[data-pos-status-option="completed"]').click()
  return response
}

test('proven size refusal preserves the basket and tender and allows editing',async({page})=>{
  const requests:Record<string,unknown>[]=[]
  await page.route(url=>url.pathname==='/api/sales',async route=>{
    if(route.request().method()!=='POST')return route.continue()
    requests.push(route.request().postDataJSON())
    await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Fixture size refusal',code:'sale_snapshot_too_large',proven_uncommitted:true})})
  })
  const {before,usd}=await ringOne(page)
  const tender=await usd.inputValue()
  expect((await submit(page)).status()).toBe(409)
  await expect.poll(async()=>(await draft(page))?.checkoutRequestId||'').toBe('')
  const after=(await draft(page))!
  expect(after.id).toBe(before.id)
  expect(after.cart).toEqual(before.cart)
  expect(after.paymentDetails).toEqual(before.paymentDetails)
  expect(after.checkoutPayload).toBeUndefined()
  await expect(usd).toHaveValue(tender)
  expect(requests).toHaveLength(1)
  expect(requests[0].client_request_id).toBeTruthy()
  await page.getByRole('button',{name:'Increase quantity',exact:true}).click()
  await expect.poll(async()=>(await draft(page))?.cart[0].quantity).toBe(2)
})

test('a later refusal never releases an earlier unknown checkout',async({page})=>{
  const requests:Record<string,unknown>[]=[]
  const lookups:string[]=[]
  let proven=false
  await page.route(url=>url.pathname==='/api/sales',async route=>{
    if(route.request().method()!=='POST')return route.continue()
    requests.push(route.request().postDataJSON())
    await route.fulfill({status:proven?409:500,contentType:'application/json',body:JSON.stringify(proven
      ? {error:'Fixture size refusal',code:'sale_snapshot_too_large',proven_uncommitted:true}:{error:'Fixture outcome unknown'})})
  })
  await page.route(url=>url.pathname==='/api/sales/create-receipt',async route=>{
    lookups.push(new URL(route.request().url()).searchParams.get('client_request_id')||'')
    await route.fulfill({status:200,contentType:'application/json',body:'{"committed":false}'})
  })
  await ringOne(page)
  expect((await submit(page)).status()).toBe(500)
  await expect.poll(async()=>(await draft(page))?.checkoutRequestId||'').not.toBe('')
  const frozen=(await draft(page))!
  expect(frozen.checkoutRequestId).toBe(requests[0].client_request_id)
  expect(frozen.checkoutPayload).toBeTruthy()
  await page.reload()
  await expect.poll(async()=>(await draft(page))?.checkoutRequestId).toBe(frozen.checkoutRequestId)
  expect((await draft(page))?.checkoutPayload).toEqual(frozen.checkoutPayload)
  const cart=page.getByRole('button',{name:'Cart',exact:true})
  if(await cart.count())await cart.first().click()
  proven=true
  expect((await submit(page)).status()).toBe(409)
  await expect.poll(async()=>(await draft(page))?.checkoutRequestId).toBe(frozen.checkoutRequestId)
  expect(requests).toHaveLength(2)
  expect(requests[1]).toEqual(requests[0])
  expect(lookups).toEqual([frozen.checkoutRequestId])
  expect((await draft(page))?.cart).toEqual(frozen.cart)
  expect((await draft(page))?.paymentDetails).toEqual(frozen.paymentDetails)
  expect((await draft(page))?.checkoutPayload).toEqual(frozen.checkoutPayload)
})

test('a session-only clear cannot unlock a stale preferred local draft',async({page})=>{
  await page.route(url=>url.pathname==='/api/sales',async route=>{
    if(route.request().method()!=='POST')return route.continue()
    await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Fixture size refusal',code:'sale_snapshot_too_large',proven_uncommitted:true})})
  })
  const {before}=await ringOne(page)
  await page.evaluate(({id,key})=>{
    const set=Storage.prototype.setItem
    Storage.prototype.setItem=function(name,value){
      if(this===localStorage&&name===key){
        const rows=JSON.parse(value) as Draft[]
        if(rows.some(row=>row.id===id&&!row.checkoutRequestId))throw new DOMException('Fixture local quota','QuotaExceededError')
      }
      return set.call(this,name,value)
    }
  },{id:before.id,key:`businessos_pos_orders_${account.id}`})
  expect((await submit(page)).status()).toBe(409)
  await expect(page.getByText(en.money_checkout_recovery_required,{exact:true})).toBeVisible()
  await expect.poll(async()=>(await draft(page))?.checkoutRequestId||'').not.toBe('')
  await page.reload()
  await expect(page.getByText(en.money_checkout_recovery_required,{exact:true})).toBeVisible()
  expect((await draft(page))?.cart).toEqual(before.cart)
})
