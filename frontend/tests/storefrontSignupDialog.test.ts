// G38 P0, storefront account drawer:
//   1. the "do you already have a membership ID?" reminder is asked in the
//      shared ConfirmDialog, never the browser's untranslatable confirm(), and
//      the account is created only from the dialog's Confirm;
//   2. the owner's sign-up switch (customer_portal_signup_enabled, public
//      config signupEnabled) hides the Sign up tab and says so, EN and KM,
//      while sign-in stays;
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

for (const language of ['en', 'km'] as const) {
  const copy = copyFor(language)
  const signUpLabel = copy('signUp', 'Sign up')
  const signInLabel = copy('signIn', 'Sign in')
  await check(`${language}: the Sign up tab shows by default and disappears when the owner pauses sign-ups`, () => {
    const open = renderToStaticMarkup(React.createElement(CatalogAccountSection, { ...baseProps, copy }))
    assert.ok(visibleText(open).includes(signUpLabel), 'Sign up tab present by default')
    assert.doesNotMatch(open, /data-portal-signup-paused/)
    const paused = renderToStaticMarkup(React.createElement(CatalogAccountSection, { ...baseProps, copy, signupEnabled: false }))
    const text = visibleText(paused)
    assert.ok(!text.includes(signUpLabel), 'no Sign up tab while paused')
    assert.ok(text.includes(PAUSED[language]), `the ${language} paused line is shown`)
    assert.ok(text.includes(signInLabel), 'sign-in stays')
    assert.match(paused, /autoComplete="current-password"|autocomplete="current-password"/i, 'the sign-in form is rendered')
  })
}

await check('the storefront passes the public signupEnabled to the drawer', () => {
  const page = fs.readFileSync(path.join(SRC, 'components/catalog/PublicCatalogPage.tsx'), 'utf8')
  assert.match(page, /signupEnabled=\{displayConfig\.signupEnabled !== false\}/)
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
