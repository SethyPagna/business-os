// G38 P0, storefront account drawer:
//   1. the "do you already have a membership ID?" reminder is asked in the
//      shared ConfirmDialog, never the browser's untranslatable confirm(), and
//      the account is created only from the dialog's Confirm;
//   2. the owner's sign-up switch (customer_portal_signup_enabled, public
//      config signupEnabled) hides the Sign up tab and says so, EN and KM,
//      while sign-in stays. Sign-up is OFF unless the server says exactly
//      true (owner ruling 6 Oct): no prop or a config without the field (first
//      paint, a failed bootstrap) shows no Sign up tab;
//   2b. a sign-up the server refused as paused (403 portal_signup_paused)
//      carries its code through the real transport and usePortalAccount,
//      closes the Sign up tab and is announced in the visitor's language,
//      not server English;
//   3. an AI chat refused by the daily budget carries its code to the page,
//      which shows the EN/KM "today's limit" line instead of server English.
//
// Run: node tests/storefrontSignupDialog.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { buildSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolveStorefrontCopy } from '../src/components/catalog/portalLanguagePacks.ts'
import { SRC, storefrontTranslator } from './storefrontCopyScan.ts'

const t = storefrontTranslator()
const requireActual = createRequire(import.meta.url)
function loadModule(relative: string) {
  const bundle = buildSync({
    entryPoints: [path.join(SRC, relative)],
    bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
    external: ['react', 'react-dom'], loader: { '.css': 'empty' }, write: false, logLevel: 'silent',
  })
  const module = { exports: {} as Record<string, unknown> }
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(requireActual, module, module.exports)
  return module.exports
}
const visibleText = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const copyFor = (language: 'en' | 'km') => (key: string, fallback = '', fallbackKm = fallback) =>
  resolveStorefrontCopy(language, t, key, fallback, fallbackKm)

let passed = 0
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve().then(fn).then(
    () => { passed += 1; console.log(`PASS ${name}`) },
    (error: Error) => { process.exitCode = 1; console.log(`FAIL ${name}: ${error.message}`) },
  )
}

const accountSource = fs.readFileSync(path.join(SRC, 'components/catalog/CatalogAccountSection.tsx'), 'utf8')

