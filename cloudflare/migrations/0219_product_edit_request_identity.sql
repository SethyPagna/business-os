SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM undo_snapshots WHERE kind = 'product.edit.v1' AND CASE
    WHEN json_valid(payload_json) = 0 THEN 1
    WHEN typeof(created_by_id) != 'integer' OR created_by_id <= 0 THEN 1
    WHEN json_type(payload_json, '$.request_id') IS NOT 'text' THEN 1
    WHEN instr(json_extract(payload_json, '$.request_id'), char(0)) > 0 THEN 1
    WHEN length(json_extract(payload_json, '$.request_id')) NOT BETWEEN 8 AND 120 THEN 1
    WHEN json_extract(payload_json, '$.request_id') GLOB '*[^A-Za-z0-9_-]*' THEN 1
    ELSE 0 END
) THEN 1 ELSE json('product_edit_request_identity_invalid') END;

CREATE UNIQUE INDEX idx_undo_product_edit_request
ON undo_snapshots(created_by_id, json_extract(payload_json, '$.request_id'))
WHERE kind = 'product.edit.v1';
