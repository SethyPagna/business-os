# Frontend<->backend request-body contract diff (Part 229)

Heuristic regex/brace-matching tools -- not a real TS AST walk -- built to
diff what the frontend sends against what each backend handler actually
reads, past the point where path+method matching alone stops being useful.

Run in this order from this directory:

```
node extract_backend_routes.cjs   # -> backend_routes.json
node extract_frontend_calls.cjs   # -> frontend_calls.json
node diff_contracts.cjs           # -> contract_diff.json + summary counts
```

Known, accepted blind spots (verified false-positive sources during Part
229, not worth chasing further given the heuristic-tool tradeoff):
- Frontend calls that spread a body from a helper function
  (`{ ...getX(), ...payload }`) are skipped as opaque rather than compared
  -- the real field set can't be known without tracing the helper.
- Frontend paths built from a non-literal base (e.g. `` `${config.endpoint}/${id}` ``
  where `config` is imported from elsewhere) can't be resolved statically.
- Routes registered via a factory/config-object pattern rather than a
  literal `app.<method>('/path', ...)` call are invisible to the backend
  extractor.

Always spot-check `contract_diff.json` entries against live source before
treating them as real bugs -- this tooling narrows down *where to look*,
it doesn't replace reading the handler.
