# personas — whose eyes

A bug is only a bug relative to someone trying to do something. Pick the person before you pick the path, and say in the report which one you used. If the product serves two very different people, walk it twice — the second walk is always faster and usually finds more.

## Choosing

Read the product for two minutes (landing copy, nav labels, the first form) and pick the closest:

**O apressado** — arrives from an ad or a link, on a phone, with 30 seconds of patience.
Cares: is this what I clicked for, how many taps to the thing, is the price real.
Finds: slow first paint, hidden costs, tap targets, forms that ask too much too early, primary action below the fold.
How to walk: `--device=mobile`, `throttle fast-3g`, go straight for the primary action, refuse to read any paragraph.

**O desconfiado** — will not hand over data without a reason.
Cares: who is this, what happens after I click, can I undo, where is the contact info.
Finds: missing confirmations, no post-submit feedback, unclear consent, no way back, forms that ask for CPF before showing value.
How to walk: hover over every commitment before clicking it, look for the escape hatch at each step, submit half-filled and see how it reacts.

**O usuário de teclado** — mouse unavailable, or just fast.
Cares: Tab reaches everything, focus is visible, Enter and Escape do the obvious.
Finds: focus traps, invisible focus, unreachable controls, modals that leak focus, hover-only menus.
How to walk: `tabaudit` first, then complete the whole primary flow using only `press` and `type`. If you cannot, that is the finding.

**O operador** — uses this all day, every day, and knows it better than you.
Cares: keyboard shortcuts, bulk actions, how many clicks per repetition, does it remember my filters.
Finds: state lost on reload, filters not in the URL, no bulk select, confirmation dialogs on routine actions, pagination resets.
How to walk: do the same task three times in a row and count the clicks. Reload in the middle. Sort, filter, then `back`.

**O primeiro acesso** — has never seen this and has no context.
Cares: what is this, what do I do first, am I doing it right.
Finds: missing empty states, unexplained jargon, no onboarding, dashboards full of zeros with no next step.
How to walk: `reset`, then only do what the interface explicitly tells you to do. When it stops telling you, stop — and report where.

**O usuário adverso** — not malicious, just messy. Pastes, double-clicks, opens three tabs.
Cares: nothing. Does everything wrong.
Finds: double submits, XSS-shaped copy rendered raw, broken state from two tabs, crashes on long input.
How to walk: `--double` on every submit, `<b>oi</b>` and 200-char strings in every field, a second tab on the same flow, back-button abuse.

## Device and network matrix

Minimum viable coverage for any UI review: **desktop happy path + mobile primary flow + one degraded network**. Add rows when the product's audience demands it.

| Profile | Command | Test it when |
|---|---|---|
| desktop 1440x900 | `start --device=desktop` | Always — this is the baseline. |
| laptop 1280x800 | `--device=laptop` | Dense dashboards; the height is where things get cut. |
| tablet 820x1180 | `--device=tablet` | Layouts that switch to two columns; touch plus lots of room. |
| mobile 390x844 | `--device=mobile` | Always, for anything public-facing. |
| mobile-small 360x640 | `--device=mobile-small` | Real Brazilian phone traffic — the tightest common screen. |
| TV / kiosk 1920x1080 | `--device=tv` | Wall dashboards. Base font ≥24px, KPI numerals ≥72px, one viewport, no scroll. |
| fast-3g | `throttle fast-3g` | The default assumption for mobile, not an edge case. |
| slow-3g | `throttle slow-3g` | To reveal missing loading states. |
| offline | `throttle offline` | To reveal missing error states. Then `throttle none`. |

Locale matters in Brazil: the session defaults to `pt-BR` / `America/Sao_Paulo`. If the app formats dates, currency or decimals, check that `1.234,56` and `20/08/2026` come out right — and start a second session with `--locale=en-US` if the product claims to be bilingual.

## Saying it in the report

Name the persona and the profile once, up front:

> Andei como **o apressado** em `mobile` (390x844) com `fast-3g`, e repeti o fluxo principal no teclado em `desktop`.

That single line tells the reader how much weight to give every finding that follows.
