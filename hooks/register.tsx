import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Contas, Delegado } from '../types'
import {
  CONTAS_VAZIAS,
  ESFORCO_DELEGADO,
  FERRAMENTAS_VIGIADAS,
  ORQUESTRA,
  PROTEGIDOS,
  ROTEAMENTO,
  chaveDaSemana,
  compacto,
  completas,
  familia,
  mensagemDeRecusa,
  modeloPara,
  porModelo,
  protegidoEm,
  regrasExtra,
  somar,
  textosDaChamada,
} from './regras'

const PLUGIN = 'model-super-power'

const contas = atom({ plugin: 'model-super-power', key: 'contas' } as const, CONTAS_VAZIAS)
const delegados = atom({ plugin: 'model-super-power', key: 'delegados' } as const, [] as readonly Delegado[])
const oculto = atom({ plugin: 'model-super-power', key: 'oculto' } as const, false)

// Ligado por defeito; /super-power off desliga em todas as sessões.
async function estaLigado($: EngineInterface): Promise<boolean> {
  return (await $.store.get('ligado')) !== false
}

async function somarSemana($: EngineInterface, fn: (c: Contas) => Contas): Promise<void> {
  const chave = chaveDaSemana(await $.clock.now())
  const atual = completas((await $.store.get(chave)) as Contas | undefined)
  await $.store.set(chave, fn(atual))
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
  return [`${titulo} · ${c.delegados} tarefas delegadas`, ...linhas]
}

export const register: Register = (on, options) => {
  // Lista genérica mais as pastas que quem instalou pôs em pastasProtegidas.
  const regras = [...PROTEGIDOS, ...regrasExtra(String(options.pastasProtegidas ?? ''))]

  // 1. Roteador: cada tipo de subagente da tabela arranca no seu modelo (Haiku, Sonnet).
  // Todo subagente que arranca (da tabela, da orquestra ou outro) entra nas contas com o seu papel.
  on('agent.spawn', async ($, e, next) => {
    const modelo = (await estaLigado($)) ? modeloPara(e) : undefined
    const r = await next(modelo === undefined ? e : { ...e, model: modelo })
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

  // 3. Guarda de caminhos, só dentro de subagentes.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (e.agentId === undefined || !FERRAMENTAS_VIGIADAS.includes(tool)) return next(e)

    const input = e as unknown as Readonly<Record<string, unknown>>
    let nome = protegidoEm(textosDaChamada(tool, input), regras)

    // Um atalho (symlink) pode esconder uma pasta protegida: olhar também o caminho real.
    const caminho = input.file_path ?? input.notebook_path
    if (nome === undefined && typeof caminho === 'string') {
      const real = (await $.fs.stat(caminho, { resolve: true }).catch(() => undefined))?.realPath
      if (real !== undefined) nome = protegidoEm([real], regras)
    }

    return nome === undefined ? next(e) : { deny: mensagemDeRecusa(nome) }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: `${PLUGIN}: a guarda de caminhos falhou, chamada recusada por segurança.` },
  )

  // 4. Contas por modelo: o que correu em cada pedido (conversa e subagentes).
  on('turn.complete', async ($, e, next) => {
    const uso = e.usage
    if (uso !== undefined) {
      const delegado = (await read($, delegados)).find(d => d.id === e.agentId)?.modelo
      const nome = familia(modeloDoLoop.get(e.agentId ?? 'principal') ?? delegado)
      await update($, contas, c => somar(completas(c), nome, uso))
      await somarSemana($, c => somar(c, nome, uso))
    }
    return next(e)
  })

  // 5. Comando /super-power.
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'super-power',
      description: 'model-super-power: estado, contas, regras, on/off',
      argumentHint: '[on|off|regras|mostrar|zerar]',
    })
    return next(e)
  })

  on('command.run', { command: 'super-power' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === 'on' || arg === 'off') {
      await $.store.set('ligado', arg === 'on')
      return { text: arg === 'on' ? 'Ligado: subagentes de leitura vão para o Haiku.' : 'Desligado: nada é roteado.' }
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
        '',
        ...blocoDeContas('Esta sessão', completas(await read($, contas))),
        '',
        ...blocoDeContas('Esta semana', semana),
        '',
        'Releitura do cache = o modelo relendo a conversa; custa uma fração do preço normal.',
        'Use /super-power on|off|regras|mostrar|zerar',
      ].join('\n'),
    }
  })

  // 6. Barra discreta acima do prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const c = completas(await read($, contas))
    const calado = e.props.hasSurvey || c.delegados === 0 || (await read($, oculto)) || !(await estaLigado($))
    if (calado) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text dimColor>
          ⚓ {porModelo(c).map(x => `${x.nome} ${x.pct}%`).join(' · ')} · {c.delegados} delegadas{' '}
        </Text>
        <Button key="esconder" label="Esconder" onPress={() => update($, oculto, () => true)} />
      </Box>
    )
  })
}
