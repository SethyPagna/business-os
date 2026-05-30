'use strict'

const path = require('path')

/** @type {unknown | null | undefined} */
let cachedSharp = undefined

/** @returns {unknown | null} */
function loadSharp() {
  if (cachedSharp !== undefined) return cachedSharp
  const executableDir = path.dirname(process.execPath || '')
  const candidates = [
    'sharp',
    path.join(executableDir, 'node_modules', 'sharp'),
    path.join(executableDir, 'sharp'),
    path.join(process.cwd(), 'node_modules', 'sharp'),
    path.join(process.cwd(), 'sharp'),
  ]
  for (const candidate of candidates) {
    try {
      cachedSharp = require(candidate)
      return cachedSharp
    } catch (_) {}
  }
  cachedSharp = null
  return cachedSharp
}

module.exports = {
  loadSharp,
}
