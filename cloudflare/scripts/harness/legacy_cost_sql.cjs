// Several INERT tests compare today's statements with those of an older oracle commit that predates the
// unknown-cost rule (owner, 14 Oct 2026). The rule changes exactly two things in the sale/return statements:
//   * a movement INSERT names total_cost_usd / total_cost_khr and computes them with
//     ROUND(@unit * ABS(@quantity), 4) instead of leaving them to the DEFAULT 0;
//   * a product-cost guard compares NULL-safely (`p.cost_price_usd IS json_extract(...)`) instead of
//     COALESCE(p.cost_price_usd,0)=json_extract(...).
// Taking those two changes back out of the NEW text lets the comparison keep proving that nothing else moved.
const GAP = String.raw`(?:\s|\\n)*`
const TOTAL_COLUMNS = new RegExp(String.raw`(unit_cost_khr),${GAP}total_cost_usd,${GAP}total_cost_khr`, 'g')
const TOTAL_VALUES = new RegExp(String.raw`(?:,${GAP}ROUND\([@?]\w+\s*\*\s*(?:ABS\()?[@?]\w+\)?,\s*4\)){2}`, 'g')
const PRODUCT_COST_GUARD = /p\.cost_price_(usd|khr) IS json_extract\(/g
// A ledger row serialised as JSON: the oracle stored 0 where no KHR cost was captured, today's rows hold NULL.
const LEDGER_KHR_NULL = /(\\*"(?:unit|total)_cost_khr\\*"):null/g

// The stock-in line edit and the stock session wrote a literal 0 KHR cost (and a 0 KHR total next to a recorded USD
// total); they now write NULL (no KHR cost was captured).
const LINE_EDIT_KHR = /([@?]\w+),NULL,([@?]\w+),NULL,/g
const SESSION_KHR = /m\.unit_cost_usd,NULL,CASE WHEN m\.unit_cost_usd IS NULL THEN NULL ELSE ([@?]\w+) END,NULL,/g

function legacyCostSql(text) {
  return text
    .replace(LINE_EDIT_KHR, '$1,0,$2,CASE WHEN $2 IS NULL THEN NULL ELSE 0 END,')
    .replace(SESSION_KHR, 'm.unit_cost_usd,0,CASE WHEN m.unit_cost_usd IS NULL THEN NULL ELSE $1 END,0,')
    .replace(TOTAL_COLUMNS, '$1')
    .replace(TOTAL_VALUES, '')
    .replace(PRODUCT_COST_GUARD, 'COALESCE(p.cost_price_$1,0)=json_extract(')
    .replace(LEDGER_KHR_NULL, '$1:0.0')
}

// The oracle's movement rows hold DEFAULT 0 in total_cost_usd / total_cost_khr; today's rows hold the computed total
// (or NULL when the cost is unknown). The totals are what the rule adds, so a ledger comparison ignores them.
function legacyCostLedger(text) {
  return text.replace(/"total_cost_(usd|khr)":(?:null|-?[0-9.]+)/g, '"total_cost_$1":0')
}

module.exports = { legacyCostSql, legacyCostLedger }
