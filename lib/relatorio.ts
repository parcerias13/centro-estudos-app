import { endOfMonth, format, startOfMonth, subMonths } from 'date-fns';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getHojeLisboa } from './dataLisboa';

export type MetricasMes = {
  totalHoras: number;
  totalSessoes: number;
  /** Nome da disciplina com mais sessões no mês, já com a contagem — "-" se não houve nenhuma. */
  disciplinaPrincipal: string;
};

export type PayloadRelatorioMensal = {
  ano: number;
  mes: number; // 1-12
  horas: number;
  sessoes: number;
  disciplina_principal: string | null;
};

/** Ano e mês do mês anterior ao de hoje, sempre a partir de getHojeLisboa() — nunca do fuso do browser. */
export function mesAnteriorPorOmissao(): { ano: number; mes: number } {
  const hoje = new Date(`${getHojeLisboa()}T00:00:00`);
  const anterior = subMonths(hoje, 1);
  return { ano: anterior.getFullYear(), mes: anterior.getMonth() + 1 };
}

/** Intervalo [início, fim] do mês indicado, no mesmo formato de string (sem fuso) usado em diario_bordo.entrada. */
export function intervaloDoMes(ano: number, mes: number): { inicioISO: string; fimISO: string } {
  const referencia = new Date(ano, mes - 1, 1);
  return {
    inicioISO: format(startOfMonth(referencia), "yyyy-MM-dd'T'HH:mm:ss"),
    fimISO: format(endOfMonth(referencia), "yyyy-MM-dd'T'23:59:59"),
  };
}

/**
 * Mesmas métricas que app/admin/relatorio/page.tsx sempre calculou para o
 * aluno (horas acumuladas, nº de sessões, disciplina principal) — extraídas
 * para aqui e parametrizadas por ano/mês (o original só olhava para o mês
 * atual) para os números do envio em lote nunca divergirem dos da página
 * individual. Uma sessão sem saída ainda conta até agora (sessão "viva"),
 * exatamente como antes.
 */
export async function calcularMetricasMes(
  supabase: SupabaseClient,
  alunoId: string,
  ano: number,
  mes: number
): Promise<MetricasMes> {
  const { inicioISO, fimISO } = intervaloDoMes(ano, mes);
  const { data: entries, error } = await supabase
    .from('diario_bordo')
    .select('entrada, saida, subject_name')
    .eq('aluno_id', alunoId)
    .gte('entrada', inicioISO)
    .lte('entrada', fimISO);

  if (error) throw new Error(`calcularMetricasMes: ${error.message}`);

  let totalMs = 0;
  const porDisciplina: Record<string, number> = {};
  const agoraMs = Date.now();

  for (const e of entries || []) {
    if (!e.entrada) continue;
    const horaFim = e.saida ? new Date(e.saida).getTime() : agoraMs;
    const horaInicio = new Date(e.entrada).getTime();
    totalMs += horaFim - horaInicio;
    if (e.subject_name) porDisciplina[e.subject_name] = (porDisciplina[e.subject_name] || 0) + 1;
  }

  const topEntry = Object.entries(porDisciplina).sort((a, b) => b[1] - a[1])[0];

  return {
    totalHoras: Math.round(totalMs / (1000 * 60 * 60)),
    totalSessoes: (entries || []).length,
    disciplinaPrincipal: topEntry ? `${topEntry[0]} (${topEntry[1]}x)` : '-',
  };
}

/**
 * Payload do cartão tipo 'relatorio_mensal' — EXATAMENTE as chaves que os
 * dois cartões já desenham (app/admin/mensagens/page.tsx e
 * app/encarregados/mensagens/page.tsx): ano, mes, horas, sessoes,
 * disciplina_principal. Sempre < 16 KB (5 campos escalares).
 */
export function construirPayloadRelatorioMensal(ano: number, mes: number, metricas: MetricasMes): PayloadRelatorioMensal {
  return {
    ano,
    mes,
    horas: metricas.totalHoras,
    sessoes: metricas.totalSessoes,
    disciplina_principal: metricas.disciplinaPrincipal === '-' ? null : metricas.disciplinaPrincipal,
  };
}
