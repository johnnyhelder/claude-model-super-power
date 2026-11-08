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

// Sessão real: o turn.step da conversa principal pode não anunciar o modelo e um plugin de tier
// acima pode pular o prompt.compose. O mod usa $.session.model() e entrega o maestro no prompt.submit.
const semStep = (on: On, modelo: string | (() => string) = 'claude-opus-5-5', ferramentas = ['Read', 'Agent']) => {
  on('tool.list', () => ({ value: ferramentas.map(name => ({ name, description: '' })) }) as never)
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 30) })
  on('command.register', () => ({ value: { command: 'super-power' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: typeof modelo === 'function' ? modelo() : modelo }))
  on('tool.call', () => ({ result: 'ok' }))
}

test('sem turn.step nem prompt.compose: modelo vem da sessão, aviso e maestro chegam', async ($, on) => {
  semStep(on)
  const contextos: Array<readonly string[] | undefined> = []
  on('prompt.submit', (_, e) => {
    contextos.push(e.context)
    return { text: e.text }
  })
  await $.session.start(interativa)
  await submeter($, { kind: 'composer' })
  await submeter($, { kind: 'composer' })
  expect(contextos[0]?.some(c => c.startsWith('Você é o maestro'))).toBe(true)
  expect(contextos[1]?.some(c => c.startsWith('Você é o maestro')) ?? false).toBe(false)
  await lerEm($, 1)
  await lerEm($, 2)
  expect((await lerEm($, 3)).context?.[0]).toContain('3 leituras diretas')
})

test('sem turn.step em Sonnet: nem maestro nem aviso', async ($, on) => {
  semStep(on, 'claude-sonnet-5-5')
  const contextos: Array<readonly string[] | undefined> = []
  on('prompt.submit', (_, e) => {
    contextos.push(e.context)
    return { text: e.text }
  })
  await $.session.start(interativa)
  await submeter($, { kind: 'composer' })
  expect(contextos[0]?.some(c => c.startsWith('Você é o maestro')) ?? false).toBe(false)
  for (let i = 1; i <= 4; i++) expect((await lerEm($, i)).context).toBeUndefined()
})

test('com o prompt.compose a correr, o maestro não vai em dobro no prompt.submit', async ($, on) => {
  semStep(on)
  on('prompt.compose', () => ({ sections: [] }))
  const contextos: Array<readonly string[] | undefined> = []
  on('prompt.submit', (_, e) => {
    contextos.push(e.context)
    return { text: e.text }
  })
  await $.session.start(interativa)
  expect((await $.prompt.compose(compose([]))).sections.map(s => s.id)).toContain(ID)
  await submeter($, { kind: 'composer' })
  expect(contextos[0]?.some(c => c.startsWith('Você é o maestro')) ?? false).toBe(false)
})

test('app desktop (SDK com superfície) conta como interativa; -p puro não', async ($, on) => {
  semStep(on)
  on('session.surfaces', () => ({ value: ['desktop'] }) as never)
  const contextos: Array<readonly string[] | undefined> = []
  on('prompt.submit', (_, e) => {
    contextos.push(e.context)
    return { text: e.text }
  })
  await $.session.start({ ...interativa, isInteractive: false })
  await submeter($, { kind: 'sdk' })
  expect(contextos[0]?.some(c => c.startsWith('Você é o maestro'))).toBe(true)
  await lerEm($, 1)
  await lerEm($, 2)
  expect((await lerEm($, 3)).context?.[0]).toContain('3 leituras diretas')
})

