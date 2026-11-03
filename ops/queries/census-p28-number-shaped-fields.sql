-- P2.8 security review census (4 Nov 2026): how many stored values are wholly number-shaped in the fields the phone
-- mask treats as names or free text. READ-ONLY: one row of counts, no ids, names or values.
--   digit_named_products     product names the old rule would mask (B2) and mask write-back could overwrite (B1)
--   numeric_customer_notes / numeric_supplier_notes / numeric_fee_labels   mask write-back targets (B1)
--   numeric_contact_person   supplier contact person holding a number, returned unmasked (B3)
--   numeric_user_names       staff display or login names holding a number, returned as username / cashier (B3)
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:max-rows-read 80000
SELECT
  (SELECT COUNT(*) FROM products WHERE length(trim(name)) BETWEEN 8 AND 24 AND trim(name) NOT GLOB '*[^0-9 +().-]*') AS digit_named_products,
  (SELECT COUNT(*) FROM customers WHERE length(trim(notes)) BETWEEN 8 AND 24 AND trim(notes) NOT GLOB '*[^0-9 +().-]*') AS numeric_customer_notes,
  (SELECT COUNT(*) FROM suppliers WHERE length(trim(notes)) BETWEEN 8 AND 24 AND trim(notes) NOT GLOB '*[^0-9 +().-]*') AS numeric_supplier_notes,
  (SELECT COUNT(*) FROM suppliers WHERE length(trim(contact_person)) BETWEEN 8 AND 24 AND trim(contact_person) NOT GLOB '*[^0-9 +().-]*') AS numeric_contact_person,
  (SELECT COUNT(*) FROM fees WHERE length(trim(label)) BETWEEN 8 AND 24 AND trim(label) NOT GLOB '*[^0-9 +().-]*') AS numeric_fee_labels,
  (SELECT COUNT(*) FROM users WHERE (length(trim(name)) BETWEEN 8 AND 24 AND trim(name) NOT GLOB '*[^0-9 +().-]*') OR (length(trim(username)) BETWEEN 8 AND 24 AND trim(username) NOT GLOB '*[^0-9 +().-]*')) AS numeric_user_names
