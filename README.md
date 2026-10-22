# ⚓ model-super-power

**Um maestro para o Claude Code.** Cada tarefa vai para o modelo certo, e você vê quanto cada um trabalhou.

O Claude Code usa o mesmo modelo caro para tudo, até para procurar um arquivo. É como pôr o camisa 10 para carregar a bolsa de bola. Este mod dá ao Claude Code uma orquestra. A conversa principal continua com o seu modelo de sempre e faz o papel de maestro. Quando há trabalho para delegar, ela chama o músico certo, cada um com o seu modelo.

> Projeto independente. Não tem ligação à Anthropic nem ao `obra/superpowers`.

[English below](#english)

## A orquestra

| Músico | Modelo | Quando o maestro chama |
|---|---|---|
| `batedor` | Haiku 5.5 | Procurar e ler rápido. Achar arquivos, ler logs, juntar trechos. |
| `executor` | Sonnet 5.5 | Fazer o que já foi decidido. Código, arquivos, testes. |
| `segunda-opiniao` | Sonnet 4.6 | Um olhar de outro modelo, sem os mesmos pontos cegos. |
| `revisor` | Opus 5.5 | Revisão crítica antes de entregar. Bugs, riscos, segurança. |
| `arquiteto` | Fable 5.1 | Decisões difíceis em que errar custa caro. O mais caro, por isso a descrição pede para usar pouco. |

Além da orquestra, os subagentes que o próprio Claude Code cria também são roteados.

| Tipo de subagente | Vai para |
|---|---|
| `Explore` (buscas) | Haiku, com esforço baixo |
| `general-purpose` (trabalho geral) | Sonnet |
| Qualquer outro | O modelo da conversa |

**A conversa principal nunca é alterada.** Trocar o modelo no meio da conversa obriga a reler todo o histórico sem cache, e isso sai mais caro do que poupa. A poupança está nos subagentes, que começam com o contexto limpo.

## Um teste real

Um único pedido (encontrar um bug, decidir a correção, escrever o patch, pedir segunda opinião e rever) colocou os cinco músicos para tocar. Isto é o que o `/super-power` mostrou.

```
Esta sessão · 6 tarefas delegadas
  Opus 5.5      3.7M   62%  revisor + conversa principal  (novo 131k, releitura do cache 3.6M)
  Sonnet 5.5    1.7M   29%  executor  (novo 180k, releitura do cache 1.5M)
  Sonnet 4.6    221k    4%  segunda-opiniao  (novo 48k, releitura do cache 173k)
  Haiku 5.5     176k    3%  batedor  (novo 52k, releitura do cache 125k)
  Fable 5.1     140k    2%  arquiteto  (novo 56k, releitura do cache 84k)
```

Olhe para a coluna **novo**. É o trabalho de verdade. A **releitura do cache** é o modelo relendo a conversa, e custa uma fração do preço normal. Neste teste, quem fez mais trabalho novo foi o Sonnet 5.5 (180k), não o Opus (131k). O modelo caro coordenou e o pesado ficou com os mais baratos.

## Pastas fechadas aos subagentes

Nenhum subagente pode ler, procurar ou mexer em `.env*` (e `*.env`, `.envrc`), `keys.env`, `secrets/` e `.secrets/`, as credenciais do próprio Claude Code (`.credentials.json`), `~/.ssh`, chaves SSH privadas, arquivos `.pem`, `~/.aws/credentials`, `.netrc`, `.git-credentials`, `.npmrc`, `.pypirc`, `.pgpass`, `~/.gnupg`, `~/.kube`, `~/.docker/config.json` e `gh/hosts.yml`. No Bash, também ficam fechados os comandos que despejam o ambiente (`printenv`, `env` sozinho, `/proc/*/environ`) e as variáveis com `TOKEN`, `KEY`, `SECRET` ou `PASSWORD` no nome. A recusa explica o motivo e manda devolver a tarefa ao maestro. A conversa principal não é travada, porque às vezes precisa mesmo desses arquivos e você está vendo.

Para fechar mais pastas, use a opção `pastasProtegidas` (lista separada por vírgulas), por exemplo `financas, ~/.vault, /etc/segredos`. No Claude Code ela aparece em `/config`. Num plugin carregado com `--plugin-dir`, ponha em `~/.claude/settings.json`.

```json
{
  "pluginConfigs": {
    "model-super-power": { "options": { "pastasProtegidas": "financas, ~/.vault" } }
  }
}
```

Num comando de terminal a guarda procura o caminho escrito por extenso. Um caminho guardado numa variável ou disfarçado com glob (`cat .en?`) passa. É uma rede de segurança, não um cofre.

O `batedor` não tem Bash. É o modelo mais barato e o que mais lê conteúdo de fora (logs, páginas, arquivos de terceiros), por isso é o mais exposto a injeção de instruções; com Read, Grep e Glob ele procura e lê tudo o que precisa.

## O comando `/super-power`

| Comando | O que faz |
|---|---|
| `/super-power` | Estado e contas da sessão e da semana, por modelo |
| `/super-power off` / `on` | Desliga ou liga o roteamento |
| `/super-power regras` | Mostra o roteamento e as pastas fechadas |
| `/super-power zerar` | Zera as contas |
| `/super-power mostrar` | Volta a mostrar a barra ⚓ escondida |

A barra acima do prompt resume tudo numa linha, por exemplo `⚓ Opus 5.5 62% · Sonnet 5.5 29% · Sonnet 4.6 4% · Haiku 5.5 3% · Fable 5.1 2% · 6 delegadas`.

## Instalar

No prompt do Claude Code, no terminal.

```
/plugin install model-super-power --marketplace johnnyhelder/claude-model-super-power
```

Responda `y` para adicionar o marketplace e escolha o escopo (o de usuário vem primeiro).

Pelo shell.

```
claude plugin install model-super-power --marketplace johnnyhelder/claude-model-super-power
```

No app de desktop, clique no + ao lado da caixa do prompt, depois Plugins, Add marketplace com `johnnyhelder/claude-model-super-power` e Add plugin.

Para testar sem instalar, clone o repositório e abra o Claude Code com `claude --plugin-dir caminho/para/claude-model-super-power`. O mod só fica ativo nessa sessão.

## O que ele não faz

- Não usa a rede, não tem telemetria e não se atualiza sozinho. A versão só muda quando você atualiza.
- Não mexe na compactação nem no `/clear`, e não reescreve nada da sua sessão.
- Não troca o modelo da conversa principal.

## Requisitos

- Claude Code com suporte a mods (testado na versão 2.1.302).
- Os modelos da orquestra disponíveis no seu plano. Se um modelo não estiver disponível, edite o `model` do agente correspondente em `agents/`.
- O Fable é o mais caro. Se não quiser arriscar, apague `agents/arquiteto.md`.

## Créditos

A ideia nasceu do [effortless](https://github.com/HeyCubit/effortless) (MIT), que escolhe o nível de esforço a cada prompt. Nenhum código foi copiado. O caminho aqui é outro: o modelo da conversa fica intacto e quem muda de modelo são os subagentes.

Feito por [Johnny Helder](https://www.johnnyhelder.com). Licença MIT.

---

## English

**A conductor for Claude Code.** Every task goes to the right model, and you see how much each one worked.

Claude Code uses the same expensive model for everything, even to find a file. This mod gives it an orchestra. Your main conversation keeps its model and acts as the conductor. When there is work to delegate, it calls the right musician, each running its own model.

> Independent project. Not affiliated with Anthropic or with `obra/superpowers`.

**The orchestra.** `batedor` (scout, Haiku 5.5) searches and reads fast. `executor` (Sonnet 5.5) does work that is already decided. `segunda-opiniao` (second opinion, Sonnet 4.6) gives an independent look from a different model. `revisor` (reviewer, Opus 5.5) does the critical review before delivery. `arquiteto` (architect, Fable 5.1) handles hard decisions where mistakes are expensive, and its description asks the conductor to use it sparingly. Claude Code's own subagents are routed too. `Explore` goes to Haiku with low effort, `general-purpose` goes to Sonnet, everything else stays on the conversation's model.

**The main conversation is never changed.** Switching models mid conversation means rereading the whole history without cache, which costs more than it saves. The savings live in subagents, which start with a clean context.

**A real test.** One request (find a bug, choose the fix, write the patch, get a second opinion, review) made all five musicians play. Opus 5.5 did 131k new tokens as conductor and reviewer, Sonnet 5.5 did 180k as executor, Sonnet 4.6 did 48k, Haiku 5.5 did 52k and Fable 5.1 did 56k. "New" is real work. "Cache reread" is the model rereading the conversation, at a fraction of the normal price.

**Folders closed to subagents.** `.env*` (plus `*.env` and `.envrc`), `keys.env`, `secrets/` and `.secrets/`, Claude Code's own `.credentials.json`, `~/.ssh`, private SSH keys, `.pem` files, `~/.aws/credentials`, `.netrc`, `.git-credentials`, `.npmrc`, `.pypirc`, `.pgpass`, `~/.gnupg`, `~/.kube`, `~/.docker/config.json` and `gh/hosts.yml`. In the shell, commands that dump the environment (`printenv`, bare `env`, `/proc/*/environ`) and variables named with `TOKEN`, `KEY`, `SECRET` or `PASSWORD` are closed too. Add your own with the `pastasProtegidas` option (comma separated), shown in `/config` or set under `pluginConfigs` in `~/.claude/settings.json` for a `--plugin-dir` plugin. In shell commands the guard matches paths written out in full (a path in a variable or a glob like `cat .en?` gets through), so it is a safety net, not a vault. The `batedor` has no Bash: it is the cheapest model and reads the most outside content, so it is the most exposed to prompt injection.

**Commands.** `/super-power` shows status and per model usage for the session and the week. `on` / `off` toggles routing, `regras` lists the rules, `zerar` resets the counters, `mostrar` brings back the ⚓ bar.

**Install.** At the Claude Code prompt, run `/plugin install model-super-power --marketplace johnnyhelder/claude-model-super-power`, answer `y` and pick a scope. From a shell, run `claude plugin install model-super-power --marketplace johnnyhelder/claude-model-super-power`. To try it without installing, clone the repo and start `claude --plugin-dir path/to/claude-model-super-power`.

**What it does not do.** No network, no telemetry, no self updates. It does not touch compaction or `/clear`, and it never changes the main conversation's model.

**Requirements.** Claude Code with mods support (tested on 2.1.302) and the orchestra's models available on your plan. Edit the `model` in `agents/` if one is not, or delete `agents/arquiteto.md` to skip Fable.

**Credits.** Inspired by [effortless](https://github.com/HeyCubit/effortless) (MIT), which picks the effort level per prompt. No code was copied. MIT license, by [Johnny Helder](https://www.johnnyhelder.com).
