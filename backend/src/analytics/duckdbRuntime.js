'use strict'

const path = require('path')

const {
  ANALYTICS_ENGINE,
  PARQUET_STORE,
  OBJECT_STORAGE_DRIVER,
  S3_BUCKET,
} = require('../config')

let cachedProbe = null

function tryRequireDuckDbPackage(packageName) {
  try {
    return require(packageName)
  } catch (error) {
    if (!process.pkg) throw error
    try {
      return require(path.join(path.dirname(process.execPath), 'node_modules', packageName))
    } catch (_) {
      throw error
    }
  }
}

function probeDuckDbPackage() {
  if (cachedProbe) return cachedProbe
  const candidates = ['@duckdb/node-api', 'duckdb']
  for (const packageName of candidates) {
    try {
      // Optional runtime dependency: only load when diagnostics need to know if
      // the DuckDB bridge is installed in this specific release image.
      tryRequireDuckDbPackage(packageName)
      cachedProbe = { available: true, packageName, reason: 'available' }
      return cachedProbe
    } catch (error) {
      if (error?.code !== 'MODULE_NOT_FOUND') {
        cachedProbe = {
          available: false,
          packageName,
          reason: error?.message || 'DuckDB package failed to load',
        }
        return cachedProbe
      }
    }
  }
  cachedProbe = {
    available: false,
    packageName: null,
    reason: 'DuckDB Node package is not installed in this runtime yet',
  }
  return cachedProbe
}

function getDuckDbRuntimeStatus(options = {}) {
  const configuredEngine = String(options.analyticsEngine || ANALYTICS_ENGINE || 'none').toLowerCase()
  const configuredStore = String(options.parquetStore || PARQUET_STORE || 'none').toLowerCase()
  const probe = options.probe === false
    ? { available: false, packageName: null, reason: 'probe skipped' }
    : probeDuckDbPackage()
  const enabled = configuredEngine === 'duckdb'
  const objectStores = new Set(['r2', 'minio'])
  const parquetEnabled = objectStores.has(configuredStore) || configuredStore === 'local'
  const productionStoreReady = objectStores.has(configuredStore) && configuredStore === OBJECT_STORAGE_DRIVER && !!S3_BUCKET

  return {
    engine: configuredEngine,
    enabled,
    available: enabled && probe.available,
    packageName: probe.packageName,
    unavailableReason: enabled && !probe.available ? probe.reason : '',
    parquetStore: configuredStore,
    parquetEnabled,
    productionStoreReady,
    objectStorageDriver: OBJECT_STORAGE_DRIVER,
    bucket: S3_BUCKET || null,
    roles: [
      'import_staging',
      'large_validation_scans',
      'export_generation',
      'analytics_snapshots',
      'backup_verification',
    ],
  }
}

module.exports = {
  getDuckDbRuntimeStatus,
}
