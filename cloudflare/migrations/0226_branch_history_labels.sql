ALTER TABLE stock_transfers ADD COLUMN from_branch_name TEXT;
ALTER TABLE stock_transfers ADD COLUMN to_branch_name TEXT;
ALTER TABLE stock_session_members ADD COLUMN branch_name TEXT;
