-- WIP NONDEPLOYABLE: chosen return condition and exact returned-lot attribution.
-- No conversion or historical condition inference; 0246 remains unchanged.
ALTER TABLE return_items ADD COLUMN stock_condition TEXT
  CHECK(stock_condition IS NULL OR stock_condition IN('ordinary','broken','damaged','expired','opened','other'));
ALTER TABLE damaged_stock_lots ADD COLUMN return_item_id INTEGER;
CREATE INDEX idx_damaged_return_item_0247 ON damaged_stock_lots(return_item_id);

CREATE TRIGGER counted_return_condition_capture_0247 AFTER INSERT ON return_items
WHEN NEW.stock_action='damaged' AND NEW.stock_condition IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.stock_condition!='ordinary' AND ABS(COALESCE((
    SELECT SUM(quantity) FROM damaged_stock_lots WHERE return_id=NEW.return_id
      AND product_id=NEW.product_id AND branch_id IS NEW.branch_id AND return_item_id IS NULL
      AND condition_tag=NEW.stock_condition),0)-NEW.quantity)<0.000000001
    THEN 1 ELSE RAISE(ABORT,'counted_return_condition_identity_conflict') END;
  UPDATE damaged_stock_lots SET return_item_id=NEW.id
    WHERE return_id=NEW.return_id AND product_id=NEW.product_id AND branch_id IS NEW.branch_id
      AND return_item_id IS NULL AND condition_tag=NEW.stock_condition;
END;
