// Re-consent to the age-16 wording (owner, 20 Oct 2026), storefront side.
//   1. usePortalAccount, run for real over the real transport: /auth/me answering 428
//      portal_consent_required raises the prompt; Agree posts the combined tick (consent +
//      ageConfirmed true) to /account/consent/renew and signs the account in from that answer
//      (no second /auth/me, so no loop); a refusal keeps the prompt and the message; Close and
//      sign-out end it; a guest or a current account never sees it.
//   2. ConsentRenewalPrompt, rendered with stub hooks: the same combined tick as sign-up, a way
//      through (Agree), a way out (Sign out) and a way to keep browsing (Close), in EN and KM.
//   3. The page mounts the prompt from the hook state only, and sign-in sends the age confirmation.
//
// Run: node tests/portalConsentRenewal.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { buildSync } from 'esbuild'
import React from 'react'
import { resolveStorefrontCopy } from '../src/components/catalog/portalLanguagePacks.ts'
import { SRC } from './storefrontCopyScan.ts'

let passed = 0
async function check(name: string, fn: () => void | Promise<void>) { await fn(); passed += 1; console.log(`PASS ${name}`) }

type Json = Record<string, unknown>
const globals = globalThis as Record<string, unknown>

// ---- 1. the hook, over the real transport ----------------------------------
function loadHook() {
  const bundle = buildSync({
    entryPoints: [path.join(SRC, 'components/catalog/portalAccount.ts')],
    bundle: true, platform: 'node', format: 'cjs', external: ['react'], write: false, logLevel: 'silent',
  })
  const cells: unknown[] = []
  const mountEffects: Array<() => unknown> = []
  let cursor = 0
  let rendered = false
  const reactStub = {
    useState: (init: unknown) => {
      const at = cursor++
      if (!(at in cells)) cells[at] = typeof init === 'function' ? (init as () => unknown)() : init
      return [cells[at], (next: unknown) => { cells[at] = typeof next === 'function' ? (next as (v: unknown) => unknown)(cells[at]) : next }]
    },
    useRef: (value: unknown) => { const at = cursor++; if (!(at in cells)) cells[at] = { current: value }; return cells[at] },
    useCallback: (fn: unknown) => { cursor++; return fn },
    useEffect: (fn: () => unknown) => { cursor++; if (!rendered) mountEffects.push(fn) },
  }
  const mod = { exports: {} as Record<string, unknown> }
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)((id: string) => { assert.equal(id, 'react'); return reactStub }, mod, mod.exports)
  const usePortalAccount = mod.exports.usePortalAccount as (b: unknown, w: unknown) => Record<string, (...a: unknown[]) => Promise<boolean>> & Json
  const bucket = { items: [], setAll() {} }
  const wishlist = { items: [], setAll() {} }
  const render = () => { cursor = 0; const out = usePortalAccount(bucket, wishlist); rendered = true; return out }
  const mount = async () => { const first = render(); for (const effect of mountEffects) await effect(); await new Promise((r) => setTimeout(r, 20)); return first }
  return { render, mount }
}

