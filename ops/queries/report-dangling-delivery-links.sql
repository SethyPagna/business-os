-- report-dangling-delivery-links: sales and fees whose delivery person id points at no delivery contact.
-- A delete before the contact_has_sales guard could leave these. Counts only, one row.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:max-rows-read 400000
SELECT
  (SELECT COUNT(*) FROM sales s WHERE s.delivery_contact_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM delivery_contacts d WHERE d.id = s.delivery_contact_id)) AS sales_dangling,
  (SELECT COUNT(DISTINCT s.delivery_contact_id) FROM sales s WHERE s.delivery_contact_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM delivery_contacts d WHERE d.id = s.delivery_contact_id)) AS sales_dangling_ids,
  (SELECT COUNT(*) FROM fees f WHERE f.delivery_contact_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM delivery_contacts d WHERE d.id = f.delivery_contact_id)) AS fees_dangling,
  (SELECT COUNT(*) FROM sales s WHERE s.delivery_contact_id IS NOT NULL) AS sales_with_driver,
  (SELECT COUNT(*) FROM fees f WHERE f.delivery_contact_id IS NOT NULL) AS fees_with_driver
