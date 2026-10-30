// Regras do model-super-power: lógica pura, sem `$`, para os testes lerem direto.

// Tipo de subagente -> modelo em que ele arranca. Busca vai para o Haiku, trabalho geral
// para o Sonnet; Plan e o resto ficam no modelo do chat principal. Edite aqui para mudar o roteamento.
export const ROTEAMENTO: Readonly<Record<string, string>> = {
  Explore: 'haiku',
  'general-purpose': 'sonnet',
}

// A orquestra: os agentes de agents/*.md, com o mesmo modelo que lá está. Serve para a lista
// das contas mostrar todos os músicos, mesmo os que ainda não tocaram.
export const ORQUESTRA: ReadonlyArray<{ papel: string; modelo: string }> = [
  { papel: 'batedor', modelo: 'claude-haiku-5-5' },
  { papel: 'executor', modelo: 'claude-sonnet-5-5' },
  { papel: 'segunda-opiniao', modelo: 'claude-sonnet-4-6' },
  { papel: 'revisor', modelo: 'claude-opus-5-5' },
  { papel: 'arquiteto', modelo: 'claude-fable-5-1' },
]

// Esforço dos subagentes que este mod pôs em Haiku (os do Sonnet ficam com o esforço que vier).
export const ESFORCO_DELEGADO = 'low' as const

// Pastas e arquivos que nenhum subagente pode tocar. Cada regra tem um nome para a
// mensagem de recusa. Conservador de propósito: na dúvida, recusa.
// Inclui os caracteres de glob e de chaves (* ? [ ] { } ,) para `**/{.env,x}` ou `*.env*` não passarem.
const LIMITE = `(?:^|[\\s/'"=:;|&(<>~*?{},\\[\\]\`])`
const FIM = `(?:$|[\\s/'"=:;|&)<>*?{},\\[\\]\`])`

export type Regra = { nome: string; regex: RegExp }

