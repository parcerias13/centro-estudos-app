import { format, isToday, isYesterday, isSameYear } from 'date-fns';

export type PedidoExplicacaoSeguro = {
  disciplinaId: number | null;
  disciplina: string | null;
  anoEscolar: number | null;
  dias: number[];
  horario: string | null;
  nota: string | null;
};

/**
 * O payload de um pedido_explicacao vem do cliente (a família escreve-o
 * diretamente) — nunca é de confiança. Esta função é o único sítio que lê
 * esse payload; todos os ecrãs que o mostram (banner de Explicações, cartão
 * da caixa do admin, cartão da família, pré-preenchimento de ?pedido=) usam
 * sempre o resultado daqui, nunca o payload bruto, para nunca desenhar um
 * objeto como filho do React nem confiar em tipos/valores inesperados
 * (nota como objeto, dias com lixo, disciplina_id não numérico, etc.).
 */
export function sanitizarPedidoExplicacao(payload: unknown): PedidoExplicacaoSeguro {
  const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const disciplinaId = Number.isInteger(p.disciplina_id) ? (p.disciplina_id as number) : null;
  const disciplina = typeof p.disciplina === 'string' ? p.disciplina.slice(0, 200) : null;
  const anoEscolar = Number.isInteger(p.ano_escolar) ? (p.ano_escolar as number) : null;
  const dias = Array.isArray(p.dias)
    ? p.dias.filter((d): d is number => Number.isInteger(d) && (d as number) >= 1 && (d as number) <= 7)
    : [];
  const horario = typeof p.horario === 'string' ? p.horario.slice(0, 120) : null;
  const nota = typeof p.nota === 'string' ? p.nota.slice(0, 500) : null;
  return { disciplinaId, disciplina, anoEscolar, dias, horario, nota };
}

/**
 * Hora/data de uma mensagem, só para apresentação (nunca para decidir nada
 * de negócio): de hoje "HH:mm", de outro dia "dd/MM HH:mm", de outro ano
 * "dd/MM/yy HH:mm".
 */
export function horaOuDataMensagem(iso: string): string {
  const data = new Date(iso);
  if (isToday(data)) return format(data, 'HH:mm');
  if (isSameYear(data, new Date())) return format(data, 'dd/MM HH:mm');
  return format(data, 'dd/MM/yy HH:mm');
}

/** Rótulo do separador de dia numa conversa: "Hoje", "Ontem", ou "dd/MM/yyyy". */
export function rotuloSeparadorDia(iso: string): string {
  const data = new Date(iso);
  if (isToday(data)) return 'Hoje';
  if (isYesterday(data)) return 'Ontem';
  return format(data, 'dd/MM/yyyy');
}

/**
 * Intercala separadores de dia numa lista ordenada cronologicamente (mais
 * antiga primeiro) — usado nos dois lados (família e admin) para que a
 * conversa mostre sempre o mesmo agrupamento por dia.
 */
export function comSeparadoresDeDia<T extends { id: string; criada_em: string }>(
  itens: T[]
): Array<{ tipo: 'separador'; chave: string; rotulo: string } | { tipo: 'item'; chave: string; item: T }> {
  const resultado: Array<{ tipo: 'separador'; chave: string; rotulo: string } | { tipo: 'item'; chave: string; item: T }> = [];
  let ultimoDia: string | null = null;
  for (const item of itens) {
    const dia = new Date(item.criada_em).toDateString();
    if (dia !== ultimoDia) {
      resultado.push({ tipo: 'separador', chave: `sep-${item.id}`, rotulo: rotuloSeparadorDia(item.criada_em) });
      ultimoDia = dia;
    }
    resultado.push({ tipo: 'item', chave: item.id, item });
  }
  return resultado;
}
