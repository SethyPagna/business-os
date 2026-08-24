-- fees.branch_id was defined in 0018_fees.sql but never actually settable
-- from the UI (no branch field on the Fees form) or filterable from the
-- list endpoint -- it was dead schema. Now that FeeForm.tsx lets a person
-- pick a branch and GET /api/fees accepts branch_id as a filter (matching
-- the existing sale_id filter's shape), this column gets queried by value
-- the same way fee_date/fee_type/sale_id already are -- give it the same
-- treatment those three got in 0018_fees.sql rather than leave it as the
-- one filterable fees column with no supporting index.

CREATE INDEX idx_fees_branch_id ON fees(branch_id);
