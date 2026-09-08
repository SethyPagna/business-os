import assert from 'node:assert/strict'
import fs from 'node:fs'

const transport = fs.readFileSync(new URL('../src/api/contactReadTransport.ts', import.meta.url), 'utf8')
const pos = fs.readFileSync(new URL('../src/components/pos/POS.tsx', import.meta.url), 'utf8')
const snapshot = fs.readFileSync(new URL('../src/api/offlineSnapshotTransport.ts', import.meta.url), 'utf8')

assert.match(transport, /export async function getSalesCustomerPicker/)
assert.match(transport, /fields: 'sales_picker'/)
assert.match(transport, /\['id', 'name', 'phone', 'email', 'address', 'membership_number', 'updated_at', 'is_anonymous'\]/)
assert.match(transport, /Number\(value\.is_anonymous \|\| 0\) === 1/, 'offline fallback must exclude a newly marked anonymous row')
assert.doesNotMatch(transport.slice(transport.indexOf('export async function getSalesCustomerPicker')), /points_balance|last_sale_at|notes/)

const calls = pos.match(/getSalesCustomerPicker\(/g) || []
assert.equal(calls.length, 2, 'search and exact-id revalidation must both use the private picker')
const oldCalls = pos.slice(pos.indexOf('async function searchPosCustomers'), pos.indexOf('async function loadPosDeliveryContacts'))
assert.doesNotMatch(oldCalls, /getCustomers\(/, 'POS customer identity reads must not use the Contacts directory payload')

assert.match(snapshot, /\/api\/customers\?fields=picker/, 'offline mirror stays on the bounded snapshot route')
console.log('PASS POS search and exact-id refresh use the narrow picker; offline fallback keeps the same allowlist')
