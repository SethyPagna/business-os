import { Hono } from 'hono'
import settingsRoute from './routes/settings'
import productsRoute from './routes/products'
import portalRoute from './routes/portal'
import salesRoute from './routes/sales'
import authRoute from './routes/auth'
import filesRoute from './routes/files'
import branchesRoute from './routes/branches'
import catalogRoute from './routes/catalog'
import promotionsRoute from './routes/promotions'
import { serveObject } from './lib/r2'
import { handleImportQueue, handleMediaQueue } from './queue'

export type Env = {
  DB: D1Database
  ASSETS: R2Bucket
  CACHE: KVNamespace
  IMPORT_QUEUE: Queue
  MEDIA_QUEUE: Queue
  BUSINESS_OS_PUBLIC_URL: string
  BUSINESS_OS_ADMIN_URL: string
}

const app = new Hono<{ Bindings: Env }>()

app.get('/health', (c) => c.json({ status: 'ok', time: new Date().toISOString() }))

// Public: serves uploaded files straight from R2. Unauthenticated by design
// -- this mirrors backend/server.ts's GET /uploads/* route, which is also
// public (uploaded product/promotion images need to load on the public
// portal without a login). Access control happens at upload/delete time
// (files.ts requires auth), not at read time.
app.get('/uploads/*', async (c) => {
  const key = `uploads/${c.req.path.replace(/^\/uploads\//, '')}`
  return serveObject(c.env.ASSETS, key, c.req.raw)
})

app.route('/api/settings', settingsRoute)
app.route('/api/products', productsRoute)
app.route('/api/portal', portalRoute)
app.route('/api/sales', salesRoute)
app.route('/api/auth', authRoute)
app.route('/api/files', filesRoute)
app.route('/api/branches', branchesRoute)
app.route('/api/catalog', catalogRoute)
app.route('/api/promotions', promotionsRoute)

export default {
  fetch: app.fetch,
  // Cloudflare routes a queue message batch here based on which queue it
  // came from (wrangler.toml's [[queues.consumers]] entries), not by name
  // collision -- both consumers are declared, so we dispatch on the queue's
  // own name off the batch itself.
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    if (batch.queue === 'business-os-import') {
      await handleImportQueue(batch as MessageBatch<{ jobId: string; kind: 'analyze' | 'apply' }>, env)
    } else if (batch.queue === 'business-os-media') {
      await handleMediaQueue(batch as MessageBatch<{ assetKey: string; kind: 'optimize-video' | 'optimize-image' }>, env)
    }
  },
}