async function withServer(routes: Record<string, { status: number; body: Json }>, run: (calls: Array<{ url: string; method: string; body: Json | null }>) => Promise<void>) {
  const calls: Array<{ url: string; method: string; body: Json | null }> = []
  const realFetch = globalThis.fetch
  const realWindow = globals.window
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, method: String(init?.method || 'GET'), body: init?.body ? JSON.parse(String(init.body)) : null })
    const route = Object.entries(routes).find(([suffix]) => url.endsWith(suffix))?.[1] || { status: 200, body: { items: [] } }
    return new Response(JSON.stringify(route.body), { status: route.status, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  try {
    const transport = await import('../src/api/portalPublicTransport.ts')
    globals.window = { location: { origin: 'https://shop.example' }, api: transport }
    await run(calls)
  } finally {
    globalThis.fetch = realFetch
    globals.window = realWindow
  }
}

const ME_428 = { status: 428, body: { account: null, error: 'Please agree to the current policies to continue.', code: 'portal_consent_required' } }
const PROFILE = { membershipId: 'LC-1', name: 'Dara', email: null }
const TICK = { consent: true, consentLocale: 'en', ageConfirmed: true }

await check('a session waiting for renewal raises the prompt; Agree signs in from the answer without asking /auth/me again', async () => {
  await withServer({ '/auth/me': ME_428, '/account/consent/renew': { status: 200, body: { ok: true, renewed: true, account: PROFILE } } }, async (calls) => {
    const hook = loadHook()
    await hook.mount()
    let state = hook.render()
    assert.equal(state.consentRenewal, true)
    assert.equal(state.account, null)
    assert.equal(await state.renewConsent(TICK), true)
    state = hook.render()
    assert.equal(state.consentRenewal, false, 'the prompt ends once Agree succeeded')
    assert.deepEqual(state.account, PROFILE)
    const renew = calls.filter((c) => c.url.endsWith('/account/consent/renew'))
    assert.equal(renew.length, 1)
    assert.deepEqual(renew[0].body, TICK, 'the combined tick sends consent and ageConfirmed true')
    assert.equal(calls.filter((c) => c.url.endsWith('/auth/me')).length, 1, 'no second /auth/me: the prompt cannot loop')
  })
})

await check('a refused renewal keeps the prompt, the message and the code; Close and sign-out end it', async () => {
  await withServer({ '/auth/me': ME_428, '/account/consent/renew': { status: 400, body: { error: 'Please confirm you are 16 or older to continue.', code: 'age_confirmation_required' } } }, async (calls) => {
    const hook = loadHook()
    await hook.mount()
    let state = hook.render()
    assert.equal(await state.renewConsent(TICK), false)
    state = hook.render()
    assert.equal(state.consentRenewal, true, 'a failed Agree keeps the prompt open')
    assert.equal(state.errorCode, 'age_confirmation_required')
    assert.equal(state.error, 'Please confirm you are 16 or older to continue.')
    ;(state.dismissConsentRenewal as unknown as () => void)()
    state = hook.render()
    assert.equal(state.consentRenewal, false, 'Close keeps the visitor browsing as a guest')
    assert.equal(state.error, '')
    assert.equal(state.account, null)
    assert.equal(calls.filter((c) => c.url.endsWith('/auth/signout')).length, 0, 'Close signs nobody out')
  })
  await withServer({ '/auth/me': ME_428, '/auth/signout': { status: 200, body: { ok: true } } }, async (calls) => {
    const hook = loadHook()
    await hook.mount()
    let state = hook.render()
    assert.equal(state.consentRenewal, true)
    await state.signOut()
    state = hook.render()
    assert.equal(state.consentRenewal, false, 'sign-out ends the prompt')
    assert.equal(calls.filter((c) => c.url.endsWith('/auth/signout')).length, 1)
  })
})

await check('a guest and a current account never see the prompt', async () => {
  for (const me of [{ status: 200, body: { account: null } }, { status: 200, body: { account: PROFILE } }]) {
    await withServer({ '/auth/me': me }, async () => {
      const hook = loadHook()
      await hook.mount()
      assert.equal(hook.render().consentRenewal, false)
    })
  }
})

await check('signing in again also ends the prompt', async () => {
  await withServer({ '/auth/me': ME_428, '/auth/signin': { status: 200, body: { ok: true, account: PROFILE } } }, async () => {
    const hook = loadHook()
    await hook.mount()
    let state = hook.render()
    assert.equal(await state.signIn({ identifier: 'Dara', phone: '012', password: 'x', ...TICK }), true)
    state = hook.render()
    assert.equal(state.consentRenewal, false)
    assert.deepEqual(state.account, PROFILE)
  })
})

// ---- 2. the prompt -----------------------------------------------------------
type Node = { type: unknown; props: Json & { children?: unknown } }
function loadPrompt() {
  const bundle = buildSync({
    entryPoints: [path.join(SRC, 'components/catalog/legal/ConsentRenewalPrompt.tsx')],
    bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], write: false, logLevel: 'silent',
  })
  const cells: unknown[] = []
  let cursor = 0
  // Real React for module-load helpers (icons); only the prompt's own useState is driven by hand.
  const reactStub = {
    ...React,
    useState: (init: unknown) => {
      const at = cursor++
      if (!(at in cells)) cells[at] = init
      return [cells[at], (next: unknown) => { cells[at] = next }]
    },
  }
  const runtime = { jsx: (type: unknown, props: Json) => ({ type, props }), jsxs: (type: unknown, props: Json) => ({ type, props }), Fragment: 'fragment' }
  const mod = { exports: {} as Record<string, unknown> }
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)((id: string) => (id === 'react' ? reactStub : runtime), mod, mod.exports)
  const Prompt = mod.exports.default as (props: Json) => Node
  return (props: Json) => { cursor = 0; return expand(Prompt(props)) }
}
// Calls the one function component the prompt owns (the consent field); icons and links stay opaque.
function expand(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(expand)
  if (!node || typeof node !== 'object') return node
  const el = node as Node
  if (typeof el.type === 'function' && (el.type as { name?: string }).name === 'SignupConsentField') return expand((el.type as (p: Json) => unknown)(el.props))
  return { ...el, props: { ...el.props, children: expand(el.props.children) } }
}
function walk(node: unknown, visit: (el: Node) => void) {
  if (Array.isArray(node)) { node.forEach((n) => walk(n, visit)); return }
  if (!node || typeof node !== 'object') return
  visit(node as Node)
  walk((node as Node).props.children, visit)
}
function textOf(node: unknown): string {
  let out = ''
  const go = (n: unknown) => {
    if (typeof n === 'string' || typeof n === 'number') out += String(n)
    else if (Array.isArray(n)) n.forEach(go)
    else if (n && typeof n === 'object') go((n as Node).props.children)
  }
  go(node)
  return out.replace(/\s+/g, ' ').trim()
}
const find = (tree: unknown, pred: (el: Node) => boolean) => { let hit: Node | null = null; walk(tree, (el) => { if (!hit && pred(el)) hit = el }); return hit as Node | null }

