'use strict'
// The Worker config the tests read. cloudflare/wrangler.toml and
// wrangler.free.toml are generated per client and gitignored, so a pure test
// cannot read them. It reads the committed template rendered with
// clients/example.env instead: the same structure every client gets (bindings,
// custom-domain routes, limits, queues and their consumers), with fake values.
//
//   const wrangler = require('./harness/rendered_wrangler.cjs')
//   wrangler.paid()          // text of a rendered wrangler.toml
//   wrangler.free()          // text of a rendered wrangler.free.toml
//   wrangler.values          // the fixture's resolved variables
//   wrangler.identity        // a neutral shop identity (Example Shop) for tests that need the identity variables set
//   wrangler.paid(wrangler.identity)    // the same render with that identity: what the identity tests read
//   wrangler.paid({ ROUTES: 'none' })   // the same with one variable changed
//   wrangler.clientEnvFile()   // path of the private leang.env when this machine has it, else null
//   wrangler.clientRender('paid')   // the private client's own render (null where absent)
//   wrangler.fixtureFile()   // a temp file holding the paid render (for scripts that read OPS_WRANGLER_CONFIG)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..', '..')
const lib = require(path.join(ROOT, 'ops', 'scripts', 'client', 'render-lib.cjs'))
const targetLib = require(path.join(ROOT, 'ops', 'scripts', 'client', 'target-lib.cjs'))

const TEMPLATE_PATH = path.join(ROOT, 'cloudflare', 'wrangler.template.toml')
const EXAMPLE_ENV = path.join(ROOT, 'clients', 'example.env')

const template = () => fs.readFileSync(TEMPLATE_PATH, 'utf8')
const exampleMap = () => lib.readEnvFile(EXAMPLE_ENV)

function valuesWith(overrides = {}) {
  const map = exampleMap()
  for (const [k, v] of Object.entries(overrides)) map.set(k, v)
  return lib.resolveValues(map, { strict: true })
}

const render = (plan, overrides) => lib.renderVariant(template(), valuesWith(overrides), plan)

// clients/example.env leaves the seven identity variables empty (the neutral Business OS defaults). Tests that exercise a
// client WITH an identity use this one: the same shape a real client has (a name, its Khmer spelling, an alias, a
// category, an icon file prefix, a staff app name, a membership prefix), with neutral values. It is a committed test
// fixture, not a client: nothing here is any shop's real value.
const IDENTITY = Object.freeze({
  SHOP_NAME: 'Example Shop',
  SHOP_NAME_KM: 'ហាងគំរូ',
  SHOP_ALIAS: 'Example Cosmetics',
  SHOP_CATEGORY: 'beauty',
  SHOP_ICON_PREFIX: '/example-shop-',
  ADMIN_SHORT_NAME: 'Ex Admin',
  MEMBERSHIP_PREFIX: 'EX-',
})

module.exports = {
  ROOT,
  TEMPLATE_PATH,
  EXAMPLE_ENV,
  lib,
  targetLib,
  template,
  get values() { return valuesWith() },
  valuesWith,
  identity: IDENTITY,
  paid: (overrides) => render('paid', overrides),
  free: (overrides) => render('free', overrides),
  // The real client's values live outside the repository (never committed); null where they are absent (CI, a fresh clone).
  clientEnvFile() {
    return [
      process.env.CLIENT_PARITY_ENV_FILE,
      path.join(ROOT, '..', '..', 'Records', 'Clients', 'leang.env'),
      path.join(ROOT, '..', 'Records', 'Clients', 'leang.env'),
    ].filter(Boolean).find((p) => fs.existsSync(p)) || null
  },
  // The paid or free config rendered with the private client file, or null where this machine does not have it.
  clientRender(plan) {
    const file = this.clientEnvFile()
    return file ? lib.renderVariant(template(), lib.resolveValues(lib.readEnvFile(file), { strict: true }), plan) : null
  },
  // A file outside the repository holding the rendered config, removed at exit.
  fixtureFile(overrides) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-config-fixture-'))
    const file = path.join(dir, 'wrangler.toml')
    fs.writeFileSync(file, render('paid', overrides))
    process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ } })
    return file
  },
  // The fixture client's parsed target, as the release kit and ops scripts read it.
  target: (overrides) => targetLib.parseTarget(render('paid', overrides)),
}
