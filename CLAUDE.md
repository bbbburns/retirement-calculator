# retirement-calculator

Cloudflare Worker (hono API + static frontend).
Tests: `npm test` (vitest). Typecheck: `npm run typecheck`.

**Merging to `main` deploys to production** via Cloudflare Workers Builds
(git integration set up in the Cloudflare dashboard, so nothing in the repo
shows it). There is no manual deploy step; treat every merge as a release,
unless it only touches excluded paths (see "Build watch paths" below).
Check the `Workers Builds: retirement-calculator` check run to confirm it.

## Returning to this project

After any gap, run `npm outdated` before `npm install`. If wrangler or the
rest of the toolchain is behind, update it first (`npm update`, then any
majors you want one at a time), run the tests, and commit the lockfile as its
own chore commit before starting feature work. Transitive dev dependencies
such as miniflare, workerd and sharp only move when wrangler does, so a stale
wrangler is the usual cause of a surprising install failure.

## Build watch paths

Cloudflare Workers Builds skips the build when every file a push changes is
excluded: `.github/*`, `.gitignore`, `README.md`, `LICENSE`, `CLAUDE.md`,
`scripts/*`, `test/*`, `vitest.config.mts`. Everything else builds and deploys.
A skipped push gets no `Workers Builds` check on the commit. The setting lives
only in Cloudflare, not in this repo. It's managed from
`~/Projects/cloudflare-config` (`desired/retirement-calculator.json`,
`apply.sh`). If you add a new top-level file or directory, check whether it
belongs in that list. Leaving it out is the safe default.
