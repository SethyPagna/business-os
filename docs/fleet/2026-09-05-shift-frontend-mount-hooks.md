# Shift frontend mount contract

The reusable non-sensitive transaction-page component is:

```tsx
import CurrentShiftSummary from '../shifts/CurrentShiftSummary.tsx'

<CurrentShiftSummary />
```

It renders only shift code/status, opener/cashier, scope, branch, opened time,
closed time, and duration. It deliberately does not render opening cash,
closing cash, notes, revenue, cost, or profit. Loading, no-shift, exempt, and
offline/error states remain visible rather than disappearing silently.

Completed mounts:

- POS passes the active till branch to both `ShiftGate` and `EndShiftButton`.
- Sales, Expenses, and Income/Reports mount `CurrentShiftSummary` above their
  transaction controls.
- All transaction summaries read the operational `pos_branch` selection. A
  historical report branch/date filter never redefines the current shift.
- POS open/close writes publish through the same branch/user/policy cache, so
  mounted transaction pages update immediately.

This component describes the live/today shift; it does not claim historical
transaction ownership. If a later feature needs per-record attribution, add a
persisted `shift_session_id` and prefer that direct key. Do not infer ownership
solely from timestamp overlap.
