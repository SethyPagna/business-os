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

runTest('owned Google OAuth service exposes only Business OS callbacks', () => {
  const googleOauth = require('../src/services/googleOauth')
  const config = googleOauth.getGoogleLoginPublicConfig()
  assert.equal(config.clientId, '784691087631-2ugaidgt6umv80i9qvfo08ddu12n4a9b.apps.googleusercontent.com')
  assert.equal(config.enabled, true)
  assert.deepEqual(config.authorizedRedirectUris, [
    'https://admin.leangcosmetics.dpdns.org/api/auth/oauth/callback',
    'https://leangcosmetics.dpdns.org/api/auth/oauth/callback',
    'http://localhost:4000/api/auth/oauth/callback',
  ])
  assert.deepEqual(config.authorizedJavaScriptOrigins, [
    'https://admin.leangcosmetics.dpdns.org',
    'https://leangcosmetics.dpdns.org',
    'http://localhost:4000',
  ])
  const start = googleOauth.buildGoogleOauthStartUrl({
    mode: 'login',
    organization: 'Leang Cosmetics',
    redirectUri: config.authorizedRedirectUris[0],
    stateNonce: 'nonce',
    codeVerifier: 'verifier-for-test',
  })
  assert.equal(start.success, true)
  assert.match(start.url, /accounts\.google\.com\/o\/oauth2\/v2\/auth/)
  assert.match(start.url, /code_challenge_method=S256/)
  assert.doesNotMatch(start.url, /supabase/i)
})

runTest('auth runtime no longer imports or writes active Supabase identity', () => {
  const source = read('backend/src/routes/auth.js')
  assert.doesNotMatch(source, /services\/supabaseAuth/)
  assert.doesNotMatch(source, /isSupabaseAuthConfigured/)
  assert.doesNotMatch(source, /updateLocalUserSupabaseIdentity/)
  assert.doesNotMatch(source, /supabase_user_id\s*=/)
  assert.match(source, /router\.get\('\/oauth\/callback'/)
  assert.match(source, /router\.post\('\/oauth\/unlink'/)
  assert.match(source, /google_subject/)
  assert.match(source, /setAuthSessionCookie/)
})

runTest('schema keeps legacy Supabase column unused and adds Google identity columns', () => {
  const schema = read('backend/src/db/postgresSchema.sql')
  const pgRuntime = read('backend/src/postgresDatabase.js')
  assert.match(schema, /supabase_user_id text/)
  assert.match(schema, /google_subject text/)
  assert.match(schema, /google_email text/)
  assert.match(schema, /google_email_verified bigint/)
  assert.match(schema, /google_linked_at text/)
  assert.match(pgRuntime, /ALTER TABLE users ADD COLUMN IF NOT EXISTS google_subject TEXT/)
  assert.match(pgRuntime, /idx_users_google_subject_unique/)
})

runTest('integration doctor and Docker release report Google login without Supabase env', () => {
  const doctor = read('backend/src/services/integrationDoctor.js')
  const compose = read('ops/docker/compose.release.yml')
  const release = read('ops/scripts/powershell/docker-release.ps1')
  assert.doesNotMatch(doctor, /supabase/i)
  assert.match(doctor, /googleLogin/)
  assert.match(doctor, /GOOGLE_LOGIN_CLIENT_ID/)
  assert.doesNotMatch(compose, /SUPABASE_/)
  assert.match(compose, /GOOGLE_LOGIN_CLIENT_ID/)
  assert.match(compose, /GOOGLE_LOGIN_CLIENT_SECRET_FILE/)
  assert.doesNotMatch(release, /SUPABASE_/)
  assert.match(release, /GOOGLE_LOGIN_CLIENT_ID/)
  assert.match(release, /GOOGLE_LOGIN_CLIENT_SECRET_FILE/)
})

runTest('secret hygiene guards the owned Google OAuth secret', () => {
  const hygiene = read('ops/scripts/verify-secret-hygiene.js')
  assert.match(hygiene, /GOOGLE_LOGIN_CLIENT_SECRET/)
  assert.match(hygiene, /GOCSPX-/)
})
