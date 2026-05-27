#!/usr/bin/env node
/* eslint-disable no-console */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..', '..')
const reportPath = path.join(root, 'ops', 'docs', 'reference', 'SCHEMA-AUDIT.md')
const summaryPath = path.join(root, 'ops', 'docs', 'reference', 'SCHEMA-AUDIT.json')

const sourceFiles = {
  canonicalSchema: 'backend/src/db/postgresSchema.sql',
  runtimeSchema: 'backend/src/postgresDatabase.js',
  systemJobs: 'backend/src/systemJobs.js',
  backupSchema: 'backend/src/backupSchema.js',
  dexieSchema: 'frontend/src/api/localDb.ts',
  relationshipDoc: 'ops/docs/SCHEMA-RELATIONSHIPS.md',
}

const expectedRuntimeOnlyTables = ['system_jobs', 'ct_*']
const expectedBackupGaps = new Set([
  'ai_provider_configs',
  'ai_response_logs',
  'business_os_migration_status',
  'google_drive_sync_entries',
  'organization_groups',
  'organizations',
  'user_sessions',
  'verification_codes',
])

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}

function getLineNumber(text, index) {
  return text.slice(0, index).split(/\r?\n/).length
}

function matchAllWithLine(text, regex, build) {
  const rows = []
  let match
  while ((match = regex.exec(text))) {
    rows.push(build(match, getLineNumber(text, match.index)))
  }
  return rows
}

function parseSqlTables(sql) {
  const tables = []
  const tableRegex = /CREATE TABLE public\.([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\n\);/g
  const alteredPrimaryKeys = parseAlteredPrimaryKeys(sql)
  let match
  while ((match = tableRegex.exec(sql))) {
    const [, name, body] = match
    tables.push({
      name,
      line: getLineNumber(sql, match.index),
      columns: parseColumns(body),
      primaryKey: parsePrimaryKey(body, alteredPrimaryKeys.get(name)),
      indexes: [],
    })
  }

  const indexesByTable = parseIndexes(sql)
  return tables.map((table) => ({
    ...table,
    indexes: indexesByTable.get(table.name) || [],
  }))
}

function parseAlteredPrimaryKeys(sql) {
  const primaryKeys = new Map()
  const alterRegex = /ALTER TABLE ONLY public\.([a-zA-Z0-9_]+)\s+ADD CONSTRAINT\s+[^;]+?\s+PRIMARY KEY\s*\(([^)]+)\);/gi
  let match
  while ((match = alterRegex.exec(sql))) {
    primaryKeys.set(match[1], cleanColumnList(match[2]))
  }
  return primaryKeys
}

function parseColumns(tableBody) {
  return tableBody
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/,$/, ''))
    .filter(Boolean)
    .filter((line) => !/^(CONSTRAINT|PRIMARY KEY|UNIQUE|CHECK|FOREIGN KEY)\b/i.test(line))
    .map((line) => {
      const match = /^"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+(.+)$/.exec(line)
      if (!match) return null
      return {
        name: match[1],
        definition: match[2].trim(),
      }
    })
    .filter(Boolean)
}

function parsePrimaryKey(tableBody, alteredPrimaryKey = []) {
  const inlineMatch = /PRIMARY KEY\s*\(([^)]+)\)/i.exec(tableBody)
  if (inlineMatch) return cleanColumnList(inlineMatch[1])

  const inlineColumn = tableBody
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/,$/, ''))
    .map((line) => {
      const match = /^"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+.+\bPRIMARY KEY\b/i.exec(line)
      return match ? match[1] : null
    })
    .find(Boolean)
  if (inlineColumn) return [inlineColumn]

  return alteredPrimaryKey
}

function cleanColumnList(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)
}

function parseIndexes(sql) {
  const indexesByTable = new Map()
  const indexRegex = /CREATE\s+(UNIQUE\s+)?INDEX\s+([a-zA-Z0-9_]+)\s+ON\s+public\.([a-zA-Z0-9_]+)\s+[\s\S]*?;/g
  let match
  while ((match = indexRegex.exec(sql))) {
    const [, uniqueText, indexName, tableName] = match
    const indexes = indexesByTable.get(tableName) || []
    indexes.push({
      name: indexName,
      unique: Boolean(uniqueText),
      line: getLineNumber(sql, match.index),
    })
    indexesByTable.set(tableName, indexes)
  }
  return indexesByTable
}

