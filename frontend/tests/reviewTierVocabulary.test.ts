import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The permission tiers read None / View / Review / Full everywhere a person can see them.
// "Partial Access" (middle tier) and "View only" (read tier) were retired on 20 Oct 2026.
// Stored values ('review', 'view') are unchanged and not checked here.

const frontendRoot = fileURLToPath(new URL('../', import.meta.url))
const cloudflareRoot = path.join(frontendRoot, '..', 'cloudflare')
const read = (...p: string[]) => fs.readFileSync(path.join(frontendRoot, ...p), 'utf8')
const strings = (f: string) => Object.fromEntries(Object.entries(JSON.parse(read(f)) as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string>
const en = strings('src/lang/en.json')
const km = strings('src/lang/km.json')

const OLD_MIDDLE = /partial[ _-]?access/i
const OLD_KM_MIDDLE = 'សិទ្ធិមួយផ្នែក'
const OLD_READ = /\bview[ -]only\b/i
const TIER_KEY = /^(perm_.*_desc|perm_view_only_.*|view_only)$/

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

function run(name: string, fn: () => void) { fn(); console.log(`PASS ${name}`) }

run('no pack value names the retired middle tier', () => {
  const hits = [
    ...Object.entries(en).filter(([, v]) => OLD_MIDDLE.test(v)).map(([k]) => `en:${k}`),
    ...Object.entries(km).filter(([, v]) => v.includes(OLD_KM_MIDDLE) || OLD_MIDDLE.test(v)).map(([k]) => `km:${k}`),
  ]
  assert.deepEqual(hits, [])
})

run('tier descriptions and role-card labels do not say "View only"', () => {
  const hits = [en, km].flatMap((pack, i) => Object.entries(pack)
    .filter(([k, v]) => TIER_KEY.test(k) && (OLD_READ.test(v) || v.includes('មើលតែប៉ុណ្ណោះ')))
    .map(([k]) => `${i ? 'km' : 'en'}:${k}`))
  assert.deepEqual(hits, [])
  assert.equal(en.view_only, 'View')
  assert.equal(km.view_only, 'មើល')
  assert.equal(en.review_required, 'Review')
  assert.equal(km.review_required, 'ពិនិត្យ')
})

run('permission definitions, UI source and Worker routes never print "Partial Access"', () => {
  const files = [...walk(path.join(frontendRoot, 'src')), ...walk(path.join(cloudflareRoot, 'src'))]
  const hits = files.filter(f => OLD_MIDDLE.test(fs.readFileSync(f, 'utf8'))).map(f => path.relative(frontendRoot, f))
  assert.deepEqual(hits, [])
})

run('tier descriptions in permissionDefinitions.ts say View, not "View only"', () => {
  assert.ok(!OLD_READ.test(read('src/components/users/permissionDefinitions.ts')))
})
