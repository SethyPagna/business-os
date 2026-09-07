// The sale-amendment `kind` union is hand-copied into three files, and on
// 2026-09-06 that is exactly how the frontend typecheck broke.
//
// 4e58891f added 'delivery_actual_cost_changed' to the union in
// src/api/salesTransport.ts and to the copy in
// src/components/sales/SaleDetailModal.tsx, and missed the third copy in
// src/components/sales/Sales.tsx. `tsc --noEmit` then fails with TS2322 at
// Sales.tsx(2105): the handler Sales.tsx passes down accepts a narrower `kind`
// than the modal calls it with. Nothing in the test suite noticed, because a
// type fork is invisible to every behavioural test -- the only gate that sees
// it is the typecheck, which reports it as a wall of assignability text 1900
// lines away from the declaration that is actually wrong.
//
// So the rule is pinned as a rule: every declaration of this union in
// frontend/src carries the same member set. Whoever adds the next amendment
// kind gets one sentence naming the file they forgot, instead of a structural
// type mismatch.
//
// A single shared type would be better still -- import it from
// api/salesTransport.ts and the union cannot fork a fourth time -- and that
// satisfies this test too, by leaving fewer declarations for it to compare.
//
// STATUS on the a2 integration tip: RED BY DESIGN, and not this lane's to fix.
// It names src/components/sales/Sales.tsx:202 as the file 4e58891f missed. The
// fix is one member on that line -- verified here: with
// `| 'delivery_actual_cost_changed'` appended to it, `npm run typecheck` exits
// 0 and this test prints PASS; with it removed, both fail again.
//
// Run: node tests/saleAmendmentKindUnion.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = path.join(here, '..', 'src')

const files: string[] = []
const walk = (dir: string): void => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (/\.tsx?$/.test(entry.name)) files.push(full)
  }
}
walk(src)

// A declaration is a `kind:` property whose type is a union of string literals
// including the anchor member -- the one member that has been in this union
// since it existed, so a declaration cannot dodge the rule by being new.
const ANCHOR = 'line_quantity_increased'
const declarations: Array<{ file: string; line: number; members: string[] }> = []
for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n')
  lines.forEach((text, index) => {
    const declared = /^\s*kind\??\s*:(.*?)(?:\s*\/\/.*)?$/.exec(text)
    if (!declared) return
    // A TYPE declaration only: the right-hand side must be nothing but a union
    // of string literals (optionally closed by a `;` or `,`). This deliberately
    // skips value expressions that also begin `kind:` -- SaleDetailModal.tsx
    // builds a request with `kind: rising ? 'line_quantity_increased' :
    // 'line_quantity_decreased'`, which names two members without declaring the
    // union and would otherwise be reported as a fork on every run.
    if (!/^\s*'[a-z_]+'(?:\s*\|\s*'[a-z_]+')+\s*[;,]?\s*$/.test(declared[1])) return
    if (!text.includes(`'${ANCHOR}'`)) return
    const members = [...text.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
    declarations.push({ file: path.relative(src, file).replace(/\\/g, '/'), line: index + 1, members })
  })
}

assert.ok(
  declarations.length >= 2,
  `expected the amendment kind union to be declared at least twice (found ${declarations.length}); if it is now declared once and imported everywhere, delete this test -- the fork it guards is gone`,
)

const [first, ...rest] = declarations
for (const decl of rest) {
  assert.deepEqual(
    decl.members,
    first.members,
    `the sale-amendment kind union has forked: src/${decl.file}:${decl.line} declares [${decl.members.join(', ')}] while src/${first.file}:${first.line} declares [${first.members.join(', ')}]. Every copy must carry the same members -- or, better, import the type from api/salesTransport.ts so there is only one.`,
  )
}
console.log(`PASS the sale-amendment kind union agrees across its ${declarations.length} declarations: ${first.members.join(', ')}`)
