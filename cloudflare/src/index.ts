import { Hono } from 'hono'
import settingsRoute from './routes/settings'
import productsRoute from './routes/products'
import portalRoute from './routes/portal'
import salesRoute from './routes/sales'
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

app.route('/api/settings', settingsRoute)
app.route('/api/products', productsRoute)
app.route('/api/portal', portalRoute)
app.route('/api/sales', salesRoute)

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

