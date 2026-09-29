// Real-time push hub. Ported concept (not code -- there's no Express/`ws`
// server in Cloudflare Workers) of the Docker backend's `broadcast(channel,
// payload)` helper, which pushed a message to every connected `/ws` socket
// after most writes so every open tab refreshed live instead of waiting on
// its own poll/refetch-on-focus.
//
// One Durable Object instance for the whole Worker (broadcastHubStub below,
// named HUB_NAME) holds the live WebSocket connections
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

// Keep-alive frames. The client (frontend/src/api/websocket.ts, WS_PING_FRAME)
// sends exactly this ping string every 25 s per open tab. Answering it from
// webSocketMessage() woke the hibernated object for every ping of every tab --
// the bulk of this hub's billed wake-ups, since real broadcasts are rare by
// comparison. The runtime auto-response below replies without waking the
// object, but only on an exact string match, so the ping must stay byte for
// byte identical to the client's. The client only reads `type` from the pong.
export const WS_PING_FRAME = '{"type":"ping"}'
export const WS_PONG_FRAME = '{"type":"pong"}'

export class BroadcastHub {
  state: DurableObjectState

  constructor(state: DurableObjectState) {
    this.state = state
    this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair(WS_PING_FRAME, WS_PONG_FRAME))
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
  // handler registered per-connection between messages. The exact
  // WS_PING_FRAME never reaches this handler (the auto-response answers it);
  // this stays as the fallback for any other ping shape, such as a tab still
  // running an older client build.
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const data = JSON.parse(String(message || '{}')) as { type?: string }
      if (data.type === 'ping') ws.send(JSON.stringify({ type: 'pong', time: new Date().toISOString() }))
    } catch (_) { /* ignore malformed client messages */ }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
    try { ws.close(code, reason) } catch (_) { /* already closing */ }
  }
}

// The hub lives where it is first created unless a location hint is given.
// The original 'global' instance was created without one; the business, D1
// and the pinned Worker placement are all in APAC, so sockets now connect to
// an APAC-hinted instance. broadcast() also posts to the legacy instance so
// tabs still attached to it keep receiving updates until they reconnect.
const HUB_NAME = 'global-apac'
const LEGACY_HUB_NAME = 'global'

// No socket attaches to the legacy hub any more, so once it reports none it
// never gains one again; from then on this isolate stops waking it.
let legacyHubDrained = false

async function reportedRecipients(response: Response): Promise<number | null> {
  if (!response.ok) return null
  const body = await response.json<{ recipients?: unknown }>().catch(() => null)
  return typeof body?.recipients === 'number' ? body.recipients : null
}

export function broadcastHubStub(env: Env): DurableObjectStub {
  return env.BROADCAST_HUB.get(env.BROADCAST_HUB.idFromName(HUB_NAME), { locationHint: 'apac' })
}

// Fire-and-forget broadcast helper for route handlers. Safe to call even
// if nothing is connected (recipients: 0) and safe to await inside
// c.executionCtx.waitUntil() so it never blocks the response that
// triggered it.
export async function broadcast(env: Env, channel: BroadcastChannel, payload?: unknown): Promise<void> {
  try {
    const body = JSON.stringify({ channel, payload })
    const post = (stub: DurableObjectStub) => stub.fetch('https://broadcast-hub.internal/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    if (legacyHubDrained) {
      await post(broadcastHubStub(env))
      return
    }
    const [, legacy] = await Promise.all([
      post(broadcastHubStub(env)),
      post(env.BROADCAST_HUB.get(env.BROADCAST_HUB.idFromName(LEGACY_HUB_NAME))),
    ])
    if (await reportedRecipients(legacy) === 0) legacyHubDrained = true
  } catch (error) {
    console.error('[broadcastHub] failed to broadcast', channel, error)
  }
}
