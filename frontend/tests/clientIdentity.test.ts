// The client identity the frontend reads (src/app/clientIdentity.ts) must be
// the one the Worker writes (cloudflare/src/lib/clientIdentity.ts): the same
// neutral default, the same field shapes, and index.html's static block equal
// to that default. A drift here is a shop name or icon that differs between
// the raw document and the running app.
//
// Run: node tests/clientIdentity.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  NEUTRAL_CLIENT_IDENTITY,
  getClientIdentity,
  parseClientIdentity,
  withShopName,
} from '../src/app/clientIdentity.ts'
import { customerMembershipPlaceholder, isHouseCustomerMembershipNumber } from '../src/components/contacts/customerMembershipNumber.ts'
import * as worker from '../../cloudflare/src/lib/clientIdentity.ts'

const read = (relPath: string): string =>
  fs.readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

function tomlVars(relPath: string): Record<string, string> {
  const text = read(relPath)
  const block = text.slice(text.indexOf('\n[vars]\n'))
  const vars: Record<string, string> = {}
  for (const match of block.matchAll(/^([A-Z][A-Z0-9_]*) = "([^"]*)"$/gm)) vars[match[1]] = match[2]
  return vars
}

const leangVars = tomlVars('../../cloudflare/wrangler.toml')
const leang = worker.resolveClientIdentity(leangVars)

assert.deepEqual(NEUTRAL_CLIENT_IDENTITY, worker.NEUTRAL_CLIENT_IDENTITY, 'frontend and Worker share one neutral identity')

const indexHtml = read('../index.html')
const block = /<script id="business-os-identity" type="application\/json">([^<]*)<\/script>/.exec(indexHtml)
assert.ok(block, 'index.html carries the identity block the Worker rewrites')
assert.equal(block[1], worker.clientIdentityJson(worker.NEUTRAL_CLIENT_IDENTITY), 'its static content is the neutral identity')
assert.doesNotMatch(indexHtml, /leang/i, 'the shared document names no client')

assert.deepEqual(parseClientIdentity(JSON.parse(worker.clientIdentityJson(leang))), leang, 'what the Worker writes, the app reads back unchanged')
assert.equal(leang.shopName, 'Leang Cosmetics')
assert.equal(leang.shopAlias, 'Leang Beauty')
assert.equal(leang.shopNames, 'Leang Cosmetics/Leang Beauty')
assert.equal(leang.adminTitle, 'Leang Cosmetics Admin')
assert.equal(leang.adminShortName, 'Leang Admin')
assert.equal(leang.membershipPrefix, 'LC-')
assert.equal(leang.shopCategory, 'beauty')
assert.equal(leang.shopIcons.icon512, '/leang-cosmetics-icon-512-v2.png')
for (const icon of Object.values(leang.shopIcons)) {
  assert.ok(fs.existsSync(fileURLToPath(new URL(`../public${icon}`, import.meta.url))), `${icon} ships in public/`)
}

assert.deepEqual(parseClientIdentity(null), NEUTRAL_CLIENT_IDENTITY, 'no block reads as neutral')
assert.deepEqual(parseClientIdentity({ shopName: 42, shopIcons: 'x', shopCategory: 'Beauty' }), NEUTRAL_CLIENT_IDENTITY, 'mistyped fields fall back field by field')
assert.equal(parseClientIdentity({ shopName: 'BM Shop' }).shopNames, 'BM Shop', 'no alias: the name stands alone')
assert.equal(parseClientIdentity({ shopName: 'BM Shop' }).shopAlias, '')

assert.equal(getClientIdentity(), getClientIdentity(), 'read once per page')
assert.deepEqual(getClientIdentity(), NEUTRAL_CLIENT_IDENTITY, 'outside a browser the identity is neutral')

assert.equal(withShopName('WE, {shopNames} take no online payments. Install {shop}.', leang), 'WE, Leang Cosmetics/Leang Beauty take no online payments. Install Leang Cosmetics.')
assert.equal(withShopName('Install {shop}: {shop}', parseClientIdentity({ shopName: 'BM Shop' })), 'Install BM Shop: BM Shop')
assert.equal(withShopName('from {shopAlias}', leang), 'from Leang Beauty')
assert.equal(withShopName('from {shopAlias}', parseClientIdentity({ shopName: 'BM Shop' })), 'from BM Shop', 'no alias: {shopAlias} reads as the name')

assert.equal(customerMembershipPlaceholder('LC-'), 'LC-00001')
assert.equal(customerMembershipPlaceholder('BM-'), 'BM-00001')
assert.equal(customerMembershipPlaceholder(), 'M-00001', 'neutral default prefix')
assert.equal(isHouseCustomerMembershipNumber(' lc-00042 ', 'LC-'), true)
assert.equal(isHouseCustomerMembershipNumber('LC-00042', 'BM-'), false)
assert.equal(isHouseCustomerMembershipNumber('LC-', 'LC-'), false)
assert.equal(isHouseCustomerMembershipNumber('LCMN-DEADBEEF', 'LC-'), false)

console.log('clientIdentity: ok')
