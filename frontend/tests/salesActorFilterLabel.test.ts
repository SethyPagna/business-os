// N13 (Sep 6 2026): every history surface names the acting user by USERNAME,
// not full name. The admin "User" filter on the Sales page narrows those rows,
// so its option labels must offer the same name the rows show -- the sales
// lane's verifier found the filter still put the full name first.
//
// Run: node tests/salesActorFilterLabel.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'

const sales = fs.readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8')

const filterBlock = sales.slice(sales.indexOf("id: 'user',"), sales.indexOf("}).filter((option) => option.id !== 'user-')"))
assert.ok(filterBlock.length > 0, 'the admin user filter block exists in Sales.tsx')
assert.match(filterBlock, /label: option\?\.username \|\| option\?\.name \|\| `User \$\{id\}`/, 'the user filter labels actors username-first, with the full name only as a fallback')
assert.doesNotMatch(filterBlock, /label: option\?\.name \|\| option\?\.username/, 'the full-name-first label is gone')

console.log('PASS the Sales page user filter names actors by username first')
