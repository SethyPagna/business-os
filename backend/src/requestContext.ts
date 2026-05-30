'use strict'

const { AsyncLocalStorage } = require('async_hooks')

/** @typedef {{ deviceName?: string, deviceTz?: string, clientTime?: string }} RequestMeta */

const requestStorage = new AsyncLocalStorage()

/** @param {unknown} value @param {number} [maxLen] @returns {string} */
function cleanText(value, maxLen = 255) {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.slice(0, maxLen)
}

/** @param {{ headers?: Record<string, unknown> } | null | undefined} req @param {string} name @returns {string} */
function readHeader(req, name) {
  const raw = req?.headers?.[name]
  if (Array.isArray(raw)) return cleanText(raw[0])
  return cleanText(raw)
}

/** @param {{ body?: Record<string, unknown>, headers?: Record<string, unknown> } | null | undefined} req @returns {RequestMeta} */
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

/** @param {object} req @param {object} _res @param {() => void} next @returns {void} */
function requestContextMiddleware(req, _res, next) {
  const meta = extractRequestMeta(req)
  requestStorage.run({ meta }, next)
}

/** @returns {RequestMeta} */
function getRequestMeta() {
  return requestStorage.getStore()?.meta || {}
}

module.exports = {
  requestContextMiddleware,
  getRequestMeta,
}
