// Extraído de app/admin/alunos/extrato/page.tsx — mesmo cálculo, mesmas
// fórmulas, para o extrato individual e a exportação de faturação (em lote)
// nunca divergirem (mesma lição de lib/relatorio.ts). Datas construídas
// exatamente como a página de extrato já fazia, para não mudar nenhum
// número que já existia.

export type ResumoExtratoMes = {
  mensalidadeFixa: number;
  totalExtras: number;
  totalExplicacoes: number;
  /** Sessões de explicação dadas neste mês cujo valor_cobrado_familia ainda é null — nunca contadas como 0€. */
  explicacoesSemPreco: number;
  totalGeral: number;
};

export type LinhaExtra = { preco_aplicado: number | string | null };
export type LinhaExplicacao = { valor_cobrado_familia: number | string | null };

export function calcularResumoExtrato(
  mensalidadeBase: number | string | null | undefined,
  extras: LinhaExtra[],
  explicacoes: LinhaExplicacao[]
): ResumoExtratoMes {
  const mensalidadeFixa = Number(mensalidadeBase) || 0;
  const totalExtras = extras.reduce((acc, e) => acc + (Number(e.preco_aplicado) || 0), 0);

  let totalExplicacoes = 0;
  let explicacoesSemPreco = 0;
  for (const ea of explicacoes) {
    if (ea.valor_cobrado_familia != null) totalExplicacoes += Number(ea.valor_cobrado_familia);
    else explicacoesSemPreco += 1;
  }

  return {
    mensalidadeFixa,
    totalExtras,
    totalExplicacoes,
    explicacoesSemPreco,
    totalGeral: mensalidadeFixa + totalExtras + totalExplicacoes,
  };
}

/**
 * Intervalo do mês tal como a página de extrato sempre o construiu
 * (new Date local + toISOString) — mantido tal e qual, para os números do
 * extrato nunca mudarem. `data` é a mesma string de data (sem hora) usada
 * para filtrar consumos_diarios.data_consumo e explicacoes.data.
 */
export function intervaloDoMesExtrato(ano: number, mes: number) {
  const primeiroDiaISO = new Date(ano, mes - 1, 1).toISOString();
  const ultimoDiaISO = new Date(ano, mes, 0, 23, 59, 59).toISOString();
  return {
    primeiroDiaISO,
    ultimoDiaISO,
    primeiroDiaData: primeiroDiaISO.split('T')[0],
    ultimoDiaData: ultimoDiaISO.split('T')[0],
  };
}
