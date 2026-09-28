/**
 * "Hoje" em Europe/Lisbon, sempre no formato yyyy-MM-dd — para comparar com
 * colunas `date` (sem fuso, ex: exams.date). O trigger de proteção de notas
 * em exams (Fase 3.0, correu diretamente no Supabase) usa exatamente este
 * fuso para decidir se um teste "já aconteceu"; esta função existe para a
 * UI nunca discordar dele. Nunca uses `new Date()` local para isto — o
 * fuso do browser do aluno pode não ser Europe/Lisbon.
 */
export function getHojeLisboa(): string {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const obter = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  return `${obter('year')}-${obter('month')}-${obter('day')}`;
}

/**
 * Uma data (yyyy-MM-dd) já aconteceu, em Europe/Lisbon? Usa sempre esta
 * função para decidir se um teste "já foi" — nunca comparar com `new Date()`.
 */
export function jaAconteceu(dataISO: string, hoje: string = getHojeLisboa()): boolean {
  return dataISO <= hoje;
}
