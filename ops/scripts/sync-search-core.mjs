#!/usr/bin/env node
// Copies the canonical product-search core (cloudflare/src/lib/searchCore.ts)
// to its frontend byte copy (frontend/src/utils/searchCore.ts).
//
//   node ops/scripts/sync-search-core.mjs           write the copy
//   node ops/scripts/sync-search-core.mjs --check   exit 1 when they differ
//
// Line endings are written as LF. The parity tests compare after EOL
// normalization, because core.autocrlf rewrites CR bytes on checkout.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const source = path.join(root, 'cloudflare', 'src', 'lib', 'searchCore.ts')
const target = path.join(root, 'frontend', 'src', 'utils', 'searchCore.ts')
const lf = (text) => text.replace(/\r\n/g, '\n')

const canonical = lf(fs.readFileSync(source, 'utf8'))
const current = fs.existsSync(target) ? lf(fs.readFileSync(target, 'utf8')) : null

if (process.argv.includes('--check')) {
  if (current !== canonical) {
    console.error('frontend/src/utils/searchCore.ts differs from cloudflare/src/lib/searchCore.ts; run node ops/scripts/sync-search-core.mjs')
    process.exit(1)
  }
  console.log('searchCore copies are identical')
} else if (current === canonical) {
  console.log('frontend/src/utils/searchCore.ts already up to date')
} else {
  fs.writeFileSync(target, canonical)
  console.log('wrote frontend/src/utils/searchCore.ts')
}
