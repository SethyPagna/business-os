'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function runTest(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    console.error(error)
    process.exitCode = 1
  }
}

runTest('full automation launcher and policy are present', () => {
  const launcher = read('run/full-automation.bat')
  const script = read('ops/scripts/powershell/full-automation.ps1')
  const policy = JSON.parse(read('ops/automation/business-os-automation.json'))

  assert.match(launcher, /full-automation\.ps1/)
  assert.doesNotMatch(script, /node @args/)
  assert.match(script, /node @cloudflareArgs/)
  assert.equal(policy.domains.admin, 'https://admin.leangcosmetics.dpdns.org')
  assert.equal(policy.domains.public, 'https://leangcosmetics.dpdns.org')
  assert.deepEqual(policy.cloudflare.allowedCountries, ['KH', 'HK', 'AU'])
  assert.equal(policy.cloudflare.rateLimitProfile, 'normal')
  assert.equal(policy.offline.pinLength, 6)
  assert.equal(policy.offline.autoEnable, true)
  assert.equal(policy.offline.scope, 'all_business_edits')
  assert.equal(policy.backups.retentionDays, 7)
  assert.equal(policy.backups.googleDrive, true)
  assert.equal(policy.backups.cloudflareR2, true)
  assert.equal(policy.media.objectStorage, 'r2')

  ;[
    'npm.cmd --prefix frontend run test:utils',
    'npm.cmd --prefix backend run test:utils',
    'npm.cmd --prefix frontend run verify:i18n',
    'npm.cmd --prefix frontend run verify:ui',
    'npm.cmd --prefix frontend run verify:performance',
    'npm.cmd --prefix frontend run build',
    'verify-docker-release.js',
    'verify-hardening-policy.js',
    'verify-r2-object-store.mjs',
    'docker-release.ps1',
    '/health',
    '/sw.js',
    'git commit',
    'git push origin main',
  ].forEach((token) => assert.match(script, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))))
})

runTest('cloudflare automation is explicit about account-level permissions', () => {
  const script = read('ops/scripts/runtime/verify-cloudflare-automation.mjs')
  const readme = read('ops/automation/README.md')
  assert.match(script, /cloudflare-api-token\.txt/)
  assert.match(script, /access\/apps/)
  assert.match(script, /rulesets/)
  assert.match(script, /upsertAccessApp/)
  assert.match(script, /http_request_firewall_custom/)
  assert.match(script, /Account\.Cloudflare Access: Edit/)
  assert.match(script, /Zone\.Rulesets: Edit/)
  assert.match(script, /leangcosmetics\.dpdns\.org/)
  assert.match(readme, /Access: Apps and Policies/)
  assert.match(readme, /Zone Rulesets/)
  assert.match(readme, /Workers R2 Storage/)
  assert.match(readme, /ops\/runtime\/secrets\/cloudflare-api-token\.txt/)
  assert.match(readme, /ops\/runtime\/automation\/access-emails\.txt/)
})
