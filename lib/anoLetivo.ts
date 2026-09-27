/**
 * Ano letivo atual, no formato "2026/2027". Segue o calendário escolar
 * português: a partir de setembro conta como o início do ano letivo
 * seguinte; antes disso, ainda pertence ao ano letivo que começou no
 * setembro anterior.
 */
export function getAnoLetivoAtual(data: Date = new Date()): string {
  const ano = data.getFullYear();
  const mes = data.getMonth() + 1; // 1-12
  return mes >= 9 ? `${ano}/${ano + 1}` : `${ano - 1}/${ano}`;
}
