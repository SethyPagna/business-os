// lib/requestBodyGuard.ts's credential guard as a pass-through, for tests
// that load routes/auth.ts with their own override table and whose subject is
// NOT login CSRF (sessions, rate limits, Google linking, migrations). The real
// guard runs in every test built on harness/load_auth_route.cjs and is pinned
// by test-auth-credential-post-guard-pure.cjs.
'use strict'

const credentialGuardPassThrough = {
  requireJsonSameOriginCredentialPost: async (_c, next) => next(),
}

module.exports = { credentialGuardPassThrough }
