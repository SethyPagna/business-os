const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const source = fs.readFileSync(path.join(__dirname, '../src/index.ts'), 'utf8')
const start = source.indexOf('const SHIFT_OVERVIEW_DRAIN_INTERVAL_MS =')
const end = source.indexOf("app.get('/health'", start)
assert.ok(start >= 0 && end > start)
let handler
let now = 100_000
let drains = 0
let responses = 0
const pending = []
new Function('app', 'Date', 'runBackground', 'drainDueTelegramShiftOverviews', source.slice(start, end))(
  { use(route, run) { assert.equal(route, '/api/*'); handler = run } },
  { now: () => now },
  async (_env, label, run) => { assert.equal(label, 'telegram-drain'); return run() },
  async () => { drains++ },
)
const request = async method => {
  await handler({ req: { method }, env: {}, executionCtx: { waitUntil(promise) { pending.push(promise) } } }, async () => { responses++ })
  await Promise.all(pending.splice(0))
}
async function main() {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) await request(method)
  assert.equal(drains, 0, 'background work must not consume the mutation database allowance')
  assert.equal(responses, 5, 'all foreground handlers still run')
  await request('GET')
  assert.equal(drains, 1, 'skipped writes must not consume the read fallback interval')
  await request('GET')
  assert.equal(drains, 1)
  now += 20_000
  await request('GET')
  assert.equal(drains, 2, 'read polling keeps delayed delivery recovery active')
  assert.match(source, /runStep\('telegram-shift-overview'/, 'scheduled recovery remains wired')
  console.log('PASS writes retain their query budget; reads and cron retain Telegram recovery')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
