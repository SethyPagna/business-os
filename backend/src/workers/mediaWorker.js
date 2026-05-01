'use strict'

process.env.BUSINESS_OS_WORKER_ROLE = process.env.BUSINESS_OS_WORKER_ROLE || 'media-worker'

const { closeDatabase } = require('../database')
const { startMediaWorker } = require('../services/mediaQueue')

let shuttingDown = false

async function start() {
  const status = await startMediaWorker()
  console.log(`[media-worker] started (${status.driver}, queue=${status.queue}, concurrency=${status.concurrency})`)
}

function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[media-worker] ${signal || 'shutdown'} received`)
  try { closeDatabase() } catch (_) {}
  process.exit(0)
}

if (require.main === module) {
  start().catch((error) => {
    console.error(`[media-worker] failed to start: ${error?.message || error}`)
    try { closeDatabase() } catch (_) {}
    process.exit(1)
  })
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

module.exports = { start }
