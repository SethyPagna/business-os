-- Part-77 (D1-scale audit), FK-index slice: three hot foreign-key lookups
-- had no index at all, so each was a full table scan at production size
-- (14,913 sales and growing):
--
--   sales.customer_id            -- every customer sales-history read, and
--                                   the loyalty balance computation (balance
--                                   is COMPUTED from sales + adjustments,
--                                   never stored), which runs on POS
--                                   membership lookups.
--   returns.sale_id              -- the sale-status recompute (fully vs
--                                   partially returned) that runs on EVERY
--                                   return create/edit, and the returns
--                                   portal/detail joins.
--   loyalty_point_adjustments.customer_id -- the other half of the balance
--                                   computation; scanned per lookup.
--
-- sales gets the composite (customer_id, created_at DESC) so a customer's
-- ordered history reads straight off the index, matching the shape of the
-- existing idx_sales_created_pg family. The other slices of the D1-scale
-- finding (unpaged reads, date(created_at) sites, the REPLACE chain) are
-- tracked separately in progress.md -- this migration is deliberately only
-- the additive indexes.

CREATE INDEX IF NOT EXISTS idx_sales_customer_created ON sales (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_returns_sale_id ON returns (sale_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_point_adjustments_customer ON loyalty_point_adjustments (customer_id);
