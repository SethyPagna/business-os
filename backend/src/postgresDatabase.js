'use strict'

const fs = require('fs')
const path = require('path')
const { DATABASE_URL } = require('./config')
const { coerceRow, translateSql } = require('./db/postgresQueryCompat')

function loadPgNative() {
  try {
    return require('pg-native')
  } catch (error) {
    const externalModuleRoot = process.pkg
      ? path.join(path.dirname(process.execPath), 'node_modules')
      : ''
    if (externalModuleRoot) {
      try {
        return require(path.join(externalModuleRoot, 'pg-native'))
      } catch (_) {}
    }
    const message = error?.message || String(error)
    throw new Error(`Postgres runtime requires pg-native/libpq for the synchronous cutover bridge. ${message}`)
  }
}

function normalizeQueryRows(rows) {
  if (!Array.isArray(rows)) return []
  return rows.map(coerceRow)
}

function buildRunResult(rows = []) {
  const normalized = normalizeQueryRows(rows)
  const first = normalized[0] || {}
  return {
    changes: normalized.length,
    lastInsertRowid: first.id || 0,
  }
}

function normalizeStatementArgs(args = []) {
  if (!args.length) return []
  if (args.length > 1) return args
  const value = args[0]
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return value
  return [value]
}

class PostgresCompatStatement {
  constructor(database, sql) {
    this.database = database
    this.sql = String(sql || '')
  }

  all(...args) {
    const params = normalizeStatementArgs(args)
    const translated = translateSql(this.sql, params, { mode: 'all' })
    return this.database.queryRows(translated.sql, translated.values)
  }

  get(...args) {
    return this.all(...args)[0] || undefined
  }

  run(...args) {
    const params = normalizeStatementArgs(args)
    const translated = translateSql(this.sql, params, { mode: 'run' })
    const rows = this.database.queryRows(translated.sql, translated.values)
    return buildRunResult(rows)
  }
}

class PostgresCompatDatabase {
  constructor(options = {}) {
    this.connectionString = options.connectionString || DATABASE_URL
    if (!this.connectionString) throw new Error('DATABASE_URL is required when DATABASE_DRIVER=postgres.')
    const Client = options.client ? null : (options.Client || loadPgNative())
    this.client = options.client || new Client()
    this.inTransaction = 0
    if (!options.client) this.client.connectSync(this.connectionString)
    this.ensureRuntimeSchema()
  }

  prepare(sql) {
    return new PostgresCompatStatement(this, sql)
  }

  queryRows(sql, values = []) {
    const rows = this.client.querySync(sql, values)
    return normalizeQueryRows(rows)
  }

