import { supabase } from '@/lib/supabase';

/**
 * Extras do centro (consumos + dias fora do horário) e dados de pagamento —
 * partilhado por /admin/pagamentos, a Lista do Dia e a Área dos Encarregados,
 * para os três nunca divergirem. As somas em si (RPCs) vivem na BD
 * (config_extras_centro, dias_fora_horario_mes, decidir_dia_fora_horario,
 * extras_do_mes, extras_mes_encarregado, dados_pagamento_centro); aqui só a
 * leitura/escrita a partir do cliente e a combinação pura dos resultados.
 */

// --- Configuração do centro (qualquer staff) ---

export type ConfigExtrasCentro = { valorDiaForaHorario: number; diaLimiteMensalidade: number };

function primeiraLinha<T>(data: T | T[] | null): T | null {
  if (Array.isArray(data)) return data[0] ?? null;
  return data ?? null;
}

export async function obterConfigExtrasCentro(): Promise<ConfigExtrasCentro> {
  const { data, error } = await supabase.rpc('config_extras_centro');
  if (error) throw error;
  const row: any = primeiraLinha(data);
  return {
    valorDiaForaHorario: Number(row?.valor_dia_fora_horario) || 0,
    diaLimiteMensalidade: Number.isInteger(row?.dia_limite_mensalidade) ? row.dia_limite_mensalidade : 8,
  };
}

// --- Dados de pagamento do centro (qualquer utilizador autenticado) ---

export type DadosPagamentoCentro = { beneficiario: string; iban: string };

export async function obterDadosPagamentoCentro(): Promise<DadosPagamentoCentro | null> {
  const { data, error } = await supabase.rpc('dados_pagamento_centro');
  if (error) throw error;
  const row: any = primeiraLinha(data);
  if (!row?.iban) return null;
  return { beneficiario: row.beneficiario, iban: row.iban };
}

// --- Extras do mês por aluno (consumos + dias fora, já agregados na BD) ---

export type ExtraAlunoDoMes = {
  alunoId: string;
  consumos: number;
  diasFora: number;
  total: number;
  pago: boolean;
  valorPago: number | null;
  dataPagamento: string | null;
  pagamentoId: string | null;
};

export interface TotalExtrasRaw {
  aluno_id: string;
  consumos: number | string | null;
  dias_fora: number | string | null;
  total: number | string | null;
}

export interface PagamentoExtraRaw {
  id: string;
  aluno_id: string;
  pago: boolean;
  valor_pago: number | string | null;
  data_pagamento: string | null;
}

function novaEntradaExtra(alunoId: string): ExtraAlunoDoMes {
  return { alunoId, consumos: 0, diasFora: 0, total: 0, pago: false, valorPago: null, dataPagamento: null, pagamentoId: null };
}

/**
 * Cálculo puro, sem Supabase — testável diretamente. `dias` é a lista (já
 * carregada, nunca pedida de novo aqui) de dias fora do horário do mês,
 * em qualquer estado — um aluno só com dias 'pendente' ou só 'dispensado'
 * não tem linha em `totais` (extras_do_mes só soma os aceites), mas ainda
 * assim precisa de entrada (a 0€) para aparecer em Pagamentos e o admin
 * poder decidir.
 */
export function calcularExtrasDoMes(
  totais: TotalExtrasRaw[],
  pagamentos: PagamentoExtraRaw[],
  dias: DiaForaHorarioLinha[] = []
): Record<string, ExtraAlunoDoMes> {
  const porAluno: Record<string, ExtraAlunoDoMes> = {};

  for (const t of totais) {
    porAluno[t.aluno_id] = {
      ...novaEntradaExtra(t.aluno_id),
      consumos: Number(t.consumos) || 0,
      diasFora: Number(t.dias_fora) || 0,
      total: Number(t.total) || 0,
    };
  }

  for (const d of dias) {
    if (!porAluno[d.alunoId]) porAluno[d.alunoId] = novaEntradaExtra(d.alunoId);
  }

  for (const p of pagamentos) {
    if (!porAluno[p.aluno_id]) porAluno[p.aluno_id] = novaEntradaExtra(p.aluno_id);
    const entry = porAluno[p.aluno_id];
    entry.pago = p.pago;
    entry.valorPago = p.valor_pago != null ? Number(p.valor_pago) : null;
    entry.dataPagamento = p.data_pagamento;
    entry.pagamentoId = p.id;
  }

  return porAluno;
}

/**
 * `dias` tem de vir já carregado pelo chamador (ex. obterDiasForaHorarioDoMes,
 * em paralelo com o resto) — nunca pedido aqui outra vez à RPC.
 */
export async function obterExtrasDoMes(
  centroId: string,
  ano: number,
  mes: number,
  dias: DiaForaHorarioLinha[]
): Promise<Record<string, ExtraAlunoDoMes>> {
  const [{ data: totaisData, error: errTotais }, { data: pagamentosData, error: errPagamentos }] = await Promise.all([
    supabase.rpc('extras_do_mes', { p_ano: ano, p_mes: mes }),
    supabase
      .from('pagamentos_extras')
      .select('id, aluno_id, pago, valor_pago, data_pagamento')
      .eq('centro_id', centroId)
      .eq('ano', ano)
      .eq('mes', mes),
  ]);
  if (errTotais) throw errTotais;
  if (errPagamentos) throw errPagamentos;
  return calcularExtrasDoMes(totaisData || [], pagamentosData || [], dias);
}

// --- Dias fora do horário (painel do admin) ---

export type EstadoDiaForaHorario = 'pendente' | 'aceite' | 'dispensado';

export type DiaForaHorarioLinha = {
  alunoId: string;
  dia: string;
  estado: EstadoDiaForaHorario;
  valor: number;
};

export async function obterDiasForaHorarioDoMes(ano: number, mes: number): Promise<DiaForaHorarioLinha[]> {
  const { data, error } = await supabase.rpc('dias_fora_horario_mes', { p_ano: ano, p_mes: mes });
  if (error) throw error;
  return (data || []).map((d: any) => ({
    alunoId: d.aluno_id,
    dia: d.dia,
    estado: d.estado,
    valor: Number(d.valor) || 0,
  }));
}

export async function decidirDiaForaHorario(alunoId: string, dia: string, estado: EstadoDiaForaHorario): Promise<void> {
  const { error } = await supabase.rpc('decidir_dia_fora_horario', { p_aluno: alunoId, p_dia: dia, p_estado: estado });
  if (error) throw error;
}

// --- "Fora do horário" na Lista do Dia (puro, sem Supabase) ---

/**
 * Um dia está "fora do horário" quando o aluno é de sala de estudo, está
 * ativo, tem pelo menos uma linha em aluno_horarios, e o dia da semana
 * pedido (diaSemanaLisboa(), nunca Date.getDay() local) não está entre os
 * seus horários. Não decide por si só se a funcionalidade está ligada — o
 * ponto de chamada deve também verificar valorDiaForaHorario > 0.
 */
export function alunoForaDoHorarioHoje(
  aluno: { ativo?: boolean | null; sala_estudo?: boolean | null; aluno_horarios?: { dia_semana: number }[] | null },
  diaSemanaHoje: number
): boolean {
  if (aluno.ativo === false) return false;
  if (aluno.sala_estudo === false) return false;
  const horarios = aluno.aluno_horarios ?? [];
  if (horarios.length === 0) return false;
  return !horarios.some((h) => h.dia_semana === diaSemanaHoje);
}
