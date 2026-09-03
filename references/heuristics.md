# heuristics — naming why it is bad

A finding that only says "não gostei" cannot be fixed. Every finding needs a *mechanism*: what the interface did, what the user therefore believed, and why that belief was wrong. This file is the vocabulary for that.

## The ten questions that cover most of it

Nielsen's heuristics, phrased as things you can actually check in a browser.

1. **Visibility of system status** — after I acted, did the interface tell me what is happening? A click with no spinner, no disabled button and no message means the user clicks again.
2. **Match with the real world** — do the labels use the user's words or the database's? `Cadastro de entidade` versus `Meus clientes`.
3. **User control and freedom** — can I get out? Is there a back, a cancel, an undo? A destructive action with no undo needs a confirmation; a reversible one does not need either.
4. **Consistency** — does the same thing look the same everywhere? Two different button styles for the same weight of action is a defect, not a style choice.
5. **Error prevention** — better than a good error message is no error: sensible defaults, input masks, disabled-until-valid, a confirmation before the irreversible.
6. **Recognition over recall** — does the user have to remember something from a previous screen (an order number, a code) to finish this one?
7. **Efficiency for the frequent user** — shortcuts, remembered filters, sane tab order. See `o operador` in personas.
8. **Aesthetic and minimalist design** — is everything on screen actually load-bearing? Two competing primary buttons means neither is primary.
9. **Error recovery** — does the message say *what went wrong, where, and what to do*? "Erro inesperado" fails all three.
10. **Help in context** — is the explanation where the confusion is, or buried in a docs page?

## The specific failures worth their own names

Use these terms; they map to fixes.

- **Dead control** — clicked, nothing happened, nothing logged. The driver flags this as `NO VISIBLE CHANGE`.
- **Silent failure** — the request failed (`net` shows 4xx/5xx or `request failed`) but the UI shows success or nothing. The worst class of bug: the user walks away believing a lie.
- **Optimistic lie** — the UI updates before the server confirms and never reconciles. Detect it by acting with `throttle offline` and watching the screen say "salvo".
- **Missing state** — the interface has a success state and nothing else. No empty, no loading, no error, no partial. Found by `reset`, `throttle`, and by submitting nothing.
- **Lost work** — a `reload` or a `back` destroys entered data without a warning. Prove it with `storage` before and after.
- **Invisible state** — sorting, filtering, pagination and tabs that live only in memory: not in the URL, so not shareable, not bookmarkable, and destroyed by the back button.
- **Double-submit** — no in-flight disable. Two orders, two charges. Prove it with `click --double`.
- **Enumeration leak** — "esse email não existe" tells an attacker which emails exist.
- **Unescaped copy** — `<b>oi</b>` renders bold in the confirmation. Report it as a defect; do not attempt any real payload.
- **Hover-only affordance** — a menu or tooltip that exists only on `hover` does not exist on a phone.
- **Focus black hole** — a modal opens and focus stays behind it; Tab wanders the page underneath. From `tabaudit`.
- **Keyboard dead end** — the flow cannot be completed without a mouse. From `tabaudit` + the unreachable list.
- **Layout debt** — `horizontal-overflow`, `small-tap-target`, `tiny-text` from `snap`. Cheap to find, cheap to fix, embarrassing to ship.
- **Contrast failure** — real numbers from `contrast`. Quote the ratio and the requirement; "muito claro" is not actionable, "1.96:1 onde o mínimo é 4.5:1" is.

## Severity, decided honestly

Ask only: *what does this cost the user?*

- **P0 blocker** — the main job cannot be completed at all, or completes wrongly with money/data consequences. Crash, dead submit, silent failure on a paid action, data loss.
- **P1 grave** — completable, but the user is misled or loses work: wrong total shown, no error on failure, state lost on refresh, enumeration leak, double-charge risk.
- **P2 friction** — completable and correct, but confusing, slow or awkward. Most mobile and a11y findings, missing empty states, vague error copy.
- **P3 polish** — cosmetic and copy. Alignment, inconsistent styles, nice-to-haves.

Two calibration rules:

- **Severity is about impact, not effort.** A one-line CSS fix that hides the submit button on a phone is P0.
- **Frequency multiplies.** A P2 on the screen everyone sees every day outranks a P1 in a corner nobody visits — say so explicitly rather than quietly inflating the label.

## What counts as evidence

A finding is complete when a stranger could reproduce it. That means:

| Element | Bad | Good |
|---|---|---|
| What happened | "o botão não funciona" | "step 7: `click e14 \"Salvar\"` → `NO VISIBLE CHANGE`, POST /api/pedidos → HTTP 500" |
| Where | "na tela de checkout" | "`/checkout/pagamento`, viewport 390x844" |
| Repro | "às vezes falha" | "1. `reset` 2. `goto /checkout` 3. `fill e5 ...` 4. `click e14`" |
| Proof | "vi o erro" | "`shots/007-click-e14-Salvar-.png`, `journal.jsonl` step 7" |
| Fix | "melhorar o botão" | "disable the button while the request is in flight and surface the 500 as an inline error" |

## Things that are not findings

Do not pad the report:

- Style preferences with no user cost ("eu usaria outro azul").
- Defects you inferred from the source code but never observed in the browser.
- Anything from a page you never actually loaded.
- The same root cause reported three times because it appears on three screens — report it once and list where it appears.
- Framework noise in the console (hydration warnings in dev, extension errors). Recognise it and say you filtered it, rather than counting it as an error.

## Say what worked, specifically

The positives section is not politeness — it tells the user which parts to leave alone. "A validação inline do CEP preenche cidade e estado sozinha e o erro aparece do lado do campo" is useful. "Design bonito" is not.