  exec(sql) {
    const statements = String(sql || '')
      .split(/;\s*(?=(?:[^']*'[^']*')*[^']*$)/)
      .map((statement) => statement.trim())
      .filter(Boolean)
    statements.forEach((statement) => {
      const translated = translateSql(statement, [], { mode: 'exec' })
      this.queryRows(translated.sql, translated.values)
    })
  }

  transaction(fn) {
    if (typeof fn !== 'function') throw new Error('transaction requires a function')
    return (...args) => {
      const nested = this.inTransaction > 0
      const savepoint = nested ? `bos_sp_${this.inTransaction + 1}` : ''
      if (nested) this.queryRows(`SAVEPOINT ${savepoint}`)
      else this.queryRows('BEGIN')
      this.inTransaction += 1
      try {
        const result = fn(...args)
        this.inTransaction -= 1
        if (nested) this.queryRows(`RELEASE SAVEPOINT ${savepoint}`)
        else this.queryRows('COMMIT')
        return result
      } catch (error) {
        this.inTransaction -= 1
        try {
          if (nested) this.queryRows(`ROLLBACK TO SAVEPOINT ${savepoint}`)
          else this.queryRows('ROLLBACK')
        } catch (_) {}
        throw error
      }
    }
  }

  ensureRuntimeSchema() {
    try {
      const hasCoreTables = this.queryRows(`
        SELECT (
          to_regclass('public.products') IS NOT NULL
          AND to_regclass('public.settings') IS NOT NULL
          AND to_regclass('public.users') IS NOT NULL
        )::int AS ready
      `)[0]?.ready === 1
      if (!hasCoreTables) {
        const schemaPath = path.join(__dirname, 'db', 'postgresSchema.sql')
        const schemaSql = fs.readFileSync(schemaPath, 'utf8')
        this.client.querySync(schemaSql)
      }
    } catch (error) {
      console.warn(`[postgres] final schema bootstrap failed: ${error?.message || error}`)
      throw error
    }

    const statements = [
      'CREATE EXTENSION IF NOT EXISTS pg_trgm',
      'CREATE EXTENSION IF NOT EXISTS unaccent',
      'CREATE EXTENSION IF NOT EXISTS btree_gin',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_key_unique ON settings(key)',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_branch_stock_product_branch_unique ON branch_stock(product_id, branch_id)',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_file_assets_public_path_unique ON file_assets(public_path)',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_google_drive_sync_entries_path_unique ON google_drive_sync_entries(relative_path)',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_import_job_batches_job_batch_unique ON import_job_batches(job_id, batch_index)',
      'CREATE INDEX IF NOT EXISTS idx_products_name_lower_pg ON products (lower(name))',
      'CREATE INDEX IF NOT EXISTS idx_products_brand_lower_pg ON products (lower(brand))',
      'CREATE INDEX IF NOT EXISTS idx_products_category_lower_pg ON products (lower(category))',
      'CREATE INDEX IF NOT EXISTS idx_products_barcode_pg ON products (barcode)',
      'CREATE INDEX IF NOT EXISTS idx_products_sku_pg ON products (sku)',
      'CREATE INDEX IF NOT EXISTS idx_products_parent_pg ON products (parent_id, is_group)',
      'CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_created_pg ON inventory_movements(product_id, created_at DESC, id DESC)',
      'CREATE INDEX IF NOT EXISTS idx_sales_created_pg ON sales(created_at DESC, id DESC)',
      'CREATE INDEX IF NOT EXISTS idx_returns_created_pg ON returns(created_at DESC, id DESC)',
      'CREATE INDEX IF NOT EXISTS idx_action_history_created_pg ON action_history(created_at DESC, id DESC)',
    ]
    statements.forEach((statement) => {
      try {
        this.queryRows(statement)
      } catch (error) {
        console.warn(`[postgres] schema/index check skipped for "${statement.slice(0, 80)}": ${error?.message || error}`)
      }
    })
  }

  close() {
    try { this.client.end() } catch (_) {}
  }
}

function createPostgresDatabase(options = {}) {
  return new PostgresCompatDatabase(options)
}

function runDatabaseMaintenance() {
  return null
}

function ensureCoreDataInvariants() {
  return null
}

function ensureDefaultOrganizationAndGroup() {
  return null
}

function ensurePrimaryAdminRoleAndUser() {
  return null
}

let dbInstance = null

function getDb() {
  if (!dbInstance) dbInstance = createPostgresDatabase()
  return dbInstance
}

const db = new Proxy({}, {
  get(_target, prop) {
    const database = getDb()
    const value = database[prop]
    return typeof value === 'function' ? value.bind(database) : value
  },
  set(_target, prop, value) {
    const database = getDb()
    database[prop] = value
    return true
  },
  has(_target, prop) {
    return prop in getDb()
  },
  ownKeys() {
    return Reflect.ownKeys(getDb())
  },
  getOwnPropertyDescriptor(_target, prop) {
    const descriptor = Object.getOwnPropertyDescriptor(getDb(), prop)
    return descriptor || { configurable: true, enumerable: false, writable: true, value: undefined }
  },
})

function closeDatabase() {
  if (dbInstance) dbInstance.close()
  dbInstance = null
}

module.exports = {
  PostgresCompatDatabase,
  closeDatabase,
  createPostgresDatabase,
  db,
  ensureCoreDataInvariants,
  ensureDefaultOrganizationAndGroup,
  ensurePrimaryAdminRoleAndUser,
  runDatabaseMaintenance,
}
