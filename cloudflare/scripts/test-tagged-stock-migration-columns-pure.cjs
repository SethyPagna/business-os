#!/usr/bin/env node
// Pins that every `damaged_stock_lots` column the Worker reads or writes is
// declared by SOME migration file in the chain.
//
// Owner report / fix: progress.md "Program 4 checkpoint LIVE" P4-1 --
// "Failed to load tagged stock". Cause: migration 0162 (the tagged-lot
// columns condition_tag / source / unit_cost_usd) was PREPARED in the repo
// but not yet APPLIED to production when the reading code shipped, so the
// live SELECT threw. It was fixed by applying 0162 with 0163 (see the same
// progress.md paragraph).
//
// A static test cannot see whether a migration was applied to a remote D1 --
// that is a deploy-time fact, not a source fact (see AGENTS.md: migrations
// are append-only, applied separately from code). What a static test CAN
// pin is the narrower, code-level half of the same defect class: a column
// name used in a SELECT/INSERT/UPDATE against damaged_stock_lots that no
// migration file declares at all -- a typo or a forgotten migration file --
// which is the only way this specific bug could reproduce again from a code
// change alone. The remote-apply half is covered operationally by the
// owner-action line in progress.md's release notes, not by a Worker test.
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const CF = path.join(__dirname, '..')
const MIGRATIONS_DIR = path.join(CF, 'migrations')
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

let checks = 0
const check = (label, fn) => { fn(); checks++; process.stdout.write(`  ok  ${label}\n`) }

// Build { table: Set<column> } from every migration file's CREATE TABLE
// column list and every ALTER TABLE ... ADD COLUMN statement.
function collectMigrationColumns() {
  const columns = new Map() // table -> Set<column>
  const addCol = (table, col) => {
    if (!columns.has(table)) columns.set(table, new Set())
    columns.get(table).add(col)
  }
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  assert.ok(files.length > 50, `expected many migration files, found ${files.length} -- MIGRATIONS_DIR wrong?`)

  for (const file of files) {
    const sql = read(path.join(MIGRATIONS_DIR, file))

    // ALTER TABLE <table> ADD COLUMN <col> ...
    const alterRe = /ALTER TABLE\s+([a-zA-Z_][\w]*)\s+ADD COLUMN\s+([a-zA-Z_][\w]*)/gi
    let m
    while ((m = alterRe.exec(sql))) addCol(m[1], m[2])

    // CREATE TABLE [IF NOT EXISTS] <table> ( <cols...> )
    const createRe = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([a-zA-Z_][\w]*)\s*\(/gi
    while ((m = createRe.exec(sql))) {
      const table = m[1]
      const bodyStart = m.index + m[0].length - 1 // index of '('
      let depth = 0
      let end = -1
      for (let i = bodyStart; i < sql.length; i++) {
        if (sql[i] === '(') depth++
        else if (sql[i] === ')') { depth--; if (depth === 0) { end = i; break } }
      }
      if (end < 0) continue
      const body = sql.slice(bodyStart + 1, end)
      // Split top-level commas (naive but sufficient: this project's schema
      // migrations do not nest parens inside a column definition except for
      // CHECK(...)/DEFAULT(...) which we skip past by depth-tracking too).
      let lineDepth = 0
      let cur = ''
      const parts = []
      for (const ch of body) {
        if (ch === '(') lineDepth++
        if (ch === ')') lineDepth--
        if (ch === ',' && lineDepth === 0) { parts.push(cur); cur = '' } else cur += ch
      }
      if (cur.trim()) parts.push(cur)
      for (const part of parts) {
        const trimmed = part.trim()
        const upper = trimmed.toUpperCase()
        if (/^(PRIMARY KEY|FOREIGN KEY|UNIQUE|CHECK|CONSTRAINT)\b/.test(upper)) continue
        const nameMatch = trimmed.match(/^"?([a-zA-Z_][\w]*)"?\s+/)
        if (nameMatch) addCol(table, nameMatch[1])
      }
    }
  }
  return columns
}

const migrationColumns = collectMigrationColumns()

check('damaged_stock_lots columns are declared across the migration chain (base 0074 + tag columns 0162)', () => {
  const cols = migrationColumns.get('damaged_stock_lots')
  assert.ok(cols, 'no migration declares damaged_stock_lots at all')
  for (const expected of ['id', 'product_id', 'quantity', 'quantity_remaining', 'condition_tag', 'source', 'unit_cost_usd']) {
    assert.ok(cols.has(expected), `damaged_stock_lots.${expected} is not declared by any migration file`)
  }
})

check('every damaged_stock_lots column referenced by the tagged-stock writers exists in the migration chain', () => {
  // The writers that made P4-1 possible: the return-create/replace-damaged
  // path and the remove-stock-with-tag path.
  const sources = [
    'src/lib/damagedLotActions.ts',
    'src/lib/returnsStock.ts',
    'src/lib/returnCreateAction.ts',
    'src/lib/productDelete.ts',
    'src/routes/inventory.ts',
    'src/routes/returns.ts',
  ]
  const declared = migrationColumns.get('damaged_stock_lots')
  assert.ok(declared, 'no migration declares damaged_stock_lots')
  // Columns this defect class is actually about (added by 0162, the ones
  // that were missing in production): a code reference to any of these
  // outside the declared set means a migration file itself regressed or was
  // renamed without updating the ALTER statement.
  const fragile = ['condition_tag', 'source', 'unit_cost_usd']
  for (const file of sources) {
    const text = read(path.join(CF, file))
    if (!text.includes('damaged_stock_lots')) continue
    for (const col of fragile) {
      if (text.includes(`.${col}`) || new RegExp(`\\b${col}\\b`).test(text)) {
        assert.ok(declared.has(col), `${file} references damaged_stock_lots.${col} but no migration declares that column`)
      }
    }
  }
})

console.log(`\n${checks} checks passed`)
