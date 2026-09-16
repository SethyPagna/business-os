# Quarantined legacy reconciliation evidence

`recovered-legacy-flip-2026-09-04.sql.quarantined` is the exact SQL artifact
recovered from the archived September 4 session. Its SHA-256 is
`9402E45B8F86E94AE7E173D6AF390BEB3AAF4ACB602BA44B7BB09014548A6895`.

Do not execute this file. Its production row IDs and old-state assumptions may
be stale, it omits 18 already-completed sales with open receivables, and it
contains an unresolved policy choice for two partially paid invoices. It is
retained only as immutable evidence for a fresh read-only production preflight.

Any future operator-run repair must first capture a current D1 bookmark and a
complete before-state manifest, pin every target by primary key and full
old-state fingerprint, separate the partial-payment policy from other repairs,
assert no stock or batch changes, and generate a logical inverse. Production
execution requires explicit owner authorization.
