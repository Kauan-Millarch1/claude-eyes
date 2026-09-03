# troubleshooting — when the eye itself misbehaves

Read `daemon.log` in the run directory first. It holds the driver's own stderr, which is where the real reason usually is.

## The browser will not start

`FAILED to start the browser session` prints the tail of `daemon.log`.

- **`could not launch any browser`** — no Chrome, no Edge, and no Chromium in the ms-playwright cache. Fixes, cheapest first:
  - Install Chrome, or pass `--browser=msedge` if Edge is present.
  - Download a Chromium once: `npx playwright install chromium` (~150MB), then `--browser=chromium`.
- **`Cannot find module 'playwright-core'`** — deps not installed:
  ```bash
  cd "$HOME/.claude/skills/eyes/runtime" && npm install
  ```
- **A stale session file blocks a fresh start** — `stop` failed to clean up:
  ```bash
  node "$EYES" stop            # try the graceful path first
  rm -f "$TMPDIR/claude-eyes/session.json"   # PowerShell: Remove-Item $env:TEMP\claude-eyes\session.json
  ```
- **No display (CI, SSH, container)** — use `--headless`. Everything except the video's usefulness works identically.

## `no live session`

The daemon died, or was never started. `node "$EYES" status` confirms. Just `start` again — but note that the previous run's evidence is still on disk and still citable.

## `stale ref` / `refs invalidated`

Working as intended. The page re-rendered and the `data-eyes-ref` attributes went with it. `snap` again and use the new refs. If it happens on *every* action, the app is re-rendering constantly (a React key or effect loop) — that is itself a finding worth reporting, and `--settle=1200` will let you keep working meanwhile.

## An SPA that never settles

`settle` waits for `domcontentloaded`, then `networkidle` with a short cap. Apps with websockets, polling or analytics beacons never reach networkidle; the cap means this only costs a couple of seconds. If actions still land too early:

- `--settle=1500` on the action.
- Better: `wait "<texto que aparece quando pronto>"` or `wait --sel=".data-table tbody tr"`. Waiting for the thing beats waiting for time.

## The element is there but the click does nothing

In this order:

1. `snap` again — is it `{disabled}`? Then the finding is *why* it is disabled with no explanation.
2. Is it `off-screen`? `scroll <ref>` first (though `click` scrolls on its own).
3. Is something covering it — a sticky header, a cookie banner, an invisible overlay? Playwright refuses to click through an overlay and says so in the error. **The overlay is the finding.**
4. `NO VISIBLE CHANGE` with a clean console and clean network = a genuinely dead control. That is a P0/P1, not a driver problem.

## Login walls

Most real reviews need a session. In order of preference:

1. **Log in through the UI** — it is a flow worth testing anyway. `fill` the fields, `click` submit, read the result.
2. **Ask the user for test credentials.** Never guess, never use anything that looks like production data.
3. **Reuse an existing browser session** — not supported by this driver; do not fight it. Ask for credentials instead.

Never disable auth, never inject a token you were not given, never `eval` your way past a gate. If you cannot get in, that limitation goes in the "Não testei" section.

## Cookie banners and overlays

They cover everything and they are part of the real experience. Dismiss it the way a user would (`snap`, find the accept button, `click`) and note whether dismissing it was easy. If the banner has no visible dismiss on mobile, that is a P1 — the product is unusable on a phone.

## iframes

`snap` reports how many iframes exist but does not walk into them. Payment gateways, embedded maps and third-party widgets live in there. Options:

- Drive the frame's URL directly with `goto` if it is a standalone page (rarely appropriate for a gateway).
- `eval` to inspect the frame from the outside.
- Or state plainly in the report that the iframe content was out of scope. For payment gateways, out of scope is the correct answer.

## `throttle` did nothing

CDP throttling attaches to the page that was active when it ran. If you switched tabs or the page navigated hard, run `throttle` again. `throttle none` restores.

## Screenshots are blank / white

Usually a page that has not painted yet — raise `--settle`. On a lazy-loading page, `scroll bottom` then `scroll top` before `shot --full`, or the full-page capture will be full of unloaded placeholders.

## `perf` numbers look impossibly good

A local dev server on the same machine has no network and often serves from memory. Use `perf` to compare *between* states (before/after a change, page A versus page B) and to catch obvious weight problems. Never quote a dev-server LCP as a production number — say which environment produced it.

## The video is missing

The video file is only finalised when the context closes. Always end with `node "$EYES" stop`. If the process was killed, the `.webm` in `video/` may be truncated or absent — the screenshots and journal still stand as evidence.

## Windows notes

- Paths in the output are Windows paths; the driver handles them. Quote them when passing to shell commands.
- `file:///` URLs work for static HTML, but `fetch` from a `file://` origin is blocked by CORS — the console errors you see are the browser's, not the app's. Serve over HTTP (`npx serve`, `python -m http.server`) before judging anything data-driven.
- The Bash tool's RTK hook can truncate long output. For a review where a dropped line matters, run driver commands through PowerShell or use `rtk proxy`.
