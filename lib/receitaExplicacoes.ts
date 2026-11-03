import { supabase } from '@/lib/supabase';
import { mesParaData, ultimoDiaDoMes } from '@/lib/custos';

/**
 * Receita de explicações (o que as famílias pagam) — partilhada por
 * Pagamentos (aba Mensalidades) e Performance, para os dois nunca
 * divergirem (mesma razão de ser que obterCustosDoMes em lib/custos.ts e
 * obterRemuneracaoDoMes em lib/remuneracaoProfessores.ts). Isto é só o lado
 * da RECEITA (família → centro); o custo do professor por dar a sessão já
 * está em lib/remuneracaoProfessores.ts e não é tocado aqui.
 *
 * O pagamento por aluno/mês é um booleano (pagamentos_explicacoes_familia) +
 * valor_pago opcional: quando marcado pago SEM valor_pago definido (linhas
 * antigas, antes desta coluna existir), conta-se o esperado ATUAL desse
 * aluno — nunca um valor congelado no passado. Com valor_pago definido
 * (fluxo novo), é esse valor que conta, mesmo que o esperado suba depois
 * (mais uma sessão dada após marcar pago) — por isso entra "em falta" > 0
 * nesse aluno, embora pago:true.
 */

export interface SessaoExplicacaoFamilia {
  data: string;
  disciplina: string;
  professor: string;
  valor: number | null;
}

export interface ReceitaExplicacoesAluno {
  alunoId: string;
  nome: string;
  ativo: boolean;
  esperado: number;
  pago: number;
  emFalta: number;
  pagoRegistrado: boolean;
  dataPagamento: string | null;
  valorPagoRegistrado: number | null; // valor_pago em bruto da BD — null = não pago, ou linha antiga sem este valor
  pagamentoId: string | null;
  semPrecoCount: number; // sessões dadas deste aluno, sem valor_cobrado_familia
  sessoes: SessaoExplicacaoFamilia[];
}

export interface ReceitaExplicacoesDoMes {
  porAluno: Record<string, ReceitaExplicacoesAluno>;
  totalEsperado: number;
  totalPago: number;
  totalEmFalta: number;
  sessoesSemPrecoTotal: number;
}

// --- Linhas em bruto (o que vem do Supabase, já achatado por aluno) ---

export interface SessaoExplicacaoRaw {
  aluno_id: string;
  nome: string;
  ativo: boolean;
  data: string;
  disciplina: string;
  professor: string;
  valor_cobrado_familia: number | null;
}

export interface PagamentoExplicacaoRaw {
  id: string;
  aluno_id: string;
  pago: boolean;
  data_pagamento: string | null;
  valor_pago: number | null;
}

function novaEntrada(alunoId: string, nome: string, ativo: boolean): ReceitaExplicacoesAluno {
  return {
    alunoId,
    nome,
    ativo,
    esperado: 0,
    pago: 0,
    emFalta: 0,
    pagoRegistrado: false,
    dataPagamento: null,
    valorPagoRegistrado: null,
    pagamentoId: null,
    semPrecoCount: 0,
    sessoes: [],
  };
}

/**
 * Cálculo puro, sem Supabase — testável diretamente. `sessoes` já deve vir
 * filtrada a um mês e a `dado = true` e `estado = 'ativa'` (uma sessão
 * cancelada nunca conta, mesmo que por algum motivo tenha dado = true).
 * Inclui alunos inativos com sessões (a dívida de uma sessão já dada existe,
 * inativo ou não) — decisão igual à de /admin/pagamentos.
 */
export function calcularReceitaExplicacoesDoMes(
  sessoes: SessaoExplicacaoRaw[],
  pagamentos: PagamentoExplicacaoRaw[]
): ReceitaExplicacoesDoMes {
  const porAluno: Record<string, ReceitaExplicacoesAluno> = {};

  for (const s of sessoes) {
    if (!porAluno[s.aluno_id]) porAluno[s.aluno_id] = novaEntrada(s.aluno_id, s.nome, s.ativo);
    const entry = porAluno[s.aluno_id];
    if (s.valor_cobrado_familia != null) entry.esperado += Number(s.valor_cobrado_familia);
    else entry.semPrecoCount += 1;
    entry.sessoes.push({ data: s.data, disciplina: s.disciplina, professor: s.professor, valor: s.valor_cobrado_familia });
  }

  for (const p of pagamentos) {
    if (!porAluno[p.aluno_id]) porAluno[p.aluno_id] = novaEntrada(p.aluno_id, '', true);
    const entry = porAluno[p.aluno_id];
    entry.pagoRegistrado = p.pago;
    entry.dataPagamento = p.data_pagamento;
    entry.valorPagoRegistrado = p.valor_pago != null ? Number(p.valor_pago) : null;
    entry.pagamentoId = p.id;
  }

  let totalEsperado = 0;
  let totalPago = 0;
  let sessoesSemPrecoTotal = 0;
  for (const entry of Object.values(porAluno)) {
    const pago = entry.pagoRegistrado ? (entry.valorPagoRegistrado ?? entry.esperado) : 0;
    entry.pago = pago;
    entry.emFalta = entry.esperado - pago;
    totalEsperado += entry.esperado;
    totalPago += pago;
    sessoesSemPrecoTotal += entry.semPrecoCount;
  }

  return { porAluno, totalEsperado, totalPago, totalEmFalta: totalEsperado - totalPago, sessoesSemPrecoTotal };
}

