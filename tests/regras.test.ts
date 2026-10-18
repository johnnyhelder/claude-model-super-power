import { describe, expect, test } from 'claude-code/testing'

import {
  CONTAS_VAZIAS,
  chaveDaSemana,
  completas,
  familia,
  modeloPara,
  porModelo,
  PROTEGIDOS,
  protegidoEm,
  regrasExtra,
  somar,
  textosDaChamada,
} from '../hooks/regras'

describe('guarda de caminhos', () => {
  const bloqueia = (tool: string, input: Record<string, unknown>) => protegidoEm(textosDaChamada(tool, input))

  test('recusa pastas e ficheiros sensíveis', () => {
    expect(bloqueia('Read', { file_path: '/home/ana/projeto/.env.local' })).toBeDefined()
    expect(bloqueia('Read', { file_path: '/home/x/.ssh/id_ed25519' })).toBeDefined()
    expect(bloqueia('Glob', { pattern: '**/*.pem' })).toBeDefined()
    expect(bloqueia('Bash', { command: 'grep KEY .env' })).toBeDefined()
    expect(bloqueia('Bash', { command: 'source ~/.claude/secrets/vercel.env' })).toBeDefined()
    expect(bloqueia('Write', { file_path: '/srv/app/keys.env', content: '' })).toBeDefined()
    expect(bloqueia('Read', { file_path: '/home/ana/.aws/credentials' })).toBeDefined()
    expect(bloqueia('Bash', { command: 'cat ~/.netrc' })).toBeDefined()
  })

  test('deixa passar o resto', () => {
    expect(bloqueia('Read', { file_path: '/home/ana/projeto/src/app/page.tsx' })).toBeUndefined()
    expect(bloqueia('Grep', { pattern: 'process.env.KEY', path: 'src' })).toBeUndefined()
    expect(bloqueia('Bash', { command: 'git log --oneline | head' })).toBeUndefined()
    expect(bloqueia('Read', { file_path: '/repo/.envrc.example.md' })).toBeUndefined()
    expect(bloqueia('WebFetch', { url: 'https://x/.env' })).toBeUndefined()
  })

  test('pastasProtegidas soma pastas de quem instala', () => {
    const regras = [...PROTEGIDOS, ...regrasExtra(' financas/, ~/.vault , /etc/segredos,, ')]
    const ve = (tool: string, input: Record<string, unknown>) => protegidoEm(textosDaChamada(tool, input), regras)
    expect(regras.length).toBe(PROTEGIDOS.length + 3)
    expect(ve('Read', { file_path: '/home/ana/financas/2026.xlsx' })).toBe('financas (protegida por você)')
    expect(ve('Bash', { command: 'ls ~/.vault' })).toBe('.vault (protegida por você)')
    expect(ve('Bash', { command: 'sudo cat /etc/segredos/chave' })).toBeDefined()
    expect(ve('Read', { file_path: '/home/ana/docs/financas-antigas.md' })).toBeUndefined()
    expect(protegidoEm(['/home/ana/financas/x'])).toBeUndefined()
  })
})

describe('roteador', () => {
  const base = { fork: false }

  test('Explore vai para o Haiku, general-purpose para o Sonnet', () => {
    expect(modeloPara({ ...base, subagentType: 'Explore' })).toBe('haiku')
    expect(modeloPara({ ...base, subagentType: 'general-purpose' })).toBe('sonnet')
  })

  test('respeita modelo pedido, forks, teammates e o Plan', () => {
    expect(modeloPara({ ...base, subagentType: 'Explore', model: 'opus' })).toBeUndefined()
    expect(modeloPara({ subagentType: 'Explore', fork: true })).toBeUndefined()
    expect(modeloPara({ ...base, subagentType: 'Explore', isTeammate: true })).toBeUndefined()
    expect(modeloPara({ ...base, subagentType: 'Plan' })).toBeUndefined()
  })
})

test('semana começa na segunda', () => {
  expect(chaveDaSemana(Date.UTC(2026, 9, 18))).toBe('semana:2026-10-12')
  expect(chaveDaSemana(Date.UTC(2026, 9, 19))).toBe('semana:2026-10-19')
})

test('contas por modelo: nome curto, novo vs releitura e percentagem', () => {
  const uso = (novo: number, cache: number) => ({
    input_tokens: novo, output_tokens: 0, cache_read_input_tokens: cache, cache_creation_input_tokens: 0,
  })
  expect(familia('claude-opus-5-5')).toBe('Opus 5.5')
  expect(familia('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(familia('claude-fable-5-1')).toBe('Fable 5.1')
  expect(familia('haiku')).toBe('Haiku')
  let c = somar(CONTAS_VAZIAS, 'Opus 5.5', uso(100, 700))
  c = somar(c, 'Haiku 5.5', uso(200, 0))
  const linhas = porModelo(c)
  expect(linhas.map(l => [l.nome, l.pct])).toEqual([
    ['Opus 5.5', 80], ['Haiku 5.5', 20], ['Sonnet 5.5', 0], ['Sonnet 4.6', 0], ['Fable 5.1', 0],
  ])
  expect(linhas[0]?.linha).toEqual({ novo: 100, releitura: 700, pedidos: 1 })
  expect(completas({ delegados: 3 } as never)).toEqual(CONTAS_VAZIAS)
})
