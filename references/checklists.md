# checklists — the sweep, by surface

Not a form to fill in. It is the list of things that are forgotten, so that when you say "testei esse fluxo" the sentence is true. Run the ones that apply to what is on screen; skip the rest and say you skipped them.

Each line is written as an action, because each line is a command you can actually run.

## Arrival (run before anything else)

- `reset` then `goto /` — this is what a stranger sees. Is it clear within five seconds what this is and what to do next?
- Is there a single obvious primary action, or three competing ones?
- `snap` — does the heading outline match the visual hierarchy, or is the biggest text an `h3` inside a `div` soup?
- `throttle slow-3g` then `reload` — during those seconds, does the page show a skeleton, a spinner, or a blank white void?
- `throttle offline` then `reload` — is there any message at all, or just a browser error page?
- Back to `throttle none`.

## Forms (the richest source of real bugs)

- Submit **empty**. Is there an error per field, or one vague banner, or nothing?
- Do error messages say how to fix it ("use 11 dígitos") or only that something is wrong ("inválido")?
- Does the error appear **next to the field**, and does focus move there?
- `fill` a wrong-format value — check the readback line: did a mask mangle it?
- Long input: a 200-character name, a 60-character email. Truncated silently? Layout broken?
- Accents and apostrophes: `José D'Ávila`. Emoji in a text field. `<b>oi</b>` — is it escaped in the confirmation, or rendered?
- Numbers: `0`, `-1`, `999999999`, `1,5` versus `1.5`.
- Whitespace: leading/trailing spaces in an email — trimmed or rejected?
- `click <submit> --double` — one submission or two? Is the button disabled while in flight?
- `press Enter` inside a text field — submits, or does nothing (and should it)?
- `reload` with the form half-filled — is the work gone with no warning?
- `back` out of a form and forward again — values restored, or garbage state?
- After a **successful** submit: is there confirmation the user can believe? Where did it take them? Can they get back?
- `tabaudit` — is the field order the visual order? Can the submit be reached and fired with the keyboard alone?
- Are required fields marked visually *and* with `required`/`aria-required` (the `snap` flags tell you)?

## Auth

- Wrong password: does the message reveal whether the email exists (an enumeration leak) — and does it say what to do next?
- Right password: where do you land? Was the intended destination preserved, or did it dump you on the dashboard?
- `reset` then `goto <protected-url>` — login prompt, crash, or blank screen? After logging in, do you get back to that URL?
- `back` right after logout — is the protected page still rendered from cache?
- `storage` before and after login — what is kept, and is anything sensitive sitting in localStorage in plain text?
- Is there any path to password recovery from the failure state, or is the user stuck?

## Lists, tables, search

- Empty state: is there one, and does it tell the user what to do, or is it a blank rectangle?
- One result. Zero results — does the "nenhum resultado" copy suggest a next step?
- A search with a typo, a search with accents, a search with a single letter.
- Pagination: page 2, then `reload` — same page or back to 1? Is the page in the URL?
- Sorting and filtering: does the URL reflect it (shareable/back-button-safe) or is it invisible state?
- `scroll bottom` — infinite scroll: does it load, does it show it is loading, does `back` return you to your place?
- Wide tables at `device mobile` — `snap` and check `horizontal-overflow`. Does it scroll inside its own container, or does the whole page scroll sideways?
- A destructive row action (delete): is there a confirmation? An undo? Does the row vanish before the server confirmed?

## Modals, drawers, menus

- After opening: does focus move into the modal (`tabaudit`)?
- `press Escape` — does it close?
- Click the backdrop — does it close? Should it, given unsaved input?
- `tabaudit` while open — does Tab escape to the page behind it (a focus leak) or loop inside?
- On `device mobile`: is the close button reachable without scrolling? Is the modal taller than the screen with the action buttons pushed below the fold?
- Does the page behind scroll while the modal is open (scroll bleed)?
- `hover` menus: is there any keyboard or touch path to the same items? On a phone, hover does not exist.

## Checkout / multi-step flows

- Walk it end to end and read the total at every step — does it stay consistent? Does shipping appear before or after the user commits?
- Go `back` one step mid-flow: is the data still there? Is the progress indicator still honest?
- `reload` mid-flow: same question.
- Change quantity: does the total update, and does it update *before* the button becomes clickable again?
- `throttle slow-3g` then submit: is the button disabled? Is there any indication of work in progress? Can you double-submit?
- `throttle offline` then submit: what does the user see? (This is where "silent failure" lives.)
- Any step that opens a new tab (payment gateways): `tabs`, follow it, come back — does the original tab know what happened?
- Never complete a real payment. Stop at the gateway boundary and say so.

## Dashboards / data views

- Do the numbers agree with each other? A total that is not the sum of its parts is a P1.
- Is there a data-freshness indicator, or does a stale page look identical to a live one?
- Loading: skeletons per widget, or one page-wide spinner that blocks everything?
- Zero/negative/huge values — does the chart axis survive? Does the layout?
- `device tv` for wall displays: is anything under 24px? (See the TV/kiosk rules in the user's global CLAUDE.md.)
- `perf` — how heavy is it, and how many requests fire on load?

## Responsive sweep

Run at `device mobile` at minimum, `mobile-small` if the product has real phone traffic:

- `snap` and read: `horizontal-overflow`, `small-tap-target`, `tiny-text`.
- Is the primary action still visible without scrolling?
- Does the nav collapse into something openable — and closable?
- Do fixed headers/footers eat the content or cover the submit button?
- Does a focused input get covered by the on-screen keyboard region (test by resizing to `--viewport=390x420` and interacting)?
- Is anything hover-only, and therefore unusable here?

## Keyboard and screen-reader floor

- `tabaudit` on every page you judge. Read three things: unreachable controls, missing focus rings, order jumps.
- `a11y` and `contrast` once per distinct layout, not once per page.
- Are icon-only buttons named? (`(SEM NOME ACESSÍVEL)` in `snap` is a screen-reader dead end.)
- Is there a skip-to-content link as the first tab stop on a page with a big nav?
- Do error messages get announced (`aria-live`), or are they only visual? Check the DOM with `eval` if it matters.

## Integrity checks on the whole session

Before writing the report:

- `console` — anything logged that the user was never told about?
- `net` — any 4xx/5xx the UI hid?
- `dialogs` — any native `alert` used where a designed message belonged?
- `perf` — LCP over 2.5s, CLS over 0.1, or a single resource over 1MB?
- Re-run any step that produced a finding, once, to confirm it reproduces.
