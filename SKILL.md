---
name: eyes
description: Claude's eyes on a running interface. Opens a real browser, navigates as a real user would — clicking, typing, submitting, going back, breaking things on purpose — and reports what actually happened, with screenshots, console errors and repro steps as evidence. Use when the user says /eyes, "olha o site", "testa o sistema", "navega como usuário", "vê se ficou bom", or after building/changing any UI that should be verified in a browser rather than described from the code.
---

# eyes

You are about to stop reading code and start using the product.

This skill exists because a description of a system is not the system. The gap between "the code looks right" and "the thing works" is where every embarrassing bug lives: the button wired to nothing, the form that swallows the submit, the modal you cannot close on a phone, the error that only prints to the console. `/eyes` closes that gap by driving a real browser, one step at a time, and reporting only what was actually observed.

## The hard rule

**Never write a finding you did not see happen in the browser.**

Every claim in the report traces to a step number in the journal, a screenshot, a console line, or a failed request. No "provavelmente", no "pode ser que", no reasoning about the source code presented as an observation. If you did not click it, you do not know.

If the browser cannot be opened, say so and stop. A text review is a different deliverable — offer it, do not silently substitute it.

## 0. Preflight

```bash
EYES="$HOME/.claude/skills/eyes/runtime/eyes.mjs"
node "$HOME/.claude/skills/eyes/runtime/probe.mjs" --dir=.
```

`probe.mjs` reports which local ports answer HTTP and what start scripts exist. Then:

- **A live URL was found** → use it.
- **The user named a URL** → use it (staging, production, a public site — all fine).
- **Nothing is running but the repo has a dev script** → start it in the background (`npm run dev`), wait for the port, then continue. Say which command you ran.
- **Nothing to look at at all** → ask for the URL. One question, then proceed.

Never test production with destructive intent: no real orders, no real payments, no deleting anyone's data. If the only environment available is production, restrict yourself to read-only paths and say so in the report.

## 1. Open the eyes

```bash
node "$EYES" start --url=http://localhost:3000          # headed: the user watches
node "$EYES" start --url=... --device=mobile             # phone profile (UA + touch)
node "$EYES" start --url=... --headless                  # CI / no display
```

Headed is the default and the better choice — the user sees the same session you do, which is half the value. The window records a video and every action screenshots itself; everything lands in the run directory printed by `start`.

One session at a time. `node "$EYES" status` to see what is open; `stop` to close and flush the summary.

## 2. The loop

Three commands carry the whole skill:

```bash
node "$EYES" snap                 # look: refs, outline, static defects, new signals
node "$EYES" click e12            # act (or: click "Finalizar compra")
node "$EYES" snap                 # look again: what changed?
```

`snap` hands you a `ref` (`e1`, `e2`, …) for every interactive element on screen. You act on refs. Refs die when the page re-renders — the tool tells you when, and you `snap` again.

Read `references/driver-api.md` for the full command surface (`fill`, `type`, `press`, `select`, `hover`, `scroll`, `back`, `reload`, `wait`, `throttle`, `reset`, `tabs`, `eval`, `find`, `text`).

**What the tool volunteers, unasked, after every action** — these are your highest-value findings, do not skim them:

| Signal | What it means |
|---|---|
| `NO VISIBLE CHANGE` | You clicked and nothing happened. Dead control, or a failure the UI never told the user about. |
| `!! UNCAUGHT` | A JS exception. Something is broken even if the screen looks fine. |
| `!! HTTP 4xx/5xx` / `request failed` | The UI may be hiding a backend failure behind a spinner or a smile. |
| `field now holds: … DIFFERENT` | A mask, maxlength or filter mangled what the user typed. |
| `the browser considers this field invalid` | Native validation fired — did the UI show the user anything? |
| `a new tab/window opened` | Flow jumped context; follow it with `tabs` / `tab <n>`. |
| `refs invalidated` | The page re-rendered. `snap` before your next move. |

## 3. Behave like a person, not a script

Read `references/personas.md` and pick the persona the product is actually for. Then walk in as that person, with their impatience and their assumptions. Concretely:

- **Arrive cold.** `reset` first, so you see what a first-time visitor sees, not what a warm cache and a stale session show you. Is it obvious what this is and what to do next?
- **Follow the loudest thing on screen**, not the sitemap. If the primary call to action does not lead to the primary job, that is the finding.
- **Type real, messy input**: accents, `José D'Ávila`, a 200-char name, `+55 (11) 99999-8888`, `test@test`, `0`, `-1`, `<b>oi</b>` (does it escape?), an emoji.
- **Be impatient.** Double-click the submit (`click e8 --double`) — two orders? Press Enter in a text field. Hit the back button mid-flow. Refresh with a half-filled form (`reload`, then `snap` — did the work survive?).
- **Get lost on purpose.** Deep-link to an inner page with a clean session (`reset` then `goto /conta/pedidos`) — do you get a login prompt, a crash, or a blank screen?
- **Look for what is missing**, which is what "passou em branco" always means: no empty state, no loading state, no error message, no confirmation after a destructive action, no way back from a dead end, no focus on the newly opened modal.

Cover at least: the primary flow end to end, one failure path (bad input, bad credentials, network `offline`), one narrow viewport, and the keyboard (`tabaudit`).

## 4. Then measure

Cheap, mechanical, and it finds real defects the eye slides past:

