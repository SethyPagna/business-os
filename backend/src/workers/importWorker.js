'use strict'

process.env.BUSINESS_OS_WORKER_ROLE = process.env.BUSINESS_OS_WORKER_ROLE || 'import-worker'

const { closeDatabase } = require('../database')
const { recoverImportJobs, startImportWorkers } = require('../services/importJobs')

let shuttingDown = false

async function start() {
  const status = await startImportWorkers()
  console.log(`[import-worker] started (${status.driver}, analyze=${status.queues?.analyze}, apply=${status.queues?.apply})`)
  await recoverImportJobs({ forceQueue: true })
}

function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[import-worker] ${signal || 'shutdown'} received`)
  try { closeDatabase() } catch (_) {}
  process.exit(0)
}

if (require.main === module) {
  start().catch((error) => {
    console.error(`[import-worker] failed to start: ${error?.message || error}`)
    try { closeDatabase() } catch (_) {}
    process.exit(1)
  })
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

module.exports = { start }
