// N14 follow-up (owner ruling, 6 Oct 2026): the customer portal and the sale
// route read the configured value of one redemption unit the SAME way -- four
// decimals, one reader (lib/membershipRedemption.ts redeemValueUsdPerUnit).
//
// POST /api/sales books a redemption at units x the configured value at four
// decimals; routes/portal.ts buildPortalConfig rounded that value to whole
// dollars, so a $0.50 unit was shown to the member as $1 (and $0.25 as $0)
// while the till booked $0.50. This suite drives the REAL portal config
// builder and the REAL sale-route valuation over one table of settings and
// requires the same per-unit value from both, and that the value the portal
// shows is the value POST /api/sales accepts.
//
// Discriminating: SEC_SALES_BASELINE=1 serves every src file from the audited
// release (read-only `git show`), where the portal rounds; the $0.50, $0.25
// and four-decimal rows fail there.
//
// Run: node test-sec-sales-redeem-value-parity-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const BASELINE_REF = '4ab47676eeb25299dad5235fdf2e9d071ffb97ac'
const srcRoot = path.join(__dirname, '..', 'src')
const baseline = process.env.SEC_SALES_BASELINE === '1'
if (baseline) {
  const readFileSync = fs.readFileSync
  fs.readFileSync = function patchedRead(file, ...rest) {
    const relative = path.relative(srcRoot, String(file)).replaceAll('\\', '/')
    if (!relative.startsWith('..') && relative.endsWith('.ts')) {
      try {
        return execFileSync('git', ['show', `${BASELINE_REF}:cloudflare/src/${relative}`], { cwd: srcRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      } catch { /* a module this lane added: read the working tree */ }
    }
    return readFileSync.call(this, file, ...rest)
  }
}

const portal = require('./harness/load_portal_route.cjs')
// The sale route's valuation, loaded for real with its one dependency.
const ts = require('typescript')
function loadLib(name, deps = {}) {
  const file = path.join(srcRoot, 'lib', `${name}.ts`)
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', outputText)(mod.exports, (request) => deps[request] ?? require(request), mod)
  return mod.exports
}
const redemption = loadLib('membershipRedemption', { './moneyPrecision': loadLib('moneyPrecision') })

const env = {}
// [setting, the per-unit value both must read]
const TABLE = [
  ['1', 1],
  ['2', 2],
  ['0.5', 0.5],
  ['0.25', 0.25],
  ['1.2345', 1.2345],
  ['0.00005', 0.0001],
  [undefined, 1],
  ['', 0],
  ['0', 0],
  ['-1', 0],
  ['not a number', 0],
]

let failures = 0
function check(name, body) {
  try { body(); console.log(`PASS ${name}`) } catch (error) { failures += 1; console.log(`FAIL ${name}\n  ${String(error && error.message).split('\n')[0]}`) }
}

for (const [setting, perUnit] of TABLE) {
  check(`redeem value ${JSON.stringify(setting)}: the portal shows what the sale route books (${perUnit})`, () => {
    const settings = setting === undefined ? {} : { customer_portal_redeem_value_usd: setting }
    const shown = portal.buildPortalConfig(settings, env).redeemValueUsd
    assert.equal(shown, perUnit, 'portal per-unit value')
    const booked = redemption.membershipRedemptionDiscount({
      pointsRedeemed: 100, claimedDiscountUsd: shown, redeemPointsSetting: '100', redeemValueUsdSetting: setting, exchangeRate: 4100,
    })
    if (redemption.redeemValueUsdPerUnit && redemption.redeemValueUsdPerUnit(setting) === null) {
      // A setting no redemption can be valued from: the sale route refuses it,
      // and the portal offers nothing for it.
      assert.equal(booked, null)
      assert.equal(shown, 0)
    } else {
      assert.ok(booked, 'the sale route accepts a redemption claimed at the value the portal shows')
      assert.equal(booked.discountUsd, shown)
    }
  })
}

check('one reader: both sides call redeemValueUsdPerUnit', () => {
  const portalSource = fs.readFileSync(path.join(srcRoot, 'routes', 'portal.ts'), 'utf8')
  assert.match(portalSource, /import \{ redeemValueUsdPerUnit \} from '\.\.\/lib\/membershipRedemption'/)
  assert.match(portalSource, /return redeemValueUsdPerUnit\(value\) \?\? 0/)
  const libSource = fs.readFileSync(path.join(srcRoot, 'lib', 'membershipRedemption.ts'), 'utf8')
  assert.match(libSource, /const valuePerUnit = redeemValueUsdPerUnit\(input\.redeemValueUsdSetting\)/)
})

if (failures) {
  console.log(`\n${failures} check(s) failed${baseline ? ' (expected on the audited baseline: the portal rounds to whole dollars)' : ''}`)
  process.exit(1)
}
console.log('\nPortal and sale route read the redemption value identically')
