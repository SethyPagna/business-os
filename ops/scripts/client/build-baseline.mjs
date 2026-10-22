#!/usr/bin/env node
// Build cloudflare/baseline/schema-0269.sql: the schema a client gets from the
// shared migration chain, minus the chain's data.
//
// It replays cloudflare/migrations (through --through, default 0269) on an empty
// in-memory SQLite, reads sqlite_master, and writes every table, index, view and
// trigger plus the three seed constants in SEED_ROWS. No business row.
//
//   node ops/scripts/client/build-baseline.mjs            write the file
//   node ops/scripts/client/build-baseline.mjs --check    exit 1 if the file on disk differs from a fresh build
//   node ops/scripts/client/build-baseline.mjs --out <p>  write somewhere else
//
// Local only: no network, no wrangler, no Cloudflare. Why a new client uses this
// and not the chain: docs/setup/migrations-multi-client.md.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const base = require(path.join(here, '..', '..', '..', 'cloudflare', 'scripts', 'harness', 'client_baseline.cjs'))

function arg(name) {
  const at = process.argv.indexOf(name)
  return at < 0 ? null : process.argv[at + 1]
}

const through = Number(arg('--through') || base.DEFAULT_THROUGH)
const check = process.argv.includes('--check')
const out = arg('--out') || base.baselinePath(through)
const built = base.buildBaseline({ through })

if (check) {
  const onDisk = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null
  if (onDisk === built.text) {
    console.log(`baseline up to date: ${path.relative(process.cwd(), out)} (fingerprint ${built.fingerprint})`)
    process.exit(0)
  }
  console.error(`baseline is ${onDisk === null ? 'missing' : 'stale'}: ${out}\nrebuild it: node ops/scripts/client/build-baseline.mjs`)
  process.exit(1)
}

fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, built.text)
const counts = base.schemaCounts(built.objects)
console.log(`wrote ${out}`)
console.log(`${counts.table} tables, ${counts.index} indexes, ${counts.view} views, ${counts.trigger} triggers, ${base.SEED_ROWS.length} seed rows`)
console.log(`schema fingerprint ${built.fingerprint}`)
console.log(`stamp covers ${built.stampNames.length} migration files (${built.stampNames[0]} .. ${built.stampNames[built.stampNames.length - 1]})`)
