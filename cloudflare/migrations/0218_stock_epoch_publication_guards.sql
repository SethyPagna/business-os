CREATE VIEW stock_epoch_basis_inputs AS
SELECT o.id AS operation_id,e.id AS event_id,b.quantity AS before_quantity,c.quantity AS selected_quantity,b.gross4 AS before_gross4,b.coverage4 AS before_coverage4,c.gross4 AS selected_gross4,c.coverage4 AS selected_coverage4
FROM stock_epoch_operations o
JOIN stock_epoch_events e ON e.operation_id=o.id
JOIN stock_epoch_fragment_inputs i ON i.event_id=e.id AND i.source_id=e.source_id
JOIN stock_epoch_segments b ON b.event_id=i.before_event_id AND b.segment_id=i.before_segment_id AND b.source_id=e.source_id
JOIN stock_epoch_segments c ON c.event_id=e.id AND c.segment_id=json_extract(o.request_json,'$.child_segment_id') AND c.parent_segment_id=i.before_segment_id AND c.source_id=e.source_id
WHERE o.protocol=2 AND o.kind IN ('hold','repair');

CREATE TRIGGER stock_epoch_publication_request_kind BEFORE INSERT ON stock_epoch_publications
WHEN EXISTS(SELECT 1 FROM stock_epoch_operations WHERE id=NEW.operation_id AND protocol=2 AND kind IN ('hold','repair'))
BEGIN
SELECT CASE WHEN EXISTS(SELECT 1 FROM stock_epoch_operations o JOIN stock_epoch_events e ON e.operation_id=o.id JOIN stock_epoch_commands c ON c.operation_id=o.id WHERE o.id=NEW.operation_id AND json_type(o.request_json,'$.kind')='text' AND json_extract(o.request_json,'$.kind')=o.kind AND e.kind=o.kind AND json_extract(c.response_json,'$.kind')=o.kind) THEN 1 ELSE RAISE(ABORT,'epoch request kind mismatch') END;
END;

