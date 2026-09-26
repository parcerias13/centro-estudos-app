/**
 * Cálculo do valor a pagar por uma sessão de explicação, a partir da tarifa
 * do professor nesse instante (snapshot — não é reavaliado depois de gravado,
 * exceto se a sessão for reaberta e voltar a ser marcada como dada).
 *
 * base = tarifa_tipo === 'fixo' ? tarifa_valor : tarifa_valor * horas_dadas
 * valor = tarifa_escala_aluno ? base * nº de alunos da sessão : base
 *
 * Tarifa em falta (professor ainda não configurado) resolve para 0€, seguindo
 * o mesmo padrão já usado no resto do projeto para valores numéricos ausentes
 * (ex: mensalidade_base em falta também conta como 0 na Performance).
 */
export function calcularValorExplicacao(params: {
  tarifaTipo: string | null | undefined;
  tarifaValor: number | null | undefined;
  tarifaEscalaAluno: boolean | null | undefined;
  horasDadas: number | null | undefined;
  numAlunos: number;
}): number {
  const { tarifaTipo, tarifaValor, tarifaEscalaAluno, horasDadas, numAlunos } = params;
  const valor = Number(tarifaValor) || 0;
  const horas = Number(horasDadas) || 0;
  const base = tarifaTipo === 'fixo' ? valor : valor * horas;
  return tarifaEscalaAluno ? base * numAlunos : base;
}
