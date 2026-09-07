// N45: the storefront asks for agreement to the Terms & Conditions and the
// Privacy Policy before it creates an account, and BOTH halves of that rule
// have to hold. This file owns the frontend half and the parity that ties it
// to the Worker half (cloudflare/scripts/test-portal-legal-consent-pure.cjs,
// which runs the real signup against a real database).
//
// The checkbox is RENDERED here, not regex-matched: SignupConsentField is
// bundled with esbuild and rendered to static markup, so a box that is
// silently pre-ticked, not required, unlabelled, or missing a policy link
// fails -- none of which a source grep would notice.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildSync } from 'esbuild'
import { PORTAL_LEGAL_CONSENT_VERSION, PORTAL_LEGAL_LAST_UPDATED_ISO } from '../src/components/catalog/legal/legalContent.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), 'utf8')

const accountSource = read('../src/components/catalog/CatalogAccountSection.tsx')
const workerAccounts = read('../../cloudflare/src/lib/portalAccounts.ts')
const workerRoute = read('../../cloudflare/src/routes/portal.ts')

type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string
type ConsentProps = { copy: CopyFn; checked: boolean; onChange: (next: boolean) => void; error?: string }

let ConsentField: React.FunctionComponent<ConsentProps> | null = null

async function loadConsentField(): Promise<React.FunctionComponent<ConsentProps>> {
  if (ConsentField) return ConsentField
  const built = buildSync({
    entryPoints: [path.resolve(here, '../src/components/catalog/legal/SignupConsentField.tsx')],
    bundle: true, write: false, format: 'esm', platform: 'neutral', jsx: 'automatic',
    target: 'es2020', logLevel: 'silent',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  })
  // The bundle still imports react by bare specifier, and a data: module has
  // no package resolution of its own -- point those at the real files.
  const requireFrom = createRequire(import.meta.url)
  const source = built.outputFiles[0].text.replace(
    /from\s*"(react(?:\/[\w.-]+)*)"/g,
    (_all, specifier) => `from "${pathToFileURL(requireFrom.resolve(specifier)).href}"`,
  )
  const mod = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
  ConsentField = (mod as { default: React.FunctionComponent<ConsentProps> }).default
  return ConsentField
}

// The portal `copy` contract: key, English fallback, Khmer fallback. Picking
// the fallback for the requested language is what the real one does when the
// language pack has no entry for the key.
const copyIn = (lang: 'en' | 'km'): CopyFn => (_key, fallbackEn, fallbackKm) => (
  lang === 'km' ? fallbackKm ?? fallbackEn ?? '' : fallbackEn ?? ''
)

const KHMER = /[ក-៿]/

test('the consent checkbox is required, unticked, labelled, and links to both policies', async () => {
  const Field = await loadConsentField()
  const html = renderToStaticMarkup(
    React.createElement(Field, { copy: copyIn('en'), checked: false, onChange: () => {} }),
  )
  const checkbox = html.match(/<input[^>]*type="checkbox"[^>]*>/)
  assert.ok(checkbox, 'no consent checkbox was rendered')
  assert.match(checkbox[0], /required/, 'the consent checkbox must be required')
  assert.doesNotMatch(checkbox[0], /checked=""|checked="checked"/, 'consent must never be pre-ticked')
  // Keyboard/screen-reader reachable: a real label pointing at the box.
  const id = checkbox[0].match(/id="([^"]+)"/)
  assert.ok(id, 'the checkbox needs an id for its label')
  assert.match(html, new RegExp(`<label[^>]*for="${id[1]}"`), 'the checkbox has no associated label')
  assert.match(html, /I agree to the Terms &amp; Conditions and the Privacy Policy\./)
  assert.match(html, /href="[^"]*legal=terms"/, 'the consent line must link to the Terms')
  assert.match(html, /href="[^"]*legal=privacy"/, 'the consent line must link to the Privacy Policy')
})

test('a ticked box renders ticked, and a refusal message is announced', async () => {
  const Field = await loadConsentField()
  const ticked = renderToStaticMarkup(
    React.createElement(Field, { copy: copyIn('en'), checked: true, onChange: () => {} }),
  )
  const tickedBox = ticked.match(/<input[^>]*type="checkbox"[^>]*>/)
  assert.ok(tickedBox, 'no consent checkbox was rendered')
  assert.match(tickedBox[0], /checked=""/)

  const failed = renderToStaticMarkup(
    React.createElement(Field, { copy: copyIn('en'), checked: false, onChange: () => {}, error: 'Nope.' }),
  )
  const failedBox = failed.match(/<input[^>]*type="checkbox"[^>]*>/)
  assert.ok(failedBox, 'no consent checkbox was rendered')
  const box = failedBox[0]
  const describedBy = box.match(/aria-describedby="([^"]+)"/)
  assert.ok(describedBy, 'the failure message must be tied to the checkbox')
  assert.match(box, /aria-invalid="true"/)
  assert.match(failed, new RegExp(`id="${describedBy[1]}"[^>]*role="alert"`), 'the message must be announced')
})

