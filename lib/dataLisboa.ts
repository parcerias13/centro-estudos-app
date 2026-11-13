/**
 * "Hoje" em Europe/Lisbon, sempre no formato yyyy-MM-dd — para comparar com
 * colunas `date` (sem fuso, ex: exams.date). O trigger de proteção de notas
 * em exams (Fase 3.0, correu diretamente no Supabase) usa exatamente este
 * fuso para decidir se um teste "já aconteceu"; esta função existe para a
 * UI nunca discordar dele. Nunca uses `new Date()` local para isto — o
 * fuso do browser do aluno pode não ser Europe/Lisbon.
 */
export function getHojeLisboa(): string {
  return dataLisboaDe(new Date());
}

/**
 * Mesma conversão de getHojeLisboa(), mas para qualquer instante (não só
 * "agora") — ex. um `created_at` vindo da BD, para decidir em que dia civil,
 * em Europe/Lisbon, algo aconteceu.
 */
export function dataLisboaDe(instante: Date | string): string {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instante));
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

/**
 * Hora (HH:mm) de um instante em Europe/Lisbon — para mostrar a hora de um
 * `entrada`/`saida` (timestamptz) de registos_horas_professor sem depender do
 * fuso do browser de quem está a ver o ecrã.
 */
export function horaLisboaDe(instante: Date | string): string {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Lisbon',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(instante));
  const obter = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  return `${obter('hour')}:${obter('minute')}`.replace('24:', '00:');
}

/**
 * Diferença em dias inteiros entre duas datas yyyy-MM-dd (positiva se
 * `dataISO` for no futuro em relação a `hoje`) — para "daqui a N dias" (ex.
 * Próximo Teste do aluno) sem depender do fuso do browser nem de `new Date()`
 * para decidir o dia atual.
 */
export function diasEntre(dataISOyyyyMMdd: string, hoje: string = getHojeLisboa()): number {
  const [anoA, mesA, diaA] = dataISOyyyyMMdd.split('-').map(Number);
  const [anoB, mesB, diaB] = hoje.split('-').map(Number);
  const a = Date.UTC(anoA, mesA - 1, diaA);
  const b = Date.UTC(anoB, mesB - 1, diaB);
  return Math.round((a - b) / 86400000);
}

/**
 * Dia da semana (0=Domingo..6=Sábado, igual a Date.getDay()) mas calculado em
 * Europe/Lisbon, não no fuso do browser — para a Lista do Dia (admin/page.tsx)
 * nunca discordar de aluno_horarios.dia_semana (1=Segunda..6=Sábado) por causa
 * do fuso de quem está a ver o ecrã.
 */
export function diaSemanaLisboa(instante: Date | string = new Date()): number {
  const diaAbrev = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Lisbon', weekday: 'short' }).format(
    new Date(instante)
  );
  const mapa: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return mapa[diaAbrev] ?? new Date(instante).getDay();
}

/**
 * Converte uma data civil (yyyy-MM-dd) + hora (HH:mm) EM EUROPE/LISBON para o
 * instante UTC correspondente (ISO 8601) — para fechar uma sessão aberta de
 * um dia anterior a uma hora escolhida à mão, sem o resultado saltar de dia
 * por causa da hora de verão/inverno. Testa os deslocamentos possíveis de
 * Lisboa (0h ou +1h, com margem) e escolhe o que, formatado de volta em
 * Europe/Lisbon, bate certo com a data+hora pedidas.
 */
export function instanteLisboaParaUTC(dataISOyyyyMMdd: string, horaHHmm: string): string {
  for (const offsetHoras of [0, 1, -1, 2]) {
    const candidato = new Date(`${dataISOyyyyMMdd}T${horaHHmm}:00.000Z`);
    candidato.setUTCHours(candidato.getUTCHours() - offsetHoras);
    const partes = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Lisbon',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(candidato);
    const obter = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
    const dataFormatada = `${obter('year')}-${obter('month')}-${obter('day')}`;
    const horaFormatada = `${obter('hour')}:${obter('minute')}`.replace('24:', '00:');
    if (dataFormatada === dataISOyyyyMMdd && horaFormatada === horaHHmm) {
      return candidato.toISOString();
    }
  }
  // Não deveria acontecer (Lisboa só tem os desvios acima) — cai para UTC puro.
  return `${dataISOyyyyMMdd}T${horaHHmm}:00.000Z`;
}

/**
 * Janela larga em UTC que cobre com garantia o dia civil `dataISOyyyyMMdd` em
 * Europe/Lisbon (com margem de 3h para cada lado, bem acima do desvio real de
 * 0h/+1h) — para filtrar `diario_bordo.entrada` por "hoje em Lisboa" sem
 * trazer a tabela toda. Filtra sempre o resultado a seguir com
 * `dataLisboaDe(row.entrada) === dataISOyyyyMMdd` para a precisão exata.
 */
export function janelaLarga(dataISOyyyyMMdd: string): { inicio: string; fim: string } {
  const inicio = new Date(`${dataISOyyyyMMdd}T00:00:00.000Z`);
  inicio.setUTCHours(inicio.getUTCHours() - 3);
  const fim = new Date(`${dataISOyyyyMMdd}T00:00:00.000Z`);
  fim.setUTCDate(fim.getUTCDate() + 1);
  fim.setUTCHours(fim.getUTCHours() + 3);
  return { inicio: inicio.toISOString(), fim: fim.toISOString() };
}