for (const language of ['en', 'km'] as const) {
  await check(`the ${language} prompt shows the combined tick with a way through, a way out and a way to keep browsing`, async () => {
    const copy = (key: string, fallback = '', fallbackKm = fallback) => resolveStorefrontCopy(language, (k: string) => k, key, fallback, fallbackKm)
    const render = loadPrompt()
    const calls: string[] = []
    const agreed: Json[] = []
    const props = (extra: Json = {}) => ({
      copy, busy: false, error: '', consentLocale: language,
      onAgree: async (payload: Json) => { agreed.push(payload); return true },
      onSignOut: () => calls.push('signout'),
      onClose: () => calls.push('close'),
      ...extra,
    })
    let tree = render(props())
    const dialog = find(tree, (el) => el.props.role === 'dialog')
    assert.ok(dialog && dialog.props['data-portal-consent-renewal'] === 'true', 'the dialog renders its real content from first paint')
    const label = language === 'en' ? 'I am 16 or older, and I agree to the Terms & Conditions and the Privacy Policy.' : 'ខ្ញុំមានអាយុ ១៦ ឆ្នាំឡើងទៅ ហើយខ្ញុំយល់ព្រមនឹងលក្ខខណ្ឌប្រើប្រាស់ និងគោលការណ៍ឯកជនភាព។'
    assert.ok(textOf(tree).includes(label), 'the same combined tick as sign-up')
    const box = find(tree, (el) => el.props.type === 'checkbox')!
    assert.equal(box.props.checked, false, 'never pre-ticked')

    const buttons = (t: unknown) => { const list: Node[] = []; walk(t, (el) => { if (el.type === 'button') list.push(el) }); return list }
    const labelled = (t: unknown, name: string) => buttons(t).find((b) => b.props['aria-label'] === name)!
    const signOutLabel = copy('signOut', 'Sign out')
    const closeLabel = copy('close', 'Close')
    ;(labelled(tree, signOutLabel).props.onClick as () => void)()
    ;(labelled(tree, closeLabel).props.onClick as () => void)()
    assert.deepEqual(calls, ['signout', 'close'], 'both ways out are one tap')
    assert.equal(labelled(tree, signOutLabel).props.title, signOutLabel, 'icon-only buttons carry a tooltip')

    const agree = buttons(tree).find((b) => !b.props['aria-label'])!
    await (agree.props.onClick as () => Promise<void>)()
    assert.equal(agreed.length, 0, 'Agree without the tick sends nothing')
    tree = render(props())
    assert.ok(textOf(find(tree, (el) => el.props.role === 'alert')).length > 0, 'and says why')

    ;(find(tree, (el) => el.props.type === 'checkbox')!.props.onChange as (e: Json) => void)({ target: { checked: true } })
    tree = render(props())
    assert.equal(find(tree, (el) => el.props.type === 'checkbox')!.props.checked, true)
    assert.equal(find(tree, (el) => el.props.role === 'alert'), null, 'ticking clears the message')
    await (buttons(tree).find((b) => !b.props['aria-label'])!.props.onClick as () => Promise<void>)()
    assert.deepEqual(agreed, [{ consent: true, consentLocale: language, ageConfirmed: true }])

    tree = render(props({ busy: true, error: 'Server said no' }))
    assert.equal(buttons(tree).find((b) => !b.props['aria-label'])!.props.disabled, true, 'no double submit while busy')
    assert.equal(textOf(find(tree, (el) => el.props.role === 'alert')), 'Server said no', 'a refusal keeps its message')
  })
}

// ---- 3. page wiring ------------------------------------------------------------
await check('the page mounts the prompt from hook state only, and sign-in sends the age confirmation', () => {
  const page = fs.readFileSync(path.join(SRC, 'components/catalog/PublicCatalogPage.tsx'), 'utf8').replace(/\r\n/g, '\n')
  assert.match(page, /\{portalAccount\.consentRenewal \? \(\n\s*<Suspense fallback=\{null\}>\n\s*<ConsentRenewalPrompt/)
  assert.match(page, /lazyRetry\(\(\) => import\('\.\/legal\/ConsentRenewalPrompt'\)/)
  assert.match(page, /onAgree=\{portalAccount\.renewConsent\}/)
  assert.match(page, /onSignOut=\{portalAccount\.signOut\}/)
  assert.match(page, /onClose=\{portalAccount\.dismissConsentRenewal\}/)
  const section = fs.readFileSync(path.join(SRC, 'components/catalog/CatalogAccountSection.tsx'), 'utf8').replace(/\r\n/g, '\n')
  assert.match(section, /await signIn\(\{[^}]*\.\.\.signupConsentFields\(consent, consentLocale\)/)
})

console.log(`\n${passed} passed`)