await check('the sign-up reminder is the shared ConfirmDialog, and only its Confirm creates the account', () => {
  assert.doesNotMatch(accountSource, /\b(?:window|globalThis)\.confirm\s*\(/, 'no native confirm()')
  assert.match(accountSource, /import ConfirmDialog from '\.\.\/shared\/ConfirmDialog\.tsx'/)
  assert.match(accountSource, /<ConfirmDialog\b[\s\S]*?onConfirm=\{\(\) => \{ setReminderOpen\(false\); void submitSignUp\(\) \}\}/)
  const onSignUp = accountSource.slice(accountSource.indexOf('const onSignUp'), accountSource.indexOf('const submitSignUp'))
  assert.ok(onSignUp.length > 0, 'onSignUp found')
  const ask = onSignUp.indexOf('setReminderOpen(true)')
  assert.ok(ask > 0, 'an empty membership ID opens the reminder')
  assert.match(onSignUp.slice(ask), /^setReminderOpen\(true\)\s*\n\s*return\b/, 'and returns before any sign-up call')
  assert.equal((onSignUp.match(/signUp\(/g) || []).length, 0, 'onSignUp itself never calls signUp')
  assert.match(accountSource, /cancelLabel=\{copy\('back', 'Back', 'ត្រឡប់'\)\}/, 'Back is the cancel action, translated')
})

const CatalogAccountSection = loadModule('components/catalog/CatalogAccountSection.tsx').default as React.ComponentType<Record<string, unknown>>
const baseProps = { account: null, ready: true, busy: false, error: '', signIn: async () => true, signUp: async () => true, signOut: () => {}, clearError: () => {}, cartCount: 0, wishlistCount: 0 }
const PAUSED = {
  en: 'New accounts are paused for now. Existing members can sign in below.',
  km: 'ការបង្កើតគណនីថ្មីត្រូវបានផ្អាកសិន។ សមាជិកដែលមានស្រាប់អាចចូលគណនីខាងក្រោម។',
}

const SERVER_PAUSED_EN = 'New accounts are paused. Existing members can still sign in.'
for (const language of ['en', 'km'] as const) {
  const copy = copyFor(language)
  const signUpLabel = copy('signUp', 'Sign up')
  const signInLabel = copy('signIn', 'Sign in')
  const assertPaused = (html: string, why: string) => {
    const text = visibleText(html)
    assert.ok(!text.includes(signUpLabel), `no Sign up tab: ${why}`)
    assert.ok(text.includes(PAUSED[language]), `the ${language} paused line is shown: ${why}`)
    assert.ok(text.includes(signInLabel), `sign-in stays: ${why}`)
    assert.match(html, /autoComplete="current-password"|autocomplete="current-password"/i, `the sign-in form is rendered: ${why}`)
  }
  await check(`${language}: no Sign up tab unless the owner turned sign-up on (missing or false)`, () => {
    assertPaused(renderToStaticMarkup(React.createElement(CatalogAccountSection, { ...baseProps, copy })), 'no signupEnabled prop (config without the field)')
    assertPaused(renderToStaticMarkup(React.createElement(CatalogAccountSection, { ...baseProps, copy, signupEnabled: false })), 'signupEnabled false')
    const open = renderToStaticMarkup(React.createElement(CatalogAccountSection, { ...baseProps, copy, signupEnabled: true }))
    assert.ok(visibleText(open).includes(signUpLabel), 'Sign up tab present when the owner turned it on')
    assert.doesNotMatch(open, /data-portal-signup-paused/)
  })
  await check(`${language}: a sign-up refused as paused closes the Sign up tab and is announced in the visitor's language`, () => {
    const html = renderToStaticMarkup(React.createElement(CatalogAccountSection, { ...baseProps, copy, signupEnabled: true, error: SERVER_PAUSED_EN, errorCode: 'portal_signup_paused' }))
    assertPaused(html, 'server answered portal_signup_paused')
    const alert = /<div[^>]*role="alert"[^>]*>([\s\S]*?)<\/div>/.exec(html)
    assert.ok(alert, 'the refusal is announced (role=alert)')
    assert.equal(visibleText(alert[1]), PAUSED[language], 'the alert says the paused line, translated')
    if (language === 'km') assert.ok(!visibleText(html).includes(SERVER_PAUSED_EN), 'no server English on a Khmer page')
    assert.equal(visibleText(html).split(PAUSED[language]).length - 1, 1, 'said once, not twice')
    const other = renderToStaticMarkup(React.createElement(CatalogAccountSection, { ...baseProps, copy, signupEnabled: true, error: 'Invalid sign-in details. Please check and try again.', errorCode: 'invalid_credentials' }))
    assert.ok(visibleText(other).includes('Invalid sign-in details. Please check and try again.'), 'other refusals keep their message')
    assert.ok(visibleText(other).includes(signUpLabel), 'and leave the Sign up tab alone')
  })
}

await check('the storefront opens sign-up only on an explicit true and hands the refusal code to the drawer', () => {
  const page = fs.readFileSync(path.join(SRC, 'components/catalog/PublicCatalogPage.tsx'), 'utf8').replace(/\r\n/g, '\n')
  assert.match(page, /signupEnabled=\{displayConfig\.signupEnabled === true\}/)
  assert.match(page, /errorCode=\{portalAccount\.errorCode\}/)
  const start = page.indexOf('const DEFAULT_PUBLIC_CONFIG')
  const defaults = page.slice(start, page.indexOf('\n}\n', start))
  assert.ok(start > 0 && defaults.length > 0, 'DEFAULT_PUBLIC_CONFIG found')
  assert.doesNotMatch(defaults, /signupEnabled\s*:/, 'the page default has no sign-up answer of its own')
  const paint = fs.readFileSync(path.join(SRC, 'components/catalog/publicFirstPaint.ts'), 'utf8').replace(/\r\n/g, '\n')
  assert.doesNotMatch(paint, /signupEnabled\s*:/, 'first paint carries no sign-up answer, so it paints the paused state until /bootstrap says true')
})

await check('usePortalAccount keeps the server refusal code from the real transport, and clearError drops it', async () => {
  const bundle = buildSync({
    entryPoints: [path.join(SRC, 'components/catalog/portalAccount.ts')],
    bundle: true, platform: 'node', format: 'cjs', external: ['react'], write: false, logLevel: 'silent',
  })
  // A minimal hook runtime: state cells keyed by call order, re-read by calling the hook again.
  const cells: unknown[] = []
  let cursor = 0
  const reactStub = {
    useState: (init: unknown) => {
      const at = cursor++
      if (!(at in cells)) cells[at] = typeof init === 'function' ? (init as () => unknown)() : init
      return [cells[at], (next: unknown) => { cells[at] = typeof next === 'function' ? (next as (v: unknown) => unknown)(cells[at]) : next }]
    },
    useRef: (value: unknown) => { const at = cursor++; if (!(at in cells)) cells[at] = { current: value }; return cells[at] },
    useCallback: (fn: unknown) => { cursor++; return fn },
    useEffect: () => { cursor++ },
  }
  const mod = { exports: {} as Record<string, unknown> }
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)((id: string) => { assert.equal(id, 'react'); return reactStub }, mod, mod.exports)
  const usePortalAccount = mod.exports.usePortalAccount as (b: unknown, w: unknown) => Record<string, unknown>
  const bucket = { items: [], setAll() {} }
  const wishlist = { items: [], setAll() {} }
  const render = () => { cursor = 0; return usePortalAccount(bucket, wishlist) }

  const realFetch = globalThis.fetch
  const globals = globalThis as Record<string, unknown>
  const realWindow = globals.window
  let answer = { status: 403, body: { error: SERVER_PAUSED_EN, code: 'portal_signup_paused' } as Record<string, unknown> }
  globalThis.fetch = (async () => new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'Content-Type': 'application/json' } })) as typeof fetch
  try {
    const transport = await import('../src/api/portalPublicTransport.ts')
    globals.window = { location: { origin: 'https://shop.example' }, api: transport }
    const first = render()
    assert.equal(await (first.signUp as (p: unknown) => Promise<boolean>)({ name: 'x' }), false)
    let state = render()
    assert.equal(state.errorCode, 'portal_signup_paused', 'the paused code reaches the drawer')
    assert.equal(state.error, SERVER_PAUSED_EN)
    ;(state.clearError as () => void)()
    state = render()
    assert.equal(state.errorCode, '', 'clearError drops the code with the message')
    answer = { status: 401, body: { error: 'Invalid sign-in details. Please check and try again.', code: 'invalid_credentials' } }
    await (state.signIn as (p: unknown) => Promise<boolean>)({ phone: 'x' })
    state = render()
    assert.equal(state.errorCode, 'invalid_credentials')
  } finally {
    globalThis.fetch = realFetch
    globals.window = realWindow
  }
})

await check('an AI chat refused by the daily budget keeps its code and is shown in the visitor\'s language', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'The shopping assistant has reached today\'s limit. Please try again tomorrow.', code: 'portal_ai_budget_exhausted' }), { status: 429, headers: { 'Content-Type': 'application/json' } })) as typeof fetch
  try {
    const transport = await import('../src/api/portalPublicTransport.ts')
    await assert.rejects(transport.askPortalAi({ question: 'x', dataUseConsent: true }), (error: Error & { code?: string }) => error.code === 'portal_ai_budget_exhausted')
  } finally {
    globalThis.fetch = realFetch
  }
  const page = fs.readFileSync(path.join(SRC, 'components/catalog/PublicCatalogPage.tsx'), 'utf8')
  assert.match(page, /code === 'portal_ai_budget_exhausted'\s*\n\s*\? copy\('assistantDailyLimit', 'The assistant has reached today\\'s limit\. Please try again tomorrow\.', 'ជំនួយការបានដល់ចំនួនកំណត់សម្រាប់ថ្ងៃនេះហើយ។ សូមព្យាយាមម្តងទៀតនៅថ្ងៃស្អែក។'\)/)
})

console.log(`\n${passed} passed${process.exitCode ? ', FAILURES above' : ''}`)
