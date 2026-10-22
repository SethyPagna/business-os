// The client identity the frontend reads (src/app/clientIdentity.ts) must be
// the one the Worker writes (cloudflare/src/lib/clientIdentity.ts): the same
// neutral default, the same field shapes, and index.html's static block equal
// to that default. A drift here is a shop name or icon that differs between
// the raw document and the running app.
//
// The structural checks run as the neutral fixture client (the committed
// template rendered with clients/example.env, see clientFixtureIdentity.ts).
// Leang Cosmetics' own strings are pinned from the private Records/Clients/
// leang.env, where this machine has it; elsewhere (CI) that block prints SKIP.
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
import { fixtureVars, leangVars, skipLeang } from './clientFixtureIdentity.ts'

const read = (relPath: string): string =>
  fs.readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

const client = worker.resolveClientIdentity(fixtureVars())

assert.deepEqual(NEUTRAL_CLIENT_IDENTITY, worker.NEUTRAL_CLIENT_IDENTITY, 'frontend and Worker share one neutral identity')

const indexHtml = read('../index.html')
const block = /<script id="business-os-identity" type="application\/json">([^<]*)<\/script>/.exec(indexHtml)
assert.ok(block, 'index.html carries the identity block the Worker rewrites')
assert.equal(block[1], worker.clientIdentityJson(worker.NEUTRAL_CLIENT_IDENTITY), 'its static content is the neutral identity')
assert.doesNotMatch(indexHtml, /leang/i, 'the shared document names no client')

assert.deepEqual(parseClientIdentity(JSON.parse(worker.clientIdentityJson(client))), client, 'what the Worker writes, the app reads back unchanged')
assert.equal(client.shopName, 'Example Shop')
assert.equal(client.shopAlias, 'Example Cosmetics')
assert.equal(client.shopNames, 'Example Shop/Example Cosmetics')
assert.equal(client.adminTitle, 'Example Shop Admin')
assert.equal(client.adminShortName, 'Ex Admin')
assert.equal(client.membershipPrefix, 'EX-')
assert.equal(client.shopCategory, 'beauty')
assert.equal(client.shopIcons.icon512, '/example-shop-icon-512-v2.png')

const leangRaw = leangVars()
if (leangRaw) {
  const leang = worker.resolveClientIdentity(leangRaw)
  assert.deepEqual(parseClientIdentity(JSON.parse(worker.clientIdentityJson(leang))), leang, "what the Worker writes for Leang, the app reads back unchanged")
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
  assert.equal(withShopName('WE, {shopNames} take no online payments. Install {shop}.', leang), 'WE, Leang Cosmetics/Leang Beauty take no online payments. Install Leang Cosmetics.')
  assert.equal(withShopName('from {shopAlias}', leang), 'from Leang Beauty')
  assert.equal(customerMembershipPlaceholder(leang.membershipPrefix), 'LC-00001')
  assert.equal(isHouseCustomerMembershipNumber(' lc-00042 ', leang.membershipPrefix), true)
  assert.equal(isHouseCustomerMembershipNumber('LC-00042', 'SM-'), false, "another client's number is not this client's house format")
} else {
  skipLeang('clientIdentity.test', "Leang's identity strings and shipped icons")
}

assert.deepEqual(parseClientIdentity(null), NEUTRAL_CLIENT_IDENTITY, 'no block reads as neutral')
assert.deepEqual(parseClientIdentity({ shopName: 42, shopIcons: 'x', shopCategory: 'Beauty' }), NEUTRAL_CLIENT_IDENTITY, 'mistyped fields fall back field by field')
assert.equal(parseClientIdentity({ shopName: 'Second Shop' }).shopNames, 'Second Shop', 'no alias: the name stands alone')
assert.equal(parseClientIdentity({ shopName: 'Second Shop' }).shopAlias, '')

assert.equal(getClientIdentity(), getClientIdentity(), 'read once per page')
assert.deepEqual(getClientIdentity(), NEUTRAL_CLIENT_IDENTITY, 'outside a browser the identity is neutral')

assert.equal(withShopName('WE, {shopNames} take no online payments. Install {shop}.', client), 'WE, Example Shop/Example Cosmetics take no online payments. Install Example Shop.')
assert.equal(withShopName('Install {shop}: {shop}', parseClientIdentity({ shopName: 'Second Shop' })), 'Install Second Shop: Second Shop')
assert.equal(withShopName('from {shopAlias}', client), 'from Example Cosmetics')
assert.equal(withShopName('from {shopAlias}', parseClientIdentity({ shopName: 'Second Shop' })), 'from Second Shop', 'no alias: {shopAlias} reads as the name')

assert.equal(customerMembershipPlaceholder('EX-'), 'EX-00001')
assert.equal(customerMembershipPlaceholder('SM-'), 'SM-00001')
assert.equal(customerMembershipPlaceholder(), 'M-00001', 'neutral default prefix')
assert.equal(isHouseCustomerMembershipNumber(' ex-00042 ', 'EX-'), true)
assert.equal(isHouseCustomerMembershipNumber('EX-00042', 'SM-'), false)
assert.equal(isHouseCustomerMembershipNumber('EX-', 'EX-'), false)
assert.equal(isHouseCustomerMembershipNumber('LCMN-DEADBEEF', 'EX-'), false)
assert.equal(customerMembershipPlaceholder(client.membershipPrefix), 'EX-00001', "the placeholder is the fixture client's first number")

console.log('clientIdentity: ok')