function parseRuntimeStatements(namedSources) {
  const createTables = []
  const alterColumns = []
  const indexes = []

  Object.entries(namedSources).forEach(([file, text]) => {
    createTables.push(...matchAllWithLine(
      text,
      /CREATE TABLE IF NOT EXISTS\s+([a-zA-Z0-9_]+)\s*\(/g,
      (match, line) => ({ table: match[1], file, line }),
    ))
    alterColumns.push(...matchAllWithLine(
      text,
      /ALTER TABLE\s+([a-zA-Z0-9_]+)\s+ADD COLUMN IF NOT EXISTS\s+([a-zA-Z0-9_]+)\s+([^'`,\r\n]+)/g,
      (match, line) => ({
        table: match[1],
        column: match[2],
        definition: match[3].trim(),
        file,
        line,
      }),
    ))
    indexes.push(...matchAllWithLine(
      text,
      /CREATE\s+(UNIQUE\s+)?INDEX IF NOT EXISTS\s+([a-zA-Z0-9_]+)\s+ON\s+([a-zA-Z0-9_]+)/g,
      (match, line) => ({
        index: match[2],
        table: match[3],
        unique: Boolean(match[1]),
        file,
        line,
      }),
    ))
  })

  return {
    createTables: uniqueRuntimeRows(createTables, 'table'),
    alterColumns: uniqueRuntimeRows(alterColumns, (row) => `${row.table}.${row.column}`),
    indexes: uniqueRuntimeRows(indexes, 'index'),
  }
}

function uniqueRuntimeRows(rows, keyNameOrFunction) {
  const keyFor = typeof keyNameOrFunction === 'function'
    ? keyNameOrFunction
    : (row) => row[keyNameOrFunction]
  const byKey = new Map()
  rows.forEach((row) => {
    const key = keyFor(row)
    if (!byKey.has(key)) byKey.set(key, row)
  })
  return [...byKey.values()].sort((a, b) => keyFor(a).localeCompare(keyFor(b)))
}

function parseDexieStores(text) {
  const versions = []
  const versionRegex = /dexieDb\.version\((\d+)\)\.stores\(\{([\s\S]*?)\n\}\)/g
  let match
  while ((match = versionRegex.exec(text))) {
    const version = Number(match[1])
    const body = match[2]
    const stores = []
    const storeRegex = /([a-zA-Z0-9_]+):\s*'([^']*)'/g
    let storeMatch
    while ((storeMatch = storeRegex.exec(body))) {
      stores.push({
        name: storeMatch[1],
        indexes: storeMatch[2],
      })
    }
    versions.push({ version, stores })
  }
  return versions.sort((a, b) => a.version - b.version)
}

function loadBackupSchema() {
  const backupPath = path.join(root, sourceFiles.backupSchema)
  delete require.cache[backupPath]
  return require(backupPath)
}

function countForeignKeyDeclarations(texts) {
  return texts.reduce((count, text) => {
    const matches = text.match(/\b(FOREIGN KEY|REFERENCES)\b/gi)
    return count + (matches ? matches.length : 0)
  }, 0)
}

function buildCoverage({ canonicalTables, relationshipDoc }) {
  const requiredNames = [...canonicalTables.map((table) => table.name), ...expectedRuntimeOnlyTables]
  const missing = requiredNames.filter((name) => !relationshipDoc.includes(name))
  return {
    required: requiredNames.length,
    missing,
  }
}

function buildBackupCoverage({ canonicalTables, backupTables, nonBackupTables, runtimeCreateTables }) {
  const canonicalNames = canonicalTables.map((table) => table.name)
  const staticMissing = canonicalNames.filter((table) => !backupTables.includes(table))
  const runtimeMissing = runtimeCreateTables
    .map((row) => row.table)
    .filter((table) => table !== 'ct_*')
    .filter((table) => !canonicalNames.includes(table) && !backupTables.includes(table))
    .filter((table) => !nonBackupTables.includes(table))

  const actionNeeded = staticMissing
    .filter((table) => !expectedBackupGaps.has(table))
    .filter((table) => !nonBackupTables.includes(table))
    .concat(runtimeMissing)

  return {
    backupTableCount: backupTables.length,
    nonBackupTables,
    staticMissing: uniqueSorted(staticMissing),
    actionNeeded: uniqueSorted(actionNeeded),
  }
}

function renderList(values) {
  if (!values.length) return '- None'
  return values.map((value) => `- ${value}`).join('\n')
}

function renderRuntimeRows(rows, formatter) {
  if (!rows.length) return '- None'
  return rows.map((row) => `- ${formatter(row)} (${row.file}:${row.line})`).join('\n')
}

function renderTableCatalog(tables) {
  return tables
    .map((table) => `| \`${table.name}\` | ${table.columns.length} | ${table.primaryKey.length ? table.primaryKey.map((column) => `\`${column}\``).join(', ') : 'None'} | ${table.indexes.length} | ${table.line} |`)
    .join('\n')
}

function primaryKeyGapRows(tables) {
  return tables
    .filter((table) => table.primaryKey.length === 0)
    .map((table) => ({
      table: table.name,
      logicalKey: table.indexes.filter((index) => index.unique).map((index) => index.name),
      recommendation: table.name === 'settings'
        ? 'Promote key to primary key after confirming no duplicate/null keys.'
        : 'Add a declared primary key or document the logical identity before FK hardening.',
      line: table.line,
    }))
}

function renderPrimaryKeyGaps(primaryKeyGaps) {
  if (!primaryKeyGaps.length) return '- None'
  return [
    '| Table | Logical unique index | Recommendation | Line |',
    '| --- | --- | --- | ---: |',
    ...primaryKeyGaps.map((gap) => [
      `| \`${gap.table}\``,
      gap.logicalKey.length ? gap.logicalKey.map((name) => `\`${name}\``).join(', ') : 'None',
      gap.recommendation,
      gap.line,
      '|',
    ].join(' | ')),
  ].join('\n')
}

