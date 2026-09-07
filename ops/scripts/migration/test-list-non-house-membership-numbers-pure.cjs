const assert = require('node:assert/strict')

;(async () => {
  const helpers = await import('./list-non-house-membership-numbers.mjs')

  // isHouseMembershipNumber must agree with cloudflare/src/lib/membershipNumber.ts's
  // parseMembershipSequence/isHouseMembershipNumber on every case that function
  // itself is tested against (see cloudflare/scripts/test-membership-number-pure.cjs).
  assert.equal(helpers.isHouseMembershipNumber('LC-00001'), true)
  assert.equal(helpers.isHouseMembershipNumber('lc-00042'), true, 'case-insensitive, mirrors parseMembershipSequence upper-casing')
  assert.equal(helpers.isHouseMembershipNumber(' LC-00007 '), true, 'trims, mirrors parseMembershipSequence')
  assert.equal(helpers.isHouseMembershipNumber('LC-100000'), true, 'sequence past the padded width is still house format')
  assert.equal(helpers.isHouseMembershipNumber('LC-00000'), false, 'sequence must be >= 1')
  assert.equal(helpers.isHouseMembershipNumber('LCMN-DEADBEEF'), false, 'legacy prefixed id is not house format')
  assert.equal(helpers.isHouseMembershipNumber('QWERTY12'), false, 'legacy random id is not house format')
  assert.equal(helpers.isHouseMembershipNumber(''), false)
  assert.equal(helpers.isHouseMembershipNumber(null), false)
  assert.equal(helpers.isHouseMembershipNumber(undefined), false)

  // findNonHouseRows: blank/null numbers are excluded (nothing to report --
  // "unset" is not "non-house"); house rows are excluded; everything else
  // (legacy random, legacy LCMN-, hand-typed vanity) is reported.
  const customerRows = [
    { id: 1, membership_number: 'LC-00001', created_at: '2026-09-01' },
    { id: 2, membership_number: 'LCMN-DEADBEEF', created_at: '2026-08-15' },
    { id: 3, membership_number: null, created_at: '2026-09-02' },
    { id: 4, membership_number: '   ', created_at: '2026-09-02' },
    { id: 5, membership_number: 'QWERTY12', created_at: '2026-09-03' },
    { id: 6, membership_number: 'lc-00002', created_at: '2026-09-04' },
  ]
  const nonHouse = helpers.findNonHouseRows(customerRows)
  assert.deepEqual(nonHouse.map((row) => row.id), [2, 5], 'only the two genuinely non-house, non-blank rows are reported')

  // extractRows: accepts wrangler's `[{ results: [...] }]` shape and a bare array.
  assert.deepEqual(helpers.extractRows([{ results: [{ id: 1 }] }]), [{ id: 1 }], 'wrangler --json shape')
  assert.deepEqual(helpers.extractRows([{ id: 1 }]), [{ id: 1 }], 'bare row array')
  assert.deepEqual(helpers.extractRows([]), [])
  assert.deepEqual(helpers.extractRows(null), [])

  // buildReport: counts, ids, created_at all present; empty sections say so.
  const report = helpers.buildReport(
    [{ id: 2, membership_number: 'LCMN-DEADBEEF', created_at: '2026-08-15' }],
    [],
  )
  assert.match(report, /customers:\s+1/)
  assert.match(report, /portal_accounts:\s+0/)
  assert.match(report, /total:\s+1/)
  assert.match(report, /id=2/)
  assert.match(report, /LCMN-DEADBEEF/)
  assert.match(report, /2026-08-15/)
  assert.match(report, /\(none\)/, 'the empty portal_accounts section says so rather than printing nothing')
  assert.match(report, /leave these as-is/i, 'the default recommendation is stated in the report, not just the file header')

  console.log('PASS list-non-house-membership-numbers: house-format detection matches membershipNumber.ts, blank numbers excluded, both input shapes accepted, report renders counts/ids/dates and the leave-as-is recommendation')
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
