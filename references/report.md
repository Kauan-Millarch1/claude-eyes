# report — the shape of the deliverable

Written in PT-BR. Terse, concrete, worst-first. The reader wants to know: can my user finish the job, what is broken, and what do I fix first.

## Skeleton

```markdown
## Olhei: <o quê> — <persona> em <device>, <N> passos
<Uma frase sobre a rota andada.> Evidência: <runDir>

**Veredito:** <consegue ou não consegue completar o trabalho principal>. <Uma frase.>

### A jornada
| # | O que eu fiz | O que aconteceu |
|---|---|---|
| 1 | <ação> | <o que respondeu — ou o sinal exato, se travou> |
| … | | |

<Uma ou duas frases sobre a sensação da rota: onde hesitei, o que não estava
onde eu esperava, o que me fez clicar duas vezes.>

### Achados

**P0 — <título curto do problema>**
O que aconteceu: <observação, com o sinal exato do driver>
Repro:
1. <comando>
2. <comando>
Evidência: shots/NNN-*.png · journal step N
Fix: <a mudança concreta>

**P1 — ...**

### Funcionou bem
- <interação específica que resolveu bem>

### Não testei
- <o quê> — <por quê>
```

## Regras de escrita

- **Pior primeiro.** P0 no topo. Se não tem P0, diga isso na primeira linha do veredito.
- **Um achado por causa raiz.** Se o mesmo bug aparece em três telas, é um achado com três locais.
- **Sinal exato, não paráfrase.** `NO VISIBLE CHANGE`, `HTTP 500`, `1.96:1 (precisa 4.5:1)` — copie o que o driver disse.
- **Repro em comandos.** O leitor deve poder colar e ver o mesmo. É por isso que a sessão é conduzida por CLI.
- **Fix no imperativo, uma linha.** "Desabilitar o botão enquanto o POST está em voo e mostrar o erro do servidor inline." Não é PR, é direção.
- **Sem hedge.** Se você não sabe, está em "Não testei".
- **Números, não adjetivos.** "LCP 4.2s" em vez de "lento". "24x20px" em vez de "pequeno".

## Exemplo trabalhado

```markdown
## Olhei: loja / fluxo comprar — apressado em mobile 390x844, 23 passos
Home → produto → adicionar ao carrinho → checkout → pagamento (parei antes do gateway).
Repeti o formulário de entrega no teclado. Evidência: C:\...\claude-eyes\run-20260820174027

**Veredito:** não consegue comprar. O botão "Adicionar ao carrinho" falha em silêncio e o
usuário fica na mesma tela achando que o item entrou.

### A jornada
| # | O que eu fiz | O que aconteceu |
|---|---|---|
| 1 | Cheguei na home sem sessão | Carrossel ocupa a tela toda; nenhum produto visível sem rolar |
| 3 | Abri o produto 42 | Preço e foto ok, frete só aparece depois do CEP |
| 4 | "Adicionar ao carrinho" | `NO VISIBLE CHANGE` + `!! HTTP 500: POST /api/carrinho`. Nada na tela |
| 5 | Cliquei de novo, achando que não pegou | Mesma coisa. Dois POSTs, dois 500, contador segue em 0 |
| 8 | Fui no carrinho pelo topo | Vazio, como esperado. Sem mensagem explicando |
| 12 | Preenchi os 6 campos de entrega | Aceitou tudo, inclusive CEP de 3 dígitos |
| 13 | Recarreguei | Formulário voltou vazio, sem aviso |
| 23 | Parei na fronteira do gateway | — |

A rota trava no passo 4 e o produto não conta isso. Cliquei duas vezes porque nada
mudou na tela, e só o console sabia do 500. Do passo 5 ao 8 eu estava procurando
confirmação de uma coisa que nunca aconteceu.

### Achados

**P0 — "Adicionar ao carrinho" falha em silêncio**
O que aconteceu: step 4, `click e8 "Adicionar ao carrinho"` → `NO VISIBLE CHANGE`, e o console
cuspiu `checkout: cart service returned 500` + `POST /api/carrinho` falhou. Nada apareceu na tela:
sem toast, sem erro, sem contador do carrinho mudando. O usuário clica de novo achando que não pegou.
Repro:
1. `node "$EYES" start --device=mobile --url=http://localhost:3000/produto/42`
2. `node "$EYES" snap`
3. `node "$EYES" click "Adicionar ao carrinho"`
Evidência: shots/004-click-e8-Adicionar-ao-carrinho-.png · journal step 4
Fix: tratar a falha do POST /api/carrinho — erro inline no botão, e não incrementar o contador
antes da confirmação do servidor.

