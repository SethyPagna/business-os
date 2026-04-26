'use strict'

const fs = require('fs')
const path = require('path')

/**
 * 1. Filesystem Utility Library
 * 1.1 Purpose
 * - Centralize shared script helpers used across project scripts.
 * - Reduce duplicate walk/read/path logic in multiple script files.
 */

/**
 * 1.2 Path helpers
 */
function toPosix(value) {
  return String(value || '').replace(/\\/g, '/')
}

function resolveProjectRoot(startDir = __dirname) {
  let current = path.resolve(startDir)
  while (true) {
    const hasProjectShape =
      fs.existsSync(path.join(current, 'backend')) &&
      fs.existsSync(path.join(current, 'frontend')) &&
      fs.existsSync(path.join(current, 'ops'))
    if (hasProjectShape) return current

    const parent = path.dirname(current)
    if (parent === current) return process.cwd()
    current = parent
  }
}

function relFrom(rootDir, absPath) {
  return toPosix(path.relative(rootDir, absPath))
}

/**
 * 1.3 Read helpers
 */
function readUtf8(filePath, fallback = '') {
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch (_) {
    return fallback
  }
}

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (_) {
    return fallback
  }
}

function lineCount(text) {
  if (!text) return 0
  return String(text).split(/\r?\n/).length
}

/**
 * 1.4 File collection helpers
 */
function walkFilesRecursive(startDir, options = {}) {
  const {
    excludeDirs = new Set(['node_modules', 'dist', '.git', '.pm2', 'release']),
    extensions = null,
  } = options
  const out = []
  if (!fs.existsSync(startDir)) return out
  const stack = [startDir]
  while (stack.length) {
    const current = stack.pop()
    const entries = fs.readdirSync(current, { withFileTypes: true })
    entries.forEach((entry) => {
      const abs = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (!excludeDirs.has(entry.name)) stack.push(abs)
        return
      }
      if (extensions instanceof Set) {
        const ext = path.extname(entry.name).toLowerCase()
        if (!extensions.has(ext)) return
      }
      out.push(abs)
    })
  }
  return out
}

function collectRootFiles(rootDir, options = {}) {
  const {
    extensions = null,
    excludedFiles = new Set(),
  } = options
  const out = []
  const entries = fs.readdirSync(rootDir, { withFileTypes: true })
  entries.forEach((entry) => {
    if (!entry.isFile()) return
    if (excludedFiles.has(entry.name)) return
    if (extensions instanceof Set) {
      const ext = path.extname(entry.name).toLowerCase()
      if (!extensions.has(ext) && !extensions.has(entry.name.toLowerCase())) return
    }
    out.push(path.join(rootDir, entry.name))
  })
  return out
}

module.exports = {
  toPosix,
  resolveProjectRoot,
  relFrom,
  readUtf8,
  readJson,
  lineCount,
  walkFilesRecursive,
  collectRootFiles,
}
