/**
 * Regra do "em atraso" da mensalidade — partilhada por /admin/pagamentos e
 * pela Área dos Encarregados, para nunca divergirem. Pura (sem Supabase):
 * `hojeISO` deve vir sempre de getHojeLisboa() no ponto de chamada, nunca
 * de new Date() local.
 *
 * Em atraso = não pago, valor esperado > 0, e: o mês é anterior ao mês de
 * `hojeISO`, ou é o mesmo mês e o dia de `hojeISO` já passou do dia limite.
 * Um mês futuro nunca está em atraso.
 */
export function mensalidadeEmAtraso(params: {
  pago: boolean;
  valorEsperado: number | null | undefined;
  ano: number;
  mes: number;
  diaLimite: number;
  hojeISO: string;
}): boolean {
  const { pago, valorEsperado, ano, mes, diaLimite, hojeISO } = params;
  if (pago) return false;
  if (!(Number(valorEsperado) > 0)) return false;

  const [anoHoje, mesHoje, diaHoje] = hojeISO.split('-').map(Number);
  if (ano > anoHoje || (ano === anoHoje && mes > mesHoje)) return false; // mês futuro
  if (ano < anoHoje || (ano === anoHoje && mes < mesHoje)) return true; // mês anterior

  return diaHoje > diaLimite; // mês atual: só em atraso depois do dia limite
}
