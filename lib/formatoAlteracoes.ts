import { format } from 'date-fns';
import { pt } from 'date-fns/locale';

/**
 * Texto fixo (nunca livre) dos avisos de alteração a uma explicação, gerado
 * em React a partir do payload de `mensagens` (tipo 'alteracao_explicacao')
 * — único sítio que lê esse payload, tal como sanitizarPedidoExplicacao faz
 * para pedidos. Um payload com campos em falta ou tipo_alteracao desconhecido
 * devolve null: quem chama mostra sempre um cartão genérico em vez de
 * arriscar desenhar undefined/objetos.
 */

export type ChaveIconeAlteracao = 'cancelada' | 'reativada' | 'hora' | 'dia' | 'professor' | 'pausa';

export type AlteracaoCartao =
  | { tipo: 'cancelada'; icone: 'cancelada'; disciplina: string; data: string; hora: string }
  | { tipo: 'reativada'; icone: 'reativada'; disciplina: string; data: string; hora: string }
  | {
      tipo: 'horario';
      icone: 'hora' | 'dia';
      disciplina: string;
      data: string;
      hora: string;
      dataAntes: string;
      horaAntes: string;
      diaMudou: boolean;
      horaMudou: boolean;
    }
  | { tipo: 'professor'; icone: 'professor'; disciplina: string; data: string; hora: string; professorNovo: string }
  | { tipo: 'pausa'; icone: 'pausa'; disciplina: string; de: string; ate: string; sessoes: string };

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function sessoesComoTexto(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

export function sanitizarAlteracaoExplicacao(payload: unknown): AlteracaoCartao | null {
  const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const tipoAlteracao = str(p.tipo_alteracao);
  const disciplina = str(p.disciplina);
  if (!tipoAlteracao || !disciplina) return null;

  if (tipoAlteracao === 'cancelada') {
    const data = str(p.data);
    const hora = str(p.hora_inicio);
    if (!data || !hora) return null;
    return { tipo: 'cancelada', icone: 'cancelada', disciplina, data, hora };
  }

  if (tipoAlteracao === 'reativada') {
    const data = str(p.data);
    const hora = str(p.hora_inicio);
    if (!data || !hora) return null;
    return { tipo: 'reativada', icone: 'reativada', disciplina, data, hora };
  }

  if (tipoAlteracao === 'horario') {
    const data = str(p.data);
    const hora = str(p.hora_inicio);
    const dataAntes = str(p.data_antes);
    const horaAntes = str(p.hora_antes);
    if (!data || !hora || !dataAntes || !horaAntes) return null;
    const diaMudou = dataAntes !== data;
    const horaMudou = horaAntes !== hora;
    if (!diaMudou && !horaMudou) return null;
    return { tipo: 'horario', icone: diaMudou ? 'dia' : 'hora', disciplina, data, hora, dataAntes, horaAntes, diaMudou, horaMudou };
  }

  if (tipoAlteracao === 'professor') {
    const data = str(p.data);
    const hora = str(p.hora_inicio);
    const professorNovo = str(p.professor_novo);
    if (!data || !hora || !professorNovo) return null;
    return { tipo: 'professor', icone: 'professor', disciplina, data, hora, professorNovo };
  }

  if (tipoAlteracao === 'pausa') {
    const de = str(p.de);
    const ate = str(p.ate);
    const sessoes = sessoesComoTexto(p.sessoes);
    if (!de || !ate || !sessoes) return null;
    return { tipo: 'pausa', icone: 'pausa', disciplina, de, ate, sessoes };
  }

  return null;
}

/** "HH:mm" a partir de "HH:mm:ss" (ou já "HH:mm") — hora_inicio vem sempre com segundos da base de dados. */
export function formatarHoraAlteracao(hora: string): string {
  return hora.slice(0, 5);
}

/** "segunda-feira, 12 de outubro" — dia da semana e mês em português, hora de Lisboa (a data é sempre yyyy-MM-dd, sem fuso). */
export function formatarDataExtensoAlteracao(dataISO: string): string {
  return format(new Date(`${dataISO}T00:00:00`), "EEEE, d 'de' MMMM", { locale: pt });
}

/** "12 de outubro" — sem dia da semana, para intervalos (pausa). */
export function formatarDataCurtaAlteracao(dataISO: string): string {
  return format(new Date(`${dataISO}T00:00:00`), "d 'de' MMMM", { locale: pt });
}

export function tituloAlteracao(a: AlteracaoCartao): string {
  switch (a.tipo) {
    case 'cancelada':
      return 'Sessão cancelada';
    case 'reativada':
      return 'Sessão reposta';
    case 'professor':
      return 'Mudança de professor';
    case 'pausa':
      return 'Pausa nas explicações';
    case 'horario':
      if (a.diaMudou && a.horaMudou) return 'Sessão mudou de dia e hora';
      if (a.diaMudou) return 'Sessão mudou de dia';
      return 'Sessão mudou de hora';
  }
}

export function linhasAlteracao(a: AlteracaoCartao): string[] {
  switch (a.tipo) {
    case 'cancelada':
      return [
        `A explicação de ${a.disciplina} de ${formatarDataExtensoAlteracao(a.data)}, às ${formatarHoraAlteracao(a.hora)}, foi cancelada.`,
        'Vamos avisar quando for remarcada.',
      ];
    case 'reativada':
      return [`A explicação de ${a.disciplina} de ${formatarDataExtensoAlteracao(a.data)}, às ${formatarHoraAlteracao(a.hora)}, voltou a estar marcada.`];
    case 'professor':
      return [`A explicação de ${a.disciplina} de ${formatarDataExtensoAlteracao(a.data)}, às ${formatarHoraAlteracao(a.hora)}, passa a ser dada por ${a.professorNovo}.`];
    case 'pausa':
      return [
        `As sessões de ${a.disciplina} entre ${formatarDataCurtaAlteracao(a.de)} e ${formatarDataCurtaAlteracao(a.ate)} ficam canceladas (${a.sessoes}).`,
        'Avisaremos quando recomeçarem.',
      ];
    case 'horario': {
      if (a.diaMudou && a.horaMudou) {
        return [
          `A explicação de ${a.disciplina} passa de ${formatarDataExtensoAlteracao(a.dataAntes)} para ${formatarDataExtensoAlteracao(a.data)}, das ${formatarHoraAlteracao(a.horaAntes)} para as ${formatarHoraAlteracao(a.hora)}.`,
        ];
      }
      if (a.diaMudou) {
        return [`A explicação de ${a.disciplina} passa de ${formatarDataExtensoAlteracao(a.dataAntes)} para ${formatarDataExtensoAlteracao(a.data)}.`];
      }
      return [`A explicação de ${a.disciplina} passa das ${formatarHoraAlteracao(a.horaAntes)} para as ${formatarHoraAlteracao(a.hora)}.`];
    }
  }
}
