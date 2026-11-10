-- ops:min-rows 1
-- ops:max-rows 1
-- ops:max-rows-read 200000
-- Counts only, no customer data: how many sales snapshotted the delivery contact's
-- address as the Contact Options JSON (a leading '[' or '{') instead of address text,
-- and how many of those resolve to no address at all. Read-only.
SELECT
  COUNT(*) AS sales_with_delivery_address,
  SUM(CASE WHEN TRIM(delivery_contact_address) LIKE '[%' OR TRIM(delivery_contact_address) LIKE '{%' THEN 1 ELSE 0 END) AS sales_with_json_address,
  SUM(CASE WHEN (TRIM(delivery_contact_address) LIKE '[%' OR TRIM(delivery_contact_address) LIKE '{%')
            AND NOT EXISTS (
              SELECT 1 FROM json_each(sales.delivery_contact_address) je
              WHERE json_valid(sales.delivery_contact_address)
                AND (TRIM(COALESCE(json_extract(je.value, '$.address'), '')) <> '' OR TRIM(COALESCE(json_extract(je.value, '$.area'), '')) <> '')
            ) THEN 1 ELSE 0 END) AS json_addresses_with_nothing_to_print
FROM sales
WHERE delivery_contact_address IS NOT NULL AND TRIM(delivery_contact_address) <> '';