**P1 — recarregar perde o endereço digitado**
O que aconteceu: step 12 preencheu os 6 campos de entrega; step 13 `reload` e o `snap` seguinte
mostrou todos vazios, sem aviso. `storage` confirma: nada foi persistido.
Repro: preencher entrega → `node "$EYES" reload` → `node "$EYES" snap`
Evidência: shots/013-reload-F5-.png
Fix: persistir o rascunho do formulário em localStorage a cada blur, ou avisar antes de sair.

**P2 — nav inteira é inclicável de dedo**
O que aconteceu: em 390px, os 4 links do topo têm 21px de altura (`small-tap-target` em e1–e4);
o piso confortável é 32px e o mínimo WCAG 2.5.8 é 24px.
Evidência: snap em `device mobile`
Fix: 44px de altura mínima nos itens de nav via padding.

**P2 — "Frete grátis acima de R$ 199" quase invisível**
O que aconteceu: contraste 1.96:1 onde AA exige 4.5:1 (cinza #b9b9b9 no branco), 16px.
Evidência: `contrast`
Fix: escurecer para no mínimo #767676 no fundo branco.

**P2 — link do carrinho sem anel de foco**
O que aconteceu: `tabaudit` stop 4 → `NO-FOCUS-RING`. Regra `a.noring:focus{outline:none}`.
Fix: remover o `outline:none` ou dar um `:focus-visible` próprio visível.

### Funcionou bem
- O painel abre e fecha sem travar o scroll do fundo, e o Escape fecha.
- A validação nativa do email dispara com mensagem em português no momento certo.

### Não testei
- Pagamento de verdade — parei na fronteira do gateway de propósito.
- Login/conta — não achei rota autenticada exposta no ambiente local.
- Tablet — o produto declara foco em mobile e desktop.
```

## Regras da jornada

A tabela sai do `bundle.json` (`steps[]`), gerado por `runtime/bundle.mjs` depois do `stop`.

- **Não cole os 40 passos.** O leitor quer a espinha da rota (5–8 linhas: cheguei, procurei, cliquei, preenchi, submeti) mais **todo passo sinalizado, na íntegra**. `bundle.mjs` imprime quais são.
- **Coluna 2 é observação, não narração.** "abriu o modal" e não "cliquei no botão de detalhes". O que eu fiz já está na coluna 1.
- **Passo com sinal leva o sinal exato**, copiado: `NO VISIBLE CHANGE`, `!! HTTP 500: POST /api/carrinho`.
- **O parágrafo depois da tabela é a única parte subjetiva do relatório inteiro** — e ele é sobre fricção observável ("voltei duas vezes porque o preço só aparece no passo 3"), nunca sobre gosto ("achei feio").
- Se a sessão morreu no meio, a jornada termina onde morreu e isso vira linha em **Não testei**.

## Publicar

**O Artifact é a entrega.** Uma revisão cuja evidência mora no `%TEMP%` de uma máquina não chega em quem tem que corrigir o bug. Publique, a menos que o usuário diga pra não publicar.

1. Rode `runtime/bundle.mjs` primeiro. Sem `bundle.json` não há imagem pra colocar na página.
2. Carregue a skill `artifact-design` **antes** de escrever o arquivo.
3. Escreva o relatório em HTML num arquivo: jornada como timeline, achados pior-primeiro, **cada achado com o próprio screenshot inline**.
4. A imagem vem de `shots[<step>].dataUri` — cole em `<img src="...">` direto. Um Artifact **não alcança o disco do usuário**: citar `shots/004-click.png` numa página compartilhada não mostra nada pra quem abrir o link.
5. `Artifact` com o caminho, título curto (ex.: "Revisão da Loja"), `favicon` `👁️`, descrição de uma linha, e **sem `capabilities`** — a página é estática e as imagens já estão dentro dela.
6. Leia `notes[]` do bundle e diga no fim da resposta o que ficou fora: screenshot descartado por orçamento, e o vídeo, que é local e não viaja.

> Sobre `upload_asset` / capability `assets`: existe, é mais leve pra evidência grande, mas **não está liberada em toda conta**. `data:` URI funciona sempre. Só use `assets` se a `artifact-capabilities` listar ela pra você — e declare a capability no primeiro publish, porque anexar depois obriga redeploy.

O relatório no terminal continua saindo. Quem está lendo agora não deveria precisar abrir um link pra saber o veredito.