export const PROTEGIDOS: ReadonlyArray<Regra> = [
  // `.env`, `.env.local`, e também `producao.env` / `claude-shared.env` (mas não `process.env` nem `import.meta.env`).
  { nome: '.env (chaves)', regex: new RegExp(`${LIMITE}(?:(?!process\\.env|meta\\.env)[\\w-]+\\.env|\\.env(?:\\.[\\w.-]+)?)${FIM}`) },
  { nome: '.envrc (chaves)', regex: new RegExp(`${LIMITE}\\.envrc${FIM}`) },
  { nome: 'keys.env (chaves)', regex: /keys\.env\b/ },
  { nome: 'secrets/ (chaves)', regex: new RegExp(`${LIMITE}\\.?secrets${FIM}`) },
  { nome: 'credenciais do Claude Code', regex: /\.credentials\.json/ },
  {
    nome: 'arquivo de credenciais',
    regex: new RegExp(`${LIMITE}(?:\\.git-credentials|\\.npmrc|\\.pypirc|\\.pgpass|\\.gnupg|\\.kube|\\.docker/config\\.json|gh/hosts\\.yml)${FIM}`),
  },
  // Chaves também vivem no ambiente do shell: `printenv`, `env` sozinho, `echo $VERCEL_TOKEN`.
  { nome: 'variáveis de ambiente (chaves)', regex: /\bprintenv\b|\/proc\/[\w-]+\/environ\b|\bexport\s+-p\b|\bdeclare\s+-[px]\b|\bcompgen\s+-e\b/ },
  { nome: 'variáveis de ambiente (chaves)', regex: /(?:^|[;&|(]\s*)env\s*(?:$|[;&|)>])/ },
  { nome: 'variáveis de ambiente (chaves)', regex: /\$\{?[A-Za-z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIALS?)\b/ },
  { nome: '~/.ssh (chaves SSH)', regex: new RegExp(`${LIMITE}\\.ssh${FIM}`) },
  { nome: 'chave SSH privada', regex: /\bid_(?:rsa|ed25519|ecdsa|dsa)\b/ },
  { nome: 'arquivo .pem (chave)', regex: /\.pem\b/ },
  { nome: '~/.aws/credentials (chaves)', regex: /\.aws\/credentials\b/ },
  { nome: '.netrc (senhas)', regex: new RegExp(`${LIMITE}\\.netrc${FIM}`) },
]

// Pastas extra de quem instala, vindas da opção pastasProtegidas ("financas, ~/.vault, /etc/segredos").
export function regrasExtra(lista: string): Regra[] {
  return lista
    .split(',')
    .map(e => e.trim().replace(/^~\//, '').replace(/\/+$/, ''))
    .filter(e => e.length > 0)
    .map(e => ({
      nome: `${e} (protegida por você)`,
      regex: new RegExp(`${LIMITE}${e.replace(/^\//, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${FIM}`),
    }))
}

// Campos de cada ferramenta que levam caminho (ou comando, no Bash).
const CAMPOS: Readonly<Record<string, readonly string[]>> = {
  Read: ['file_path'],
  Edit: ['file_path'],
  Write: ['file_path'],
  NotebookEdit: ['notebook_path'],
  Glob: ['path', 'pattern'],
  Grep: ['path', 'glob'],
  Bash: ['command'],
}

export const FERRAMENTAS_VIGIADAS = Object.keys(CAMPOS)

// Os textos de uma chamada que a guarda olha.
export function textosDaChamada(tool: string, input: Readonly<Record<string, unknown>>): string[] {
  return (CAMPOS[tool] ?? [])
    .map(campo => input[campo])
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
}

// Devolve o nome da regra violada, ou undefined se os textos estão limpos.
export function protegidoEm(textos: readonly string[], regras: ReadonlyArray<Regra> = PROTEGIDOS): string | undefined {
  for (const texto of textos) {
    const achou = regras.find(p => p.regex.test(texto))
    if (achou !== undefined) return achou.nome
  }
  return undefined
}

export function mensagemDeRecusa(nome: string): string {
  return (
    `model-super-power: subagentes não podem tocar em ${nome}. ` +
    'Se for mesmo preciso, devolva a tarefa ao agente principal.'
  )
}

// O que decide o modelo de um subagente. Undefined = não mexer.
export type Pedido = {
  subagentType: string
  model?: string
  fork: boolean
  isTeammate?: true
  workflow?: unknown
  resume?: unknown
}

export function modeloPara(p: Pedido): string | undefined {
  if (p.fork || p.isTeammate || p.workflow !== undefined || p.resume !== undefined) return undefined
  if (p.model !== undefined) return undefined // quem chamou escolheu: respeitar
  return Object.hasOwn(ROTEAMENTO, p.subagentType) ? ROTEAMENTO[p.subagentType] : undefined
}

// Contas de tokens, por modelo (Opus, Sonnet, Haiku, Fable...). "novo" é o que o modelo
// leu ou escreveu pela primeira vez; "releitura" é o histórico relido do cache, bem mais barato.
// "entrada", "saida", "escrita" (cache de 5 min) e "escrita1h" (cache de 1 hora) separam o "novo" para o cálculo de custo; dados
// gravados antes da 1.1.0 não os têm.
export type Linha = {
  novo: number
  releitura: number
  pedidos: number
  entrada?: number
  saida?: number
  escrita?: number
  escrita1h?: number
}
export type Contas = {
  delegados: number
  modelos: Readonly<Record<string, Linha>>
  // Leituras diretas (Read, Grep, Glob, cat, grep...) feitas na conversa principal.
  leituras?: number
}

export const CONTAS_VAZIAS: Contas = { delegados: 0, modelos: {} }

export type Uso = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

// Nome curto do modelo, com a versão quando o id a traz ("claude-opus-5-5" -> "Opus 5.5",
// "haiku" -> "Haiku"). Uma data no fim do id ("-20251001") não conta como versão.
export function familia(modelo: string | undefined): string {
  const m = (modelo ?? '').toLowerCase()
  const achou = /(opus|sonnet|haiku|fable)(?:-(\d{1,2})(?:-(\d{1,2}))?(?!\d))?/.exec(m)
  if (achou === null) return modelo !== undefined && modelo !== '' ? modelo : 'Desconhecido'
  const [, nome = '', maior, menor] = achou
  const versao = maior === undefined ? '' : ` ${maior}${menor === undefined ? '' : `.${menor}`}`
  return nome.charAt(0).toUpperCase() + nome.slice(1) + versao
}

// "Opus 5.5" e "Opus" são o mesmo modelo para efeitos de papel e de lista.
export function mesmoModelo(a: string, b: string): boolean {
  return a.split(' ')[0] === b.split(' ')[0]
}

// Contas gravadas no formato antigo (sem "modelos") recomeçam do zero.
export function completas(c: Partial<Contas> | undefined): Contas {
  return c !== undefined && c.modelos !== undefined ? { ...CONTAS_VAZIAS, ...c } as Contas : CONTAS_VAZIAS
}

// Na conversa principal a escrita de cache é de 1 hora; nos subagentes, de 5 minutos.
export function somar(c: Contas, nome: string, u: Uso, principal = false): Contas {
  const l = c.modelos[nome] ?? { novo: 0, releitura: 0, pedidos: 0 }
  const linha: Linha = {
    novo: l.novo + u.input_tokens + u.output_tokens + u.cache_creation_input_tokens,
    releitura: l.releitura + u.cache_read_input_tokens,
    pedidos: l.pedidos + 1,
    entrada: (l.entrada ?? 0) + u.input_tokens,
    saida: (l.saida ?? 0) + u.output_tokens,
    escrita: (l.escrita ?? 0) + (principal ? 0 : u.cache_creation_input_tokens),
    escrita1h: (l.escrita1h ?? 0) + (principal ? u.cache_creation_input_tokens : 0),
  }
  return { ...c, modelos: { ...c.modelos, [nome]: linha } }
}

// Linhas por modelo, do que gastou mais para o que gastou menos. Os modelos da orquestra
// aparecem sempre, mesmo a zero, para se ver que existiam e não foram chamados.
export function porModelo(c: Contas): Array<{ nome: string; total: number; pct: number; linha: Linha }> {
  const usados = Object.keys(c.modelos)
  const daOrquestra = ORQUESTRA.map(o => familia(o.modelo)).filter(n => !usados.includes(n))
  const nomes = new Set([...usados, ...daOrquestra])
  const vazia: Linha = { novo: 0, releitura: 0, pedidos: 0 }
  const lista = [...nomes].map(nome => {
    const linha = c.modelos[nome] ?? vazia
    return { nome, linha, total: linha.novo + linha.releitura, pct: 0 }
  })
  const soma = lista.reduce((t, x) => t + x.total, 0)
  return lista
    .map(x => ({ ...x, pct: soma === 0 ? 0 : Math.round((x.total / soma) * 100) }))
    .sort((a, b) => b.total - a.total)
}

export function compacto(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

// Chave da semana no $.store (segunda-feira da semana, em UTC).
export function chaveDaSemana(ms: number): string {
  const d = new Date(ms)
  const dia = (d.getUTCDay() + 6) % 7
  const segunda = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dia))
  return `semana:${segunda.toISOString().slice(0, 10)}`
}

// Modelo com que um subagente vai arrancar, antes de arrancar: o da tabela, o da orquestra,
// o que quem chamou pediu, ou o da conversa. Serve só para mostrar na linha da tarefa.
export function modeloPrevisto(p: Pedido & { parentModel: string }, roteado: string | undefined): string {
  const daOrquestra = ORQUESTRA.find(o => `model-super-power:${o.papel}` === p.subagentType)?.modelo
  return roteado ?? p.model ?? daOrquestra ?? p.parentModel
}

// Põe o modelo à frente da descrição da tarefa ("Sonnet 4.6 · Segunda opinião sobre...").
export function comModelo(descricao: string, modelo: string): string {
  const nome = familia(modelo)
  return descricao.startsWith(`${nome} · `) ? descricao : `${nome} · ${descricao}`
}

// ---- Maestro obrigatório (1.1.0) ----

// aviso = lembra a cada passo; forte = além disso recusa a leitura direta a partir da 6ª; desligado = nada.
export type Modo = 'aviso' | 'forte' | 'desligado'

export const AVISO_LEITURAS = 3
export const TRAVA_LEITURAS = 6
export const AVISO_PASSOS = 10

// Seção do system prompt que faz da conversa principal o maestro.
export const TEXTO_MAESTRO = [
  'Você é o maestro. Esta conversa é o modelo caro e relê todo o contexto a cada passo.',
  'Delegue:',
  '- Ler ou procurar em mais de 2 arquivos, logs, sessões ou docs: model-super-power:batedor ou Explore, pedindo só a conclusão.',
  '- Trabalho já decidido com vários passos (código, scripts, comandos, ssh, renders): model-super-power:executor.',
  '- Antes de ir para produção: model-super-power:revisor. Texto ou plano importante: model-super-power:segunda-opiniao.',
  '- Decisão cara de errar: model-super-power:arquiteto, raramente.',
  'Não delegue:',
  '- Um arquivo, uma busca, um comando, uma edição pequena: faça aqui.',
  '- Quando explicar custaria mais do que fazer. O subagente não vê esta conversa; o pedido a ele tem de caber em poucas linhas.',
  'Evite fork: herda o modelo caro e o contexto todo. O batedor não tem Bash. Decidir, coordenar e falar com o usuário ficam aqui.',
].join('\n')

// O maestro só vale quando a conversa principal roda num modelo caro (Opus ou Fable).
export function modeloCaro(modelo: string | undefined): boolean {
  const nome = familia(modelo)
  return nome.startsWith('Opus') || nome.startsWith('Fable')
}

// Comando que só lê ou procura, por ferramenta ou por Bash (após um `cd X &&` opcional).
const BASH_DE_LEITURA = /^\s*(?:cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*&&\s*)?(?:cat|sed|head|tail|grep|rg|find|ls|wc|jq|awk)(?=\s|$)/

// Escrita, edição no lugar ou encadeamento (depois do `cd X &&` opcional) deixam de ser leitura.
// `2>/dev/null` e `2>&1` são redirecionamentos de erro e não contam como escrita. O pipe continua a contar.
export function leituraDireta(tool: string, input: Readonly<Record<string, unknown>>): boolean {
  if (tool === 'Read' || tool === 'Grep' || tool === 'Glob') return true
  if (tool !== 'Bash' || typeof input.command !== 'string' || !BASH_DE_LEITURA.test(input.command)) return false
  const resto = input.command
    .replace(/^\s*cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*&&\s*/, '')
    .replace(/\d?>\s*\/dev\/null|\d>&\d/g, '')
  return !/>|<<|\bsed\s+(?:-\S+\s+)*-[A-Za-z]*i|-delete\b|-exec\b|&&|;|\|\|/.test(resto)
}

export function avisoLeituras(n: number): string {
  return (
    `model-super-power: ${n} leituras diretas seguidas nesta conversa, que é o modelo mais caro. ` +
    'Passe a busca ou a leitura ao model-super-power:batedor (ou Explore) e peça só a conclusão.'
  )
}

export function avisoPassos(n: number): string {
  return (
    `model-super-power: ${n} passos sem delegar. ` +
    'Trabalho decidido vai para o model-super-power:executor, busca para o model-super-power:batedor.'
  )
}

export function recusaLeitura(n: number): string {
  return (
    `model-super-power: ${n} leituras diretas sem delegar, leitura recusada. ` +
    'Chame o model-super-power:batedor (ou Explore) para ler ou procurar e peça só a conclusão. Depois disso a conversa volta a poder ler.'
  )
}

// Preços em US$ por milhão de tokens. Fonte: página oficial de preços da Anthropic, 30/10/2026.
// Escrita de cache de 5 minutos (subagentes) e de 1 hora (conversa principal, 2x a entrada). Modelo que não está aqui não entra na soma.
const PRECOS: Readonly<Record<string, { entrada: number; escrita: number; escrita1h: number; leitura: number; saida: number }>> = {
  'Fable 5.1': { entrada: 10, escrita: 12.5, escrita1h: 20, leitura: 0.25, saida: 50 },
  'Opus 5.5': { entrada: 4, escrita: 5, escrita1h: 8, leitura: 0.2, saida: 20 },
  'Sonnet 5.5': { entrada: 2, escrita: 2.5, escrita1h: 4, leitura: 0.1, saida: 10 },
  'Sonnet 4.6': { entrada: 3, escrita: 3.75, escrita1h: 6, leitura: 0.3, saida: 15 },
  'Haiku 5.5': { entrada: 0.1, escrita: 0.125, escrita1h: 0.2, leitura: 0.01, saida: 0.5 },
}

// Estimativa do que as contas custariam a preço de API (não é o que você paga na assinatura).
export function custoUsd(c: Contas): number {
  let total = 0
  for (const [nome, l] of Object.entries(c.modelos)) {
    const p = PRECOS[nome]
    if (p === undefined) continue
    total +=
      ((l.entrada ?? 0) * p.entrada + (l.escrita ?? 0) * p.escrita + (l.escrita1h ?? 0) * p.escrita1h + l.releitura * p.leitura + (l.saida ?? 0) * p.saida) /
      1_000_000
  }
  return total
}

// "US$ 1,23" (vírgula decimal, como no resto dos textos).
export function usd(n: number): string {
  return `US$ ${n.toFixed(2).replace('.', ',')}`
}

export function maisUmaLeitura(c: Contas): Contas {
  return { ...c, leituras: (c.leituras ?? 0) + 1 }
}
