import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine as Motor } from 'claude-code/testing'

const pedido = (subagentType: string) => ({
  tool_use_id: 'tu1',
  prompt: 'procura X',
  description: 'procura',
  subagentType,
  provider: { plugin: 'engine', tier: 'core' as const },
  parentModel: 'claude-opus-5-5',
  background: false,
  fork: false,
})
const comando = (args: string) => ({
  command: 'super-power',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 120 },
})

test('Explore no Haiku com esforço baixo, general-purpose no Sonnet; o chat principal fica igual', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 18) })

  const modelos: Array<string | undefined> = []
  on('agent.spawn', ($, e) => {
    modelos.push(e.model)
    return { model: e.model ?? e.parentModel, agentId: `a${modelos.length}` }
  })

  const esforcos: Array<string | number | undefined> = []
  on('turn.step', async function* ($, e) {
    esforcos.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })

  await $.agent.spawn(pedido('Explore'))
  await $.agent.spawn(pedido('general-purpose'))
  expect(modelos).toEqual(['haiku', 'sonnet'])

  const passo = { turnId: 't', index: 0, model: 'claude-opus-5-5', effort: 'high' as const, messageCount: 1 }
  for await (const _ of $.turn.step({ ...passo, agentId: 'a1' })) void _
  for await (const _ of $.turn.step({ ...passo, agentId: 'a2' })) void _
  for await (const _ of $.turn.step(passo)) void _
  expect(esforcos).toEqual(['low', 'high', 'high'])
})

test('/super-power off desliga o roteador', async ($, on) => {
  mock.store(on)
  mock.clock(on)

  const modelos: Array<string | undefined> = []
  on('agent.spawn', ($, e) => {
    modelos.push(e.model)
    return { model: e.parentModel, agentId: 'a1' }
  })

  await $.command.run(comando('off'))
  await $.agent.spawn(pedido('Explore'))
  expect(modelos).toEqual([undefined])
})

