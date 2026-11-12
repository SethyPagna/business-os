// The waiting sign-in screen checks for approval by itself: every 10 seconds,
// for at most 10 minutes, stopping on unmount, and only ever reading a status.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEVICE_WAIT_INTERVAL_MS, DEVICE_WAIT_LIMIT_MS, startDeviceApprovalWait } from '../src/components/auth/deviceApprovalWait.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => fs.readFileSync(path.join(here, '..', 'src', relative), 'utf8').replace(/\r\n/g, '\n')

// A manual clock: timers fire only when the test advances time.
function clock() {
  let now = 0
  let nextId = 1
  const timers = new Map<number, { at: number; callback: () => void }>()
  return {
    now: () => now,
    schedule: (callback: () => void, ms: number) => { const id = nextId++; timers.set(id, { at: now + ms, callback }); return id },
    cancel: (handle: unknown) => { timers.delete(handle as number) },
    pending: () => timers.size,
    async advance(ms: number) {
      const target = now + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        now = due[1].at
        due[1].callback()
        await Promise.resolve()
        await Promise.resolve()
      }
      now = target
    },
  }
}

assert.equal(DEVICE_WAIT_INTERVAL_MS, 10_000)
assert.equal(DEVICE_WAIT_LIMIT_MS, 600_000)

async function scenario(name: string, run: () => Promise<void>) {
  await run()
  console.log(`PASS ${name}`)
}

await scenario('polls every 10 seconds, calls onApproved once and stops', async () => {
  const c = clock()
  const answers = ['pending', 'pending', 'approved', 'approved']
  let calls = 0
  let approved = 0
  startDeviceApprovalWait({ fetchStatus: async () => answers[calls++], onApproved: () => { approved += 1 }, onStopped: () => assert.fail('not stopped'), now: c.now, schedule: c.schedule, cancel: c.cancel })
  await c.advance(9_999)
  assert.equal(calls, 0, 'nothing before the first interval')
  await c.advance(1)
  assert.equal(calls, 1)
  await c.advance(20_000)
  assert.equal(calls, 3)
  assert.equal(approved, 1)
  await c.advance(60_000)
  assert.equal(calls, 3, 'no further reads after approval')
  assert.equal(c.pending(), 0)
})

await scenario('gives up after 10 minutes and says why', async () => {
  const c = clock()
  let calls = 0
  const stops: string[] = []
  startDeviceApprovalWait({ fetchStatus: async () => { calls += 1; return 'pending' }, onApproved: () => assert.fail('never approved'), onStopped: (reason) => stops.push(reason), now: c.now, schedule: c.schedule, cancel: c.cancel })
  await c.advance(DEVICE_WAIT_LIMIT_MS + 30_000)
  assert.deepEqual(stops, ['timeout'])
  assert.ok(calls >= 58 && calls <= 60, `about one read per 10 s for 10 min (got ${calls})`)
  const before = calls
  await c.advance(120_000)
  assert.equal(calls, before)
  assert.equal(c.pending(), 0)
})

await scenario('stop() on unmount ends the wait, even with a read in flight', async () => {
  const c = clock()
  let calls = 0
  let release: (value: string) => void = () => {}
  let approved = 0
  const stop = startDeviceApprovalWait({ fetchStatus: () => { calls += 1; return new Promise<string>((resolve) => { release = resolve }) }, onApproved: () => { approved += 1 }, onStopped: () => assert.fail('no stop callback after stop()'), now: c.now, schedule: c.schedule, cancel: c.cancel })
  await c.advance(10_000)
  assert.equal(calls, 1)
  stop()
  release('approved')
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(approved, 0, 'a late answer after unmount is ignored')
  await c.advance(120_000)
  assert.equal(calls, 1)
  assert.equal(c.pending(), 0)
})

await scenario('a network error keeps waiting; rejected, expired and missing stop with their reason', async () => {
  for (const [answer, reason] of [['rejected', 'rejected'], ['expired', 'expired'], ['missing', 'expired']] as const) {
    const c = clock()
    let calls = 0
    const stops: string[] = []
    startDeviceApprovalWait({ fetchStatus: async () => { calls += 1; if (calls === 1) throw new Error('offline'); return answer }, onApproved: () => assert.fail('not approved'), onStopped: (r) => stops.push(r), now: c.now, schedule: c.schedule, cancel: c.cancel })
    await c.advance(40_000)
    assert.deepEqual(stops, [reason])
    assert.equal(calls, 2, 'the failed read did not end the wait')
  }
})

// The screen: password only in component memory, a status read never signs in, both Google and password paths covered.
const wait = read('components/auth/deviceApprovalWait.ts')
assert.doesNotMatch(wait, /password|localStorage|sessionStorage|indexedDB|document\.cookie/i, 'the wait helper never touches a password or any storage')
const login = read('components/auth/Login.tsx')
assert.doesNotMatch(login, /(local|session)Storage\.setItem\([^)]*password/i, 'the password is never written to storage')
assert.match(login, /const passwordRef = useRef\(''\)[\s\S]*passwordRef\.current = password/, 'the password is read from component memory only')
assert.match(login, /if \(passwordRef\.current\) \{[\s\S]*?handleLoginRef\.current\(/, 'a password sign-in resubmits itself after approval')
assert.match(login, /setDeviceApproved\(true\)[\s\S]{0,40}setDeviceTicket\(''\)/, 'a Google sign-in is asked to sign in again instead of being resubmitted')
assert.match(login, /startDeviceApprovalWait\(\{[\s\S]*?return stop[\s\S]*?\[deviceApprovalPending, deviceTicket\]\)/, 'the wait starts per ticket and its stop() is the effect cleanup')
assert.doesNotMatch(login, /onClick=\{\(\) => handleLogin\(\{ preventDefault: \(\) => \{\} \} as FormEvent<HTMLFormElement>\)\}/, 'Check again no longer resubmits an empty password (the Google dead end)')
assert.equal((login.match(/startDeviceWait\(/g) || []).length, 4, 'the stored Google callback, Google completion, password and OTP answers all start the wait')
const transport = read('api/authTransport.ts')
assert.match(transport, /apiFetch\('POST', '\/api\/auth\/device-status', \{ ticket \}\)/)
assert.match(read('web-api.ts'), /getDeviceApprovalStatus: getAuthTransportMethod\('getDeviceApprovalStatus'\)/)
const en = JSON.parse(read('lang/en.json')) as Record<string, string>
const km = JSON.parse(read('lang/km.json')) as Record<string, string>
for (const key of ['device_approved_sign_in_again', 'device_still_waiting', 'device_wait_auto', 'device_wait_stopped']) {
  assert.ok(en[key] && km[key], `both packs carry ${key}`)
  assert.notEqual(en[key], km[key], `Khmer ${key} is not the English copied`)
}

console.log('PASS the waiting screen keeps the password in memory, polls with a ticket and cleans up')
