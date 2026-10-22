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

module.exports = {
  ROOT,
  TEMPLATE_PATH,
  EXAMPLE_ENV,
  lib,
  targetLib,
  template,
  get values() { return valuesWith() },
  valuesWith,
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
