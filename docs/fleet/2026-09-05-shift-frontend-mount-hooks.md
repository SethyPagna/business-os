# Shift frontend mount hooks

The reusable non-sensitive transaction-page component is:

```tsx
import ShiftSummary from '../shifts/ShiftSummary.tsx'

<ShiftSummary shift={shift} compact />
```

It renders only shift code/status, cashier, branch, opened time, closed time, and duration. It deliberately does not render opening cash, closing cash, notes, revenue, cost, or profit.

Coordinator-owned mounts were left untouched because the active report/accounting lane owns the overlapping page trees:

- POS: update both existing mounts in `frontend/src/components/pos/POS.tsx` to pass the same active till branch: `<ShiftGate branchId={primaryBranchFilterId} branchName={...} />` and `<EndShiftButton branchId={primaryBranchFilterId} />`. Resolve `branchName` from the already-loaded `branches` collection. Both components already accept these props; this final mount edit was intentionally left out because `POS.tsx` is outside this worker's ownership.

- Sales: mount beside the selected sale/date summary in `frontend/src/components/sales/Sales.tsx`. Resolve the applicable shift from `listShifts({ branchId, from, to })`, matching `business_date`, `branch_id`, and the sale cashier when policy is `per_account`; for `shop_wide`, match business date and branch only.
- Expenses: mount in the expense history/detail surface after the date/branch filters. Use the same date/branch rule and cashier match only for `per_account` mode.
- Income: mount in the income history/detail surface after the date/branch filters, using the same resolver contract.

Do not infer a shift solely from timestamp overlap. The backend records `business_date`, `branch_id`, `scope_mode`, and `user_id`; those fields are the stable join dimensions. If a transaction endpoint later returns `shift_session_id`, prefer that direct key and retain the scoped fallback only for legacy rows.
