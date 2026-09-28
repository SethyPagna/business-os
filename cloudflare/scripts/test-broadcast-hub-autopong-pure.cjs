// F2: the broadcast hub answers the client's keep-alive ping through the
// Durable Object runtime auto-response, so a ping no longer wakes the
// hibernated object. The auto-response only fires on an exact string match,
// so this test also pins the client's ping frame to the hub's byte for byte.
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const hubPath = path.join(__dirname, '..', 'src', 'durable-objects', 'broadcastHub.ts')
const clientPath = path.join(__dirname, '..', '..', 'frontend', 'src', 'api', 'websocket.ts')

function loadHub() {
  const { outputText } = ts.transpileModule(fs.readFileSync(hubPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: hubPath,
  })
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', outputText)(mod.exports, (id) => {
    throw new Error(`broadcastHub.ts should not need a runtime import (asked for ${id})`)
  }, mod)
  return mod.exports
}

// The Workers runtime class, modelled closely enough to read back the pair.
class WebSocketRequestResponsePair {
  constructor(request, response) { this.request = request; this.response = response }
}
global.WebSocketRequestResponsePair = WebSocketRequestResponsePair

const hub = loadHub()
const registered = []
const state = {
  setWebSocketAutoResponse: (pair) => registered.push(pair),
  getWebSockets: () => [],
  acceptWebSocket: () => {},
}
new hub.BroadcastHub(state)

// 1. The hub registers exactly one auto-response at construction, which runs
//    on every wake, so it is in place before any socket can send a ping.
assert.equal(registered.length, 1, 'BroadcastHub must register a WebSocket auto-response in its constructor')
const pair = registered[0]
assert.ok(pair instanceof WebSocketRequestResponsePair, 'the auto-response must be a WebSocketRequestResponsePair')
assert.equal(pair.request, '{"type":"ping"}')
assert.equal(pair.response, '{"type":"pong"}')

// 2. The client's ping is the same bytes. JSON.stringify({ type: 'ping' }) is
//    what older clients send; the current client sends a named constant.
const client = fs.readFileSync(clientPath, 'utf8')
const clientFrame = client.match(/const WS_PING_FRAME = '([^']*)'/)
assert.ok(clientFrame, 'websocket.ts must name its ping frame WS_PING_FRAME')
assert.equal(clientFrame[1], pair.request, 'client ping frame must equal the hub auto-response request byte for byte')
assert.equal(JSON.stringify({ type: 'ping' }), pair.request, 'older clients (JSON.stringify ping) must also match')
assert.match(client, /ws\.send\(WS_PING_FRAME\)/, 'the ping timer must send the pinned frame, not a rebuilt object')

// 3. The client accepts the auto-response as a pong: it only reads `type`.
assert.equal(JSON.parse(pair.response).type, 'pong')
assert.match(client, /data\.type === 'pong'/, 'client pong detection must stay type-only so the fixed auto-response counts')

// 4. The fallback handler still answers any other ping shape (defence in depth).
;(async () => {
  const sent = []
  const hubInstance = new hub.BroadcastHub(state)
  await hubInstance.webSocketMessage({ send: (m) => sent.push(m) }, '{"type":"ping","extra":1}')
  assert.equal(sent.length, 1)
  assert.equal(JSON.parse(sent[0]).type, 'pong')
  console.log('broadcast hub auto-pong: ok')
})().catch((error) => { console.error(error); process.exit(1) })
