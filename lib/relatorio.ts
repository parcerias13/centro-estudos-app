import { endOfMonth, format, startOfMonth } from 'date-fns';
import type { SupabaseClient } from '@supabase/supabase-js';

export type MetricasMes = {
  totalHoras: number;
  totalSessoes: number;
  /** Nome da disciplina com mais sessões no mês, já com a contagem — "-" se não houve nenhuma. */
  disciplinaPrincipal: string;
};

/** Intervalo [início, fim] do mês indicado, no mesmo formato de string (sem fuso) usado em diario_bordo.entrada. */
export function intervaloDoMes(ano: number, mes: number): { inicioISO: string; fimISO: string } {
  const referencia = new Date(ano, mes - 1, 1);
  return {
    inicioISO: format(startOfMonth(referencia), "yyyy-MM-dd'T'HH:mm:ss"),
    fimISO: format(endOfMonth(referencia), "yyyy-MM-dd'T'23:59:59"),
  };
}

/**
 * Métricas de app/admin/relatorio/page.tsx (horas acumuladas, nº de
 * sessões, disciplina principal), parametrizadas por ano/mês. Uma sessão
 * sem saída ainda conta até agora (sessão "viva").
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
