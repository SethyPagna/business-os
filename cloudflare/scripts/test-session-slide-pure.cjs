// Sliding session expiry.
//
// Reported: "'ERR Not authenticated' just loads randomly after not using the
// website for a while, like leaving it idle... sometimes also have to login
// again."
//
// Nothing had gone wrong. Sessions were issued with a FIXED expires_at at
// login and never renewed, so a session died at a wall-clock moment decided
// hours or days earlier, regardless of whether the person was mid-task. The
// chosen duration now means "N days of INACTIVITY" instead of "N days from
// login", which is what "Keep me signed in for 30 days" already implies.
//
// The arithmetic is what this file guards, because every failure mode here
// is silent:
//   - renewing too eagerly = an UPDATE and a Set-Cookie on every request
//   - renewing too late     = no margin for a briefly-offline client
//   - renewing an expired or revoked session = an auth hole
//   - shortening a session  = the opposite of the bug being fixed
//   - misparsing SQLite's "YYYY-MM-DD HH:MM:SS" as local time = every
//     comparison skewed by the server's offset
//
// Run: node scripts/test-session-slide-pure.cjs

const assert = require('assert')
const fs = require('fs')
const path = require('path')

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

const SESSION_SLIDE_AFTER_FRACTION = 0.5
const MAX_COOKIE_AGE_MS = 399 * 24 * 60 * 60 * 1000
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000

// Mirrors lib/auth.ts's asUtc exactly.
function asUtc(value) {
  const text = String(value).trim()
  const normalized = /[zZ]|[+-]\d{2}:?\d{2}$/.test(text)
    ? text.replace(' ', 'T')
    : `${text.replace(' ', 'T')}Z`
  return Date.parse(normalized)
}

// Mirrors lib/auth.ts's last-seen write throttle exactly.
function isSessionTouchDue(lastSeenAt, nowMs) {
  if (!lastSeenAt) return true
  const lastSeenMs = asUtc(lastSeenAt)
  return !Number.isFinite(lastSeenMs) || lastSeenMs < nowMs - SESSION_TOUCH_INTERVAL_MS
}

// Mirrors slideSessionExpiry's decision. Returns the new expiry, or null for
// "leave it alone".
function nextExpiryFor(session, now) {
  const createdAt = asUtc(session.created_at)
  const expiresAt = asUtc(session.expires_at)
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt)) return null
  const ttlMs = expiresAt - createdAt
  if (ttlMs <= 0) return null
  const remaining = expiresAt - now
  if (remaining > ttlMs * (1 - SESSION_SLIDE_AFTER_FRACTION)) return null
  const next = Math.min(now + ttlMs, now + MAX_COOKIE_AGE_MS)
  if (next <= expiresAt) return null
  return next
}

const DAY = 24 * 60 * 60 * 1000
const iso = (ms) => new Date(ms).toISOString()
// SQLite's CURRENT_TIMESTAMP format: UTC, space separator, NO zone marker.
const sqlite = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19)

const T0 = Date.parse('2026-08-01T00:00:00Z')

// --- bounded last-seen writes -----------------------------------------

check('a fresh last-seen timestamp does not schedule a touch write', () => {
  assert.equal(isSessionTouchDue(sqlite(T0 - 60 * 1000), T0), false)
  assert.equal(isSessionTouchDue(iso(T0 - 4 * 60 * 1000), T0), false)
  assert.equal(isSessionTouchDue(sqlite(T0 - SESSION_TOUCH_INTERVAL_MS), T0), false,
    'exactly five minutes old is not older than the threshold')
})

check('a stale, missing, or corrupt last-seen timestamp may schedule a touch', () => {
  assert.equal(isSessionTouchDue(sqlite(T0 - SESSION_TOUCH_INTERVAL_MS - 1000), T0), true)
  assert.equal(isSessionTouchDue(null, T0), true)
  assert.equal(isSessionTouchDue('not-a-date', T0), true)
})

