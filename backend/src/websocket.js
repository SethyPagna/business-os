'use strict'
/**
 * websocket.js — WebSocket server setup and client management.
 *
 * Exports `attachWss(httpServer)` which wires up the WebSocket server onto an
 * existing http.Server. The shared `wss_clients` Set is imported from helpers
 * so that `broadcast()` in route handlers and the WS connection logic share the
 * same client set without a circular dependency.
 */

const { WebSocketServer } = require('ws')
const { wss_clients }     = require('./helpers')
const { getSessionUser } = require('./sessionAuth')
const { isAllowedWebSocketOrigin } = require('./serverUtils')

const WS_MAX_MESSAGE_BYTES = Math.max(256, Number(process.env.WS_MAX_MESSAGE_BYTES || 8 * 1024))
const WS_MAX_MESSAGES_PER_WINDOW = Math.max(5, Number(process.env.WS_MAX_MESSAGES_PER_WINDOW || 60))
const WS_MESSAGE_WINDOW_MS = Math.max(1_000, Number(process.env.WS_MESSAGE_WINDOW_MS || 30 * 1000))

/**
 * Attach the WebSocket server to an existing http.Server instance.
 * @param {import('http').Server} httpServer
 */
function attachWss(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: WS_MAX_MESSAGE_BYTES })

  wss.on('connection', (ws, req) => {
    if (!isAllowedWebSocketOrigin(req)) {
      console.warn(`[WS] rejected origin ${String(req.headers.origin || '(none)')} from ${req.socket.remoteAddress}`)
      try { ws.close(4003, 'Origin not allowed.') } catch (_) {}
      return
    }

    const sessionUser = getSessionUser(req)
    if (!sessionUser) {
      console.warn(`[WS] unauthorized connection attempt from ${req.socket.remoteAddress} (invalid_session)`)
      try { ws.close(4001, 'Please sign in again to continue.') } catch (_) {}
      return
    }

    ws.user = sessionUser
    ws._messageWindowStartedAt = Date.now()
    ws._messageCount = 0

    wss_clients.add(ws)
    console.log(`[WS] Client connected from ${req.socket.remoteAddress}. Total: ${wss_clients.size}`)

    ws.on('message', (msg) => {
      try {
        const nowMs = Date.now()
        if ((nowMs - Number(ws._messageWindowStartedAt || 0)) > WS_MESSAGE_WINDOW_MS) {
          ws._messageWindowStartedAt = nowMs
          ws._messageCount = 0
        }
        ws._messageCount = Number(ws._messageCount || 0) + 1
        if (ws._messageCount > WS_MAX_MESSAGES_PER_WINDOW) {
          console.warn(`[WS] rate limit exceeded for user ${ws.user?.id || 'unknown'} from ${req.socket.remoteAddress}`)
          try { ws.close(4008, 'Too many websocket messages.') } catch (_) {}
          return
        }

        const raw = Buffer.isBuffer(msg) ? msg.toString('utf8') : String(msg || '')
        if (Buffer.byteLength(raw, 'utf8') > WS_MAX_MESSAGE_BYTES) {
          try { ws.close(4009, 'Message too large.') } catch (_) {}
          return
        }

        const data = JSON.parse(raw)
        // Log ping/pong for debugging
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }))
          console.debug('[WS] received ping → pong')
        } else {
          console.debug('[WS] received message', data.type || '(unknown)')
        }
      } catch (_) {}
    })

    ws.on('close', (code, reason) => {
      wss_clients.delete(ws)
      try { console.log(`[WS] Client disconnected. Total: ${wss_clients.size} code=${code} reason=${String(reason)}`) } catch(_) {}
    })

    ws.on('error', (err) => { console.warn('[WS] client error', err); wss_clients.delete(ws) })

    // Send welcome frame so client can confirm the connection is live
    ws.send(JSON.stringify({ type: 'connected', clients: wss_clients.size }))
  })

  return wss
}

module.exports = { attachWss }
