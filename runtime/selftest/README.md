# selftest — prove the eye works before trusting what it reports

A page with defects planted on purpose. Run it whenever the driver is changed, or when a real review comes back suspiciously clean and you want to know whether the tool or the app is at fault.

```bash
node "$HOME/.claude/skills/eyes/runtime/selftest/serve.mjs" &      # http://localhost:4599
EYES="$HOME/.claude/skills/eyes/runtime/eyes.mjs"
node "$EYES" start --headless --url=http://localhost:4599
node "$EYES" click "Adicionar ao carrinho"
node "$EYES" tabaudit 14
node "$EYES" contrast
node "$EYES" a11y
node "$EYES" device mobile && node "$EYES" snap
node "$EYES" stop
```

The `/api/carrinho` route answers 500 on purpose, so the add-to-cart failure is real HTTP, not a mock.

## What must show up

| Planted defect | Where it must appear |
|---|---|
| dead button ("Ver detalhes") | `NO VISIBLE CHANGE` after `click` |
| add-to-cart fails silently | `NO VISIBLE CHANGE` + `console.error` + `HTTP 500 POST /api/carrinho` |
| uncaught exception on load | `!! UNCAUGHT: undefined_function_qualquer is not defined` |
| broken image + missing alt | `broken-image`, `img-missing-alt`, `HTTP 404` |
| input with only a placeholder | `unnamed-control e5` mentioning the placeholder |
| input with only a `name` | `unnamed-control e6 (name="cep")` |
| no label on 2 of 3 fields | `form-unlabeled-fields: 2/3` |
| `href="#"` | `dead-link e2` |
| 2200px block | `horizontal-overflow` naming `div.wide` |
| no `h1`, no `lang`, no viewport meta | three separate static issues |
| 10px legal text | `tiny-text` |
| `#b9b9b9` on white | `contrast` → `1.96:1 (precisa 4.5:1)` |
| `outline:none` on the cart link | `tabaudit` → `NO-FOCUS-RING` at that stop |
| 21px nav links at 390px | `small-tap-target` after `device mobile` |
| `<input type=number>` refusing text | `fill e7 abc` → readback `DIFFERENT` |
| invalid email | readback → `the browser considers this field invalid` |

Anything on this list that stops appearing is a regression in the driver, not a fixed bug.
