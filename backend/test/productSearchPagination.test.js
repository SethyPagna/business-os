const assert = require('assert')
const fs = require('fs')
const path = require('path')

const productsRoute = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'products.js'), 'utf8')

assert(productsRoute.includes('query.ids || query.productIds || query.product_ids'), 'product search should accept ids/productIds query filters')
assert(productsRoute.includes('p.id IN'), 'product search should constrain id lookups in SQL')
assert(productsRoute.includes('.slice(0, 100)'), 'product search id lookup should stay bounded to the maximum page size')
assert(productsRoute.includes("include.has('family')"), 'product search should support POS family expansion')
assert(productsRoute.includes('expandProductFamilyRows'), 'product family expansion should load parents, variants, and same-name options')
assert(productsRoute.includes('p.parent_id IN'), 'product family expansion should fetch sibling variants for selected parents')
assert(!/ORDER BY p\.\$\{field\} COLLATE NOCASE ASC\s+LIMIT/.test(productsRoute), 'product filter metadata should not truncate brand/category/supplier options')

console.log('productSearchPagination tests passed')
