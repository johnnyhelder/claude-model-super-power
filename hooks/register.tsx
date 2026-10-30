import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Contas, Delegado } from '../types'
import {
  AVISO_LEITURAS,
  AVISO_PASSOS,
  CONTAS_VAZIAS,
  ESFORCO_DELEGADO,
  FERRAMENTAS_VIGIADAS,
  ORQUESTRA,
  PROTEGIDOS,
  ROTEAMENTO,
  TEXTO_MAESTRO,
  TRAVA_LEITURAS,
  avisoLeituras,
  avisoPassos,
  chaveDaSemana,
  comModelo,
  compacto,
  completas,
  custoUsd,
  familia,
  leituraDireta,
  maisUmaLeitura,
  mensagemDeRecusa,
  modeloCaro,
  modeloPara,
  modeloPrevisto,
  porModelo,
  protegidoEm,
  recusaLeitura,
  regrasExtra,
  somar,
  textosDaChamada,
  usd,
} from './regras'
import type { Modo } from './regras'

const PLUGIN = 'model-super-power'

const contas = atom({ plugin: 'model-super-power', key: 'contas' } as const, CONTAS_VAZIAS)
const delegados = atom({ plugin: 'model-super-power', key: 'delegados' } as const, [] as readonly Delegado[])
const oculto = atom({ plugin: 'model-super-power', key: 'oculto' } as const, false)

// Ligado por defeito; /super-power off desliga em todas as sessões.
async function estaLigado($: EngineInterface): Promise<boolean> {
  return (await $.store.get('ligado')) !== false
}

// O $.store não tem escrita atómica: subagentes em paralelo que acabam juntos liam o mesmo
// valor e um apagava a soma do outro. Uma fila por processo faz as escritas uma de cada vez.
let filaDaSemana: Promise<void> = Promise.resolve()

function somarSemana($: EngineInterface, fn: (c: Contas) => Contas): Promise<void> {
  const vez = filaDaSemana.then(async () => {
    const chave = chaveDaSemana(await $.clock.now())
    const atual = completas((await $.store.get(chave)) as Contas | undefined)
    await $.store.set(chave, fn(atual))
  })
  filaDaSemana = vez.catch(() => undefined)
  return vez
}

// Maestro obrigatório: só vale em sessão com gente no prompt. `leituras` e `passos` contam o que a
// conversa principal fez desde o último prompt do usuário ou desde a última delegação.
let interativa = false
let leituras = 0
let passos = 0
// Se a sessão tem a ferramenta Agent (undefined até o prompt.compose correr) e as leituras
// ainda não gravadas na semana (a soma vai de uma vez no fim do turno da conversa principal).
let temAgent: boolean | undefined
let leiturasSemana = 0

const MODOS: readonly Modo[] = ['aviso', 'forte', 'desligado']

// /super-power modo ganha da opção maestro; /super-power off desliga tudo.
async function modoEfetivo($: EngineInterface, opcao: unknown): Promise<Modo> {
  if (!(await estaLigado($))) return 'desligado'
  const m = (await $.store.get('modo')) ?? opcao ?? 'aviso'
  return MODOS.find(x => x === m) ?? 'aviso'
}

// Modelo do último pedido de cada loop ("principal" = a conversa), lido em turn.step.
const modeloDoLoop = new Map<string, string>()

// Papéis que cada modelo já fez nesta sessão (o mesmo modelo pode ser conversa e revisor).
const papeisDoModelo = new Map<string, Set<string>>()

function nomeDoPapel(subagentType: string): string {
  if (subagentType === 'Explore') return 'buscas'
  if (subagentType === 'general-purpose') return 'trabalho geral'
  return subagentType.replace(/^model-super-power:/, '')
}

function papel(nome: string): string {
  const papeis = new Set(papeisDoModelo.get(nome))
  const conversa = modeloDoLoop.get('principal')
  if (conversa !== undefined && familia(conversa) === nome) papeis.add('conversa principal')
  if (papeis.size === 0) {
    const daOrquestra = ORQUESTRA.find(o => familia(o.modelo) === nome)
    return daOrquestra !== undefined ? `${daOrquestra.papel} (ainda não tocou)` : 'outros'
  }
  return [...papeis].join(' + ')
}

function blocoDeContas(titulo: string, c: Contas): string[] {
  const linhas = porModelo(c).map(
    x =>
      `  ${x.nome.padEnd(11)} ${compacto(x.total).padStart(5)}  ${String(x.pct).padStart(3)}%  ${papel(x.nome)}` +
      (x.total > 0 ? `  (novo ${compacto(x.linha.novo)}, releitura do cache ${compacto(x.linha.releitura)})` : ''),
  )
  return [
    `${titulo} · ${c.delegados} tarefas delegadas`,
    ...linhas,
    `  A preço de API: ${usd(custoUsd(c))}`,
    `  Leituras diretas: ${c.leituras ?? 0}`,
  ]
}

