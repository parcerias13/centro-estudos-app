import { format, isToday, isYesterday, isSameYear } from 'date-fns';

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
