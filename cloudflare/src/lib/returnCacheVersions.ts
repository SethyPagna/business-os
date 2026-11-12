// Every writer of a return (customer, exchange, supplier, edit, grouped action) bumps the same versions a sale status change
// does, plus 'products' and 'returns': the Sales list and stats key on sales+returns+customers+products+stock, and a restock
// or a refund moves all of them. One list so a new return writer cannot bump fewer than its siblings.
export const RETURN_WRITE_CACHE_NAMESPACES = ['products', 'returns', 'sales', 'stock']
