'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

let failed = 0

async function runTest(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const root = path.resolve(__dirname, '..')
const schema = fs.readFileSync(path.join(root, 'src/db/postgresSchema.sql'), 'utf8')
const runtime = fs.readFileSync(path.join(root, 'src/postgresDatabase.js'), 'utf8')
const productsRoute = fs.readFileSync(path.join(root, 'src/routes/products.js'), 'utf8')
const notificationsRoute = fs.readFileSync(path.join(root, 'src/routes/notifications.js'), 'utf8')
const salesRoute = fs.readFileSync(path.join(root, 'src/routes/sales.js'), 'utf8')
const branchesRoute = fs.readFileSync(path.join(root, 'src/routes/branches.js'), 'utf8')
const metrics = fs.readFileSync(path.join(root, 'src/businessMetrics.js'), 'utf8')

runTest('products persist expiry date and alert window through schema and runtime migrations', () => {
  assert.match(schema, /expiry_date/i)
  assert.match(schema, /expiry_alert_days/i)
  assert.match(runtime, /ADD COLUMN IF NOT EXISTS expiry_date/i)
  assert.match(runtime, /ADD COLUMN IF NOT EXISTS expiry_alert_days/i)
})

runTest('product create and update routes accept expiry fields', () => {
  assert.match(productsRoute, /expiry_date/)
  assert.match(productsRoute, /expiry_alert_days/)
  assert.match(productsRoute, /normalizeExpiryFields/)
})

runTest('dashboard and notifications expose expiring product alerts', () => {
  assert.match(metrics, /function getExpiringProducts/)
  assert.match(metrics, /expiry_date/)
  assert.match(notificationsRoute, /notifications_expiry_enabled/)
  assert.match(notificationsRoute, /buildExpirySection/)
  assert.match(notificationsRoute, /notification_expiry_summary/)
})

runTest('stock alert counts share one low-stock and out-of-stock definition', () => {
  assert.match(metrics, /function getStockMetrics/)
  assert.match(metrics, /function getStockAlertProducts/)
  assert.match(metrics, /function getOutOfStockProducts/)
  assert.match(metrics, /COALESCE\(p\.stock_quantity, 0\) > COALESCE\(p\.out_of_stock_threshold, 0\)/)
  assert.match(notificationsRoute, /getStockAlertProducts\(\{ limit: 5000 \}\)/)
  assert.match(salesRoute, /low_stock:\s+getLowStockProducts\(\{ limit: 5000 \}\)/)
  assert.match(salesRoute, /out_of_stock:\s+getOutOfStockProducts\(\{ limit: 5000 \}\)/)
  assert.match(branchesRoute, /router\.get\('\/summary'/)
  assert.match(branchesRoute, /COALESCE\(bs\.quantity, 0\) > COALESCE\(p\.out_of_stock_threshold, 0\)/)
})

if (failed > 0) {
  process.exitCode = 1
}
