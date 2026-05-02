'use strict'

const assert = require('node:assert/strict')
const { startSystemJob, getSystemJob, listSystemJobs } = require('../src/systemJobs')

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForStatus(id, expected) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const job = getSystemJob(id)
    if (job?.status === expected) return job
    await wait(25)
  }
  throw new Error(`Timed out waiting for ${id} to become ${expected}`)
}

async function main() {
  const completed = startSystemJob('test_complete', async ({ progress }) => {
    progress({ phase: 'halfway', progress: 50, message: 'Halfway' })
    await wait(1)
    return { value: 42 }
  }, { prefix: 'test' })

  const completedJob = await waitForStatus(completed.id, 'completed')
  assert.equal(completedJob.progress, 100)
  assert.equal(completedJob.result.value, 42)
  assert.equal(completedJob.phase, 'completed')

  const failed = startSystemJob('test_failed', async () => {
    throw new Error('expected failure')
  }, { prefix: 'test' })

  const failedJob = await waitForStatus(failed.id, 'failed')
  assert.match(failedJob.error, /expected failure/)

  const jobs = listSystemJobs({ limit: 10 })
  assert.ok(jobs.some((job) => job.id === completed.id))
  assert.ok(jobs.some((job) => job.id === failed.id))
  console.log('PASS system jobs track completion and failure')
}

main().catch((error) => {
  console.error('FAIL system jobs track completion and failure')
  console.error(error)
  process.exitCode = 1
})
