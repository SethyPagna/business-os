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
const { authorizeProtectedRequest } = require('./accessControl')

/**
 * Attach the WebSocket server to an existing http.Server instance.
 * @param {import('http').Server} httpServer
 */
function attachWss(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

  wss.on('connection', (ws, req) => {
    const result = authorizeProtectedRequest(req)
    if (!result.allowed) {
      console.warn(`[WS] unauthorized connection attempt from ${req.socket.remoteAddress} (${result.code || 'unauthorized'})`)
      try { ws.close(4001, result.message || 'Unauthorized') } catch (_) {}
      return
    }

    wss_clients.add(ws)
    console.log(`[WS] Client connected from ${req.socket.remoteAddress}. Total: ${wss_clients.size}`)

    ws.on('message', (msg) => {
      try {
        const data = JSON.parse(msg)
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
