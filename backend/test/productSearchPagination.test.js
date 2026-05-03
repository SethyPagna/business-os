const assert = require('assert')
const fs = require('fs')
const path = require('path')

const productsRoute = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'products.js'), 'utf8')

assert(productsRoute.includes('query.ids || query.productIds || query.product_ids'), 'product search should accept ids/productIds query filters')
assert(productsRoute.includes('p.id IN'), 'product search should constrain id lookups in SQL')
assert(productsRoute.includes('.slice(0, 100)'), 'product search id lookup should stay bounded to the maximum page size')

console.log('productSearchPagination tests passed')
