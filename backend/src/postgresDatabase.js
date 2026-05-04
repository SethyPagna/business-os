'use strict'

const fs = require('fs')
const path = require('path')
const bcrypt = require('bcryptjs')
const {
  DATABASE_URL,
  DEFAULT_ORGANIZATION_BOOTSTRAP,
} = require('./config')
const { coerceRow, translateSql } = require('./db/postgresQueryCompat')
const { DEFAULT_ROLE_PERMISSIONS } = require('./permissions')

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
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_code_unique ON roles(code) WHERE code IS NOT NULL',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users(lower(trim(username))) WHERE deleted_at IS NULL',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_public_id_unique ON organizations(public_id)',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_slug_unique ON organizations(slug)',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_organization_groups_org_slug_unique ON organization_groups(organization_id, slug)',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_branch_stock_product_branch_unique ON branch_stock(product_id, branch_id)',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_file_assets_public_path_unique ON file_assets(public_path)',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_google_drive_sync_entries_path_unique ON google_drive_sync_entries(relative_path)',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_import_job_batches_job_batch_unique ON import_job_batches(job_id, batch_index)',
      'ALTER TABLE products ADD COLUMN IF NOT EXISTS expiry_date TEXT',
      'ALTER TABLE products ADD COLUMN IF NOT EXISTS expiry_alert_days DOUBLE PRECISION DEFAULT 30',
      "CREATE INDEX IF NOT EXISTS idx_products_expiry_date ON products(expiry_date) WHERE expiry_date IS NOT NULL AND expiry_date <> ''",
      'ALTER TABLE products ADD COLUMN IF NOT EXISTS rfid_confirmed_qty DOUBLE PRECISION DEFAULT 0',
      'ALTER TABLE branch_stock ADD COLUMN IF NOT EXISTS rfid_confirmed_qty DOUBLE PRECISION DEFAULT 0',
      `CREATE TABLE IF NOT EXISTS rfid_tags (
        id BIGSERIAL PRIMARY KEY,
        epc_id TEXT NOT NULL,
        tid TEXT,
        product_id BIGINT NOT NULL,
        branch_id BIGINT NOT NULL,
        status TEXT DEFAULT 'active',
        last_seen TIMESTAMPTZ,
        last_seen_session_id BIGINT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        created_by BIGINT,
        updated_by BIGINT
      )`,
      `CREATE TABLE IF NOT EXISTS rfid_scan_sessions (
        id BIGSERIAL PRIMARY KEY,
        branch_id BIGINT NOT NULL,
        area TEXT,
        reader_id TEXT,
        status TEXT DEFAULT 'active',
        ledger_qty DOUBLE PRECISION DEFAULT 0,
        confirmed_qty DOUBLE PRECISION DEFAULT 0,
        missing_count BIGINT DEFAULT 0,
        extra_count BIGINT DEFAULT 0,
        wrong_location_count BIGINT DEFAULT 0,
        unknown_count BIGINT DEFAULT 0,
        started_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        finished_at TIMESTAMPTZ,
        applied_at TIMESTAMPTZ,
        created_by BIGINT,
        created_by_name TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS rfid_events (
        id BIGSERIAL PRIMARY KEY,
        session_id BIGINT NOT NULL,
        epc_id TEXT NOT NULL,
        tid TEXT,
        product_id BIGINT,
        branch_id BIGINT,
        event_type TEXT NOT NULL,
        antenna TEXT,
        rssi DOUBLE PRECISION,
        seen_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        raw_json TEXT,
        dedupe_key TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS rfid_session_items (
        id BIGSERIAL PRIMARY KEY,
        session_id BIGINT NOT NULL,
        epc_id TEXT NOT NULL,
        tid TEXT,
        product_id BIGINT,
        expected_branch_id BIGINT,
        seen_branch_id BIGINT,
        status TEXT NOT NULL,
        review_note TEXT,
        first_seen TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        last_seen TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        read_count BIGINT DEFAULT 1
      )`,
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_rfid_tags_epc_unique ON rfid_tags(epc_id)',
      'CREATE INDEX IF NOT EXISTS idx_rfid_tags_product_branch ON rfid_tags(product_id, branch_id, status)',
      'CREATE INDEX IF NOT EXISTS idx_rfid_events_session_epc ON rfid_events(session_id, epc_id, seen_at DESC)',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_rfid_session_items_unique ON rfid_session_items(session_id, epc_id)',
      `CREATE TABLE IF NOT EXISTS system_jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        phase TEXT,
        progress INTEGER DEFAULT 0,
        message TEXT,
        result_json TEXT,
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )`,
      'CREATE INDEX IF NOT EXISTS idx_system_jobs_created_pg ON system_jobs(created_at DESC, id DESC)',
      'CREATE INDEX IF NOT EXISTS idx_system_jobs_status_pg ON system_jobs(status, updated_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_products_name_lower_pg ON products (lower(name))',
      'CREATE INDEX IF NOT EXISTS idx_products_brand_lower_pg ON products (lower(brand))',
      'CREATE INDEX IF NOT EXISTS idx_products_category_lower_pg ON products (lower(category))',
      'CREATE INDEX IF NOT EXISTS idx_products_barcode_pg ON products (barcode)',
      'CREATE INDEX IF NOT EXISTS idx_products_sku_pg ON products (sku)',
      'CREATE INDEX IF NOT EXISTS idx_products_parent_pg ON products (parent_id, is_group)',
      'CREATE INDEX IF NOT EXISTS idx_products_active_stock_name_pg ON products (is_active, stock_quantity, name)',
      'CREATE INDEX IF NOT EXISTS idx_products_supplier_lower_pg ON products (lower(supplier))',
      'CREATE INDEX IF NOT EXISTS idx_branch_stock_branch_qty_product_pg ON branch_stock(branch_id, quantity DESC, product_id)',
      'CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_created_pg ON inventory_movements(product_id, created_at DESC, id DESC)',
      'CREATE INDEX IF NOT EXISTS idx_inventory_movements_created_pg ON inventory_movements(created_at DESC, id DESC)',
      'CREATE INDEX IF NOT EXISTS idx_inventory_movements_branch_created_pg ON inventory_movements(branch_id, created_at DESC, id DESC)',
      'CREATE INDEX IF NOT EXISTS idx_inventory_movements_user_created_pg ON inventory_movements(user_id, created_at DESC, id DESC)',
      'CREATE INDEX IF NOT EXISTS idx_sales_created_pg ON sales(created_at DESC, id DESC)',
      'CREATE INDEX IF NOT EXISTS idx_sales_status_created_pg ON sales(sale_status, created_at DESC, id DESC)',
      'CREATE INDEX IF NOT EXISTS idx_sale_items_product_branch_sale_pg ON sale_items(product_id, branch_id, sale_id)',
      'CREATE INDEX IF NOT EXISTS idx_returns_created_pg ON returns(created_at DESC, id DESC)',
      'CREATE INDEX IF NOT EXISTS idx_returns_status_created_pg ON returns(status, created_at DESC, id DESC)',
      'CREATE INDEX IF NOT EXISTS idx_customers_membership_lower_pg ON customers(lower(membership_number))',
      'CREATE INDEX IF NOT EXISTS idx_customer_share_submissions_status_created_pg ON customer_share_submissions(status, created_at DESC, id DESC)',
      'CREATE INDEX IF NOT EXISTS idx_action_history_created_pg ON action_history(created_at DESC, id DESC)',
    ]
    statements.forEach((statement) => {
      try {
        this.queryRows(statement)
      } catch (error) {
        console.warn(`[postgres] schema/index check skipped for "${statement.slice(0, 80)}": ${error?.message || error}`)
      }
    })
    this.ensureDefaultSeedData()
  }

  ensureDefaultSeedData() {
    const orgSeed = DEFAULT_ORGANIZATION_BOOTSTRAP || {}
    const orgName = String(process.env.BUSINESS_OS_ORGANIZATION_NAME || orgSeed.name || 'Business OS').trim() || 'Business OS'
    const orgSlug = String(process.env.BUSINESS_OS_ORGANIZATION_SLUG || orgSeed.slug || 'business-os').trim() || 'business-os'
    const publicId = String(process.env.BUSINESS_OS_ORGANIZATION_PUBLIC_ID || orgSeed.publicId || 'org_business_os').trim() || 'org_business_os'

    const existingOrg = this.queryRows(`
      SELECT id, slug, public_id
      FROM organizations
      WHERE public_id = $1 OR slug = $2
      ORDER BY CASE WHEN public_id = $1 THEN 0 ELSE 1 END, id ASC
      LIMIT 1
    `, [publicId, orgSlug])[0]
    const org = existingOrg
      ? this.queryRows(`
          UPDATE organizations
          SET name = $1,
              is_active = 1,
              setup_enabled = 0
          WHERE id = $2
          RETURNING id
        `, [orgName, existingOrg.id])[0]
      : this.queryRows(`
          INSERT INTO organizations (name, slug, public_id, is_active, setup_enabled)
          VALUES ($1, $2, $3, 1, 0)
          RETURNING id
        `, [orgName, orgSlug, publicId])[0]
    const orgId = Number(org?.id || 0) || Number(existingOrg?.id || 0)
    if (orgId) {
      this.queryRows(`
        INSERT INTO organization_groups (organization_id, name, slug, is_default, is_active)
        VALUES ($1, 'Main', 'main', 1, 1)
        ON CONFLICT (organization_id, slug) DO UPDATE SET
          is_default = 1,
          is_active = 1
      `, [orgId])
    }

    const roleRows = [
      ['Admin', 'admin', 1, DEFAULT_ROLE_PERMISSIONS.admin],
      ['Manager', 'manager', 0, DEFAULT_ROLE_PERMISSIONS.manager],
      ['Employee', 'employee', 0, DEFAULT_ROLE_PERMISSIONS.employee],
    ]
    roleRows.forEach(([name, code, isSystem, permissions]) => {
      const existingRole = this.queryRows('SELECT id, code FROM roles WHERE code = $1 LIMIT 1', [code])[0]
      if (existingRole?.id) {
        this.queryRows(`
          UPDATE roles
          SET name = $1,
              is_system = $2,
              permissions = CASE
                WHEN code = 'admin' THEN $3
                ELSE permissions
              END,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $4
        `, [name, isSystem, JSON.stringify(permissions || {}), existingRole.id])
      } else {
        this.queryRows(`
          INSERT INTO roles (name, code, is_system, permissions, updated_at)
          VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
        `, [name, code, isSystem, JSON.stringify(permissions || {})])
      }
    })

    const adminRole = this.queryRows("SELECT id FROM roles WHERE code = 'admin' LIMIT 1")[0]
    const existingAdmin = this.queryRows("SELECT id FROM users WHERE lower(trim(username)) = 'admin' AND deleted_at IS NULL LIMIT 1")[0]
    if (!existingAdmin?.id) {
      const defaultPassword = String(process.env.BUSINESS_OS_ADMIN_PASSWORD || 'Admin123456!')
      const passwordHash = bcrypt.hashSync(defaultPassword, 10)
      const groupId = orgId
        ? Number(this.queryRows('SELECT id FROM organization_groups WHERE organization_id = $1 ORDER BY is_default DESC, id ASC LIMIT 1', [orgId])[0]?.id || 0) || null
        : null
      this.queryRows(`
        INSERT INTO users (
          username, name, password, role_id, permissions, is_active,
          organization_id, organization_group_id, created_at, updated_at
        ) VALUES ('admin', 'Admin', $1, $2, '{}', 1, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [passwordHash, adminRole?.id || null, orgId || null, groupId])
    }
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