test('-p puro (SDK sem superfície) não recebe maestro nem aviso', async ($, on) => {
  semStep(on)
  on('session.surfaces', () => ({ value: [] }) as never)
  mock.env(on, { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' })
  const contextos: Array<readonly string[] | undefined> = []
  on('prompt.submit', (_, e) => {
    contextos.push(e.context)
    return { text: e.text }
  })
  await $.session.start({ ...interativa, isInteractive: false })
  await submeter($, { kind: 'sdk' })
  expect(contextos[0]?.some(c => c.startsWith('Você é o maestro')) ?? false).toBe(false)
  for (let i = 1; i <= 4; i++) expect((await lerEm($, i)).context).toBeUndefined()
})

// Sessão aberta por card ou por outra sessão: roda no app, mas nenhuma superfície ligou ainda.
test('app desktop em segundo plano (sem superfície) recebe maestro e aviso', async ($, on) => {
  semStep(on)
  on('session.surfaces', () => ({ value: [] }) as never)
  mock.env(on, { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' })
  const contextos: Array<readonly string[] | undefined> = []
  on('prompt.submit', (_, e) => {
    contextos.push(e.context)
    return { text: e.text }
  })
  await $.session.start({ ...interativa, isInteractive: false })
  await submeter($, { kind: 'sdk' })
  expect(contextos[0]?.some(c => c.startsWith('Você é o maestro'))).toBe(true)
  await lerEm($, 1)
  await lerEm($, 2)
  expect((await lerEm($, 3)).context?.[0]).toContain('3 leituras diretas')
})

test('comando local primeiro não gasta a entrega do maestro', async ($, on) => {
  semStep(on)
  const contextos: Array<readonly string[] | undefined> = []
  on('prompt.submit', (_, e) => {
    contextos.push(e.context)
    return { text: e.text }
  })
  await $.session.start(interativa)
  await submeter($, { kind: 'composer' }, { command: { name: 'model', args: '' } })
  await submeter($, { kind: 'composer' })
  expect(contextos[0]?.some(c => c.startsWith('Você é o maestro')) ?? false).toBe(false)
  expect(contextos[1]?.some(c => c.startsWith('Você é o maestro'))).toBe(true)
})

// /clear e resume não disparam session.start: só o session.end avisa que a conversa trocou.
test('/clear e resume no mesmo processo voltam a receber o maestro', async ($, on) => {
  semStep(on)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  const contextos: Array<readonly string[] | undefined> = []
  on('prompt.submit', (_, e) => {
    contextos.push(e.context)
    return { text: e.text }
  })
  await $.session.start(interativa)
  await submeter($, { kind: 'composer' })
  await lerEm($, 1)
  await lerEm($, 2)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  await submeter($, { kind: 'composer' })
  await $.session.end({ reason: 'resume', sessionId: 's2', resume: { id: 's2' } })
  await submeter($, { kind: 'composer' })
  const maestro = (i: number) => contextos[i]?.some(c => c.startsWith('Você é o maestro')) ?? false
  expect([maestro(0), maestro(1), maestro(2)]).toEqual([true, true, true])
})

test('sessão sem Agent continua sem maestro depois do /clear', async ($, on) => {
  semStep(on, 'claude-opus-5-5', ['Read'])
  on('prompt.compose', () => ({ sections: [] }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  const contextos: Array<readonly string[] | undefined> = []
  on('prompt.submit', (_, e) => {
    contextos.push(e.context)
    return { text: e.text }
  })
  await $.session.start(interativa)
  await $.prompt.compose(compose([], ['Read']))
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  await submeter($, { kind: 'composer' })
  expect(contextos[0]?.some(c => c.startsWith('Você é o maestro')) ?? false).toBe(false)
})

test('sair da sessão (reason other) não reabre a entrega', async ($, on) => {
  semStep(on)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  const contextos: Array<readonly string[] | undefined> = []
  on('prompt.submit', (_, e) => {
    contextos.push(e.context)
    return { text: e.text }
  })
  const maestro = (i: number) => contextos[i]?.some(c => c.startsWith('Você é o maestro')) ?? false
  await $.session.start(interativa)
  await submeter($, { kind: 'composer' })
  await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })
  await submeter($, { kind: 'composer' })
  expect([maestro(0), maestro(1)]).toEqual([true, false])
})

test('prompt recusado abaixo do mod: o maestro vai no próximo prompt', async ($, on) => {
  semStep(on)
  const contextos: Array<readonly string[] | undefined> = []
  on('prompt.submit', (_, e) => {
    contextos.push(e.context)
    return contextos.length === 1 ? { drop: 'parado' } : { text: e.text }
  })
  await $.session.start(interativa)
  expect((await submeter($, { kind: 'composer' })).drop).toBe('parado')
  await submeter($, { kind: 'composer' })
  await submeter($, { kind: 'composer' })
  const maestro = (i: number) => contextos[i]?.some(c => c.startsWith('Você é o maestro')) ?? false
  expect([maestro(0), maestro(1), maestro(2)]).toEqual([true, true, false])
})

test('submit antes do compose: o maestro não vai em dobro no sistema', async ($, on) => {
  semStep(on)
  on('prompt.compose', () => ({ sections: [] }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  await $.session.start(interativa)
  await submeter($, { kind: 'composer' })
  expect((await $.prompt.compose(compose([]))).sections.map(s => s.id)).not.toContain(ID)
})

const coletar = (on: On) => {
  const contextos: Array<readonly string[] | undefined> = []
  on('prompt.submit', (_, e) => {
    contextos.push(e.context)
    return { text: e.text }
  })
  return (i: number) => contextos[i]?.some(c => c.startsWith('Você é o maestro')) ?? false
}

// No app desktop, a lista de ferramentas lida no prompt.submit veio sem o Agent e desligou tudo (teste ao vivo 4).
test('a lista de ferramentas da sessão não desliga o maestro', async ($, on) => {
  semStep(on, 'claude-opus-5-5', ['Read'])
  const maestro = coletar(on)
  await $.session.start(interativa)
  await submeter($, { kind: 'composer' })
  expect(maestro(0)).toBe(true)
})

test('tarefa agendada com superfície não liga a sessão nem recebe o maestro', async ($, on) => {
  semStep(on)
  on('session.surfaces', () => ({ value: ['desktop'] }) as never)
  const maestro = coletar(on)
  await $.session.start({ ...interativa, isInteractive: false })
  await submeter($, { kind: 'scheduled-trigger' })
  expect(maestro(0)).toBe(false)
  // A tarefa agendada não liga a sessão: nada de aviso nas leituras dela.
  for (let i = 1; i <= 4; i++) expect((await lerEm($, i)).context).toBeUndefined()
  await submeter($, { kind: 'sdk' })
  expect(maestro(1)).toBe(true)
})

test('depois da compactação o maestro é entregue de novo', async ($, on) => {
  semStep(on)
  on('session.compact', (_, e) => ({ messages: e.messages }))
  const maestro = coletar(on)
  await $.session.start(interativa)
  await submeter($, { kind: 'composer' })
  await submeter($, { kind: 'composer' })
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'oi', toolUses: [] }] })
  await submeter($, { kind: 'composer' })
  expect([maestro(0), maestro(1), maestro(2)]).toEqual([true, false, true])
})

test('/model no meio da sessão: o maestro segue o modelo novo', async ($, on) => {
  let modelo = 'claude-sonnet-5-5'
  semStep(on, () => modelo)
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  const maestro = coletar(on)
  await $.session.start(interativa)
  await submeter($, { kind: 'composer' })
  // O turn.step anunciou Sonnet antes da troca: o /model seguinte ainda vale.
  await passo($, 'claude-sonnet-5-5')
  modelo = 'claude-opus-5-5'
  await submeter($, { kind: 'composer' })
  expect([maestro(0), maestro(1)]).toEqual([false, true])
})

test('compactação de subagente ou pulada não reabre a entrega', async ($, on) => {
  semStep(on)
  let pular = false
  on('session.compact', (_, e) => (pular ? { skip: 'nada a resumir' } : { messages: e.messages }) as never)
  const maestro = coletar(on)
  await $.session.start(interativa)
  await submeter($, { kind: 'composer' })
  await $.session.compact({ trigger: 'manual', agentId: 'a1', messages: [{ role: 'user', text: 'oi', toolUses: [] }] } as never)
  pular = true
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'oi', toolUses: [] }] })
  await submeter($, { kind: 'composer' })
  expect([maestro(0), maestro(1)]).toEqual([true, false])
})

test('precompute não reabre a entrega do maestro', async ($, on) => {
  semStep(on)
  on('session.compact', (_, e) => ({ messages: e.messages }))
  const maestro = coletar(on)
  await $.session.start(interativa)
  await submeter($, { kind: 'composer' })
  await $.session.compact({ trigger: 'precompute', messages: [{ role: 'user', text: 'oi', toolUses: [] }] })
  await submeter($, { kind: 'composer' })
  expect([maestro(0), maestro(1)]).toEqual([true, false])
})
