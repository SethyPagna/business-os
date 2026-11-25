'use strict'
// The base side of the call-ceiling native's Telegram text oracle (test-shift-close-call-ceiling-native.cjs).
// The base commit (BASE_REF) prints every shift-report money pair dollars first through money(); the lane prints them riel first, and the dollar half only when the SHIFT
// has any dollar figure (owner A72 + Q3b, 6.0.3070 Cash count, 6.0.3090 Expenses, 6.0.3096 one decision for both). Only the BASE text is mapped, by that one rule
// (money order and the per-shift dollar half, nothing else) before it is compared; the lane's own text is never mapped and is pinned riel first by its own check.
// Pure and self-tested by scripts/test-shift-close-base-text-map-pure.cjs, so the mapping is proven without running the native.
const NL = String.fromCharCode(10)
const HANGING_INDENT = '     '
const SHIFT_REPORT_TITLE = 'Shift report/'
// A dollar half carries its sign either before the "$" (a difference, "+$5.00") or after it (an expected figure below zero, "$-8.00").
const DOLLAR = /^[+−-]?\$[+−-]?\d[\d,.]*$/
// A Cash count pair row, either currency possibly N/A: "label: $A · B៛".
const MONEY_PAIR_ROW = /^(.*: )([+−-]?\$[+−-]?\d[\d,.]*|N\/A) · ([+−-]?\d[\d,]*៛|N\/A)$/
// What the base's money() prints: "$A · B៛", "$A", "B៛"; "$0.00" when both halves are zero.
const BASE_MONEY = '(\\$\\d[\\d,]*\\.\\d\\d(?: · \\d[\\d,]*៛)?|\\d[\\d,]*៛)'
const LABELLED_VALUE_ROW = new RegExp(`^(.*: )${BASE_MONEY}$`)
const CONTINUATION_VALUE_ROW = new RegExp(`^(${HANGING_INDENT})${BASE_MONEY}$`)
const isHeader = (row) => /^=+[^=]/.test(row)

const isShiftReport = (text) => String(text).split(NL)[0].includes(SHIFT_REPORT_TITLE)
const sectionBounds = (rows, marker) => {
  const start = rows.findIndex((row) => isHeader(row) && row.includes(marker))
  if (start < 0) return null
  let end = rows.length
  for (let index = start + 1; index < rows.length; index += 1) if (isHeader(rows[index])) { end = index; break }
  return { start, end }
}
const dollarValue = (printed) => Number(String(printed).replace(/[^0-9.]/g, ''))
const splitBaseMoney = (value) => {
  const dollars = /^\$(\d[\d,]*\.\d\d)/.exec(value)
  const riel = /(\d[\d,]*)៛$/.exec(value)
  return { dollars: dollars ? dollars[1] : null, riel: riel ? riel[1] : null }
}
// One base money value as the lane prints it: riel first; the dollar half only on a dollar shift, a missing half printed as 0៛ or $0.00.
const rielFirstValue = (value, anyDollar) => {
  const { dollars, riel } = splitBaseMoney(value)
  const rielPart = `${riel == null ? '0' : riel}៛`
  return anyDollar ? `${rielPart} · $${dollars == null ? '0.00' : dollars}` : rielPart
}
// The value rows of the base's Expenses section: "label: value", or a value alone on a hanging-indent row under a label row that wrapped (the bilingual delivery cost).
const expensesValueRows = (rows, bounds) => {
  const found = []
  for (let index = bounds.start + 1; index < bounds.end; index += 1) {
    const row = rows[index]
    const labelled = LABELLED_VALUE_ROW.exec(row)
    if (labelled) { found.push({ index, head: labelled[1], value: labelled[2] }); continue }
    const continuation = CONTINUATION_VALUE_ROW.exec(row)
    if (continuation && index > bounds.start + 1 && /:$/.test(rows[index - 1])) found.push({ index, head: continuation[1], value: continuation[2] })
  }
  return found
}
const baseMoneyRielFirst = (text) => {
  const rows = String(text).split(NL)
  const cash = sectionBounds(rows, 'Cash count/')
  const shiftReport = isShiftReport(text)
  const expenses = shiftReport ? sectionBounds(rows, 'Expenses/') : null
  const cashParsed = cash ? rows.slice(cash.start + 1, cash.end).map((row) => MONEY_PAIR_ROW.exec(row)) : []
  const expenseRows = expenses ? expensesValueRows(rows, expenses) : []
  // ONE decision for the message, as the lane takes it: any printed dollar of the Cash count pairs or of the Expenses values.
  const anyDollar = cashParsed.some((match) => match && DOLLAR.test(match[2]) && dollarValue(match[2]) !== 0)
    || expenseRows.some(({ value }) => (splitBaseMoney(value).dollars != null && dollarValue(splitBaseMoney(value).dollars) !== 0))
  if (cash) {
    for (let index = cash.start + 1; index < cash.end; index += 1) {
      const match = cashParsed[index - cash.start - 1]
      if (match) rows[index] = anyDollar ? `${match[1]}${match[3]} · ${match[2]}` : `${match[1]}${match[3]}`
    }
  }
  for (const { index, head, value } of expenseRows) rows[index] = `${head}${rielFirstValue(value, anyDollar)}`
  return rows.join(NL)
}

module.exports = { baseMoneyRielFirst, isShiftReport }
