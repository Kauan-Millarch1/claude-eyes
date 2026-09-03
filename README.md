# eyes

**Claude's eyes on a running interface.**

A [Claude Code](https://claude.com/claude-code) skill that stops the agent from reviewing your UI *from the source code* and makes it open a real browser instead — clicking, typing, submitting, going back, breaking things on purpose — then report only what it actually observed, with screenshots, console errors and reproduction steps as evidence.

> **The hard rule:** never write a finding you did not see happen in the browser.

## Why

A description of a system is not the system. The gap between "the code looks right" and "the thing works" is where the embarrassing bugs live: the button wired to nothing, the form that swallows the submit, the modal you cannot close on a phone, the error that only prints to the console.

An LLM reading your components will happily tell you the checkout works. `/eyes` makes it go through checkout.

## What it does

- Drives a **real browser** (your installed Chrome or Edge) via `playwright-core` — headed by default, so you watch the same session the agent does.
- Hands the agent a stable `ref` (`e1`, `e2`, …) for every interactive element, and invalidates them when the page re-renders.
- **Volunteers the signals that matter, unasked**, after every action: `NO VISIBLE CHANGE` (dead control), `!! UNCAUGHT` (JS exception), `HTTP 4xx/5xx`, input mangled by a mask, native validation firing silently, a new tab stealing the flow.
- Runs the mechanical sweeps: `tabaudit` (keyboard order and focus rings), `a11y` (axe-core, WCAG 2 A/AA), `contrast` (real computed ratios), `perf` (TTFB/FCP/LCP/CLS), mobile device emulation, network throttling.
- Records a video and a screenshot per action into a run directory, plus `journal.jsonl` and `summary.json`.
- Produces a severity-ranked report (P0 blocker → P3 polish) where every claim traces to a step, a screenshot, or a console line.

## Requirements

- **Node.js 18+** (developed on v22)
- **Google Chrome or Microsoft Edge** installed. The runtime uses `playwright-core` against the system browser, so there is no multi-hundred-megabyte browser download. It falls back to a cached Chromium if one happens to exist.
- Works on Windows, macOS and Linux.

## Install

```bash
git clone https://github.com/USER/REPO.git ~/.claude/skills/eyes
cd ~/.claude/skills/eyes/runtime
npm install
```

`npm install` pulls the two dependencies (`playwright-core`, `axe-core`); they are gitignored, not vendored.

Verify it works against the bundled test page, which has defects planted on purpose:

```bash
node ~/.claude/skills/eyes/runtime/selftest/serve.mjs &     # http://localhost:4599
node ~/.claude/skills/eyes/runtime/eyes.mjs start --headless --url=http://localhost:4599
```

## Use

In Claude Code, type `/eyes` — or just describe the intent ("testa o sistema", "vê se ficou bom", "navega como usuário"). The skill also fires on its own after a UI change that should be verified in a browser rather than described from the code.

Point it somewhere explicitly when you want a specific target:

```
/eyes http://localhost:3000/checkout
/eyes https://staging.example.com --device=mobile
```

If nothing is running, `probe.mjs` finds your local ports and start scripts, and the skill offers to start the dev server itself.

## Driver commands

The agent reads `references/driver-api.md` for the full surface. The short version:

| | |
|---|---|
| **Session** | `start` · `status` · `stop` |
| **Look** | `snap` · `find` · `text` · `console` · `net` |
| **Act** | `click` · `fill` · `type` · `press` · `select` · `hover` · `scroll` · `goto` · `back` · `reload` · `wait` · `eval` |
| **Context** | `device` · `throttle` · `reset` · `tabs` |
| **Measure** | `tabaudit` · `a11y` · `contrast` · `perf` |

## Repository layout

```
SKILL.md                  the skill itself: method, honesty clauses, report shape
references/
  driver-api.md           full command reference, ref semantics, gotchas
  checklists.md           per-surface sweep: forms, auth, lists, modals, checkout, mobile
  personas.md             whose eyes to use; device and network matrix
  heuristics.md           naming *why* something is bad; what counts as evidence
  report.md               report skeleton with a worked example
  troubleshooting.md      browser won't start, stale refs, SPAs, auth walls, iframes
runtime/
  eyes.mjs                CLI entry point
  daemon.mjs              persistent browser session, journal, evidence capture
  browser.mjs             system-browser resolution (Chrome → Edge → cached Chromium)
  inpage.mjs              injected page-side instrumentation
  probe.mjs               preflight: which local ports answer, what start scripts exist
  selftest/               a page with defects planted on purpose
```

## Notes

- The skill writes its reports in **Brazilian Portuguese** (see `SKILL.md` §5 and `references/report.md`). Everything else — code, docs, command surface — is English. Change the report language by editing those two files.
- Evidence lands in `os.tmpdir()/claude-eyes/run-<timestamp>/` unless you pass `--rundir`.
- The skill refuses to run destructive flows against production: no real orders, no real payments, no deleting anyone's data.

## License

MIT — see [LICENSE](LICENSE).

Dependencies keep their own licenses: [`playwright-core`](https://github.com/microsoft/playwright) (Apache-2.0), [`axe-core`](https://github.com/dequelabs/axe-core) (MPL-2.0). Neither is vendored in this repository.
