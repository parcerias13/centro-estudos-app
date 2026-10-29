import { supabase } from '@/lib/supabase';
import { valorNoMes, mesParaData, ultimoDiaDoMes, type PeriodoCustoFixo } from '@/lib/custos';

/**
 * Remuneração de professores — partilhada por Pagamentos ("A Pagar") e
 * Performance, para os dois nunca divergirem (mesma razão de ser que
 * obterCustosDoMes em lib/custos.ts). Reutiliza valorNoMes sem a alterar:
 * um período de salário ou de valor-por-dia tem exatamente a forma
 * { de, ate, valor } que essa função já espera.
 *
 * O tipo de um professor é IMPLÍCITO por mês: se tiver um período 'salario'
 * que cubra esse mês, é de salário nesse mês; senão é variável — mesmo que
 * tenha sido de outro tipo noutros meses. Nunca há uma tabela "tipo de
 * remuneração" à parte.
 */

export type TipoRemuneracaoMes = 'salario' | 'variavel';

export interface PeriodoValorProfessor extends PeriodoCustoFixo {
  professorId: string;
  tipo: 'salario' | 'valor_dia';
}

export interface SessaoProfessor {
  data: string;
  disciplina: string;
  alunos: string;
  horas: number;
  valor: number;
}

export interface DiaTrabalhoProfessor {
  data: string;
  fracao: number;
}

export interface RemuneracaoProfessorNoMes {
  professorId: string;
  nome: string;
  tipo: TipoRemuneracaoMes;
  tarifaDefinida: boolean; // staff.tarifa_tipo — só importa para variável
  salarioMes: number; // > 0 só quando tipo === 'salario'
  valorDiaAtivo: number | null; // valor do período 'valor_dia' ativo no mês (null = sem período)
  diasTrabalho: DiaTrabalhoProfessor[];
  somaDias: number; // soma das fração (0.5/1) do mês — sempre calculada, só entra no total se variável
  valorDias: number; // somaDias * valorDiaAtivo, 0 se salário
  sessoes: SessaoProfessor[];
  sessoesDadas: number;
  horasTotais: number;
  valorSessoes: number; // soma de valor_calculado — 0 se salário (decisão: sessões de salário não somam)
  ajusteValor: number;
  ajusteNota: string | null;
  pago: boolean;
  dataPagamento: string | null;
  total: number;
  semTarifaAviso: boolean; // variável, sem tarifa definida, com sessões dadas no mês
}

export interface RemuneracaoDoMes {
  linhas: RemuneracaoProfessorNoMes[];
  totalGeral: number;
}

/** 'salario' se houver um período 'salario' a cobrir `mes`; 'variavel' senão. */
export function tipoNoMes(periodosSalario: PeriodoCustoFixo[], mes: string): TipoRemuneracaoMes {
  return valorNoMes(periodosSalario, mes) != null ? 'salario' : 'variavel';
}

/** Períodos (salário e valor-por-dia) de UM professor — para o modal de Equipa. */
export async function obterPeriodosDoProfessor(
  professorId: string
): Promise<{ salario: PeriodoCustoFixo[]; valorDia: PeriodoCustoFixo[] }> {
  const { data, error } = await supabase
    .from('periodos_valor_professor')
    .select('id, tipo, de, ate, valor')
    .eq('professor_id', professorId)
    .order('de', { ascending: true });
  if (error) throw error;

  const salario: PeriodoCustoFixo[] = [];
  const valorDia: PeriodoCustoFixo[] = [];
  for (const p of data || []) {
    const periodo: PeriodoCustoFixo = { id: p.id, de: p.de, ate: p.ate, valor: Number(p.valor) };
    if (p.tipo === 'salario') salario.push(periodo);
    else valorDia.push(periodo);
  }
  return { salario, valorDia };
}

/**
 * Remuneração de todos os professores do centro num mês: tipo implícito,
 * salário ou (sessões + dias) conforme o tipo, ajuste, e total. Usada tanto
 * por "A Pagar" como por Performance — nunca cada página a calcular por si.
 *
 * Quem aparece na UI é decisão de quem usa esta função (ver nota em cada
 * página): um professor de salário "total" nunca é zero a não ser que
 * também tenha um ajuste negativo exato a anular o salário, mas mesmo
 * entrando aqui sempre com uma linha; um variável sem sessões, sem dias e
 * sem ajuste tem todos os valores a zero, pelo que filtrá-lo da lista não
 * muda nenhuma soma (totalGeral já o conta como zero).
 */
