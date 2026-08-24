// Real-time push hub. Ported concept (not code -- there's no Express/`ws`
// server in Cloudflare Workers) of the Docker backend's `broadcast(channel,
// payload)` helper, which pushed a message to every connected `/ws` socket
// after most writes so every open tab refreshed live instead of waiting on
// its own poll/refetch-on-focus.
//
// One Durable Object instance for the whole Worker (see index.ts: always
// addressed via idFromName('global')) holds the live WebSocket connections
// using the Hibernatable WebSockets API (state.acceptWebSocket), so idle
// connections don't keep the DO billed as "active" between messages -- the
// DO can hibernate and Cloudflare wakes it back up on the next message or
// incoming connection.
//
// Usage from any route file after a write:
//   import { broadcast } from '../durable-objects/broadcastHub'
//   await broadcast(c.env, 'products', { action: 'update', id: productId })

import type { Env } from '../index'

export type BroadcastChannel = 'products' | 'units' | 'categories' | 'users' | 'roles' | 'branches' | 'inventory' | 'sales' | 'returns' | 'settings' | 'notifications' | 'customers' | 'suppliers' | 'deliveryContacts' | 'promotions' | 'portalSubmissions' | 'files' | 'fees' | 'pendingActions'

export class BroadcastHub {
  state: DurableObjectState

  constructor(state: DurableObjectState) {
    this.state = state
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Server-to-DO: a route handler POSTs a message here to fan out to
    // every connected client. Not exposed publicly -- only called from
    // inside the Worker via the DO namespace binding.
    if (request.method === 'POST' && url.pathname === '/broadcast') {
      const body = await request.json<{ channel: string; payload?: unknown }>().catch(() => null)
      if (!body?.channel) return new Response('channel is required', { status: 400 })
      // NOTE: this "type" value must match what frontend/src/api/websocket.ts's
      // ws.onmessage listens for. It was 'broadcast' here vs the frontend
      // checking `data.type === 'sync:update'` -- a silent mismatch that made
      // every message this hub ever sent get parsed and then discarded, so
      // the entire live cross-tab/cross-device update pipeline (Products,
      // POS, Sales, Inventory, Returns, etc. all listen for 'sync:update')
      // never actually fired. Every page only ever refreshed via manual
      // navigation or its own HTTP cache TTL expiring, never via push.
      const message = JSON.stringify({ type: 'sync:update', channel: body.channel, payload: body.payload ?? null, time: new Date().toISOString() })
      for (const ws of this.state.getWebSockets()) {
        try { ws.send(message) } catch (_) { /* dead socket, ignore */ }
      }
      return new Response(JSON.stringify({ ok: true, recipients: this.state.getWebSockets().length }), { headers: { 'Content-Type': 'application/json' } })
    }

    // Client-to-DO: the browser's own /ws connection, proxied here from
    // index.ts's GET /ws route so every isolate's WebSocket clients share
    // one fan-out point regardless of which edge location/isolate accepted
    // the original upgrade.
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair()
      const [client, server] = [pair[0], pair[1]]
      this.state.acceptWebSocket(server)
      server.send(JSON.stringify({ type: 'connected', runtime: 'cloudflare-workers' }))
      return new Response(null, { status: 101, webSocket: client })
    }

    return new Response('Not found', { status: 404 })
  }

  // Hibernatable WebSockets API callbacks -- the DO doesn't need to keep a
  // handler registered per-connection between messages.
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const data = JSON.parse(String(message || '{}')) as { type?: string }
      if (data.type === 'ping') ws.send(JSON.stringify({ type: 'pong', time: new Date().toISOString() }))
    } catch (_) { /* ignore malformed client messages */ }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    try { ws.close(code, reason) } catch (_) { /* already closing */ }
  }
}

// Fire-and-forget broadcast helper for route handlers. Safe to call even
// if nothing is connected (recipients: 0) and safe to await inside
// c.executionCtx.waitUntil() so it never blocks the response that
// triggered it.
export async function broadcast(env: Env, channel: BroadcastChannel, payload?: unknown): Promise<void> {
  try {
    const id = env.BROADCAST_HUB.idFromName('global')
    const stub = env.BROADCAST_HUB.get(id)
    await stub.fetch('https://broadcast-hub.internal/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, payload }),
    })
  } catch (error) {
    console.error('[broadcastHub] failed to broadcast', channel, error)
  }
}
