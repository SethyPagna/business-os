-- Itemized tender lines for split payments. Existing sales retain their
-- payment_method summary and continue to read normally; new sales can store
-- the exact method/currency amounts used at checkout.
ALTER TABLE sales ADD COLUMN payment_details TEXT;
