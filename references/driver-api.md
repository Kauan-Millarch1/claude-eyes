# driver-api — every command, and what it actually does

`EYES="$HOME/.claude/skills/eyes/runtime/eyes.mjs"` then `node "$EYES" <command>`.
`node "$EYES" help` prints the same surface as a cheat sheet.

The daemon is a single detached browser process. Commands are one-shot round trips to it, so each one is a normal, cheap shell call — no long-running foreground process to babysit.

## Session

| Command | Notes |
|---|---|
| `start [--url=URL]` | Opens the browser. Headed by default with `slowMo` 110ms so the user can follow along. Prints the run directory — all evidence goes there. |
| `start --headless` | No window. Use in CI or when no display is available. `slowMo` drops to 0. |
| `start --device=<name>` | `desktop` (1440x900, default), `laptop` (1280x800), `tv` (1920x1080), `tablet` (820x1180), `mobile` (390x844), `mobile-small` (360x640). Mobile/tablet also set a touch-capable UA — this is the only way to test code that branches on user-agent. |
| `start --browser=chrome\|msedge\|chromium` | Default `auto`: Chrome, then Edge, then a Chromium from the ms-playwright cache. |
| `start --viewport=WxH` | Overrides the device's viewport, keeps its UA. |
| `start --locale=pt-BR --timezone=America/Sao_Paulo` | Defaults shown. Change to test i18n and date formatting. |
| `start --no-video` | Skips video recording. |
| `start --dialog=accept\|dismiss` | How `alert`/`confirm`/`prompt` are answered automatically. Default `accept`; `beforeunload` is always dismissed so navigation never hangs. |
| `status` | Engine, device, url, tab count, how much has been logged. |
| `stop` | Closes the browser, writes `summary.json`, finalises the video. Always run it — the video only exists after `stop`. |

Only one session lives at a time. `start` on a live session reuses it (and honours `--url`).

## Looking

**`snap [--max=N]`** — the core observation. Returns:

- `url`, `title`
- a page line: viewport, scroll height, count of interactive elements, iframe count, LCP/CLS so far
- the heading outline (the page's own structure, useful for judging information hierarchy)
- **elements**, each with a `ref` you can act on:
  `[e8] button "Adicionar ao carrinho" {required,disabled,off-screen} 187x42`
  Flags mean what they say. `off-screen` = present in the DOM but outside the current viewport. `(SEM NOME ACESSÍVEL)` = a screen reader would announce nothing; the placeholder or `name` attribute is shown separately because neither is a label.
- **static issues** found while walking the DOM: unnamed controls, dead links (`href="#"`), small tap targets, horizontal overflow (with the widest offending node), missing alt, broken images, missing `h1`/`lang`/viewport meta, unlabeled form fields, forms with no submit, tiny text, fields that block browser autofill.
- **runtime signals since your last look**: console errors, uncaught exceptions, failed requests, dialogs. Consumed on read, so each `snap` shows only what is new.

`--max=N` caps the element list (default 220). If output says `TRUNCATED`, raise it or scroll and re-snap.

| Command | Notes |
|---|---|
| `text [--max=N]` | Visible text of the page. Good for checking copy, totals, error messages. |
| `find <text>` | Where a string appears, with its ref if it has one. Use when `snap` truncated or the target is inside a big list. |
| `shot [name] [--full]` | Manual screenshot. `--full` captures the whole scroll height. |
| `console [--all]` | Session-wide console errors and uncaught exceptions; `--all` adds warnings. |
| `net` | Every failed request and every response ≥400, plus downloads. |
| `dialogs` | Every alert/confirm/prompt that fired and how it was answered. |
| `perf` | TTFB, first paint, FCP, DOMContentLoaded, load, LCP, CLS, long tasks, request count, transferred KB, DOM node count, slowest six resources. Budgets printed inline. |
| `a11y` | axe-core against wcag2a/2aa/21a/21aa + best-practice, sorted by impact, with CSS targets. |
| `contrast` | Computes real WCAG ratios for visible text against its effective background. Complements axe with concrete numbers. |
| `tabaudit [n]` | Presses Tab up to n times (default 40) from the top of the document. Reports the focus order, stops with no visible focus ring, backwards jumps versus visual order, focus scrolled out of view, focus traps, and **which controls the keyboard never reached at all**. Run `snap` first — the unreachable list is computed against it. |
| `storage` | Cookies count, localStorage, sessionStorage. Use before/after a reload to prove state loss. |
| `journal` | Paths to the journal, screenshots and video for this run. |

## Acting

Every action reports, in the same block: what it did, whether it failed, whether the URL changed, whether the page changed at all, everything the page logged as a result, and the screenshot it took.

| Command | Notes |
|---|---|
| `goto <url>` | Bare `localhost:3000` gets `http://`, other bare hosts get `https://`. Follows with a full `snap`. |
| `click <ref\|"text">` | Scrolls into view, then clicks. `--double` for a double-click (the standard double-submit test). Text targeting matches against the last `snap` and refuses ambiguous matches, listing the candidates. |
| `fill <ref> <value>` | Sets the value in one shot, then **reads it back** — masks, `maxlength` and input filters get caught here — and reports native validation state. |
| `type <ref> <value>` | Keystroke by keystroke (`--delay=ms`). Use when the field has per-key handlers: autocomplete, search-as-you-type, currency masks. |
| `press <Key>` | `Enter`, `Tab`, `Escape`, `ArrowDown`, `Control+A`… Sent to whatever has focus. |
| `select <ref> <value>` | `<select>` option, by value or label. |
| `check <ref> [--off]` | Checkbox / radio / switch. |
| `hover <ref>` | For menus and tooltips that only exist on hover — note that whatever appears is mouse-only, which is itself a finding. |
| `scroll <down\|up\|top\|bottom\|eN>` | Lazy lists and infinite scroll need this before elements exist. |
| `back` / `forward` / `reload` | The browser's own buttons. The most under-tested part of most SPAs. |
| `wait <ms>` / `wait "<text>"` / `wait --sel="<css>"` | Prefer waiting for text or a selector over sleeping. |
| `viewport <WxH>` / `device <name>` | Resize live. Note: this changes size only — UA and touch stay as the session started, so restart with `--device=` when behaviour depends on them. |
| `throttle <none\|fast-3g\|slow-3g\|2g\|offline>` | CDP network emulation. `offline` then click is the fastest way to find missing error states; `slow-3g` then `reload` exposes missing skeletons and spinners. |
| `reset [--noreload]` | Clears cookies + localStorage + sessionStorage and reloads: you are now a first-time visitor. Run this before judging onboarding or empty states. |
| `tabs` / `tab <i>` / `closetab [i]` | New windows are tracked automatically. Switching invalidates refs. |
| `eval <js>` | Escape hatch: read app state, count rows, inspect a global. Never use it to *perform* the action you are testing — that bypasses the UI you are supposed to be judging. |

Flags valid on any action: `--shot=off` (skip the screenshot), `--settle=<ms>` (extra wait before observing; raise it for slow SPAs).

## Refs

- A ref is a `data-eyes-ref` attribute stamped on the element by `snap`.
- Any re-render, navigation or framework update wipes them. The tool detects this and prints `refs invalidated` or, on failure, `stale ref: …`. The fix is always the same: `snap` again.
- Refs are per-page. Switching tabs clears them.
- Element order is DOM order, not visual order — an element with a low ref can sit at the bottom of the screen. Coordinates are in the output when that matters.

## Evidence layout

```
%TEMP%\claude-eyes\run-YYYYMMDDHHMMSS\
  journal.jsonl     one line per step: label, url, error, screenshot, signals
  shots\NNN-*.png   auto screenshot per action, numbered in order
  video\*.webm      whole session (written on `stop`)
  summary.json      console, page errors, network problems, dialogs, counters
  daemon.log        driver's own stderr, for when the driver itself misbehaves
```

Cite these paths in the report. `journal.jsonl` is what makes a finding reproducible after the session is gone.

## Limits worth knowing

- Same-origin iframes are reported in `snap` stats but their contents are not walked. Use `eval` or drive the frame's URL directly.
- `throttle` is Chromium-only (which is every supported engine here).
- File uploads are not wired into the CLI; use `eval` plus a `DataTransfer` only if the flow demands it, and say so in the report.
- `perf` numbers from a local dev server are optimistic — dev builds are unminified but served from RAM. Compare relatively, and never quote dev LCP as a production number.
