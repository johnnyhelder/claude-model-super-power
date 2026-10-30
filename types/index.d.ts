export type Linha = {
  novo: number
  releitura: number
  pedidos: number
  entrada?: number
  saida?: number
  escrita?: number
  escrita1h?: number
}
export type Contas = { delegados: number; modelos: Readonly<Record<string, Linha>>; leituras?: number }
export type Delegado = { id: string; modelo: string }

declare module 'claude-code' {
  interface PluginState {
    'model-super-power': {
      contas: Contas
      delegados: readonly Delegado[]
      oculto: boolean
    }
  }
}