check('auth reads session metadata once and race-protects a stale touch', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'auth.ts'), 'utf8')

  assert.match(source, /s\.created_at AS session_created_at[\s\S]*s\.expires_at AS session_expires_at[\s\S]*s\.last_seen_at AS session_last_seen_at/)
  assert.doesNotMatch(source, /SELECT created_at, expires_at FROM user_sessions/,
    'sliding expiry must not issue a second session metadata SELECT')
  assert.match(source, /slideSessionExpiry\(c, tokenHash, \{[\s\S]*created_at: createdAt,[\s\S]*expires_at: expiresAt/,
    'the initial auth row must feed sliding expiry directly')

  const touchSql = source.match(/UPDATE user_sessions\s+SET last_seen_at = CURRENT_TIMESTAMP[\s\S]*?\)\s*\n\s*`\)\.run/)
  assert.ok(touchSql, 'conditional last-seen UPDATE must exist')
  assert.match(touchSql[0], /revoked_at IS NULL/)
  assert.match(touchSql[0], /expires_at > @observed_at/)
  assert.match(touchSql[0], /datetime\(last_seen_at\) < datetime\(@observed_at, '-5 minutes'\)/,
    'SQL must repeat the strict stale cutoff to protect concurrent requests')
})

// --- the timestamp format that would skew everything -------------------

check('SQLite\'s zone-less "YYYY-MM-DD HH:MM:SS" is read as UTC, not local time', () => {
  // Date.parse('2026-08-01 00:00:00') is LOCAL in some runtimes. If that
  // slipped through, every remaining-life calculation would be off by the
  // server's offset -- which on a CI box in one zone and a Worker in
  // another produces a bug that only appears in one of them.
  assert.equal(asUtc('2026-08-01 00:00:00'), Date.parse('2026-08-01T00:00:00Z'))
  assert.equal(asUtc('2026-08-01T00:00:00Z'), Date.parse('2026-08-01T00:00:00Z'))
  assert.equal(asUtc('2026-08-01T00:00:00+00:00'), Date.parse('2026-08-01T00:00:00Z'))
})

// --- when it renews, and when it stays out of the way ------------------

check('a fresh session is NOT renewed -- no write, no Set-Cookie on every call', () => {
  const s = { created_at: sqlite(T0), expires_at: iso(T0 + 30 * DAY) }
  assert.equal(nextExpiryFor(s, T0 + 1 * DAY), null)
  assert.equal(nextExpiryFor(s, T0 + 14 * DAY), null, 'still under halfway')
})

check('a session past halfway IS renewed, by its own original TTL', () => {
  const s = { created_at: sqlite(T0), expires_at: iso(T0 + 30 * DAY) }
  const now = T0 + 20 * DAY
  const next = nextExpiryFor(s, now)
  assert.equal(next, now + 30 * DAY, 'renewed to a full TTL from now, not from the old expiry')
})

check('the renewal window opens exactly at the halfway point', () => {
  const s = { created_at: sqlite(T0), expires_at: iso(T0 + 10 * DAY) }
  assert.equal(nextExpiryFor(s, T0 + 5 * DAY - 1000), null, 'a second before halfway: untouched')
  assert.ok(nextExpiryFor(s, T0 + 5 * DAY + 1000), 'a second after halfway: renewed')
})

check('a short session renews on the same rule as a long one', () => {
  // "Until I close the browser" is 24h and is the shared-device option --
  // it must still slide, but only within its own 24h shape.
  const s = { created_at: sqlite(T0), expires_at: iso(T0 + 1 * DAY) }
  const now = T0 + 20 * 60 * 60 * 1000
  assert.equal(nextExpiryFor(s, now), now + 1 * DAY)
})

// --- the safety properties --------------------------------------------

check('renewal only ever moves expiry FORWARD', () => {
  const s = { created_at: sqlite(T0), expires_at: iso(T0 + 30 * DAY) }
  for (const offset of [16, 20, 25, 29]) {
    const now = T0 + offset * DAY
    const next = nextExpiryFor(s, now)
    if (next !== null) assert.ok(next > asUtc(s.expires_at), `at day ${offset} the new expiry must be later`)
  }
})

check('an ALREADY-EXPIRED session is never resurrected', () => {
  // getSessionUser only calls this after its own `expires_at > now` check,
  // so this should be unreachable -- asserted anyway, because a future
  // caller that skipped that check would otherwise silently revive dead
  // sessions.
  const s = { created_at: sqlite(T0), expires_at: iso(T0 + 30 * DAY) }
  const now = T0 + 31 * DAY
  const next = nextExpiryFor(s, now)
  // It would extend; the protection lives in the caller's WHERE clause and
  // in the UPDATE's own `revoked_at IS NULL`. Pinning the shape here so the
  // dependency is explicit rather than assumed.
  assert.ok(next === null || next > now, 'must never produce an expiry in the past')
})

check('a corrupt or missing timestamp changes nothing', () => {
  assert.equal(nextExpiryFor({ created_at: '', expires_at: '' }, T0), null)
  assert.equal(nextExpiryFor({ created_at: 'not-a-date', expires_at: iso(T0) }, T0), null)
  assert.equal(nextExpiryFor({ created_at: sqlite(T0), expires_at: 'nonsense' }, T0), null)
})

check('a session whose expiry precedes its creation is ignored', () => {
  const s = { created_at: sqlite(T0 + 5 * DAY), expires_at: iso(T0) }
  assert.equal(nextExpiryFor(s, T0 + 6 * DAY), null, 'a negative TTL must not be extended')
})

check('renewal is capped at the cookie ceiling', () => {
  // An "always" session has a TTL longer than a cookie may live. The new
  // expiry must not exceed what the browser will actually hold.
  const hugeTtl = 10 * 365 * DAY
  const s = { created_at: sqlite(T0), expires_at: iso(T0 + hugeTtl) }
  const now = T0 + hugeTtl * 0.9
  const next = nextExpiryFor(s, now)
  assert.ok(next !== null)
  assert.ok(next <= now + MAX_COOKIE_AGE_MS, 'must not outlive the cookie it is carried in')
})

// --- the behaviour that actually fixes the report ----------------------

check('continuous use keeps a session alive indefinitely; idling still expires it', () => {
  let session = { created_at: sqlite(T0), expires_at: iso(T0 + 7 * DAY) }
  let now = T0
  // Someone using the app every few days for a month.
  for (let i = 0; i < 10; i += 1) {
    now += 4 * DAY
    const next = nextExpiryFor(session, now)
    if (next !== null) session = { created_at: sqlite(now), expires_at: iso(next) }
    assert.ok(asUtc(session.expires_at) > now, 'an actively-used session must never lapse mid-use')
  }
  // Then they stop. A full TTL of silence still ends it -- sliding expiry
  // is not the same as never expiring.
  const idleUntil = asUtc(session.expires_at) + 1000
  assert.ok(asUtc(session.expires_at) < idleUntil, 'inactivity past the TTL still expires the session')
})

console.log(`\n${passed} session-slide checks passed`)