function renderReport(audit) {
  const latestDexie = audit.dexieVersions.at(-1)
  const primaryKeyGaps = primaryKeyGapRows(audit.canonicalTables)
  return `# Generated Schema Audit

Generated: ${new Date().toISOString()}

Source position: Session 2 / Phase 6 schema map expanded; Phase 8.4 loader recovery remains active.

This report is generated by \`ops/scripts/backend/schema-audit.js\`. Re-run it after schema, runtime DDL, backup, or offline-store changes.

## Summary

| Check | Result |
| --- | --- |
| Static Postgres tables | ${audit.canonicalTables.length} |
| Runtime CREATE TABLE statements | ${audit.runtime.createTables.length} |
| Runtime ALTER COLUMN statements | ${audit.runtime.alterColumns.length} |
| Runtime CREATE INDEX statements | ${audit.runtime.indexes.length} |
| Runtime UNIQUE INDEX statements | ${audit.runtime.indexes.filter((row) => row.unique).length} |
| Dexie latest version | ${latestDexie?.version || 'None'} |
| Dexie latest stores | ${latestDexie?.stores.length || 0} |
| Backup tables | ${audit.backup.backupTableCount} |
| Foreign key/reference declarations in scanned DDL | ${audit.foreignKeyDeclarations} |
| Relationship doc required entities | ${audit.coverage.required} |
| Relationship doc missing entities | ${audit.coverage.missing.length} |
| Backup coverage action-needed gaps | ${audit.backup.actionNeeded.length} |
| Static primary key gaps | ${primaryKeyGaps.length} |

## Documentation Coverage

Missing from \`ops/docs/SCHEMA-RELATIONSHIPS.md\`:

${renderList(audit.coverage.missing.map((table) => `\`${table}\``))}

## Static Table Catalog

| Table | Columns | Primary key | Index count | Line |
| --- | ---: | --- | ---: | ---: |
${renderTableCatalog(audit.canonicalTables)}

## Primary Key Gaps

${renderPrimaryKeyGaps(primaryKeyGaps)}

## Runtime Schema Overlay

Runtime-created tables:

${renderRuntimeRows(audit.runtime.createTables, (row) => `\`${row.table}\``)}

Runtime-added columns:

${renderRuntimeRows(audit.runtime.alterColumns, (row) => `\`${row.table}.${row.column}\` ${row.definition}`)}

Runtime-created indexes:

${renderRuntimeRows(audit.runtime.indexes, (row) => `\`${row.index}\` on \`${row.table}\`${row.unique ? ' (unique)' : ''}`)}

## Dexie Offline Schema

Latest Dexie stores from version ${latestDexie?.version || 'unknown'}:

${renderList((latestDexie?.stores || []).map((store) => `\`${store.name}\` - ${store.indexes}`))}

## Backup Coverage

Tables included in \`BACKUP_TABLES\`: ${audit.backup.backupTableCount}

Static Postgres tables missing from \`BACKUP_TABLES\`:

${renderList(audit.backup.staticMissing.map((table) => `\`${table}\``))}

Action-needed backup gaps:

${renderList(audit.backup.actionNeeded.map((table) => `\`${table}\``))}

\`NON_BACKUP_TABLES\`:

${renderList(audit.backup.nonBackupTables.map((table) => `\`${table}\``))}

## Follow-Up Checks

- Revisit organization tables, AI logs/configs, sessions, and Drive sync entries before tenant or integration backup rewires.
- Add orphan-check SQL before introducing \`NOT VALID\` foreign keys.
- Add restore-rehearsal coverage that imports a package into a throwaway database and compares critical counts.
- Re-run this script after each schema-related phase and keep this report committed beside the roadmap.
`
}

