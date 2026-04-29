'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { DATA_ROOT } = require('../config')

const RUNTIME_META_DIR = path.join(DATA_ROOT, 'meta')
const RUNTIME_STATE_FILE = path.join(RUNTIME_META_DIR, 'runtime-state.json')

function ensureRuntimeMetaDir() {
  fs.mkdirSync(RUNTIME_META_DIR, { recursive: true })
}

function readRuntimeState() {
  try {
    ensureRuntimeMetaDir()
    if (!fs.existsSync(RUNTIME_STATE_FILE)) {
      return { storageVersion: 1, updatedAt: null, reason: 'bootstrap' }
    }
    const parsed = JSON.parse(fs.readFileSync(RUNTIME_STATE_FILE, 'utf8'))
    return {
      storageVersion: Math.max(1, Number(parsed?.storageVersion || 1)),
      updatedAt: String(parsed?.updatedAt || '').trim() || null,
      reason: String(parsed?.reason || '').trim() || 'bootstrap',
    }
  } catch (_) {
    return { storageVersion: 1, updatedAt: null, reason: 'bootstrap' }
  }
}

function writeRuntimeState(state) {
  ensureRuntimeMetaDir()
  fs.writeFileSync(RUNTIME_STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
  return state
}

function getRuntimeState() {
  const state = readRuntimeState()
  if (fs.existsSync(RUNTIME_STATE_FILE)) return state
  return writeRuntimeState({
    storageVersion: state.storageVersion,
    updatedAt: new Date().toISOString(),
    reason: state.reason || 'bootstrap',
  })
}

function bumpStorageVersion(reason = 'mutation') {
  const current = readRuntimeState()
  return writeRuntimeState({
    storageVersion: Math.max(1, Number(current.storageVersion || 1)) + 1,
    updatedAt: new Date().toISOString(),
    reason: String(reason || 'mutation').trim() || 'mutation',
  })
}

function buildRuntimeDescriptor(organizationPublicId = '') {
  const state = getRuntimeState()
  return {
    serverStartTime: null,
    storageVersion: String(state.storageVersion),
    updatedAt: state.updatedAt,
    dataRootKey: crypto.createHash('sha256').update(DATA_ROOT).digest('hex').slice(0, 16),
    organizationPublicId: String(organizationPublicId || '').trim() || null,
  }
}

module.exports = {
  RUNTIME_STATE_FILE,
  getRuntimeState,
  bumpStorageVersion,
  buildRuntimeDescriptor,
}
