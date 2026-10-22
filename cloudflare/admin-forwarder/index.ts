// The optional admin forwarder (wrangler.template.toml): every request goes, unchanged,
// to the client's Business OS Worker through the TARGET service binding.
interface Env {
  TARGET: Fetcher
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return env.TARGET.fetch(request)
  },
} satisfies ExportedHandler<Env>