/**
 * Aplica, localmente (sem nova leitura à BD), o resultado de um upsert em
 * pagamentos_explicacoes_familia a uma ReceitaExplicacoesDoMes já carregada
 * — usado pela UI para atualizar o estado otimista após marcar/desmarcar
 * pago, sem recalcular tudo a partir do zero nem perder os dados de sessões
 * já carregados para esse aluno.
 */
export function aplicarPagamentoNaReceita(
  receita: ReceitaExplicacoesDoMes,
  alunoId: string,
  pagamento: PagamentoExplicacaoRaw
): ReceitaExplicacoesDoMes {
  const existente = receita.porAluno[alunoId] ?? novaEntrada(alunoId, '', true);
  const entry: ReceitaExplicacoesAluno = {
    ...existente,
    pagoRegistrado: pagamento.pago,
    dataPagamento: pagamento.data_pagamento,
    valorPagoRegistrado: pagamento.valor_pago != null ? Number(pagamento.valor_pago) : null,
    pagamentoId: pagamento.id,
  };
  entry.pago = entry.pagoRegistrado ? (entry.valorPagoRegistrado ?? entry.esperado) : 0;
  entry.emFalta = entry.esperado - entry.pago;

  const porAluno = { ...receita.porAluno, [alunoId]: entry };
  let totalEsperado = 0;
  let totalPago = 0;
  let sessoesSemPrecoTotal = 0;
  for (const e of Object.values(porAluno)) {
    totalEsperado += e.esperado;
    totalPago += e.pago;
    sessoesSemPrecoTotal += e.semPrecoCount;
  }
  return { porAluno, totalEsperado, totalPago, totalEmFalta: totalEsperado - totalPago, sessoesSemPrecoTotal };
}

// --- Leitura (cliente do utilizador, nunca chave de serviço) ---

/**
 * Busca e calcula a receita de explicações de um mês para um centro, por
 * aluno e no total. Usada por /admin/pagamentos (aba Mensalidades) e por
 * /admin/performance — a mesma função, para os dois nunca mostrarem números
 * diferentes.
 */
export async function obterReceitaExplicacoesDoMes(
  centroId: string,
  ano: number,
  mes: number
): Promise<ReceitaExplicacoesDoMes> {
  const mesStr = `${ano}-${String(mes).padStart(2, '0')}`;
  const inicioMes = mesParaData(mesStr);
  const fimMes = ultimoDiaDoMes(mesStr);

  const [{ data: sessoesData, error: errSessoes }, { data: pagamentosData, error: errPagamentos }] = await Promise.all([
    supabase
      .from('explicacoes')
      .select('data, subjects(name), staff(name), explicacoes_alunos(aluno_id, valor_cobrado_familia, alunos(nome, ativo))')
      .eq('centro_id', centroId)
      .eq('dado', true)
      .eq('estado', 'ativa')
      .gte('data', inicioMes)
      .lte('data', fimMes),
    // pagamentos_explicacoes_familia não tem centro_id (RLS protege via
    // alunos.centro_id) — mesma convenção já usada em /admin/pagamentos.
    supabase.from('pagamentos_explicacoes_familia').select('id, aluno_id, pago, data_pagamento, valor_pago').eq('ano', ano).eq('mes', mes),
  ]);

  if (errSessoes) throw errSessoes;
  if (errPagamentos) throw errPagamentos;

  const sessoesRaw: SessaoExplicacaoRaw[] = [];
  for (const exp of sessoesData || []) {
    const disciplina = (exp as any).subjects?.name || 'Sem disciplina';
    const professor = (exp as any).staff?.name || '—';
    for (const ea of (exp as any).explicacoes_alunos || []) {
      const alunoInfo = Array.isArray(ea.alunos) ? ea.alunos[0] : ea.alunos;
      sessoesRaw.push({
        aluno_id: ea.aluno_id,
        nome: alunoInfo?.nome || 'Desconhecido',
        ativo: alunoInfo?.ativo ?? true,
        data: (exp as any).data,
        disciplina,
        professor,
        valor_cobrado_familia: ea.valor_cobrado_familia,
      });
    }
  }

  const pagamentosRaw: PagamentoExplicacaoRaw[] = (pagamentosData || []).map((p: any) => ({
    id: p.id,
    aluno_id: p.aluno_id,
    pago: p.pago,
    data_pagamento: p.data_pagamento,
    valor_pago: p.valor_pago,
  }));

  return calcularReceitaExplicacoesDoMes(sessoesRaw, pagamentosRaw);
}
