-- P4 (Part 386): optional per-product short tag -- the operator's own
-- memory aid ("hot", "for Mey", "new shelf"), shown as a chip next to the
-- name in Products/POS/detail and searchable. Free text, deliberately not
-- an enum and not related to promotions (G1's discount labels are their
-- own thing). The manual product write path is column-driven
-- (lib/productWrites.ts tableColumns), so this ALTER alone makes the field
-- writable from the form.

ALTER TABLE products ADD COLUMN tag_label TEXT;
