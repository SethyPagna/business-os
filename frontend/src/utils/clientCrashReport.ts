// Sends a browser crash to our own Worker, which forwards it to Sentry.
//
// Deliberately uses bare fetch rather than the app's api layer: that layer
// retries, dispatches auth events and can itself throw -- all reasonable for
// real requests, all wrong for the last thing that runs after a page has
// already crashed. Every failure mode here ends in silence on purpose.
//
// This lives outside App.tsx so both the ROOT boundary (mounted above every
// provider) and the per-page boundary in App.tsx report through one function.
export async function reportClientCrash(error: Error, page: string): Promise<void> {
  try {
    await fetch('/api/system/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        message: String(error?.message || error).slice(0, 1000),
        stack: String(error?.stack || '').slice(0, 4000),
        // The page id, never location.href -- a URL carries the query
        // string, which is where search terms and membership lookups live.
        page,
      }),
    })
  } catch {
    // Intentionally silent. See the docstring above.
  }
}
