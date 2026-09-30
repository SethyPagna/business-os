import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness, propsOf } from './mountedComponentHarness.ts'
import { STORAGE_KEYS } from '../src/constants.ts'

const english = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const remembered = { name: 'Previous Company', slug: 'previous', public_id: 'previous-public' }
const current = { name: 'Current Company', slug: 'current', public_id: 'current-public' }
const harness = await createHarness({ localStorage: { [STORAGE_KEYS.ORGANIZATION]: JSON.stringify(remembered) } })
let unavailable = true
let bootstrapCalls = 0
const searches: string[] = []
const logins: unknown[][] = []
Object.assign(window, {
  api: {
    getVerificationCapabilities: async () => ({}),
    getOrganizationBootstrap: async () => {
      bootstrapCalls += 1
      if (unavailable) throw Object.assign(new Error('D1 unavailable'), { status: 500 })
      return { organization: current, organizationCreationEnabled: false }
    },
    searchOrganizations: async (query: string) => {
      searches.push(query)
      return { items: [] }
    },
  },
})

try {
  const surface = await harness.mount({
    component: 'components/auth/Login.tsx',
    app: {
      settings: {}, language: 'en', t: (key: string) => english[key] || key,
      login: async (...args: unknown[]) => { logins.push(args); return { success: false } },
      persistAuthenticatedUser: async () => {},
    },
    doubles: { 'api/portalPublicTransport.ts': { getPortalConfig: async () => ({}) } },
  })
  assert.equal(bootstrapCalls, 1)
  await surface.type(surface.field('organization_search'), 'L')
  assert.equal(propsOf(surface.field('organization_search')).value, 'L', 'failed bootstrap must not collapse the search after its first character')
  await surface.type(surface.field('organization_search'), 'Local Company')
  assert.equal(searches.at(-1), 'Local Company')
  assert.ok(surface.text().includes(english.connection_failed), 'the failed organization lookup is visible')
  await surface.type(surface.field('username'), 'fixture-user')
  await surface.type(surface.field('password'), 'fixture-password')
  const form = surface.find((node) => node.tagName === 'FORM', 'sign-in form')
  await surface.call(form, 'onSubmit', [{ preventDefault() {} }])
  assert.equal(logins[0][3], 'Local Company', 'manual organization input remains available to the server login')

  unavailable = false
  await surface.click(surface.button(english.retry))
  assert.equal(bootstrapCalls, 2, 'retry sends one fresh bootstrap read')
  assert.equal(surface.findAll((node) => node.getAttribute('name') === 'organization_search').length, 0)
  assert.ok(surface.text().includes(current.name), 'the successful server organization wins over remembered browser data')
  assert.ok(!surface.text().includes(english.connection_failed))
  await surface.call(form, 'onSubmit', [{ preventDefault() {} }])
  assert.equal(logins[1][3], current.public_id)
  console.log('PASS organization failure stays editable, shows failure, retries and uses the server organization')

  await surface.unmount()
  localStorage.setItem(STORAGE_KEYS.ORGANIZATION, '{malformed')
  const fresh = await harness.mount({
    component: 'components/auth/Login.tsx',
    app: { settings: {}, language: 'en', t: (key: string) => english[key] || key, login: async () => ({}), persistAuthenticatedUser: async () => {} },
    doubles: { 'api/portalPublicTransport.ts': { getPortalConfig: async () => ({}) } },
  })
  assert.equal(bootstrapCalls, 3, 'corrupt remembered JSON must not prevent the server lookup')
  assert.ok(fresh.text().includes(current.name))
  console.log('PASS malformed remembered organization does not prevent a successful bootstrap')
} finally {
  await harness.close()
}