function buildSummary(audit, failures) {
  const latestDexie = audit.dexieVersions.at(-1)
  const primaryKeyGaps = primaryKeyGapRows(audit.canonicalTables)
  return {
    report: path.relative(root, reportPath).replace(/\\/g, '/'),
    summary: path.relative(root, summaryPath).replace(/\\/g, '/'),
    status: failures.length ? 'failed' : 'passed',
    failures,
    staticTables: audit.canonicalTables.length,
    runtimeCreateTables: audit.runtime.createTables.length,
    runtimeAlterColumns: audit.runtime.alterColumns.length,
    runtimeIndexes: audit.runtime.indexes.length,
    runtimeUniqueIndexes: audit.runtime.indexes.filter((row) => row.unique).length,
    dexieLatestVersion: latestDexie?.version || null,
    dexieLatestStores: latestDexie?.stores.length || 0,
    backupTables: audit.backup.backupTableCount,
    foreignKeyDeclarations: audit.foreignKeyDeclarations,
    relationshipDocRequiredEntities: audit.coverage.required,
    relationshipDocMissingEntities: audit.coverage.missing.length,
    backupActionNeededGaps: audit.backup.actionNeeded.length,
    staticPrimaryKeyGaps: primaryKeyGaps.length,
    missingRelationshipEntities: audit.coverage.missing,
    backupActionNeededTables: audit.backup.actionNeeded,
    staticPrimaryKeyGapTables: primaryKeyGaps.map((gap) => gap.table).sort(),
    staticPrimaryKeyGapDetails: primaryKeyGaps,
    staticTableNames: audit.canonicalTables.map((table) => table.name).sort(),
    runtimeCreateTableNames: audit.runtime.createTables.map((row) => row.table).sort(),
    runtimeIndexNames: audit.runtime.indexes.map((row) => row.index).sort(),
    latestDexieStoreNames: (latestDexie?.stores || []).map((store) => store.name).sort(),
  }
}

function main() {
  const canonicalSql = read(sourceFiles.canonicalSchema)
  const runtimeText = read(sourceFiles.runtimeSchema)
  const systemJobsText = read(sourceFiles.systemJobs)
  const dexieText = read(sourceFiles.dexieSchema)
  const relationshipDoc = read(sourceFiles.relationshipDoc)
  const backupSchema = loadBackupSchema()

  const canonicalTables = parseSqlTables(canonicalSql)
  const runtime = parseRuntimeStatements({
    [sourceFiles.runtimeSchema]: runtimeText,
    [sourceFiles.systemJobs]: systemJobsText,
  })
  const dexieVersions = parseDexieStores(dexieText)
  const coverage = buildCoverage({ canonicalTables, relationshipDoc })
  const backup = buildBackupCoverage({
    canonicalTables,
    backupTables: backupSchema.BACKUP_TABLES || [],
    nonBackupTables: backupSchema.NON_BACKUP_TABLES || [],
    runtimeCreateTables: runtime.createTables,
  })
  const foreignKeyDeclarations = countForeignKeyDeclarations([canonicalSql, runtimeText, systemJobsText])

  const audit = {
    canonicalTables,
    runtime,
    dexieVersions,
    coverage,
    backup,
    foreignKeyDeclarations,
  }

  fs.mkdirSync(path.dirname(reportPath), { recursive: true })

  const failures = []
  if (coverage.missing.length) {
    failures.push(`Missing schema relationship doc coverage: ${coverage.missing.join(', ')}`)
  }
  if (!canonicalTables.length) {
    failures.push('No static Postgres tables were parsed.')
  }
  if (!dexieVersions.length) {
    failures.push('No Dexie schema versions were parsed.')
  }

  const summary = buildSummary(audit, failures)
  fs.writeFileSync(reportPath, renderReport(audit))
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)

  if (failures.length) {
    console.error('Schema audit failed:')
    failures.forEach((failure) => console.error(`- ${failure}`))
    console.error(`Report written to ${path.relative(root, reportPath)}`)
    process.exit(1)
  }

  console.log('Schema audit passed.')
  console.log(`Static tables: ${canonicalTables.length}`)
  console.log(`Relationship doc missing: ${coverage.missing.length}`)
  console.log(`Foreign key/reference declarations: ${foreignKeyDeclarations}`)
  console.log(`Backup action-needed gaps: ${backup.actionNeeded.length}`)
  console.log(`Report: ${path.relative(root, reportPath)}`)
  console.log(JSON.stringify(summary, null, 2))
}

main()