```bash
node "$EYES" tabaudit            # tab order, focus rings, unreachable controls
node "$EYES" a11y                # axe-core: wcag2a/aa + best practices
node "$EYES" contrast            # real WCAG ratios for visible text
node "$EYES" perf                # TTFB/FCP/LCP/CLS, weight, slowest resources
node "$EYES" device mobile       # then snap: overflow, tap targets
node "$EYES" throttle slow-3g    # then reload: does anything tell the user to wait?
node "$EYES" console             # everything the console said all session
node "$EYES" net                 # everything the network refused all session
```

`references/checklists.md` is the full sweep, organised by surface (forms, lists, modals, auth, checkout, dashboards). Read it before declaring a flow covered — it exists to catch what you forgot to try.

## 5. Close the session and bundle the evidence

```bash
node "$EYES" stop                                    # flush summary.json + video
node "$HOME/.claude/skills/eyes/runtime/bundle.mjs"  # collect the journey + screenshots
```

`bundle.mjs` runs **standalone** — it reads the run directory off disk, so it works after the daemon is dead. It writes `bundle.json` next to the evidence and prints the flagged steps. Three things come out of it:

- **`steps[]` — the journey.** Every action in order, with the URL and the signals the driver volunteered at that step. This is the lived experience of using the product, and it only exists here: the terminal output is gone, and `summary.json` has the tallies but not the walk.
- **`shots{}` — screenshots as `data:` URIs**, keyed by step number, ready to drop straight into `<img src>`. A published Artifact cannot reach the user's disk, so a page that cites `shots/004-click.png` shows the reader nothing. By default it embeds only the steps where something actually went wrong; `--shots=4,13` picks specific ones, `--shots=all` takes everything, `--shots=none` skips images.
- **`notes[]` — what it could not embed and why.** A screenshot too big for the budget is reported, never dropped in silence.

It stays inside a 10 MB base64 budget (`--max-mb=`) against the Artifact's 16 MB ceiling, shrinking oversized shots through a real canvas rather than blowing the limit. **Read the `notes` before you write the report** — an image the bundle dropped is an image your page will not have.

The video is local-only. Cite its path; it cannot travel into an Artifact.

## 6. Report

Write it in PT-BR, structured exactly like `references/report.md`:

1. **O que eu fiz** — the route walked, in one short paragraph. Device, how many steps.
2. **Veredito** — can a real user complete the main job? One sentence, no hedging.
3. **A jornada** — the walk itself, step by step, from `bundle.json`. Where it went, what answered, where it broke. Do not paste all 40 rows: give the spine of the route, then every flagged step in full. This is the section that answers "what was it like to use this thing", and it is the reason the run was journaled.
4. **Achados**, worst first. Each one: severity, what happened, the exact steps to reproduce, the evidence, and the fix you would make.
5. **O que funcionou bem** — specific, not flattery. Name the interaction that felt right.
6. **O que eu não consegui testar** — and why. Never let a gap pass as coverage.

Severity, applied honestly:

- **P0 blocker** — the main job cannot be completed. Crash, dead submit, silent data loss.
- **P1 grave** — it works but wrongly, or the user is misled: wrong total, no error on failure, state lost on refresh.
- **P2 friction** — completable but confusing, slow, or awkward. Most a11y and mobile findings land here.
- **P3 polish** — cosmetic, copy, alignment, nice-to-have.

Rank by what it costs the user, not by how easy it is to fix. Three P2s that all say "there is no feedback after submitting" are one finding, stated once.

## 7. Publish it

**The Artifact is the deliverable, not an extra.** A review whose evidence lives in `%TEMP%` on one machine cannot be handed to the person who has to fix the bug. Publish unless the user says not to.

1. Load the `artifact-design` skill **before** writing the file.
2. Write the report to an HTML file: the journey as a walkable timeline, the findings worst-first, each one showing its own screenshot inline from `bundle.json`'s `shots[step].dataUri`.
3. Publish with `Artifact`: a short title (`"Revisão da Loja"`), `favicon` `👁️`, and a one-line description. **No `capabilities`** — the page is static, the images are already inside it.
4. Hand over the link, and say what did not make it in (dropped shots, the video path).

`references/report.md` has the full structure and the publishing rules. The terminal report stays too — the user reading right now should not have to open a link to learn the verdict.

## Honesty clauses

- A flow you could not finish is **not** a passing flow. Report where you stopped and why.
- If a finding might be your own driving mistake (wrong field, wrong order), re-run those steps once before reporting it. Say if it only reproduces sometimes — intermittent is itself a finding.
- Screenshots are for the user, not decoration: cite the ones that show the defect, not all forty.
- A clean run is a legitimate result. Say "não achei nada grave nesse fluxo" and list exactly what you exercised, so the user knows what the green covers.

## References

| File | Read it when |
|---|---|
| `references/driver-api.md` | Full command reference, flags, ref semantics, gotchas |
| `references/checklists.md` | Per-surface sweep: forms, auth, lists, modals, checkout, dashboards, mobile, keyboard |
| `references/personas.md` | Choosing whose eyes to use, and the device/network matrix |
| `references/heuristics.md` | Naming *why* something is bad: heuristics, severity calls, what counts as evidence |
| `references/report.md` | The report skeleton, the journey section, and how to publish the Artifact |
| `references/troubleshooting.md` | Browser will not start, refs go stale, SPA never settles, auth walls, iframes |
| `runtime/bundle.mjs` | Standalone. Run it after `stop` to turn the run dir into `bundle.json`: the journey, plus screenshots as `data:` URIs an Artifact can actually show |
| `runtime/selftest/README.md` | A page with defects planted on purpose — run it when a review comes back suspiciously clean, or after changing the driver |
