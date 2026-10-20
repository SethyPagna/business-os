import { Hono } from 'hono'
import type { Env } from '../index'
import { requireAuth, type SessionUser } from '../lib/auth'
import { canonicalOfflineSaleOwner } from '../lib/offlineSaleOwnership'

// GET /owner is the app's session probe (sign-out recovery and the queued-sale
// owner check). The offline outbox replay and chunked-upload routes were
// removed with offline mode; the SyncUploadSession class stays bound until a
// deleted_classes migration retires it.
export function createSyncRoute() {
  const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
  app.use('*', requireAuth)

  app.get('/owner', (c) => {
    c.header('Cache-Control', 'private, no-store')
    return c.json({ owner: canonicalOfflineSaleOwner(c.get('user'), c.req.url) })
  })

  return app
}
