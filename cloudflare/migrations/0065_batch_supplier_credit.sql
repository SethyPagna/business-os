-- Supplier credit + per-batch cost (user, Aug 28): receiving stock can be
-- PAID or ON CREDIT with a due date, and the admin is reminded (see
-- notifications.ts's supplier-credit section). The batch also stores the
-- unit cost it was bought at — without it, "costs connected to supplier"
-- had no data: cost lived only on the product (today's price, not what a
-- given lot actually cost). Every writer that creates a batch (manual
-- receive, §12 import add) now records all three where known; historical
-- batches keep NULLs honestly instead of a fabricated 'paid'.
--
--   payment_status: 'paid' | 'credit' | NULL (unknown/historical)
--   credit_due_date: ISO date; required by the routes when status='credit'
--   unit_cost_usd: what one unit of THIS lot cost at receipt time
ALTER TABLE product_batches ADD COLUMN payment_status TEXT;
ALTER TABLE product_batches ADD COLUMN credit_due_date TEXT;
ALTER TABLE product_batches ADD COLUMN unit_cost_usd REAL;
