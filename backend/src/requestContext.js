'use strict'

const { AsyncLocalStorage } = require('async_hooks')

const requestStorage = new AsyncLocalStorage()

function cleanText(value, maxLen = 255) {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.slice(0, maxLen)
}

function readHeader(req, name) {
  const raw = req?.headers?.[name]
  if (Array.isArray(raw)) return cleanText(raw[0])
  return cleanText(raw)
}

function extractRequestMeta(req) {
  const body = req?.body || {}

  const deviceName = cleanText(
    body.deviceName
      || body.device_name
      || readHeader(req, 'x-device-name')
  )

  const deviceTz = cleanText(
    body.deviceTz
      || body.device_tz
      || readHeader(req, 'x-device-tz'),
    120
  )

  const clientTime = cleanText(
    body.clientTime
      || body.client_time
      || readHeader(req, 'x-client-time'),
    64
  )

  return { deviceName, deviceTz, clientTime }
}

function requestContextMiddleware(req, _res, next) {
  const meta = extractRequestMeta(req)
  requestStorage.run({ meta }, next)
}

function getRequestMeta() {
  return requestStorage.getStore()?.meta || {}
}

module.exports = {
  requestContextMiddleware,
  getRequestMeta,
}