export async function obterRemuneracaoDoMes(centroId: string, ano: number, mes: number): Promise<RemuneracaoDoMes> {
  const mesStr = `${ano}-${String(mes).padStart(2, '0')}`;
  const inicioMes = mesParaData(mesStr);
  const fimMes = ultimoDiaDoMes(mesStr);

  const [
    { data: professoresData, error: errProf },
    { data: periodosData, error: errPer },
    { data: diasData, error: errDias },
    { data: sessoesData, error: errSess },
    { data: pagamentosData, error: errPag },
  ] = await Promise.all([
    supabase.from('staff').select('id, name, tarifa_tipo').eq('centro_id', centroId).eq('role', 'professor').order('name'),
    supabase.from('periodos_valor_professor').select('professor_id, tipo, de, ate, valor').eq('centro_id', centroId),
    supabase.from('dias_trabalho_professor').select('professor_id, data, fracao').eq('centro_id', centroId).gte('data', inicioMes).lte('data', fimMes),
    supabase
      .from('explicacoes')
      .select('professor_id, data, horas_dadas, valor_calculado, subjects(name), explicacoes_alunos(alunos(nome))')
      .eq('centro_id', centroId)
      .eq('dado', true)
      .gte('data', inicioMes)
      .lte('data', fimMes),
    supabase.from('pagamentos_professores').select('professor_id, pago, data_pagamento, ajuste_valor, ajuste_nota').eq('centro_id', centroId).eq('ano', ano).eq('mes', mes),
  ]);

  const erro = errProf || errPer || errDias || errSess || errPag;
  if (erro) throw erro;

  // Períodos por professor e por tipo — mesma forma { de, ate, valor } que valorNoMes já espera.
  const periodosSalarioPorProf: Record<string, PeriodoCustoFixo[]> = {};
  const periodosDiaPorProf: Record<string, PeriodoCustoFixo[]> = {};
  for (const p of periodosData || []) {
    const alvo = p.tipo === 'salario' ? periodosSalarioPorProf : periodosDiaPorProf;
    if (!alvo[p.professor_id]) alvo[p.professor_id] = [];
    alvo[p.professor_id].push({ de: p.de, ate: p.ate, valor: Number(p.valor) });
  }

  const diasPorProf: Record<string, DiaTrabalhoProfessor[]> = {};
  for (const d of diasData || []) {
    if (!diasPorProf[d.professor_id]) diasPorProf[d.professor_id] = [];
    diasPorProf[d.professor_id].push({ data: d.data, fracao: Number(d.fracao) });
  }

  const sessoesPorProf: Record<string, SessaoProfessor[]> = {};
  for (const s of sessoesData || []) {
    if (!sessoesPorProf[s.professor_id]) sessoesPorProf[s.professor_id] = [];
    const alunos = (s.explicacoes_alunos || []).map((ea: any) => ea.alunos?.nome).filter(Boolean).join(', ');
    sessoesPorProf[s.professor_id].push({
      data: s.data,
      disciplina: (s as any).subjects?.name || 'Sem disciplina',
      alunos: alunos || '—',
      horas: Number(s.horas_dadas) || 0,
      valor: Number(s.valor_calculado) || 0,
    });
  }

  const pagamentoPorProf: Record<string, { pago: boolean; data_pagamento: string | null; ajuste_valor: number; ajuste_nota: string | null }> = {};
  for (const pg of pagamentosData || []) {
    pagamentoPorProf[pg.professor_id] = {
      pago: pg.pago,
      data_pagamento: pg.data_pagamento,
      ajuste_valor: Number(pg.ajuste_valor) || 0,
      ajuste_nota: pg.ajuste_nota,
    };
  }

  let totalGeral = 0;
  const linhas: RemuneracaoProfessorNoMes[] = (professoresData || []).map((p: any) => {
    const tipo = tipoNoMes(periodosSalarioPorProf[p.id] || [], mesStr);
    const sessoes = sessoesPorProf[p.id] || [];
    const diasTrabalho = diasPorProf[p.id] || [];
    const somaDias = diasTrabalho.reduce((acc, d) => acc + d.fracao, 0);
    const valorDiaAtivo = valorNoMes(periodosDiaPorProf[p.id] || [], mesStr);
    const pagamento = pagamentoPorProf[p.id];
    const ajusteValor = pagamento?.ajuste_valor || 0;

    const salarioMes = tipo === 'salario' ? valorNoMes(periodosSalarioPorProf[p.id] || [], mesStr) || 0 : 0;
    const valorSessoes = tipo === 'variavel' ? sessoes.reduce((acc, s) => acc + s.valor, 0) : 0;
    const valorDias = tipo === 'variavel' ? somaDias * (valorDiaAtivo || 0) : 0;
    const total = tipo === 'salario' ? salarioMes + ajusteValor : valorSessoes + valorDias + ajusteValor;

    totalGeral += total;

    return {
      professorId: p.id,
      nome: p.name,
      tipo,
      tarifaDefinida: !!p.tarifa_tipo,
      salarioMes,
      valorDiaAtivo,
      diasTrabalho,
      somaDias,
      valorDias,
      sessoes,
      sessoesDadas: sessoes.length,
      horasTotais: sessoes.reduce((acc, s) => acc + s.horas, 0),
      valorSessoes,
      ajusteValor,
      ajusteNota: pagamento?.ajuste_nota ?? null,
      pago: pagamento?.pago ?? false,
      dataPagamento: pagamento?.data_pagamento ?? null,
      total,
      semTarifaAviso: tipo === 'variavel' && !p.tarifa_tipo && sessoes.length > 0,
    };
  });

  return { linhas, totalGeral };
}
