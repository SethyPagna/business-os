-- 0072: B4 -- "Delivery was made into the category column -- separate it."
--
-- Located with production data (Part 394): the old system recorded every
-- courier payment as an EXPENSE whose single category/label column carried
-- BOTH the kind and the counterparty -- 'Delivery / Capital Express',
-- 'Delivery / Grab', 'Delivery / J&T Express', 'Delivery / Virak Buntam',
-- 'Delivery / ពូ​ ខុម', 'Delivery / តា តឿ', 'Delivery / ពូ​ ហុង', plus one
-- bare 'Delivery' -- 3,130 of the 4,240 rows migration 0064 imported. On the
-- Fees page they all read Type=Expense with the delivery-ness buried in the
-- label string.
--
-- The separation: 'delivery' is ALREADY a first-class fee type
-- (routes/fees.ts FEE_TYPES), so the kind moves into fee_type and the label
-- keeps only the courier. Measured safe before writing: nothing aggregates
-- fee_type='delivery' as sale revenue -- customer-charged delivery lives on
-- the sales row (delivery fee columns), the only fees writers are the manual
-- form and the cancel lost-fee ('expense'), and the Fees page's per-type
-- breakdown is informational. Scoped to created_by_name='Old system' so a
-- manually created expense a person deliberately labeled 'Delivery / ...'
-- is never rewritten behind their back.
--
-- Idempotent by construction: rewritten rows have fee_type='delivery', so
-- the WHERE cannot match them a second time. 'Delivery / ' is 11 characters;
-- substr(label, 12) keeps exactly the courier name (Khmer names included --
-- substr counts characters, not bytes).

UPDATE fees
SET fee_type = 'delivery',
    label = CASE
      WHEN label LIKE 'Delivery / %' THEN substr(label, 12)
      ELSE label
    END
WHERE created_by_name = 'Old system'
  AND fee_type = 'expense'
  AND (label LIKE 'Delivery / %' OR label = 'Delivery');