CREATE TRIGGER stock_epoch_publication_basis BEFORE INSERT ON stock_epoch_publications
WHEN EXISTS(SELECT 1 FROM stock_epoch_operations WHERE id=NEW.operation_id AND protocol=2 AND kind IN ('hold','repair'))
BEGIN
SELECT CASE WHEN (SELECT COUNT(*) FROM stock_epoch_basis_inputs WHERE operation_id=NEW.operation_id)=1 THEN 1 ELSE RAISE(ABORT,'epoch basis operand membership') END;
SELECT CASE WHEN NOT EXISTS(
SELECT 1 FROM stock_epoch_basis_inputs b,json_each(json_array(b.before_quantity,b.selected_quantity)) q
WHERE b.operation_id=NEW.operation_id AND (
typeof(q.value)<>'text' OR q.value='' OR q.value='0' OR q.value GLOB '*[^0-9.]*' OR json_valid(q.value)=0 OR json_type(q.value) NOT IN ('integer','real')
OR (instr(q.value,'.')>0 AND (length(q.value)-instr(q.value,'.')>24 OR substr(q.value,-1)='0'))
OR length(CASE WHEN instr(q.value,'.')>0 THEN substr(q.value,1,instr(q.value,'.')-1) ELSE q.value END)>10
OR CAST(q.value AS INTEGER)>1000000000 OR (CAST(q.value AS INTEGER)=1000000000 AND instr(q.value,'.')>0)
)) THEN 1 ELSE RAISE(ABORT,'epoch basis quantity domain') END;
SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stock_epoch_basis_inputs b,json_each(json_array(b.before_gross4,b.before_coverage4,b.selected_gross4,b.selected_coverage4)) m WHERE b.operation_id=NEW.operation_id AND (m.type<>'integer' OR m.value<0 OR m.value>1000000000000000 OR b.before_coverage4>b.before_gross4 OR b.selected_coverage4>b.selected_gross4)) THEN 1 ELSE RAISE(ABORT,'epoch basis money domain') END;
SELECT CASE WHEN (
WITH RECURSIVE
metrics AS (
SELECT b.operation_id,b.event_id,m.key AS metric,b.before_quantity,b.selected_quantity,
CASE m.key WHEN 0 THEN b.before_gross4 ELSE b.before_gross4-b.before_coverage4 END AS before_money,
CASE m.key WHEN 0 THEN b.selected_gross4 ELSE b.selected_gross4-b.selected_coverage4 END AS selected_money
FROM stock_epoch_basis_inputs b,json_each('[0,1]') m WHERE b.operation_id=NEW.operation_id
),
operands AS (
SELECT m.operation_id,m.event_id,m.metric,s.value AS side,
CASE s.value WHEN 1 THEN m.before_money WHEN 2 THEN m.selected_money+1 ELSE m.selected_money END AS money,
CASE s.value WHEN 1 THEN m.selected_quantity ELSE m.before_quantity END AS quantity
FROM metrics m,json_each('[0,1,2]') s
),
limbs AS (
SELECT operation_id,event_id,metric,side,
json_array(money%1000000,(money/1000000)%1000000,money/1000000000000) AS money_limbs,
json_array(
CAST(substr(CASE WHEN instr(quantity,'.')>0 THEN substr(quantity,instr(quantity,'.')+1) ELSE '' END||'000000000000000000000000',19,6) AS INTEGER),
CAST(substr(CASE WHEN instr(quantity,'.')>0 THEN substr(quantity,instr(quantity,'.')+1) ELSE '' END||'000000000000000000000000',13,6) AS INTEGER),
CAST(substr(CASE WHEN instr(quantity,'.')>0 THEN substr(quantity,instr(quantity,'.')+1) ELSE '' END||'000000000000000000000000',7,6) AS INTEGER),
CAST(substr(CASE WHEN instr(quantity,'.')>0 THEN substr(quantity,instr(quantity,'.')+1) ELSE '' END||'000000000000000000000000',1,6) AS INTEGER),
CAST(quantity AS INTEGER)%1000000,CAST(quantity AS INTEGER)/1000000
) AS quantity_limbs FROM operands
),
coefficients AS (
SELECT l.operation_id,l.event_id,l.metric,l.side,m.key+q.key AS position,SUM(m.value*q.value) AS coefficient
FROM limbs l,json_each(l.money_limbs) m,json_each(l.quantity_limbs) q
GROUP BY l.operation_id,l.event_id,l.metric,l.side,m.key+q.key
),
products(operation_id,event_id,metric,side,position,carry,digits) AS (
SELECT operation_id,event_id,metric,side,0,coefficient/1000000,printf('%06d',coefficient%1000000) FROM coefficients WHERE position=0
UNION ALL
SELECT p.operation_id,p.event_id,p.metric,p.side,p.position+1,(COALESCE(c.coefficient,0)+p.carry)/1000000,printf('%06d',(COALESCE(c.coefficient,0)+p.carry)%1000000)||p.digits
FROM products p LEFT JOIN coefficients c ON c.operation_id=p.operation_id AND c.event_id=p.event_id AND c.metric=p.metric AND c.side=p.side AND c.position=p.position+1
WHERE p.position<8
),
floors AS (
SELECT event_id,metric,COUNT(*) AS side_count,MAX(carry) AS final_carry,
MAX(CASE side WHEN 0 THEN digits END) AS lower_bound,MAX(CASE side WHEN 1 THEN digits END) AS numerator,MAX(CASE side WHEN 2 THEN digits END) AS upper_bound
FROM products WHERE position=8 GROUP BY event_id,metric
)
SELECT COUNT(*) FROM floors WHERE side_count=3 AND final_carry=0 AND lower_bound COLLATE BINARY<=numerator COLLATE BINARY AND numerator COLLATE BINARY<upper_bound COLLATE BINARY
)=2 THEN 1 ELSE RAISE(ABORT,'epoch proportional basis mismatch') END;
END;
