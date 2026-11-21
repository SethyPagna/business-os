'use strict'
// waitingLineSql of lib/inventoryCheckSessions.ts (eps 0.000000001, dated), copied for the spike probe.
const countDiffers = (i) => `(${i}.baseline_quantity IS NOT NULL AND (abs(${i}.baseline_quantity-${i}.counted_quantity)>0.000000001 OR EXISTS(SELECT 1 FROM inventory_check_lot_lines l WHERE l.session_id=${i}.session_id AND l.product_id=${i}.product_id AND abs(l.seen_quantity-l.counted_quantity)>0.000000001)))`
module.exports = (a, i) => `${a}.status='pending' AND CASE WHEN ${a}.line_set_json IS NULL THEN ${countDiffers(i)}
    ELSE json_extract(${a}.line_set_json,'$."'||${i}.product_id||'"') IS NOT NULL END
  AND json_extract(${a}.applied_json,'$.lines."'||${i}.product_id||'"') IS NULL AND json_extract(${a}.superseded_json,'$."'||${i}.product_id||'"') IS NULL
  AND json_extract(${a}.line_decisions_json,'$."'||${i}.product_id||'".decision') IS NOT 'reject'`