const interativa = { cwd: '/tmp', surface: null, isInteractive: true }
const compose = (traits: Array<'print' | 'bare'>, tools = ['Read', 'Agent']) => ({
  model: 'claude-opus-5-5',
  promptModel: 'claude-opus-5-5',
  surfaces: [],
  tools,
  outputStyle: null,
  traits,
})
const ID = 'model-super-power:maestro'
// O que fica por baixo do mod ao iniciar a sessão: registrar o comando e devolver o cwd.
const base = (on: On) => {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 30) })
  on('command.register', () => ({ value: { command: 'super-power' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.compose', () => ({ sections: [] }))
  on('prompt.submit', () => ({ text: '' }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
}
// A conversa principal anuncia o modelo num turn.step; o mod só atua em modelo caro.
const passo = async ($: Motor, model = 'claude-opus-5-5') => {
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model, effort: 'high', messageCount: 1 })) void _
}
const submeter = ($: Motor, origin: { kind: string }, extra: object = {}) =>
  $.prompt.submit({ text: 'oi', wait: false, origin, ...extra } as never)

test('a seção do maestro entra em sessão interativa e não entra com trait print', async ($, on) => {
  base(on)
  await $.session.start(interativa)
  const r = await $.prompt.compose(compose([]))
  expect(r.sections.map(s => s.id)).toContain(ID)
  expect(r.sections.at(-1)?.scope).toBe('session')
  expect((await $.prompt.compose(compose(['print']))).sections.map(s => s.id)).not.toContain(ID)
  expect((await $.prompt.compose(compose([], ['Read']))).sections.map(s => s.id)).not.toContain(ID)
})

test('sessão não interativa e modo desligado não recebem a seção', async ($, on) => {
  base(on)
  await $.session.start({ ...interativa, isInteractive: false })
  expect((await $.prompt.compose(compose([]))).sections.map(s => s.id)).not.toContain(ID)
  await $.session.start(interativa)
  await $.command.run(comando('modo desligado'))
  expect((await $.prompt.compose(compose([]))).sections.map(s => s.id)).not.toContain(ID)
})

test('modo forte recusa a 6ª leitura direta, mas arquivo protegido não conta', async ($, on) => {
  base(on)
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start(interativa)
  await passo($)
  await $.command.run(comando('modo forte'))

  const ler = (file_path: string) => $.tool.call({ tool: 'Read', file_path })
  for (let i = 1; i <= 5; i++) expect((await ler(`/a/${i}.ts`)).deny).toBeUndefined()
  // o protegido não conta (a guarda de caminhos é só dos subagentes)
  expect((await ler('/a/.env')).deny).toBeUndefined()
  expect((await ler('/a/6.ts')).deny).toContain('6 leituras diretas')
})

test('delegar zera a contagem e o aviso chega como contexto', async ($, on) => {
  base(on)
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start(interativa)
  await passo($)
  const ler = (n: number) => $.tool.call({ tool: 'Read', file_path: `/a/${n}.ts` })
  await ler(1)
  await ler(2)
  expect((await ler(3)).context?.[0]).toContain('3 leituras diretas')
  await $.tool.call({ tool: 'Agent', description: 'd', prompt: 'p', subagent_type: 'Explore' } as never)
  expect((await ler(4)).context).toBeUndefined()
})

test('erro interno do mod não recusa a conversa principal', async ($, on) => {
  // sem mock.store, o $.store do mod falha dentro do hook: a chamada tem de passar mesmo assim
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'super-power' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start(interativa)
  const r = await $.tool.call({ tool: 'Read', file_path: '/a/1.ts' })
  expect(r.deny).toBeUndefined()
})

const lerEm = ($: Motor, n: number) => $.tool.call({ tool: 'Read', file_path: `/a/${n}.ts` })

test('lote paralelo de 6 Read: só a 6ª é recusada e a recusada não soma', async ($, on) => {
  base(on)
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start(interativa)
  await passo($)
  await $.command.run(comando('modo forte'))
  const r = await Promise.all([1, 2, 3, 4, 5, 6].map(n => lerEm($, n)))
  expect(r.map(x => x.deny !== undefined)).toEqual([false, false, false, false, false, true])
  expect(r[5]?.deny).toContain('6 leituras diretas')
  expect(r[2]?.context?.[0]).toContain('3 leituras diretas')
  const estado = await $.command.run(comando(''))
  expect(estado.text).toContain('Leituras diretas: 5')
})

test('notificação não zera a contagem; Enter com comando zera', async ($, on) => {
  base(on)
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start(interativa)
  await passo($)
  await lerEm($, 1)
  await lerEm($, 2)
  await submeter($, { kind: 'task-notification' })
  expect((await lerEm($, 3)).context?.[0]).toContain('3 leituras diretas')
  await submeter($, { kind: 'composer' }, { command: { name: 'x', args: '' } })
  expect((await lerEm($, 4)).context).toBeUndefined()
})

test('sessão sem a ferramenta Agent nunca recusa nem avisa', async ($, on) => {
  base(on)
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start(interativa)
  await passo($)
  await $.prompt.compose(compose([], ['Read']))
  await $.command.run(comando('modo forte'))
  for (let i = 1; i <= 8; i++) {
    const r = await lerEm($, i)
    expect(r.deny).toBeUndefined()
    expect(r.context).toBeUndefined()
  }
})

test('conversa em Sonnet não leva seção nem trava', async ($, on) => {
  base(on)
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start(interativa)
  await passo($, 'claude-sonnet-5-5')
  const sonnet = { ...compose([]), model: 'claude-sonnet-5-5' }
  expect((await $.prompt.compose(sonnet)).sections.map(s => s.id)).not.toContain(ID)
  await $.command.run(comando('modo forte'))
  for (let i = 1; i <= 8; i++) {
    const r = await lerEm($, i)
    expect(r.deny).toBeUndefined()
    expect(r.context).toBeUndefined()
  }
})
