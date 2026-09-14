# retirement-calculator

Cloudflare Worker (hono API + static frontend) deployed with `wrangler deploy`.
Tests: `npm test` (vitest).

## Returning to this project

After any gap, run `npm outdated` before `npm install`. If wrangler or the
rest of the toolchain is behind, update it first (`npm update`, then any
majors you want one at a time), run the tests, and commit the lockfile as its
own chore commit before starting feature work. Transitive dev dependencies
such as miniflare, workerd and sharp only move when wrangler does, so a stale
wrangler is the usual cause of a surprising install failure.