test('the Khmer visitor gets Khmer, not English', async () => {
  const Field = await loadConsentField()
  const html = renderToStaticMarkup(
    React.createElement(Field, { copy: copyIn('km'), checked: false, onChange: () => {} }),
  )
  assert.match(html, KHMER, 'nothing Khmer was rendered')
  assert.doesNotMatch(html, /I agree to the Terms/, 'the Khmer line fell back to English')
  const km = JSON.parse(read('../src/lang/km.json'))
  for (const key of [
    'portal_legal_consent_label', 'portal_legal_consent_required',
    'portal_legal_consent_read_terms', 'portal_legal_consent_read_privacy',
  ]) {
    assert.ok(km[key], `km.json is missing ${key}`)
    assert.match(km[key], KHMER, `${key} is not Khmer`)
  }
})

test('the consent value is sent to the server, not only checked in the browser', () => {
  assert.match(
    accountSource,
    /signUp\(\{ name, phone: signupPhone, membershipId, password: signupPassword, consent, consentLocale \}\)/,
    'the sign-up payload drops consent',
  )
  assert.match(accountSource, /const \[consent, setConsent\] = useState\(false\)/, 'consent must default to unticked')
  // An unticked submit must never reach signUp -- otherwise the only thing
  // standing between a blank consent and an account is the browser's own
  // validation, which a form with novalidate simply turns off.
  const guard = accountSource.indexOf('if (!consent) {')
  const call = accountSource.indexOf('const ok = await signUp(')
  assert.ok(guard > 0, 'the submit handler does not guard on consent')
  assert.ok(guard < call, 'the consent guard must run before signUp')
})

// --- parity with the Worker -----------------------------------------------

test('the browser rule and the Worker rule are the same rule', () => {
  // /api/portal/auth/signup is public and unauthenticated: the checkbox is a
  // prompt, the Worker is the enforcement.
  assert.match(workerAccounts, /consentGiven\(input\.consent\)/, 'the Worker does not check consent')
  assert.match(workerAccounts, /code: 'consent_required'/, 'the Worker has no consent_required refusal')
  assert.match(workerRoute, /consent: body\.consent/, 'the signup route never forwards consent')
  // Refused BEFORE any customer lookup, so the endpoint cannot double as a
  // phone-existence oracle for a caller who never consents.
  const bodyStart = workerAccounts.indexOf('export async function signupPortalAccount')
  const bodyEnd = workerAccounts.indexOf('async function claimAccount', bodyStart)
  assert.ok(bodyStart > 0 && bodyEnd > bodyStart, 'signupPortalAccount moved; re-anchor this check')
  const body = workerAccounts.slice(bodyStart, bodyEnd)
  const gate = body.indexOf("code: 'consent_required'")
  const firstLookup = body.search(/db\.prepare\(|findCustomerByCanonicalPhone\(/)
  assert.ok(gate > 0, 'signupPortalAccount does not refuse without consent')
  assert.ok(firstLookup > gate, 'consent must be checked before any customer lookup')
})

test('the recorded consent version is the version of the text the visitor saw', () => {
  assert.equal(PORTAL_LEGAL_CONSENT_VERSION, `portal-legal-${PORTAL_LEGAL_LAST_UPDATED_ISO}`)
  const workerVersion = workerAccounts.match(/PORTAL_CONSENT_VERSION = '([^']+)'/)
  assert.ok(workerVersion, 'the Worker publishes no consent version')
  assert.equal(
    workerVersion[1],
    PORTAL_LEGAL_CONSENT_VERSION,
    'the Worker would stamp a version the storefront never showed',
  )
})

test('consent storage is additive and account writes fail closed until it exists', () => {
  const migration = read('../../cloudflare/migrations/0130_portal_account_consent.sql')
  assert.ok(!migration.includes('\r'), 'migration SQL must be LF-only')
  assert.match(migration, /ADD COLUMN consent_version TEXT;/)
  assert.match(migration, /ADD COLUMN consent_at TEXT;/)
  assert.match(migration, /ADD COLUMN consent_locale TEXT;/)
  assert.match(workerAccounts, /PRAGMA table_info\("portal_accounts"\)/)
  assert.match(workerAccounts, /code: 'consent_storage_unavailable'/)
  assert.match(workerAccounts, /consent_version[\s\S]{0,80}consent_at[\s\S]{0,80}consent_locale/)
})
