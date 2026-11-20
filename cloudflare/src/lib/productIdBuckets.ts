// The occupied id ranges of the catalogue ("buckets"): the page numbers whose id range holds at least one product. The ids of a live catalogue run in
// a few islands, so a client walks only these pages instead of every range. One MIN(id) primary-key probe per occupied range, never a scan.
// Copied from routes/products.ts buildProductSearchIndexPage (which keeps its own copy until the catalogue index moves to format 2).
export const PRODUCT_ID_BUCKETS_SQL = `WITH RECURSIVE bucket(n) AS (
    SELECT CAST((SELECT MIN(id) FROM products WHERE id >= 0) / @size AS INTEGER)
    UNION ALL
    SELECT CAST((SELECT MIN(id) FROM products WHERE id >= (n + 1) * @size) / @size AS INTEGER) FROM bucket WHERE n IS NOT NULL LIMIT 10000
  ) SELECT n FROM bucket WHERE n IS NOT NULL`
