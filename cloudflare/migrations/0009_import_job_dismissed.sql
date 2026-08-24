-- "Close" on the Import Needs Review banner (and any other tracker toast)
-- previously only cleared client-side state, so the banner came back on
-- the next login/session once that state was gone -- the import batch
-- itself was never told it had been reviewed/dismissed. This adds that
-- server-side flag, kept separate from approval: dismissing a toast is
-- "I've seen this, stop showing it to me," not "apply this import."
--
-- dismissed_status records the job's status *at the moment it was
-- dismissed* so the tracker can still surface it again if the status
-- later changes (e.g. someone else approves/rejects it, or a retry
-- fails) -- same semantics the client-side localStorage fallback used.
ALTER TABLE import_jobs ADD COLUMN dismissed_at TEXT;
ALTER TABLE import_jobs ADD COLUMN dismissed_status TEXT;