export const register: Register = (on, options) => {
  // Lista genérica mais as pastas que quem instalou pôs em pastasProtegidas.
  const regras = [...PROTEGIDOS, ...regrasExtra(String(options.pastasProtegidas ?? ''))]

  // 1. Roteador: cada tipo de subagente da tabela arranca no seu modelo (Haiku, Sonnet).
  // Todo subagente que arranca (da tabela, da orquestra ou outro) entra nas contas com o seu papel.
  on('agent.spawn', async ($, e, next) => {
    const modelo = (await estaLigado($)) ? modeloPara(e) : undefined
    const description = comModelo(e.description, modeloPrevisto(e, modelo))
    const r = await next(modelo === undefined ? { ...e, description } : { ...e, model: modelo, description })
    const id = r.deny === undefined ? r.agentId : undefined
    if (id !== undefined) {
      try {
        const resolvido = r.model ?? modelo ?? e.parentModel
        const nome = familia(resolvido)
        papeisDoModelo.set(nome, new Set([...(papeisDoModelo.get(nome) ?? []), nomeDoPapel(e.subagentType)]))
        await update($, delegados, lista => [...lista, { id, modelo: resolvido }].slice(-200))
        await update($, contas, c => ({ ...completas(c), delegados: completas(c).delegados + 1 }))
        await somarSemana($, c => ({ ...c, delegados: c.delegados + 1 }))
      } catch {
        // as contas nunca impedem um subagente de trabalhar
      }
    }
    return r
  }).catch(($, e, next) => (next.called ? Promise.reject(new Error('agent.spawn')) : next(e))) // se o roteador falhar antes, o subagente arranca como pedido

  // 2. Esforço baixo só nos pedidos dos subagentes delegados ao Haiku. O chat principal
  // (sem agentId) passa sempre como veio.
  on('turn.step', async function* ($, e, next) {
    modeloDoLoop.set(e.agentId ?? 'principal', e.model)
    const ehDelegado =
      e.agentId !== undefined &&
      e.effort !== undefined &&
      (await read($, delegados)).some(d => d.id === e.agentId && familia(d.modelo).startsWith('Haiku'))
    return yield* next(ehDelegado ? { ...e, effort: ESFORCO_DELEGADO } : e)
  })

  // 2b. Maestro obrigatório: a seção entra no system prompt de sessões interativas (não em -p,
  // bare, teammates nem análises de contexto). Nunca quebra o prompt: em erro, segue como veio.
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    const fora = ['print', 'bare', 'teammate', 'analysis'].some(t => e.traits.some(x => x === t))
    if (!fora) temAgent = e.tools.includes('Agent')
    if (fora || !interativa || !e.tools.includes('Agent') || !modeloCaro(e.model) || (await modoEfetivo($, options.maestro)) === 'desligado') return r
    return { sections: [...r.sections, { id: 'model-super-power:maestro', text: TEXTO_MAESTRO, scope: 'session' as const }] }
  }).catch(($, e, next) => next(e))

  // Um prompt real do usuário recomeça a contagem do maestro (não as mensagens internas nem os comandos).
  on('prompt.submit', ($, e, next) => {
    if (['composer', 'bridge', 'scheduled-trigger'].includes(e.origin.kind)) {
      leituras = 0
      passos = 0
    }
    return next(e)
  })

  // 3. Guarda de caminhos, só dentro de subagentes. Na conversa principal, o maestro obrigatório.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Readonly<Record<string, unknown>>

    if (e.agentId === undefined) {
      // Tudo até `n` é síncrono: chamadas em paralelo chegam aqui em ordem, antes de qualquer await.
      const modelo = modeloDoLoop.get('principal')
      if (!interativa || temAgent === false || !modeloCaro(modelo)) return next(e)
      if (tool === 'Agent') {
        leituras = 0
        passos = 0
        return next(e)
      }
      passos++
      const conta = leituraDireta(tool, input) && protegidoEm(textosDaChamada(tool, input), regras) === undefined
      const n = conta ? ++leituras : leituras
      const modo = await modoEfetivo($, options.maestro)
      if (modo === 'desligado') return next(e)
      if (conta && n >= TRAVA_LEITURAS && modo === 'forte') return { deny: recusaLeitura(n) }
      if (conta) {
        leiturasSemana++
        await update($, contas, c => maisUmaLeitura(completas(c)))
      }
      const r = await next(e)
      if (r.deny !== undefined) return r
      const aviso = conta && n >= AVISO_LEITURAS ? avisoLeituras(n) : passos % AVISO_PASSOS === 0 ? avisoPassos(passos) : undefined
      return aviso === undefined ? r : { ...r, context: [...(r.context ?? []), aviso] }
    }
    if (!FERRAMENTAS_VIGIADAS.includes(tool)) return next(e)

    let nome = protegidoEm(textosDaChamada(tool, input), regras)

    // Um atalho (symlink) pode esconder uma pasta protegida: olhar também o caminho real.
    const caminho = input.file_path ?? input.notebook_path
    if (nome === undefined && typeof caminho === 'string') {
      const real = (await $.fs.stat(caminho, { resolve: true }).catch(() => undefined))?.realPath
      if (real !== undefined) nome = protegidoEm([real], regras)
    }

    return nome === undefined ? next(e) : { deny: mensagemDeRecusa(nome) }
  }).catch(($, e, next) =>
    // O mod nunca trava a conversa principal por erro próprio; nos subagentes, na dúvida, recusa.
    next.called || e.agentId === undefined
      ? next(e)
      : { deny: `${PLUGIN}: a guarda de caminhos falhou, chamada recusada por segurança.` },
  )

  // 4. Contas por modelo: o que correu em cada pedido (conversa e subagentes).
  on('turn.complete', async ($, e, next) => {
    const uso = e.usage
    if (uso !== undefined) {
      const delegado = (await read($, delegados)).find(d => d.id === e.agentId)?.modelo
      const nome = familia(modeloDoLoop.get(e.agentId ?? 'principal') ?? delegado)
      const principal = e.agentId === undefined
      await update($, contas, c => somar(completas(c), nome, uso, principal))
      await somarSemana($, c => somar(c, nome, uso, principal))
    }
    if (e.agentId === undefined && leiturasSemana > 0) {
      const k = leiturasSemana
      leiturasSemana = 0
      await somarSemana($, c => ({ ...c, leituras: (c.leituras ?? 0) + k }))
    }
    return next(e)
  })

  // 5. Comando /super-power.
  on('session.start', async ($, e, next) => {
    interativa = e.isInteractive
    await $.command.register({
      name: 'super-power',
      description: 'model-super-power: estado, contas, regras, modo, on/off',
      argumentHint: '[on|off|modo aviso|forte|desligado|regras|mostrar|zerar]',
    })
    return next(e)
  })

  on('command.run', { command: 'super-power' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === 'on' || arg === 'off') {
      await $.store.set('ligado', arg === 'on')
      return { text: arg === 'on' ? 'Ligado: subagentes de leitura vão para o Haiku.' : 'Desligado: nada é roteado.' }
    }

    if (arg.startsWith('modo ')) {
      const modo = MODOS.find(m => m === arg.slice(5).trim())
      if (modo === undefined) return { text: 'Use /super-power modo aviso|forte|desligado.' }
      await $.store.set('modo', modo)
      const o = {
        aviso: 'aviso: a conversa principal recebe o lembrete de delegar.',
        forte: `forte: além do lembrete, a ${TRAVA_LEITURAS}ª leitura direta seguida é recusada até delegar.`,
        desligado: 'desligado: o maestro não interfere.',
      }
      return { text: `Maestro em modo ${o[modo]}` }
    }

    if (arg === 'regras') {
      const rotas = Object.entries(ROTEAMENTO).map(([tipo, modelo]) => `  ${tipo} -> ${modelo}`)
      const pastas = regras.map(p => `  ${p.nome}`)
      return {
        text: [
          'Roteamento (tipo de subagente -> modelo):', ...rotas,
          `Esforço dos delegados ao Haiku: ${ESFORCO_DELEGADO}`,
          'Bloqueado para subagentes:', ...pastas,
          'O chat principal nunca é alterado.',
        ].join('\n'),
      }
    }

    if (arg === 'zerar') {
      await $.store.set(chaveDaSemana(await $.clock.now()), CONTAS_VAZIAS)
      await update($, contas, () => CONTAS_VAZIAS)
      return { text: 'Contas da semana e desta sessão zeradas.' }
    }

    if (arg === 'mostrar') {
      await update($, oculto, () => false)
      return { text: 'A barra volta a aparecer.' }
    }

    const ligado = await estaLigado($)
    const semana = completas((await $.store.get(chaveDaSemana(await $.clock.now()))) as Contas | undefined)
    return {
      text: [
        ligado ? 'ligado' : 'desligado',
        `Maestro: ${await modoEfetivo($, options.maestro)}`,
        '',
        ...blocoDeContas('Esta sessão', completas(await read($, contas))),
        '',
        ...blocoDeContas('Esta semana', semana),
        '',
        'Releitura do cache = o modelo relendo a conversa; custa uma fração do preço normal.',
        'A preço de API é uma estimativa com o preço base e escrita de cache de 1 hora na conversa principal e de 5 min nos subagentes, não o que a assinatura cobra.',
        'Use /super-power on|off|modo|regras|mostrar|zerar',
      ].join('\n'),
    }
  })

  // 6. Barra discreta acima do prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const c = completas(await read($, contas))
    const calado = e.props.hasSurvey || (c.delegados === 0 && (c.leituras ?? 0) === 0) || (await read($, oculto)) || !(await estaLigado($))
    if (calado) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text dimColor>
          ⚓ {porModelo(c).map(x => `${x.nome} ${x.pct}%`).join(' · ')} · {c.delegados} delegadas · {usd(custoUsd(c))}
          {(c.leituras ?? 0) > 0 ? ` · ${c.leituras} leituras diretas` : ''}{' '}
        </Text>
        <Button key="esconder" label="Esconder" onPress={() => update($, oculto, () => true)} />
      </Box>
    )
  })
}
