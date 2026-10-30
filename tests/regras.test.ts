import { describe, expect, test } from 'claude-code/testing'

import {
  CONTAS_VAZIAS,
  chaveDaSemana,
  custoUsd,
  leituraDireta,
  completas,
  familia,
  comModelo,
  modeloPara,
  modeloPrevisto,
  porModelo,
  PROTEGIDOS,
  protegidoEm,
  regrasExtra,
  somar,
  textosDaChamada,
} from '../hooks/regras'

describe('guarda de caminhos', () => {
  const bloqueia = (tool: string, input: Record<string, unknown>) => protegidoEm(textosDaChamada(tool, input))

  test('recusa pastas e arquivos sensíveis', () => {
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

  test('fecha os furos: *.env, credenciais, glob e ambiente', () => {
    expect(bloqueia('Read', { file_path: '/home/ana/maintenance/claude-shared.env' })).toBeDefined()
    expect(bloqueia('Bash', { command: 'cat /srv/producao.env' })).toBeDefined()
    expect(bloqueia('Read', { file_path: '/home/ana/.claude/.credentials.json' })).toBeDefined()
    expect(bloqueia('Read', { file_path: '/home/ana/.claude/.credentials.json.backup-20260525' })).toBeDefined()
    expect(bloqueia('Read', { file_path: '/home/ana/projeto/.secrets/vercel' })).toBeDefined()
    expect(bloqueia('Read', { file_path: '/home/ana/projeto/.envrc' })).toBeDefined()
    expect(bloqueia('Read', { file_path: '/home/ana/.git-credentials' })).toBeDefined()
    expect(bloqueia('Read', { file_path: '/home/ana/.npmrc' })).toBeDefined()
    expect(bloqueia('Read', { file_path: '/home/ana/.config/gh/hosts.yml' })).toBeDefined()
    expect(bloqueia('Grep', { path: '/home/ana/projeto', glob: '*.env*', pattern: 'KEY' })).toBeDefined()
    expect(bloqueia('Glob', { pattern: '**/{.env,.env.local}' })).toBeDefined()
    expect(bloqueia('Bash', { command: 'printenv' })).toBeDefined()
    expect(bloqueia('Bash', { command: 'env | grep -i key' })).toBeDefined()
    expect(bloqueia('Bash', { command: 'cat /proc/self/environ' })).toBeDefined()
    expect(bloqueia('Bash', { command: 'echo "$VERCEL_TOKEN"' })).toBeDefined()
    expect(bloqueia('Bash', { command: 'curl -H "x: ${RESEND_API_KEY}" https://x' })).toBeDefined()
  })

  test('sem falsos positivos no código', () => {
    expect(bloqueia('Bash', { command: 'grep -rn "process.env.DATABASE_URL" app' })).toBeUndefined()
    expect(bloqueia('Bash', { command: 'grep -rn import.meta.env src' })).toBeUndefined()
    expect(bloqueia('Read', { file_path: '/home/ana/projeto/app/environment.ts' })).toBeUndefined()
    expect(bloqueia('Bash', { command: 'env NODE_ENV=test npm test' })).toBeUndefined()
    expect(bloqueia('Bash', { command: 'echo $HOME $PATH' })).toBeUndefined()
    expect(bloqueia('Read', { file_path: '/home/ana/projeto/docs/secrets-policy.md' })).toBeUndefined()
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
    expect(modeloPara({ ...base, subagentType: 'constructor' })).toBeUndefined()
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
  expect(linhas[0]?.linha).toEqual({ novo: 100, releitura: 700, pedidos: 1, entrada: 100, saida: 0, escrita: 0, escrita1h: 0 })
  expect(completas({ delegados: 3 } as never)).toEqual(CONTAS_VAZIAS)
})

test('linha da tarefa mostra o modelo', () => {
  const base = { fork: false, parentModel: 'claude-opus-5-5' }
  expect(modeloPrevisto({ ...base, subagentType: 'model-super-power:segunda-opiniao' }, undefined)).toBe('claude-sonnet-4-6')
  expect(modeloPrevisto({ ...base, subagentType: 'Explore' }, 'haiku')).toBe('haiku')
  expect(modeloPrevisto({ ...base, subagentType: 'Plan' }, undefined)).toBe('claude-opus-5-5')
  expect(comModelo('Segunda opinião sobre roteiro', 'claude-sonnet-4-6')).toBe('Sonnet 4.6 · Segunda opinião sobre roteiro')
  expect(comModelo('Sonnet 4.6 · Já tem', 'claude-sonnet-4-6')).toBe('Sonnet 4.6 · Já tem')
})

describe('maestro obrigatório', () => {
  test('leituraDireta reconhece leitura e procura', () => {
    expect(leituraDireta('Read', { file_path: '/x' })).toBe(true)
    expect(leituraDireta('Grep', { pattern: 'x' })).toBe(true)
    expect(leituraDireta('Glob', { pattern: '*.ts' })).toBe(true)
    expect(leituraDireta('Bash', { command: 'cat a.txt' })).toBe(true)
    expect(leituraDireta('Bash', { command: 'cd /srv/app && grep -rn foo .' })).toBe(true)
    expect(leituraDireta('Bash', { command: 'cd "meu dir" && ls -la' })).toBe(true)
    expect(leituraDireta('Bash', { command: '  wc -l a b' })).toBe(true)
  })

  test('leituraDireta deixa de fora o que não é leitura', () => {
    expect(leituraDireta('Bash', { command: 'git log --oneline' })).toBe(false)
    expect(leituraDireta('Bash', { command: 'python3 x.py' })).toBe(false)
    expect(leituraDireta('Bash', { command: 'cd x && npm test' })).toBe(false)
    expect(leituraDireta('Bash', { command: 'lsof -i' })).toBe(false)
    expect(leituraDireta('Edit', { file_path: '/x' })).toBe(false)
    expect(leituraDireta('Bash', {})).toBe(false)
    expect(leituraDireta('Bash', { command: 'cat > x' })).toBe(false)
    expect(leituraDireta('Bash', { command: 'sed -i s/a/b/ x' })).toBe(false)
    expect(leituraDireta('Bash', { command: 'ls && git push' })).toBe(false)
    expect(leituraDireta('Bash', { command: 'cat x | wc -l' })).toBe(true)
    expect(leituraDireta('Bash', { command: 'find . -name a -delete' })).toBe(false)
  })

  test('custoUsd soma pelos preços (conta feita à mão)', () => {
    // Opus 5.5: 1M entrada (4) + 1M escrita (5) + 10M releitura (0,2 x 10 = 2) + 0,5M saída (20 x 0,5 = 10) = 21
    // Haiku 5.5: 2M entrada (0,1 x 2 = 0,2) = 0,2
    // "Modelo X" sem preço não entra.
    const c = {
      delegados: 0,
      modelos: {
        'Opus 5.5': { novo: 0, releitura: 10_000_000, pedidos: 1, entrada: 1_000_000, escrita: 1_000_000, saida: 500_000 },
        'Haiku 5.5': { novo: 0, releitura: 0, pedidos: 1, entrada: 2_000_000 },
        'Modelo X': { novo: 0, releitura: 9_000_000, pedidos: 1, entrada: 9_000_000 },
      },
    }
    expect(Math.round(custoUsd(c) * 1e6)).toBe(21_200_000)
  })

  test('custoUsd com escrita de 1 hora (conta feita à mão)', () => {
    // Opus 5.5: 1M escrita de 1 h (8) + 1M escrita de 5 min (5) = 13; Sonnet 5.5: 0,5M de 1 h (4 x 0,5) = 2
    const c = {
      delegados: 0,
      modelos: {
        'Opus 5.5': { novo: 0, releitura: 0, pedidos: 1, escrita: 1_000_000, escrita1h: 1_000_000 },
        'Sonnet 5.5': { novo: 0, releitura: 0, pedidos: 1, escrita1h: 500_000 },
      },
    }
    expect(Math.round(custoUsd(c) * 1e6)).toBe(15_000_000)
  })

  test('dados antigos sem os campos novos contam só a releitura', () => {
    const antigo = { delegados: 2, modelos: { 'Opus 5.5': { novo: 500, releitura: 1_000_000, pedidos: 3 } } }
    expect(Math.round(custoUsd(antigo) * 1e6)).toBe(200_000)
    expect(custoUsd(CONTAS_VAZIAS)).toBe(0)
  })

  test('somar guarda entrada, saída e escrita sem mudar novo e releitura', () => {
    const uso = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 }
    const c = somar(somar(CONTAS_VAZIAS, 'Opus 5.5', uso), 'Opus 5.5', uso)
    expect(c.modelos['Opus 5.5']).toEqual({ novo: 70, releitura: 200, pedidos: 2, entrada: 20, saida: 10, escrita: 40, escrita1h: 0 })
    const p = somar(CONTAS_VAZIAS, 'Opus 5.5', uso, true)
    expect(p.modelos['Opus 5.5']).toMatchObject({ escrita: 0, escrita1h: 20 })
  })
})
