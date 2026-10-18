import { expect, mock, test } from 'claude-code/testing'

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
