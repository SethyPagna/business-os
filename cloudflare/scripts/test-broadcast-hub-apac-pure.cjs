// Guards the 25 Sep 2026 location fix: the broadcast hub Durable Object is
// pinned to APAC (next to D1 and the Worker's placement), and route handlers
// never make a response wait on a hub round trip.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const src = path.join(__dirname, '..', 'src')
const hub = fs.readFileSync(path.join(src, 'durable-objects', 'broadcastHub.ts'), 'utf8')
const index = fs.readFileSync(path.join(src, 'index.ts'), 'utf8')

assert.match(hub, /get\(env\.BROADCAST_HUB\.idFromName\(HUB_NAME\), \{ locationHint: 'apac' \}\)/, 'hub stub carries the APAC location hint')
assert.match(hub, /const HUB_NAME = 'global-apac'/, 'a fresh hub name, because a hint cannot move an existing instance')
assert.match(index, /broadcastHubStub\(c\.env\)\.fetch\(c\.req\.raw\)/, 'sockets connect to the APAC hub')
assert.doesNotMatch(index, /BROADCAST_HUB\.idFromName\('global'\)/, 'no socket attaches to the legacy hub')

const routesDir = path.join(src, 'routes')
const blocking = []
for (const file of fs.readdirSync(routesDir)) {
  if (!file.endsWith('.ts')) continue
  const text = fs.readFileSync(path.join(routesDir, file), 'utf8')
  text.split(/\r?\n/).forEach((line, i) => {
    if (/await broadcast\(c\.env/.test(line)) blocking.push(`${file}:${i + 1}`)
  })
}
assert.deepEqual(blocking, [], `route handlers must use c.executionCtx.waitUntil(broadcast(...)): ${blocking.join(', ')}`)
console.log('broadcast hub APAC guard: PASS')
